use std::time::{SystemTime, UNIX_EPOCH};

use bytes::BytesMut;
use salvo::prelude::*;
use salvo::websocket::{Message, WebSocketUpgrade};

#[handler]
pub(crate) async fn time_ws(req: &mut Request, res: &mut Response) -> Result<(), StatusError> {
    WebSocketUpgrade::new()
        .upgrade(req, res, |mut ws| async move {
            while let Some(msg) = ws.recv().await {
                match msg {
                    Ok(msg) if msg.is_binary() => {
                        match SystemTime::now().duration_since(UNIX_EPOCH) {
                            Ok(ts) => {
                                let server_ts = ts.as_secs_f64();
                                let mut response = BytesMut::with_capacity(8);
                                response.extend_from_slice(&server_ts.to_le_bytes());
                                if ws.send(Message::binary(response.freeze())).await.is_err() {
                                    break;
                                }
                            }
                            Err(_) => break,
                        }
                    }
                    Ok(msg) if msg.is_ping() => {
                        if ws
                            .send(Message::pong(msg.as_bytes().to_vec()))
                            .await
                            .is_err()
                        {
                            break;
                        }
                    }
                    Ok(msg) if msg.is_close() => break,
                    Err(_) => break,
                    _ => {}
                }
            }
        })
        .await
}

#[cfg(test)]
mod tests {
    use futures_util::{SinkExt, StreamExt};
    use reqwest_websocket::Upgrade;
    use salvo::conn::{Acceptor, TcpListener};
    use salvo::prelude::*;
    use std::time::{SystemTime, UNIX_EPOCH};

    use crate::router::router;

    #[tokio::test]
    async fn test_time_ws() {
        let acceptor = TcpListener::new("127.0.0.1:0").bind().await;
        let port = acceptor.holdings()[0]
            .local_addr
            .port()
            .expect("could not get bound port");

        let router = router();
        tokio::spawn(async move {
            Server::new(acceptor).serve(router).await;
        });

        let url = format!("ws://127.0.0.1:{port}/time-ws");

        let client = reqwest::Client::new();
        let response = client
            .get(&url)
            .upgrade()
            .send()
            .await
            .expect("failed to connect to WebSocket server");
        let mut websocket = response
            .into_websocket()
            .await
            .expect("WebSocket upgrade failed");

        let t1 = SystemTime::now()
            .duration_since(UNIX_EPOCH)
            .expect("system clock before epoch")
            .as_secs_f64();

        websocket
            .send(reqwest_websocket::Message::Binary(vec![0].into()))
            .await
            .expect("failed to send WebSocket message");

        let message = websocket
            .next()
            .await
            .expect("WebSocket closed before response")
            .expect("WebSocket error");

        let t2 = SystemTime::now()
            .duration_since(UNIX_EPOCH)
            .expect("system clock before epoch")
            .as_secs_f64();

        let server_time: f64 = match message {
            reqwest_websocket::Message::Binary(bin) => {
                assert!(bin.len() >= 8, "response too short: {} bytes", bin.len());
                f64::from_le_bytes(bin[..8].try_into().unwrap())
            }
            other => panic!("unexpected WebSocket message type: {other:?}"),
        };

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
