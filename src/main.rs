use actix_web::{App, HttpResponse, HttpServer, Responder, get, http::header, middleware, route};
use clap::Parser;
use lazy_static::lazy_static;
use mime;
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

const INDEX_CSS: &str = include_str!("index.css");
const WORKER_JS: &str = include_str!("worker.js");

lazy_static! {
    static ref INDEX_CSS_HASH: String = sha256::digest(INDEX_CSS);
    static ref WORKER_JS_HASH: String = sha256::digest(WORKER_JS);
    static ref INDEX_JS: String =
        include_str!("index.js").replace("WORKER_JS_HASH", &WORKER_JS_HASH);
    static ref INDEX_HTML: String =
        include_str!("index.html").replace("INDEX_CSS_HASH", &INDEX_CSS_HASH);
}

#[get("/")]
async fn index() -> impl Responder {
    HttpResponse::Ok()
        .content_type(header::ContentType::html())
        .insert_header((header::CROSS_ORIGIN_OPENER_POLICY, "same-origin"))
        .insert_header((header::CROSS_ORIGIN_EMBEDDER_POLICY, "require-corp"))
        .body(INDEX_HTML.as_str())
}

#[get("/index.css")]
async fn index_css() -> impl Responder {
    HttpResponse::Ok()
        .content_type(header::ContentType(mime::TEXT_CSS_UTF_8))
        .body(INDEX_CSS)
}

#[get("/index.js")]
async fn index_js() -> impl Responder {
    match SystemTime::now().duration_since(SystemTime::UNIX_EPOCH) {
        Ok(timestamp) => {
            // Use as_millis_f64() when available:
            // https://github.com/rust-lang/rust/issues/122451
            let timestamp = (timestamp.as_secs_f64() * 1_000.0).to_string();
            HttpResponse::Ok()
                .content_type(header::ContentType(mime::TEXT_JAVASCRIPT))
                .append_header(header::CacheControl(vec![header::CacheDirective::NoStore]))
                .insert_header((header::CROSS_ORIGIN_OPENER_POLICY, "same-origin"))
                .insert_header((header::CROSS_ORIGIN_EMBEDDER_POLICY, "require-corp"))
                .body(INDEX_JS.replace("INITIAL_SERVER_TIME", &timestamp))
        }
        _ => HttpResponse::InternalServerError().finish(),
    }
}

#[get("/worker.js")]
async fn worker_js() -> impl Responder {
    HttpResponse::Ok()
        .content_type(header::ContentType(mime::TEXT_JAVASCRIPT))
        .insert_header((header::CROSS_ORIGIN_OPENER_POLICY, "same-origin"))
        .insert_header((header::CROSS_ORIGIN_EMBEDDER_POLICY, "require-corp"))
        .body(WORKER_JS)
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

#[actix_web::main]
async fn main() -> std::io::Result<()> {
    let args = Args::parse();

    let mut server = HttpServer::new(|| {
        App::new()
            .wrap(middleware::Compress::default())
            .service(index)
            .service(index_css)
            .service(index_js)
            .service(worker_js)
            .service(time)
    });

    if let Some(unix) = args.unix {
        server = server.bind_uds(unix)?;
    } else {
        server = server.bind((args.host.as_str(), args.port))?;
    }

    server.run().await
}
