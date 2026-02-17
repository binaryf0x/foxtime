use anyhow::{Context, Result};
use clap::Parser;
use std::time::{SystemTime, UNIX_EPOCH};

#[derive(Parser, Debug)]
#[command(version, about, long_about = None)]
struct Args {
    /// URL of the time server (e.g., http://localhost:8123)
    url: String,
}

fn main() -> Result<()> {
    let args = Args::parse();

    let mut url = args.url.clone();
    if !url.starts_with("http://") && !url.starts_with("https://") {
        url = format!("http://{}", url);
    }

    if !url.ends_with("/.well-known/time") {
        url = format!("{}/.well-known/time", url.trim_end_matches('/'));
    }

    let client = reqwest::blocking::Client::builder()
        .timeout(std::time::Duration::from_secs(5))
        .build()?;

    let _ = client
        .get(&url)
        .send()
        .with_context(|| format!("Failed to connect to {}", url))?;

    let t1 = SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .context("Local clock is before epoch")?
        .as_secs_f64();

    let response = client
        .get(&url)
        .send()
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

    let rtt = t2 - t1;
    let adjusted_local_time = (t1 + t2) / 2.0;
    let offset = adjusted_local_time - server_time_secs;

    println!("Server: {}", url);
    println!("Server time: {:.6}", server_time_secs);
    println!("Local time:  {:.6} (RTT-adjusted)", adjusted_local_time);
    println!("Offset:      {:.6} seconds", offset);
    println!("RTT:         {:.6} seconds", rtt);

    Ok(())
}
