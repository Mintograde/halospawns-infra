FROM rust:1.96-bookworm AS native-builder

WORKDIR /build/native
COPY native/Cargo.toml native/Cargo.lock ./
COPY native/src ./src
COPY contracts /build/contracts
RUN cargo build --locked --release

FROM public.ecr.aws/lambda/python:3.12

COPY requirements.txt .
RUN pip install --no-cache-dir -r requirements.txt --target "${LAMBDA_TASK_ROOT}"

COPY --from=native-builder /build/native/target/release/replay-extractor "${LAMBDA_TASK_ROOT}/replay-extractor"
COPY handler.py "${LAMBDA_TASK_ROOT}/handler.py"
COPY viewer_delta.py "${LAMBDA_TASK_ROOT}/viewer_delta.py"
COPY contracts "${LAMBDA_TASK_ROOT}/contracts"

CMD ["handler.handler"]
