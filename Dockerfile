# syntax=docker/dockerfile:1

FROM node:lts

ENV HOST=0.0.0.0
ENV PORT=3000

RUN apt-get update \
  && apt-get install -y --no-install-recommends tini \
  && rm -rf /var/lib/apt/lists/*

WORKDIR /app
COPY . /app
RUN npm install

COPY docker-entrypoint.sh /
RUN chmod +x /docker-entrypoint.sh

ENTRYPOINT ["/usr/bin/tini", "--", "/docker-entrypoint.sh"]
# Omit CMD so the entrypoint default path runs; set CMD or pass `docker run … cmd` to override.
