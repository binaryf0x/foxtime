# Fox Time

An implementation of the [Time over HTTPS Specification] with a pretty front-end
providing analog and digital clock displays synchronized using a simplified
version of the NTP algorithm.

[Demo site](https://time.foxontheinter.net).

## Usage

By default the server listens for local HTTP connections on port 8123.

### --listen-any

Listens for connections on all network interfaces instead of only localhost.

### --port &lt;PORT&gt;

Listens for connections by binding to &lt;PORT&gt; instead of 8123.

### --h2c

Enables support for plaintext HTTP/2. Only supported when listening on TCP/IP.

### --unix &lt;PATH&gt;

Creates a Unix domain socket at &lt;PATH&gt; to listen for connections.

### --tls-cert

Enables support for HTTPS using the TLS certificate read from a PEM-encoded file
at &lt;PATH&gt;. Requires `--tls-key`.

### --tls-key

Enables support for HTTPS using the private key read for a PEM-encoded file at
&lt;PATH&gt;. Requires `--tls-cert`.

### --web-transport

Enables support for WebTransport. Opens an additional UDP socket to listen for
QUIC connections. Uses port 8123 by default.

### --web-transport-port &lt;PORT&gt;

Listens for QUIC connections on &lt;PORT&gt; instead.

### -h, --help

Prints help text.

### -V, --version

Prints the application version.

## Building

The frontend component is located in the `web` directory and must be built first
using npm:

```sh
$ npm install
$ npm run build
```

The backend component can now be built with Cargo:

```sh
$ cargo build
```

When built in debug mode the frontend components are served live from the `dist`
directory. When built in release mode they are included in the binary.

[Time over HTTPS Specification]: https://phk.freebsd.dk/time/20151129/
