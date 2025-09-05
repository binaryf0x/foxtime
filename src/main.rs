use std::time::SystemTime;

use actix_web::{get, App, HttpResponse, HttpServer, Responder};
use actix_web::http::header::ContentType;

#[get("/")]
async fn index() -> impl Responder {
    HttpResponse::Ok()
        .content_type(ContentType::html())
        .body(include_str!("index.html"))
}

#[get("/time")]
async fn time() -> impl Responder {
    match SystemTime::now().duration_since(SystemTime::UNIX_EPOCH) {
        Ok(timestamp) => timestamp.as_millis().to_string(),
        _ => "Error".to_string(),
    }
}

#[actix_web::main]
async fn main() -> std::io::Result<()> {
    HttpServer::new(|| App::new().service(index).service(time))
        .bind(("127.0.0.1", 8123))?
        .run()
        .await
}
