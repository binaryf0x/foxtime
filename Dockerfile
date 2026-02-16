FROM node:current-slim AS web-build
WORKDIR /build
COPY package.json package-lock.json ./
RUN npm ci
COPY tsconfig.json vite.config.js ./
COPY ./web ./web
RUN npm run build

FROM rust:slim AS rust-build
WORKDIR /build
COPY --from=web-build /build/dist ./dist
COPY Cargo.toml Cargo.lock ./
COPY ./src ./src
RUN cargo build --release

FROM debian:stable-slim
WORKDIR /app
COPY --from=rust-build /build/target/release/foxtime .
USER 1000
EXPOSE 8123
CMD ["./foxtime", "--listen-any"]
