use std::time::SystemTime;

use actix_web::{App, HttpResponse, HttpServer, Responder, get, http::header, middleware};

#[get("/")]
async fn index() -> impl Responder {
    let timestamp = match SystemTime::now().duration_since(SystemTime::UNIX_EPOCH) {
        Ok(timestamp) => timestamp.as_millis().to_string(),
        _ => return HttpResponse::InternalServerError().finish(),
    };
    HttpResponse::Ok()
        .content_type(header::ContentType::html())
        .insert_header(header::CacheControl(vec![header::CacheDirective::NoStore]))
        .insert_header((header::CROSS_ORIGIN_OPENER_POLICY, "same-origin"))
        .insert_header((header::CROSS_ORIGIN_EMBEDDER_POLICY, "require-corp"))
        .body(include_str!("index.html").replace("INITIAL_SERVER_TIME", &timestamp))
}

#[get("/time")]
async fn time() -> impl Responder {
    let timestamp = match SystemTime::now().duration_since(SystemTime::UNIX_EPOCH) {
        Ok(timestamp) => timestamp.as_millis().to_string(),
        _ => return HttpResponse::InternalServerError().finish(),
    };
    HttpResponse::Ok()
        .content_type(header::ContentType::json())
        .insert_header(header::ContentEncoding::Identity)
        .insert_header(header::CacheControl(vec![header::CacheDirective::NoStore]))
        .body(timestamp)
}

#[actix_web::main]
async fn main() -> std::io::Result<()> {
    HttpServer::new(|| {
        App::new()
            .wrap(middleware::Compress::default())
            .service(index)
            .service(time)
    })
    .bind(("0.0.0.0", 8123))?
    .run()
    .await
}
