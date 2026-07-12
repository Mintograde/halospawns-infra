FROM rust:1.96-bookworm AS native-builder

WORKDIR /build
COPY native/Cargo.toml native/Cargo.lock ./
COPY native/src ./src
RUN cargo build --locked --release

FROM public.ecr.aws/lambda/python:3.12

COPY requirements.txt .
RUN pip install --no-cache-dir -r requirements.txt --target "${LAMBDA_TASK_ROOT}"

COPY --from=native-builder /build/target/release/replay-extractor "${LAMBDA_TASK_ROOT}/replay-extractor"
COPY handler.py "${LAMBDA_TASK_ROOT}/handler.py"

CMD ["handler.handler"]
