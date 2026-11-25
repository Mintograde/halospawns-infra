FROM rust@sha256:a339861ae23e9abb272cea45dfafde21760d2ce6577a70f8a926153677902663 AS build
WORKDIR /build
COPY lambda/replay_parser/native/Cargo.* native/
COPY lambda/replay_parser/native/src/viewer.rs native/src/
COPY lambda/replay_parser/contracts contracts
COPY lambda/replay_parser/tests/fixtures/replays tests/fixtures/replays
COPY lambda/movement_flow_worker/native/movement_field.rs native/src/bin/
COPY lambda/movement_flow_worker/native/movement_viewer.rs native/src/
COPY lambda/movement_flow_worker/native/movement_paths.rs native/src/
COPY lambda/movement_flow_worker/native/movement_situations.rs native/src/
ENV RUSTFLAGS="-C target-feature=+crt-static"
RUN --mount=type=cache,target=/usr/local/cargo/registry --mount=type=cache,target=/target \
    cargo test --locked --release --jobs 4 --bin movement_field --target x86_64-unknown-linux-gnu \
    --manifest-path native/Cargo.toml --target-dir /target situation_tests && \
    cargo build --locked --release --jobs 4 --bin movement_field --target x86_64-unknown-linux-gnu \
    --manifest-path native/Cargo.toml --target-dir /target && cp /target/x86_64-unknown-linux-gnu/release/movement_field /movement_field
FROM scratch
COPY --from=build /movement_field /
