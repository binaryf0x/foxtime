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
    quic: bool,

    #[arg(long, default_value_t = 8123)]
    quic_port: u16,

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

async fn serve_unix(
    unix_path: String,
    quic_rustls_config: Option<RustlsConfig>,
    quic_port: u16,
    listen_any: bool,
    router: Router,
) {
    let base = UnixListener::new(unix_path);
    if let Some(config) = quic_rustls_config {
        if listen_any {
            let quic = QuinnListener::new(config, (std::net::Ipv4Addr::UNSPECIFIED, quic_port));
            Server::new(base.join(quic).bind().await)
                .serve(router)
                .await;
        } else {
            let quic =
                QuinnListener::new(config.clone(), (std::net::Ipv4Addr::LOCALHOST, quic_port)).join(
                    QuinnListener::new(config, (std::net::Ipv6Addr::LOCALHOST, quic_port)),
                );
            Server::new(base.join(quic).bind().await)
                .serve(router)
                .await;
        }
    } else {
        Server::new(base.bind().await).serve(router).await;
    }
}

async fn serve_any(
    port: u16,
    quic_port: u16,
    rustls_config: Option<RustlsConfig>,
    quic_rustls_config: Option<RustlsConfig>,
    router: Router,
) {
    // Bind to the IPv6 wildcard (::) which is dual-stack by default on Linux and macOS,
    // covering both IPv4 and IPv6 clients with a single socket.
    let http_addr = (std::net::Ipv6Addr::UNSPECIFIED, port);
    let quic_addr = (std::net::Ipv6Addr::UNSPECIFIED, quic_port);
    if let Some(config) = rustls_config {
        let tcp = TcpListener::new(http_addr).rustls(config);
        if let Some(quic_config) = quic_rustls_config {
            Server::new(
                tcp.join(QuinnListener::new(quic_config, quic_addr))
                    .bind()
                    .await,
            )
            .serve(router)
            .await;
        } else {
            Server::new(tcp.bind().await).serve(router).await;
        }
    } else {
        let tcp = TcpListener::new(http_addr);
        if let Some(quic_config) = quic_rustls_config {
            Server::new(
                tcp.join(QuinnListener::new(quic_config, quic_addr))
                    .bind()
                    .await,
            )
            .serve(router)
            .await;
        } else {
            Server::new(tcp.bind().await).serve(router).await;
        }
    }
}

async fn serve_localhost(
    port: u16,
    quic_port: u16,
    rustls_config: Option<RustlsConfig>,
    quic_rustls_config: Option<RustlsConfig>,
    router: Router,
) {
    let http_v4 = (std::net::Ipv4Addr::LOCALHOST, port);
    let http_v6 = (std::net::Ipv6Addr::LOCALHOST, port);
    let quic = quic_rustls_config.map(|config| {
        QuinnListener::new(config.clone(), (std::net::Ipv4Addr::LOCALHOST, quic_port)).join(
            QuinnListener::new(config, (std::net::Ipv6Addr::LOCALHOST, quic_port)),
        )
    });
    if let Some(config) = rustls_config {
        let tcp = TcpListener::new(http_v4)
            .rustls(config.clone())
            .join(TcpListener::new(http_v6).rustls(config));
        if let Some(quic) = quic {
            Server::new(tcp.join(quic).bind().await).serve(router).await;
        } else {
            Server::new(tcp.bind().await).serve(router).await;
        }
    } else {
        let tcp = TcpListener::new(http_v4).join(TcpListener::new(http_v6));
        if let Some(quic) = quic {
            Server::new(tcp.join(quic).bind().await).serve(router).await;
        } else {
            Server::new(tcp.bind().await).serve(router).await;
        }
    }
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

    let (quic_rustls_config, quic_cert_hash) = if args.quic {
        if let Some(config) = &rustls_config {
            (Some(config.clone()), String::new())
        } else {
            let (config, cert_hash) = self_signed::generate()?;
            (Some(config), cert_hash)
        }
    } else {
        (None, String::new())
    };

    assets::set_quic_info(if args.quic {
        Some(assets::QuicInfo {
            port: args.quic_port,
            cert_hash: quic_cert_hash,
        })
    } else {
        None
    });

    let router = router::router();

    if let Some(unix_path) = args.unix.clone() {
        set_unix_permissions(&unix_path, &args)?;
        apply_privdrop(&args)?;
        serve_unix(
            unix_path,
            quic_rustls_config,
            args.quic_port,
            args.listen_any,
            router,
        )
        .await;
    } else if args.listen_any {
        apply_privdrop(&args)?;
        serve_any(
            args.port,
            args.quic_port,
            rustls_config,
            quic_rustls_config,
            router,
        )
        .await;
    } else {
        apply_privdrop(&args)?;
        serve_localhost(
            args.port,
            args.quic_port,
            rustls_config,
            quic_rustls_config,
            router,
        )
        .await;
    }

    Ok(())
}
