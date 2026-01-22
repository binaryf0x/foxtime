use actix_web::{
    App, HttpResponse, HttpServer, Responder, get, http::header, middleware, route, web,
};
use actix_web_rust_embed_responder::IntoResponse;
use clap::Parser;
use rust_embed_for_web::EmbedableFile;
use rust_embed_for_web::RustEmbed;
use std::{fs::File, io::BufReader, time::SystemTime};

#[derive(Parser, Debug)]
#[command(version, about, long_about = None)]
struct Args {
    #[arg(long, conflicts_with = "unix", default_value_t = String::from("127.0.0.1"))]
    host: String,

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
}

#[derive(RustEmbed)]
#[folder = "dist/"]
struct Asset;

#[get("/")]
async fn index() -> impl Responder {
    let index = Asset::get("index.html").unwrap().data();
    let contents = std::str::from_utf8(index.as_ref()).unwrap();

    match SystemTime::now().duration_since(SystemTime::UNIX_EPOCH) {
        Ok(timestamp) => {
            // Use as_millis_f64() when available:
            // https://github.com/rust-lang/rust/issues/122451
            let timestamp_str = (timestamp.as_secs_f64() * 1_000.0).to_string();
            let body = contents.replace("{{INITIAL_SERVER_TIME}}", &timestamp_str);

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

#[actix_web::main]
async fn main() -> std::io::Result<()> {
    let args = Args::parse();

    let mut server = HttpServer::new(|| {
        App::new()
            .wrap(middleware::Compress::default())
            .service(time)
            .service(index)
            .service(static_file)
    });

    if let Some(unix) = args.unix {
        server = server.bind_uds(unix)?;
    } else if args.h2c {
        server = server.bind_auto_h2c((args.host.as_str(), args.port))?;
    } else if let (Some(cert), Some(key)) = (args.tls_cert, args.tls_key) {
        rustls::crypto::aws_lc_rs::default_provider()
            .install_default()
            .unwrap();

        let mut certs_file = BufReader::new(File::open(cert).unwrap());
        let mut key_file = BufReader::new(File::open(key).unwrap());

        let tls_certs = rustls_pemfile::certs(&mut certs_file)
            .collect::<Result<Vec<_>, _>>()
            .unwrap();
        let tls_key = rustls_pemfile::pkcs8_private_keys(&mut key_file)
            .next()
            .unwrap()
            .unwrap();

        let tls_config = rustls::ServerConfig::builder()
            .with_no_client_auth()
            .with_single_cert(tls_certs, rustls::pki_types::PrivateKeyDer::Pkcs8(tls_key))
            .unwrap();

        server = server.bind_rustls_0_23((args.host.as_str(), args.port), tls_config)?;
    } else {
        server = server.bind((args.host.as_str(), args.port))?;
    }

    server.run().await
}
