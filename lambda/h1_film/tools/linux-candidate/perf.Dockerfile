FROM halospawns-h1-encoder:linux-perf-base
RUN apt-get update && apt-get install -y --no-install-recommends linux-perf && rm -rf /var/lib/apt/lists/*
