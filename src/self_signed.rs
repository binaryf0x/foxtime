use base64::Engine;
use rcgen::{CertificateParams, KeyPair};
use salvo::conn::rustls::{Keycert, RustlsConfig};
use sha2::{Digest, Sha256};
use time::{Duration, OffsetDateTime};

pub(crate) fn generate() -> anyhow::Result<(RustlsConfig, String)> {
    let key_pair = KeyPair::generate_for(&rcgen::PKCS_ECDSA_P256_SHA256)?;
    let now = OffsetDateTime::now_utc();
    let mut params = CertificateParams::new(vec!["localhost".to_string()])?;
    params.not_before = now;
    params.not_after = now + Duration::days(14);

    let cert = params.self_signed(&key_pair)?;
    let cert_der: &[u8] = cert.der();
    let cert_hash =
        base64::engine::general_purpose::STANDARD.encode(Sha256::digest(cert_der).as_slice());
    tracing::info!("Certificate SHA-256 fingerprint (base64): {}", cert_hash);

    Ok((
        RustlsConfig::new(
            Keycert::new()
                .cert(cert.pem().as_bytes())
                .key(key_pair.serialize_pem().as_bytes()),
        ),
        cert_hash,
    ))
}
