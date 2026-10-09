# Offline research toolchain, never a Lambda runtime image.
FROM rust@sha256:a339861ae23e9abb272cea45dfafde21760d2ce6577a70f8a926153677902663
RUN apt-get update && apt-get install -y --no-install-recommends wabt=1.0.32-1 libnode-dev && rm -rf /var/lib/apt/lists/*
WORKDIR /work
