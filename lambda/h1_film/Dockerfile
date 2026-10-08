# Build from the repo root with a private --build-context engines=<engine-store>.
FROM rust@sha256:a339861ae23e9abb272cea45dfafde21760d2ce6577a70f8a926153677902663 AS encoder
WORKDIR /build
COPY lambda/h1_film/encoder lambda/h1_film/encoder
COPY lambda/replay_parser/native/src/viewer.rs lambda/replay_parser/native/src/viewer.rs
COPY lambda/replay_parser/contracts lambda/replay_parser/contracts
ENV RUSTFLAGS="-C target-feature=+crt-static"
RUN cargo build --locked --release --jobs 4 --target x86_64-unknown-linux-gnu \
    --manifest-path lambda/h1_film/encoder/Cargo.toml --target-dir /target

FROM public.ecr.aws/lambda/nodejs:24@sha256:8dc1d72900bef6774cffbf7116704344e7e17e57ced1941e21b34106f38c1805
COPY lambda/h1_film/package.json lambda/h1_film/handler.mjs lambda/h1_film/convert.mjs ${LAMBDA_TASK_ROOT}/
COPY lambda/h1_film/runtime ${LAMBDA_TASK_ROOT}/runtime/
COPY lambda/h1_film/profiles ${LAMBDA_TASK_ROOT}/profiles/
COPY lambda/h1_film/tools/check-release.mjs ${LAMBDA_TASK_ROOT}/tools/check-release.mjs
COPY lambda/h1_film/tests/fixtures/retained-profiles.json ${LAMBDA_TASK_ROOT}/tests/fixtures/retained-profiles.json
COPY --from=encoder /target/x86_64-unknown-linux-gnu/release/h1-film-encoder ${LAMBDA_TASK_ROOT}/bin/h1-film-encoder
COPY --from=engines / ${LAMBDA_TASK_ROOT}/engines/
ENV H1_WORKER_MODE=foundation H1_ENGINE_ROOT=/var/task/engines
RUN node tools/check-release.mjs --engine-root /var/task/engines \
    && node --input-type=module -e 'import { handler } from "./handler.mjs"; console.log(JSON.stringify(await handler({ schema: "halospawns.h1FilmHealth.v1", action: "health" })));'
CMD ["handler.handler"]
