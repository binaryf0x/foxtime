use salvo::logging::Logger;
use salvo::prelude::*;

use crate::{assets, http, websocket, webtransport};

#[handler]
async fn cross_origin_isolation(
    req: &mut Request,
    depot: &mut Depot,
    res: &mut Response,
    ctrl: &mut FlowCtrl,
) {
    ctrl.call_next(req, depot, res).await;
    res.add_header("cross-origin-opener-policy", "same-origin", true)
        .ok();
    res.add_header("cross-origin-embedder-policy", "require-corp", true)
        .ok();
}

pub(crate) fn router() -> Router {
    Router::new()
        .hoop(Logger::new())
        .hoop(cross_origin_isolation)
        .get(assets::index)
        .push(Router::with_path("countdown").get(assets::countdown))
        .push(
            Router::with_path(".well-known/time")
                .get(http::time)
                .head(http::time),
        )
        .push(Router::with_path(".well-known/time-ws").goal(websocket::time_ws))
        .push(Router::with_path(".well-known/time-wt").goal(webtransport::time_wt))
        .push(Router::with_path("{*path}").get(assets::static_files()))
}
