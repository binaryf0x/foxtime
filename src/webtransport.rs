use std::time::{SystemTime, UNIX_EPOCH};

use bytes::{Bytes, BytesMut};
use salvo::prelude::*;

#[handler]
pub(crate) async fn time_wt(req: &mut Request, res: &mut Response) -> Result<(), salvo::Error> {
    let session = match req.web_transport_mut().await {
        Ok(session) => session,
        Err(_) => {
            res.status_code(StatusCode::BAD_REQUEST);
            return Ok(());
        }
    };

    let mut datagram_reader = session.datagram_reader();
    let mut datagram_sender = session.datagram_sender();

    loop {
        tokio::select! {
            result = datagram_reader.read_datagram() => {
                match result {
                    Ok(datagram) => {
                        let payload: Bytes = datagram.into_payload();
                        if payload.len() >= 8 {
                            match SystemTime::now().duration_since(UNIX_EPOCH) {
                                Ok(ts) => {
                                    let server_ts = ts.as_secs_f64();
                                    let mut response = BytesMut::with_capacity(16);
                                    response.extend_from_slice(&payload[..8]);
                                    response.extend_from_slice(&server_ts.to_le_bytes());
                                    if let Err(e) = datagram_sender.send_datagram(response.freeze()) {
                                        tracing::error!("Failed to send datagram: {e:?}");
                                        break;
                                    }
                                }
                                Err(_) => break,
                            }
                        }
                    }
                    Err(e) => {
                        tracing::error!("Failed to read datagram: {e:?}");
                        break;
                    }
                }
            }
            else => break,
        }
    }

    Ok(())
}

#[cfg(test)]
mod tests {
    use base64::Engine;
    use salvo::conn::QuinnListener;
    use salvo::prelude::*;
    use std::time::{SystemTime, UNIX_EPOCH};
    use wtransport::tls::Sha256Digest;
    use wtransport::{ClientConfig, Endpoint};

    use crate::{router, self_signed};

    #[tokio::test]
    async fn test_time_wt() {
        rustls::crypto::ring::default_provider()
            .install_default()
            .ok();

        let (config, cert_hash) = self_signed::generate().unwrap();

        // QuinnListener doesn't update its holdings after binding, so it can't
        // report the OS-assigned port when given port 0. Reserve a free UDP port
        // with the OS first, then hand it to QuinnListener.
        let udp = std::net::UdpSocket::bind("127.0.0.1:0").unwrap();
        let port = udp.local_addr().unwrap().port();
        drop(udp);

        let acceptor = QuinnListener::new(config, format!("127.0.0.1:{port}"))
            .bind()
            .await;

        let router = router::router();
        tokio::spawn(async move {
            Server::new(acceptor).serve(router).await;
        });

        let url = format!("https://127.0.0.1:{port}/time-wt");

        let hash_bytes = base64::engine::general_purpose::STANDARD
            .decode(&cert_hash)
            .unwrap();
        let hash = Sha256Digest::new(hash_bytes.try_into().unwrap());
        let client_config = ClientConfig::builder()
            .with_bind_config(wtransport::config::IpBindConfig::InAddrAnyDual)
            .with_server_certificate_hashes([hash])
            .build();

        let endpoint = Endpoint::client(client_config).unwrap();
        let session = endpoint.connect(&url).await.unwrap();

        let t1 = SystemTime::now()
            .duration_since(UNIX_EPOCH)
            .expect("system clock before epoch")
            .as_secs_f64();

        session.send_datagram(t1.to_le_bytes()).unwrap();

        let response = session.receive_datagram().await.unwrap();

        let t2 = SystemTime::now()
            .duration_since(UNIX_EPOCH)
            .expect("system clock before epoch")
            .as_secs_f64();

        assert!(
            response.len() >= 16,
            "response too short: {} bytes",
            response.len()
        );
        let client_time = f64::from_le_bytes(response[..8].try_into().unwrap());
        let server_time = f64::from_le_bytes(response[8..16].try_into().unwrap());

        assert!(
            client_time == t1,
            "client time {client_time} is not t1 {t1}"
        );
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
