use std::time::{SystemTime, UNIX_EPOCH};

use salvo::prelude::*;

const X_HTTPSTIME: &str = "x-httpstime";

fn add_common_cors_headers(res: &mut Response) {
    res.add_header("access-control-allow-origin", "*", true)
        .ok();
    res.add_header("access-control-expose-headers", X_HTTPSTIME, true)
        .ok();
}

#[handler]
pub(crate) async fn time(res: &mut Response) {
    add_common_cors_headers(res);
    match SystemTime::now().duration_since(UNIX_EPOCH) {
        Ok(ts) => {
            res.add_header(X_HTTPSTIME, ts.as_secs_f64().to_string(), true)
                .ok();
        }
        Err(_) => {
            res.status_code(StatusCode::INTERNAL_SERVER_ERROR);
        }
    }
}

#[handler]
pub(crate) async fn time_options(res: &mut Response) {
    add_common_cors_headers(res);
    res.add_header("access-control-allow-methods", "GET, HEAD", true)
        .ok();
    res.status_code(StatusCode::NO_CONTENT);
}

#[cfg(test)]
mod tests {
    use salvo::test::TestClient;
    use std::time::{SystemTime, UNIX_EPOCH};

    use crate::{http::X_HTTPSTIME, router};

    #[tokio::test]
    async fn test_time() {
        let router = router::router();
        let service = salvo::Service::new(router);

        let t1 = SystemTime::now()
            .duration_since(UNIX_EPOCH)
            .expect("system clock before epoch")
            .as_secs_f64();

        let response = TestClient::get("http://localhost/.well-known/time")
            .send(&service)
            .await;

        let t2 = SystemTime::now()
            .duration_since(UNIX_EPOCH)
            .expect("system clock before epoch")
            .as_secs_f64();

        assert_eq!(response.status_code, Some(salvo::http::StatusCode::OK));

        let server_time: f64 = response
            .headers()
            .get(X_HTTPSTIME)
            .expect("response missing x-httpstime header")
            .to_str()
            .expect("x-httpstime header is not valid UTF-8")
            .parse()
            .expect("x-httpstime header is not a valid float");

        assert!(
            server_time >= t1,
            "server time {server_time} is before t1 {t1}"
        );
        assert!(
            server_time <= t2,
            "server time {server_time} is after t2 {t2}"
        );
    }
}
