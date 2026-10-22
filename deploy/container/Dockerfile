# The same official Node24 index supplies the native ARM64/AMD64 image. No emulation claim is made.
ARG NODE_IMAGE=docker.io/library/node@sha256:14078204b6bb268c107ceff6d3c43f45a888105e5c2b18b14c32b3409d93a1b0
FROM ${NODE_IMAGE} AS build
WORKDIR /opt/bunny
COPY . .
ENV PLAYWRIGHT_SKIP_BROWSER_DOWNLOAD=1
RUN npm ci --ignore-scripts --no-audit --no-fund
RUN npm run build

FROM ${NODE_IMAGE}
ARG SOURCE_REVISION=unknown
LABEL org.opencontainers.image.title="B.U.N.N.Y. core" \
      org.opencontainers.image.revision="${SOURCE_REVISION}"
WORKDIR /opt/bunny
COPY --from=build /opt/bunny /opt/bunny
RUN install -d -m 0700 -o 1000 -g 1000 /var/lib/bunny /etc/bunny /run/secrets/bunny \
    && printf '%s\n' '{"schema":"runtime-config/1.0","modules":{}}' > /etc/bunny/runtime.json \
    && chmod 0600 /etc/bunny/runtime.json \
    && chown 1000:1000 /etc/bunny/runtime.json
USER 1000:1000
ENV NODE_ENV=production BUNNY_CONTROL=disabled
STOPSIGNAL SIGTERM
HEALTHCHECK --interval=10s --timeout=4s --start-period=20s --retries=3 \
  CMD ["node", "deploy/container/entrypoint.mjs", "status"]
ENTRYPOINT ["node", "/opt/bunny/deploy/container/entrypoint.mjs"]
CMD ["start"]
