# Fox Time

An implementation of the [Time over HTTPS Specification] with a pretty front-end
providing analog and digital clock displays synchronized using a simplified
version of the NTP algorithm.

[Demo site](https://time.foxontheinter.net).

## Usage

By default the server listens for local HTTP connections on port 8123.

### TCP socket options

#### --listen-any

Listens for connections on all network interfaces instead of only localhost.

#### --port &lt;PORT&gt;

Listens for connections by binding to &lt;PORT&gt; instead of 8123.

### UNIX socket options

#### --unix &lt;PATH&gt;

Creates a Unix domain socket at &lt;PATH&gt; to listen for connections.

#### --unix-owner &lt;USER&gt;

Set the owning user of the Unix domain socket to &lt;USER&gt;.

#### --unix-group &lt;GROUP&gt;

Set the owning group of the Unix domain socket to &lt;GROUP&gt;.

### TLS options

#### --tls-cert

Enables support for HTTPS using the TLS certificate read from a PEM-encoded file
at &lt;PATH&gt;. Requires `--tls-key`.

#### --tls-key

Enables support for HTTPS using the private key read for a PEM-encoded file at
&lt;PATH&gt;. Requires `--tls-cert`.

### QUIC options

If no TLS certificate is provided a self-signed certificate for "localhost" is
automatically generated to enable WebTransport when testing locally.

#### --quic

Enables QUIC support, including support for WebTransport. Opens an additional
UDP socket to listen for QUIC connections. Uses port 8123 by default.

#### --quic-port &lt;PORT&gt;

Listens for QUIC connections on &lt;PORT&gt; instead.

### Dropping privileges

#### --user &lt;USER&gt;

Drop privileges to &lt;USER&gt; after loading certs and binding sockets.

#### --group &lt;GROUP&gt;

Drop privileges to &lt;GROUP&gt; after loading certs and binding sockets.

#### --chroot &lt;PATH&gt;

Chroot to &lt;PATH&gt; after loading certs and binding sockets.

### Miscellaneous options

#### -h, --help

Prints help text.

#### -V, --version

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
