ARG BASE=halospawns-h1-encoder:linux-perf-base
FROM ${BASE}
RUN rustup component add llvm-tools-preview
