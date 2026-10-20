FROM halospawns-h1-linux-toolchain:865d1b3d
RUN apt-get update && apt-get install -y --no-install-recommends libclang-rt-18-dev llvm-18 && rm -rf /var/lib/apt/lists/*
