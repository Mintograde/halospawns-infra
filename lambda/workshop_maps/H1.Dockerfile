# Preserve the deployed engine/exporter inventory byte-for-byte. This release changes intake only.
FROM 283279960672.dkr.ecr.us-east-1.amazonaws.com/halospawns-h1-film@sha256:b206c002a3350828d5ad36a8445677b2f7d6afecd57025228f323a25f7b7f74a
ENV H1_WORKER_RELEASE_ID=20261113-r3 H1_WORKSHOP_ENABLED=true
COPY lambda/h1_film/cloud.py lambda/h1_film/workshop.py /var/task/h1_film/
RUN node tools/check-release.mjs --engine-root /var/task/engines
