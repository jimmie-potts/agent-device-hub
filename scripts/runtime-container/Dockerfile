# The same immutable multi-architecture Node24 base as deploy/container/Dockerfile.
FROM docker.io/library/node@sha256:14078204b6bb268c107ceff6d3c43f45a888105e5c2b18b14c32b3409d93a1b0
WORKDIR /opt/dependencies
COPY . .
ENV PLAYWRIGHT_BROWSERS_PATH=/opt/playwright
RUN npm ci --include=dev --no-audit --no-fund && npx --no-install playwright install --with-deps chromium
RUN test -x /usr/bin/timeout && mkdir -p /work/source
WORKDIR /work/source
ENTRYPOINT ["/usr/bin/timeout", "--signal=TERM", "--kill-after=30", "7200", "node", "scripts/runtime-container/inside.mjs"]
