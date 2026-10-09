# Build from the repo root with a private --build-context engines=<engine-store>.
FROM rust@sha256:a339861ae23e9abb272cea45dfafde21760d2ce6577a70f8a926153677902663 AS encoder
WORKDIR /build
COPY lambda/h1_film/encoder lambda/h1_film/encoder
COPY lambda/replay_parser/native/Cargo.toml lambda/replay_parser/native/Cargo.lock lambda/replay_parser/native/
COPY lambda/replay_parser/native/src lambda/replay_parser/native/src
COPY lambda/replay_parser/contracts lambda/replay_parser/contracts
ENV RUSTFLAGS="-C target-feature=+crt-static"
RUN cargo build --locked --release --jobs 4 --target x86_64-unknown-linux-gnu \
    --manifest-path lambda/h1_film/encoder/Cargo.toml --target-dir /target
RUN cargo build --locked --release --jobs 4 --target x86_64-unknown-linux-gnu \
    --manifest-path lambda/replay_parser/native/Cargo.toml --target-dir /target

FROM public.ecr.aws/lambda/nodejs:24@sha256:8dc1d72900bef6774cffbf7116704344e7e17e57ced1941e21b34106f38c1805 AS node
FROM public.ecr.aws/lambda/python:3.12@sha256:d9f4dc50998552b084107763177eb53ed95230f2d4e1c320158bd7325d0eac30
COPY --from=node /var/lang/bin/node /var/lang/bin/node
COPY lambda/replay_parser/requirements.txt /tmp/requirements.txt
RUN pip install --no-cache-dir -r /tmp/requirements.txt --target "${LAMBDA_TASK_ROOT}"
COPY lambda/h1_film/package.json lambda/h1_film/handler.mjs lambda/h1_film/convert.mjs ${LAMBDA_TASK_ROOT}/
COPY lambda/h1_film/runtime ${LAMBDA_TASK_ROOT}/runtime/
COPY lambda/h1_film/profiles ${LAMBDA_TASK_ROOT}/profiles/
COPY lambda/h1_film/tools/check-release.mjs ${LAMBDA_TASK_ROOT}/tools/check-release.mjs
COPY lambda/h1_film/tests/fixtures/retained-profiles.json ${LAMBDA_TASK_ROOT}/tests/fixtures/retained-profiles.json
COPY --from=encoder /target/x86_64-unknown-linux-gnu/release/h1-film-encoder ${LAMBDA_TASK_ROOT}/bin/h1-film-encoder
COPY --from=engines / ${LAMBDA_TASK_ROOT}/engines/
COPY lambda/h1_film/*.py ${LAMBDA_TASK_ROOT}/h1_film/
COPY lambda/h1_film/profiles ${LAMBDA_TASK_ROOT}/h1_film/profiles/
COPY lambda/h1_film/contracts ${LAMBDA_TASK_ROOT}/h1_film/contracts/
COPY lambda/replay_parser/handler.py lambda/replay_parser/viewer_delta.py ${LAMBDA_TASK_ROOT}/replay_parser/
COPY lambda/replay_parser/contracts ${LAMBDA_TASK_ROOT}/replay_parser/contracts/
COPY --from=encoder /target/x86_64-unknown-linux-gnu/release/replay-extractor ${LAMBDA_TASK_ROOT}/replay_parser/replay-extractor
ENV H1_WORKER_MODE=foundation H1_ENGINE_ROOT=/var/task/engines H1_NODE_ROOT=/var/task
RUN node tools/check-release.mjs --engine-root /var/task/engines \
    && node --input-type=module -e 'import { handler } from "./handler.mjs"; console.log(JSON.stringify(await handler({ schema: "halospawns.h1FilmHealth.v1", action: "health" })));'
CMD ["h1_film.worker.handler"]
