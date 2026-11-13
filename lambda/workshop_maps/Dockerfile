FROM python:3.12-slim-bookworm
RUN apt-get update && apt-get install -y --no-install-recommends \
    ca-certificates curl libc6-i386 lib32gcc-s1 g++ make cmake unzip libcurl4-openssl-dev \
    && pip install --no-cache-dir awslambdaric==3.1.1 boto3==1.40.75 \
    && mkdir -p /opt/steamcmd \
    && curl --fail --location --proto '=https' --tlsv1.2 \
      https://steamcdn-a.akamaihd.net/client/installer/steamcmd_linux.tar.gz -o /tmp/steamcmd.tar.gz \
    && echo 'cebf0046bfd08cf45da6bc094ae47aa39ebf4155e5ede41373b579b8f1071e7c  /tmp/steamcmd.tar.gz' | sha256sum -c - \
    && tar -xzf /tmp/steamcmd.tar.gz -C /opt/steamcmd \
    && rm /tmp/steamcmd.tar.gz \
    && apt-get purge -y g++ make cmake unzip libcurl4-openssl-dev && apt-get autoremove -y \
    && rm -rf /var/lib/apt/lists/*
WORKDIR /var/task
COPY lambda/workshop_maps/worker.py /var/task/worker.py
ENTRYPOINT ["/usr/local/bin/python", "-m", "awslambdaric"]
CMD ["worker.handler"]
