FROM rust:slim AS build
WORKDIR /build
COPY Cargo.toml Cargo.lock ./
COPY ./src ./src
RUN cargo build --release

FROM debian:stable-slim
WORKDIR /app
COPY --from=build /build/target/release/foxtime .
USER 1000
EXPOSE 8123
CMD ["./foxtime"]
