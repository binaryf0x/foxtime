use anyhow::Context;
use clap::Parser;
use privdrop::PrivDrop;
use salvo::conn::rustls::{Keycert, RustlsConfig};
use salvo::prelude::*;

mod assets;
mod http;
mod router;
mod self_signed;
mod websocket;
mod webtransport;

#[derive(Parser, Debug)]
#[command(version, about, long_about = None)]
struct Args {
    #[arg(long, default_value_t = false)]
    listen_any: bool,

    #[arg(long, conflicts_with = "unix", default_value_t = 8123)]
    port: u16,

    #[arg(long)]
    unix: Option<String>,

    #[arg(long, requires = "unix")]
    unix_owner: Option<String>,

    #[arg(long, requires = "unix")]
    unix_group: Option<String>,

    #[arg(long, requires = "unix", value_parser = parse_octal)]
    unix_mode: Option<u32>,

    #[arg(long, requires = "tls_key")]
    tls_cert: Option<String>,

    #[arg(long, requires = "tls_cert")]
    tls_key: Option<String>,

    #[arg(long, default_value_t = false)]
    web_transport: bool,

    #[arg(long, default_value_t = 8123)]
    web_transport_port: u16,

    #[arg(long)]
    user: Option<String>,

    #[arg(long)]
    group: Option<String>,

    #[arg(long)]
    chroot: Option<String>,
}

fn parse_octal(s: &str) -> Result<u32, String> {
    u32::from_str_radix(s, 8).map_err(|e| e.to_string())
}

fn set_unix_permissions(unix: &str, args: &Args) -> anyhow::Result<()> {
    if args.unix_owner.is_some() || args.unix_group.is_some() {
        let user = args
            .unix_owner
            .as_deref()
            .map(|name| {
                nix::unistd::User::from_name(name)
                    .context("Look up user")
                    .and_then(|u| u.ok_or_else(|| anyhow::anyhow!("User not found: {}", name)))
            })
            .transpose()?;
        let group = args
            .unix_group
            .as_deref()
            .map(|name| {
                nix::unistd::Group::from_name(name)
                    .context("Look up group")
                    .and_then(|g| g.ok_or_else(|| anyhow::anyhow!("Group not found: {}", name)))
            })
            .transpose()?;
        nix::unistd::chown(unix, user.map(|u| u.uid), group.map(|g| g.gid))?;
    }
    if let Some(mode) = args.unix_mode {
        use std::os::unix::fs::PermissionsExt;
        std::fs::set_permissions(unix, std::fs::Permissions::from_mode(mode))?;
    }
    Ok(())
}

fn apply_privdrop(args: &Args) -> anyhow::Result<()> {
    if args.user.is_some() || args.group.is_some() || args.chroot.is_some() {
        let mut pd = PrivDrop::default();
        if let Some(user) = &args.user {
            pd = pd.user(user);
        }
        if let Some(group) = &args.group {
            pd = pd.group(group);
        }
        if let Some(chroot) = &args.chroot {
            pd = pd.chroot(chroot);
        }
        pd.apply()?;
    }
    Ok(())
}

#[tokio::main]
async fn main() -> anyhow::Result<()> {
    rustls::crypto::ring::default_provider()
        .install_default()
        .ok();

    tracing_subscriber::fmt()
        .with_env_filter(tracing_subscriber::EnvFilter::from_default_env())
        .init();

    let args = Args::parse();

    let rustls_config = if let (Some(cert_path), Some(key_path)) = (&args.tls_cert, &args.tls_key) {
        let cert_pem = std::fs::read_to_string(cert_path)?;
        let key_pem = std::fs::read_to_string(key_path)?;
        Some(RustlsConfig::new(
            Keycert::new()
                .cert(cert_pem.as_bytes())
                .key(key_pem.as_bytes()),
        ))
    } else {
        None
    };

    let (wt_rustls_config, wt_cert_hash) = if args.web_transport {
        if let Some(config) = &rustls_config {
            (Some(config.clone()), String::new())
        } else {
            let (config, cert_hash) = self_signed::generate()?;
            (Some(config), cert_hash)
        }
    } else {
        (None, String::new())
    };

    assets::set_web_transport_info(if args.web_transport {
        Some(assets::WebTransportInfo {
            port: args.web_transport_port,
            cert_hash: wt_cert_hash,
        })
    } else {
        None
    });

    let router = router::router();

    // Resolve listen addresses once based on listen_any.
    let (http_v4, http_v6, q_v4, q_v6) = if args.listen_any {
        (
            (std::net::Ipv4Addr::UNSPECIFIED, args.port),
            (std::net::Ipv6Addr::UNSPECIFIED, args.port),
            (std::net::Ipv4Addr::UNSPECIFIED, args.web_transport_port),
            (std::net::Ipv6Addr::UNSPECIFIED, args.web_transport_port),
        )
    } else {
        (
            (std::net::Ipv4Addr::LOCALHOST, args.port),
            (std::net::Ipv6Addr::LOCALHOST, args.port),
            (std::net::Ipv4Addr::LOCALHOST, args.web_transport_port),
            (std::net::Ipv6Addr::LOCALHOST, args.web_transport_port),
        )
    };

    // Build the QUIC listener pair in one place (None when WebTransport is disabled).
    let quic = wt_rustls_config
        .map(|c| QuinnListener::new(c.clone(), q_v4).join(QuinnListener::new(c, q_v6)));

    if let Some(unix_path) = args.unix.clone() {
        // Unix socket for HTTP; optionally join QUIC listeners for WebTransport.
        set_unix_permissions(&unix_path, &args)?;
        apply_privdrop(&args)?;
        let base = UnixListener::new(unix_path);
        if let Some(q) = quic {
            Server::new(base.join(q).bind().await).serve(router).await;
        } else {
            Server::new(base.bind().await).serve(router).await;
        }
    } else {
        apply_privdrop(&args)?;
        if let Some(c) = rustls_config {
            let tcp = TcpListener::new(http_v4)
                .rustls(c.clone())
                .join(TcpListener::new(http_v6).rustls(c));
            if let Some(q) = quic {
                Server::new(tcp.join(q).bind().await).serve(router).await;
            } else {
                Server::new(tcp.bind().await).serve(router).await;
            }
        } else {
            let tcp = TcpListener::new(http_v4).join(TcpListener::new(http_v6));
            if let Some(q) = quic {
                Server::new(tcp.join(q).bind().await).serve(router).await;
            } else {
                Server::new(tcp.bind().await).serve(router).await;
            }
        }
    }

    Ok(())
}
