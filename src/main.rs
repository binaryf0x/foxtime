use std::time::{SystemTime, SystemTimeError};

use actix_web::{App, HttpResponse, HttpServer, Responder, get, http::header, middleware};
use clap::Parser;

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

fn timestamp() -> Result<String, SystemTimeError> {
    let timestamp = SystemTime::now().duration_since(SystemTime::UNIX_EPOCH)?;
    Ok(format!(
        "{}.{:03}",
        timestamp.as_millis(),
        timestamp.subsec_micros() % 1_000
    ))
}

#[get("/")]
async fn index() -> impl Responder {
    match timestamp() {
        Ok(timestamp) => HttpResponse::Ok()
            .content_type(header::ContentType::html())
            .insert_header(header::CacheControl(vec![header::CacheDirective::NoStore]))
            .insert_header((header::CROSS_ORIGIN_OPENER_POLICY, "same-origin"))
            .insert_header((header::CROSS_ORIGIN_EMBEDDER_POLICY, "require-corp"))
            .body(include_str!("index.html").replace("INITIAL_SERVER_TIME", &timestamp)),
        _ => HttpResponse::InternalServerError().finish(),
    }
}

#[get("/time")]
async fn time() -> impl Responder {
    match timestamp() {
        Ok(timestamp) => HttpResponse::Ok()
            .content_type(header::ContentType::json())
            .insert_header(header::ContentEncoding::Identity)
            .insert_header(header::CacheControl(vec![header::CacheDirective::NoStore]))
            .body(timestamp),
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
