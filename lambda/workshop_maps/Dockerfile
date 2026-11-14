FROM python:3.12-slim-bookworm
RUN apt-get update && apt-get install -y --no-install-recommends \
    ca-certificates curl libc6-i386 lib32gcc-s1 g++ make cmake unzip libcurl4-openssl-dev \
    && pip install --no-cache-dir awslambdaric==3.1.1 boto3==1.40.75 pexpect==4.9.0 \
    && mkdir -p /opt/steamcmd \
    && curl --fail --location --proto '=https' --tlsv1.2 \
      https://steamcdn-a.akamaihd.net/client/installer/steamcmd_linux.tar.gz -o /tmp/steamcmd.tar.gz \
    && echo 'cebf0046bfd08cf45da6bc094ae47aa39ebf4155e5ede41373b579b8f1071e7c  /tmp/steamcmd.tar.gz' | sha256sum -c - \
    && tar -xzf /tmp/steamcmd.tar.gz -C /opt/steamcmd \
    && rm /tmp/steamcmd.tar.gz \
    && mkdir -p /opt/depotdownloader \
    && curl --fail --location --proto '=https' --tlsv1.2 \
      https://github.com/SteamRE/DepotDownloader/releases/download/DepotDownloader_3.4.0/DepotDownloader-linux-x64.zip -o /tmp/depot.zip \
    && echo 'a999dec66b4850fc961bd50366696d23c2d0fad7b18790e6a5647b2f19097a53  /tmp/depot.zip' | sha256sum -c - \
    && unzip -q /tmp/depot.zip -d /opt/depotdownloader && chmod 755 /opt/depotdownloader/DepotDownloader \
    && rm /tmp/depot.zip \
    && apt-get purge -y g++ make cmake unzip libcurl4-openssl-dev && apt-get autoremove -y \
    && rm -rf /var/lib/apt/lists/*
WORKDIR /var/task
COPY lambda/workshop_maps/worker.py /var/task/worker.py
COPY lambda/workshop_maps/steam_auth.py lambda/workshop_maps/bootstrap.py lambda/workshop_maps/depot.py /var/task/
ENV WORKSHOP_DOWNLOADER=depotdownloader
ENTRYPOINT ["/usr/local/bin/python", "-m", "awslambdaric"]
CMD ["worker.handler"]
