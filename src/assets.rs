use std::sync::OnceLock;
use std::time::UNIX_EPOCH;

use rust_embed::RustEmbed;
use salvo::prelude::*;
use salvo::serve_static::static_embed;

use crate::clock;

#[derive(RustEmbed)]
#[folder = "dist/"]
struct Asset;

#[derive(Debug)]
pub(crate) struct QuicInfo {
    pub(crate) port: u16,
    pub(crate) cert_hash: String,
}

static QUIC_INFO: OnceLock<Option<QuicInfo>> = OnceLock::new();

pub(crate) fn set_quic_info(quic_info: Option<QuicInfo>) {
    QUIC_INFO.set(quic_info).expect("QUIC_INFO already set");
}

fn serve_html(path: &str, res: &mut Response) {
    res.add_header("cache-control", "no-cache, no-store, max-age=0", true)
        .ok();
    let asset = Asset::get(path).unwrap();
    let contents = std::str::from_utf8(asset.data.as_ref()).unwrap();

    let quic = QUIC_INFO.get().and_then(|o| o.as_ref());
    let wt_port = quic
        .map(|w| w.port.to_string())
        .unwrap_or_else(|| "0".to_string());
    let wt_cert = quic.map(|w| w.cert_hash.as_str()).unwrap_or("");

    let timestamp = match clock::now().duration_since(UNIX_EPOCH) {
        Ok(ts) => (ts.as_secs_f64() * 1_000.0).to_string(),
        Err(_) => {
            res.status_code(StatusCode::INTERNAL_SERVER_ERROR);
            return;
        }
    };

    let body = contents
        .replace("{{INITIAL_SERVER_TIME}}", &timestamp)
        .replace("{{WEB_TRANSPORT_PORT}}", &wt_port)
        .replace("{{WEB_TRANSPORT_CERT}}", wt_cert);

    res.render(Text::Html(body));
}

#[handler]
pub(crate) async fn index(res: &mut Response) {
    serve_html("index.html", res);
}

#[handler]
pub(crate) async fn countdown(res: &mut Response) {
    serve_html("countdown.html", res);
}

pub(crate) fn static_files() -> impl Handler {
    static_embed::<Asset>()
}

#[cfg(test)]
mod tests {
    use salvo::test::TestClient;

    use crate::router;

    #[tokio::test]
    async fn test_index_cache_control() {
        let router = router::router();
        let service = salvo::Service::new(router);

        let response = TestClient::get("http://localhost/").send(&service).await;

        assert_eq!(response.status_code, Some(salvo::http::StatusCode::OK));

        let cache_control = response
            .headers()
            .get(salvo::http::header::CACHE_CONTROL)
            .expect("response missing cache-control header")
            .to_str()
            .expect("cache-control header is not valid UTF-8");
        assert_eq!(cache_control, "no-cache, no-store, max-age=0");
    }

    #[tokio::test]
    async fn test_countdown_cache_control() {
        let router = router::router();
        let service = salvo::Service::new(router);

        let response = TestClient::get("http://localhost/countdown")
            .send(&service)
            .await;

        assert_eq!(response.status_code, Some(salvo::http::StatusCode::OK));

        let cache_control = response
            .headers()
            .get(salvo::http::header::CACHE_CONTROL)
            .expect("response missing cache-control header")
            .to_str()
            .expect("cache-control header is not valid UTF-8");
        assert_eq!(cache_control, "no-cache, no-store, max-age=0");
    }
}
