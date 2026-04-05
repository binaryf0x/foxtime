use std::sync::OnceLock;
use std::time::{SystemTime, UNIX_EPOCH};

use rust_embed::RustEmbed;
use salvo::prelude::*;
use salvo::serve_static::static_embed;

#[derive(RustEmbed)]
#[folder = "dist/"]
struct Asset;

#[derive(Debug)]
pub(crate) struct WebTransportInfo {
    pub(crate) port: u16,
    pub(crate) cert_hash: String,
}

static WT_INFO: OnceLock<Option<WebTransportInfo>> = OnceLock::new();

pub(crate) fn set_web_transport_info(wt_info: Option<WebTransportInfo>) {
    WT_INFO.set(wt_info).expect("WT_INFO already set");
}

fn serve_html(path: &str, res: &mut Response) {
    let asset = Asset::get(path).unwrap();
    let contents = std::str::from_utf8(asset.data.as_ref()).unwrap();

    let wt = WT_INFO.get().and_then(|o| o.as_ref());
    let wt_port = wt
        .map(|w| w.port.to_string())
        .unwrap_or_else(|| "0".to_string());
    let wt_cert = wt.map(|w| w.cert_hash.as_str()).unwrap_or("");

    let timestamp = match SystemTime::now().duration_since(UNIX_EPOCH) {
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
