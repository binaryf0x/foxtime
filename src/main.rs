use std::time::SystemTime;

use actix_web::http::header::{
    CROSS_ORIGIN_EMBEDDER_POLICY, CROSS_ORIGIN_OPENER_POLICY, ContentType,
};
use actix_web::{App, HttpResponse, HttpServer, Responder, get};

#[get("/")]
async fn index() -> impl Responder {
    HttpResponse::Ok()
        .content_type(ContentType::html())
        .append_header((CROSS_ORIGIN_OPENER_POLICY, "same-origin"))
        .append_header((CROSS_ORIGIN_EMBEDDER_POLICY, "require-corp"))
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
