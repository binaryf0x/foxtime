use actix_web::{
    App, HttpResponse, HttpServer, Responder, get, http::header, middleware, route, web,
};
use actix_web_rust_embed_responder::IntoResponse;
use clap::Parser;
use rust_embed_for_web::EmbedableFile;
use rust_embed_for_web::RustEmbed;
use std::{fs::File, io::BufReader, time::SystemTime, time::UNIX_EPOCH};

#[derive(Parser, Debug)]
#[command(version, about, long_about = None)]
struct Args {
    #[arg(long, default_value_t = false)]
    listen_any: bool,

    #[arg(long, conflicts_with = "unix", default_value_t = 8123)]
    port: u16,

    #[arg(long, conflicts_with = "unix", default_value_t = false)]
    h2c: bool,

    #[arg(long, conflicts_with = "tls_cert", conflicts_with = "tls_key")]
    unix: Option<String>,

    #[arg(long, requires = "tls_key", conflicts_with = "h2c")]
    tls_cert: Option<String>,

    #[arg(long, requires = "tls_cert", conflicts_with = "h2c")]
    tls_key: Option<String>,

    #[arg(long, default_value_t = false)]
    web_transport: bool,

    #[arg(long, default_value_t = 8123)]
    web_transport_port: u16,
}

#[derive(RustEmbed)]
#[folder = "dist/"]
struct Asset;

struct WebTransportData {
    port: u16,
    cert_hash: String,
}

#[get("/")]
async fn index(web_transport: web::Data<Option<WebTransportData>>) -> impl Responder {
    let index = Asset::get("index.html").unwrap().data();
    let contents = std::str::from_utf8(index.as_ref()).unwrap();

    match SystemTime::now().duration_since(SystemTime::UNIX_EPOCH) {
        Ok(timestamp) => {
            // Use as_millis_f64() when available:
            // https://github.com/rust-lang/rust/issues/122451
            let timestamp_str = (timestamp.as_secs_f64() * 1_000.0).to_string();
            let mut body = contents.replace("{{INITIAL_SERVER_TIME}}", &timestamp_str);

            if let Some(wt) = web_transport.as_ref() {
                body = body.replace("{{WEB_TRANSPORT_PORT}}", &wt.port.to_string());
                body = body.replace("{{WEB_TRANSPORT_CERT}}", &wt.cert_hash);
            } else {
                body = body.replace("{{WEB_TRANSPORT_PORT}}", "0");
                body = body.replace("{{WEB_TRANSPORT_CERT}}", "");
            }

            HttpResponse::Ok()
                .content_type(header::ContentType::html())
                .insert_header((header::CROSS_ORIGIN_OPENER_POLICY, "same-origin"))
                .insert_header((header::CROSS_ORIGIN_EMBEDDER_POLICY, "require-corp"))
                .body(body)
        }
        _ => HttpResponse::InternalServerError().finish(),
    }
}

#[route("/.well-known/time", method = "GET", method = "HEAD")]
async fn time() -> impl Responder {
    match SystemTime::now().duration_since(SystemTime::UNIX_EPOCH) {
        Ok(timestamp) => HttpResponse::Ok()
            .insert_header(("x-httpstime", timestamp.as_secs_f64().to_string()))
            .finish(),
        _ => HttpResponse::InternalServerError().finish(),
    }
}

#[get("/{path:.*}")]
async fn static_file(path: web::Path<String>) -> impl Responder {
    Asset::get(path.as_str())
        .into_response()
        .customize()
        .insert_header((header::CROSS_ORIGIN_OPENER_POLICY, "same-origin"))
        .insert_header((header::CROSS_ORIGIN_EMBEDDER_POLICY, "require-corp"))
}

async fn handle_session(
    incoming_session: wtransport::endpoint::IncomingSession,
) -> anyhow::Result<()> {
    let session_request = incoming_session.await?;

    if session_request.path() != "/.well-known/time" {
        session_request.not_found().await;
        return Ok(());
    }

    let session = session_request.accept().await?;

    log::info!("New session accepted from {}", session.remote_address());

    loop {
        tokio::select! {
            datagram = session.receive_datagram() => {
                let datagram = datagram?;
                if datagram.len() >= 8 {
                    let client_ts = &datagram[..8];
                    let server_ts = SystemTime::now().duration_since(UNIX_EPOCH)?.as_secs_f64();

                    let mut response = Vec::with_capacity(16);
                    response.extend_from_slice(client_ts);
                    response.extend_from_slice(&server_ts.to_le_bytes());

                    session.send_datagram(&response)?;
                }
            }
            _ = session.closed() => {
                log::info!("Session closed");
                break;
            }
        }
    }

    Ok(())
}

async fn run_webtransport(config: wtransport::ServerConfig) -> anyhow::Result<()> {
    let endpoint = wtransport::Endpoint::server(config)?;

    loop {
        let incoming_session = endpoint.accept().await;
        tokio::spawn(async move {
            if let Err(e) = handle_session(incoming_session).await {
                log::error!("Session error: {:?}", e);
            }
        });
    }
}

#[actix_web::main]
async fn main() -> anyhow::Result<()> {
    env_logger::init();

    let args = Args::parse();

    let wt_data = if args.web_transport {
        let (identity, is_self_signed) =
            if let (Some(cert_path), Some(key_path)) = (&args.tls_cert, &args.tls_key) {
                (
                    wtransport::Identity::load_pemfiles(cert_path, key_path).await?,
                    false,
                )
            } else {
                (wtransport::Identity::self_signed(["localhost"])?, true)
            };

        let mut cert_hash = String::new();
        if is_self_signed {
            for cert in identity.certificate_chain().as_slice() {
                use base64::Engine;
                let hash = base64::engine::general_purpose::STANDARD.encode(cert.hash().as_ref());
                log::info!("Certificate SHA-256 fingerprint (base64): {}", hash);
                if cert_hash.is_empty() {
                    cert_hash = hash;
                }
            }
        }

        let config = wtransport::ServerConfig::builder()
            .with_bind_config(
                if args.listen_any {
                    wtransport::config::IpBindConfig::InAddrAnyDual
                } else {
                    wtransport::config::IpBindConfig::LocalDual
                },
                args.web_transport_port,
            )
            .with_identity(identity)
            .build();

        tokio::spawn(async move {
            if let Err(e) = run_webtransport(config).await {
                log::error!("WebTransport server error: {:?}", e);
            }
        });

        Some(WebTransportData {
            port: args.web_transport_port,
            cert_hash,
        })
    } else {
        None
    };

    let wt_data = web::Data::new(wt_data);

    let mut server = HttpServer::new(move || {
        App::new()
            .app_data(wt_data.clone())
            .wrap(middleware::Logger::default())
            .service(time)
            .service(index)
            .service(static_file)
    });

    if let Some(unix) = args.unix {
        server = server.bind_uds(unix)?;
    } else if args.h2c {
        server = if args.listen_any {
            server.bind_auto_h2c((std::net::Ipv6Addr::UNSPECIFIED, args.port))?
        } else {
            server
                .bind_auto_h2c((std::net::Ipv4Addr::LOCALHOST, args.port))?
                .bind_auto_h2c((std::net::Ipv6Addr::LOCALHOST, args.port))?
        };
    } else if let (Some(cert), Some(key)) = (args.tls_cert, args.tls_key) {
        rustls::crypto::aws_lc_rs::default_provider()
            .install_default()
            .unwrap();

        let mut certs_file = BufReader::new(File::open(cert).unwrap());
        let mut key_file = BufReader::new(File::open(key).unwrap());

        let tls_certs = rustls_pemfile::certs(&mut certs_file)
            .collect::<Result<Vec<_>, _>>()
            .unwrap();
        let tls_key = rustls_pemfile::private_key(&mut key_file).unwrap().unwrap();

        let tls_config = rustls::ServerConfig::builder()
            .with_no_client_auth()
            .with_single_cert(tls_certs, tls_key)
            .unwrap();

        server = if args.listen_any {
            server.bind_rustls_0_23((std::net::Ipv6Addr::UNSPECIFIED, args.port), tls_config)?
        } else {
            server
                .bind_rustls_0_23(
                    (std::net::Ipv4Addr::LOCALHOST, args.port),
                    tls_config.clone(),
                )?
                .bind_rustls_0_23((std::net::Ipv6Addr::LOCALHOST, args.port), tls_config)?
        };
    } else {
        server = if args.listen_any {
            server.bind((std::net::Ipv6Addr::UNSPECIFIED, args.port))?
        } else {
            server
                .bind((std::net::Ipv4Addr::LOCALHOST, args.port))?
                .bind((std::net::Ipv6Addr::LOCALHOST, args.port))?
        };
    }

    server.run().await?;

    Ok(())
}
