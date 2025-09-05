use actix_web::{App, HttpResponse, HttpServer, Responder, get, http::header, middleware};
use clap::Parser;
use std::time::SystemTime;

#[derive(Parser, Debug)]
#[command(version, about, long_about = None)]
struct Args {
    #[arg(short, long, conflicts_with = "unix", default_value_t = String::from("127.0.0.1"))]
    host: String,

    #[arg(short, long, group = "bind", default_value_t = 8123)]
    port: u16,

    #[arg(short, long, group = "bind")]
    unix: Option<String>,
}

#[get("/")]
async fn index() -> impl Responder {
    match SystemTime::now().duration_since(SystemTime::UNIX_EPOCH) {
        Ok(duration) => {
            let timestamp = format!(
                "{}.{:03}",
                duration.as_millis(),
                duration.subsec_micros() % 1_000
            );
            HttpResponse::Ok()
                .content_type(header::ContentType::html())
                .insert_header((header::CROSS_ORIGIN_OPENER_POLICY, "same-origin"))
                .insert_header((header::CROSS_ORIGIN_EMBEDDER_POLICY, "require-corp"))
                .body(include_str!("index.html").replace("INITIAL_SERVER_TIME", &timestamp))
        }
        _ => HttpResponse::InternalServerError().finish(),
    }
}

#[get("/.well-known/time")]
async fn time() -> impl Responder {
    match SystemTime::now().duration_since(SystemTime::UNIX_EPOCH) {
        Ok(duration) => HttpResponse::Ok()
            .insert_header(("x-httpstime", duration.as_secs_f64().to_string()))
            .finish(),
        _ => HttpResponse::InternalServerError().finish(),
    }
}

#[actix_web::main]
async fn main() -> std::io::Result<()> {
    let args = Args::parse();

    let mut server = HttpServer::new(|| {
        App::new()
            .wrap(middleware::Compress::default())
            .service(index)
            .service(time)
    });

    if let Some(unix) = args.unix {
        server = server.bind_uds(unix)?;
    } else {
        server = server.bind((args.host.as_str(), args.port))?;
    }

    server.run().await
}
