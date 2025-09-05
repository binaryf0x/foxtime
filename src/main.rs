use std::time::SystemTime;

use actix_web::http::header::{
    CROSS_ORIGIN_EMBEDDER_POLICY, CROSS_ORIGIN_OPENER_POLICY, ContentType,
};
use actix_web::{App, HttpResponse, HttpServer, Responder, get};

#[get("/")]
async fn index() -> impl Responder {
    let timestamp = match SystemTime::now().duration_since(SystemTime::UNIX_EPOCH) {
        Ok(timestamp) => timestamp.as_millis().to_string(),
        _ => return HttpResponse::InternalServerError().finish(),
    };
    HttpResponse::Ok()
        .content_type(ContentType::html())
        .append_header((CROSS_ORIGIN_OPENER_POLICY, "same-origin"))
        .append_header((CROSS_ORIGIN_EMBEDDER_POLICY, "require-corp"))
        .body(include_str!("index.html").replace("INITIAL_SERVER_TIME", &timestamp))
}

#[get("/time")]
async fn time() -> impl Responder {
    match SystemTime::now().duration_since(SystemTime::UNIX_EPOCH) {
        Ok(timestamp) => HttpResponse::Ok().body(timestamp.as_millis().to_string()),
        _ => HttpResponse::InternalServerError().finish(),
    }
}

#[actix_web::main]
async fn main() -> std::io::Result<()> {
    HttpServer::new(|| App::new().service(index).service(time))
        .bind(("127.0.0.1", 8123))?
        .run()
        .await
}
