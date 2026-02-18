use anyhow::{Context, Result};
use base64::Engine;
use clap::Parser;
use std::time::{SystemTime, UNIX_EPOCH};
use wtransport::tls::Sha256Digest;
use wtransport::{ClientConfig, Endpoint};

#[derive(Parser, Debug)]
#[command(version, about, long_about = None)]
struct Args {
    /// URL of the time server (e.g., http://localhost:8123)
    url: String,

    /// Use WebTransport instead of HTTP
    #[arg(long)]
    web_transport: bool,

    /// WebTransport server certificate SHA-256 fingerprint (base64)
    #[arg(long)]
    cert_hash: Option<String>,
}

#[tokio::main]
async fn main() -> Result<()> {
    let args = Args::parse();

    if args.web_transport {
        run_web_transport(&args).await?;
    } else {
        run_http(&args).await?;
    }

    Ok(())
}

async fn run_http(args: &Args) -> Result<()> {
    let mut url = args.url.clone();
    if !url.starts_with("http://") && !url.starts_with("https://") {
        url = format!("http://{}", url);
    }

    if !url.ends_with("/.well-known/time") {
        url = format!("{}/.well-known/time", url.trim_end_matches('/'));
    }

    let client = reqwest::Client::builder()
        .timeout(std::time::Duration::from_secs(5))
        .build()?;

    let _ = client
        .get(&url)
        .send()
        .await
        .with_context(|| format!("Failed to connect to {}", url))?;

    let t1 = SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .context("Local clock is before epoch")?
        .as_secs_f64();

    let response = client
        .get(&url)
        .send()
        .await
        .with_context(|| format!("Failed to connect to {}", url))?;

    let t2 = SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .context("Local clock is before epoch")?
        .as_secs_f64();

    if !response.status().is_success() {
        anyhow::bail!("Server returned error: {}", response.status());
    }

    let server_time_str = response
        .headers()
        .get("x-httpstime")
        .context("Server response missing x-httpstime header")?
        .to_str()
        .context("Invalid x-httpstime header format")?;

    let server_time_secs: f64 = server_time_str
        .parse()
        .context("Failed to parse server time as float")?;

    print_results(&url, server_time_secs, t1, t2);

    Ok(())
}

async fn run_web_transport(args: &Args) -> Result<()> {
    let mut url = args.url.clone();
    if !url.starts_with("https://") {
        if let Some(host_port) = url.strip_prefix("http://") {
            url = format!("https://{}", host_port);
        } else {
            url = format!("https://{}", url);
        }
    }

    if !url.ends_with("/.well-known/time") {
        url = format!("{}/.well-known/time", url.trim_end_matches('/'));
    }

    let builder =
        ClientConfig::builder().with_bind_config(wtransport::config::IpBindConfig::InAddrAnyDual);

    let config = if let Some(hash_str) = &args.cert_hash {
        let hash_bytes = base64::engine::general_purpose::STANDARD
            .decode(hash_str)
            .context("Invalid base64 in cert-hash")?;
        let hash = Sha256Digest::new(
            hash_bytes
                .try_into()
                .map_err(|_| anyhow::anyhow!("Invalid hash length (must be 32 bytes)"))?,
        );
        builder.with_server_certificate_hashes([hash]).build()
    } else {
        builder.with_native_certs().build()
    };

    let endpoint = Endpoint::client(config)?;

    let session = endpoint
        .connect(&url)
        .await
        .with_context(|| format!("Failed to connect to {}", url))?;

    let t1 = SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .context("Local clock is before epoch")?
        .as_secs_f64();

    session
        .send_datagram(t1.to_le_bytes())
        .context("Failed to send datagram")?;

    let response = session
        .receive_datagram()
        .await
        .context("Failed to receive datagram")?;

    let t2 = SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .context("Local clock is before epoch")?
        .as_secs_f64();

    if response.len() < 16 {
        anyhow::bail!("Server response too short: {} bytes", response.len());
    }

    // response is [client_ts (8), server_ts (8)]
    let server_time_secs = f64::from_le_bytes(response[8..16].try_into().unwrap());

    print_results(&url, server_time_secs, t1, t2);

    Ok(())
}

fn print_results(url: &str, server_time_secs: f64, t1: f64, t2: f64) {
    let rtt = t2 - t1;
    let adjusted_local_time = (t1 + t2) / 2.0;
    let offset = adjusted_local_time - server_time_secs;

    println!("Server: {}", url);
    println!("Server time: {:.6}", server_time_secs);
    println!("Local time:  {:.6} (RTT-adjusted)", adjusted_local_time);
    println!("Offset:      {:.3} milliseconds", offset * 1_000.0);
    println!("RTT:         {:.3} milliseconds", rtt * 1_000.0);
}
