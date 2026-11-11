# Dependencies for `npm run test:container` (Hub #1638). The image is keyed by package-lock.json and this recipe;
# the build context holds only the lockfile and the package.json files that npm ci reads. Job source is not part of
# the image: each job copies its own read-only snapshot over /work/source.
# The same immutable multi-architecture Node 24 base as deploy/container/Dockerfile.
FROM docker.io/library/node@sha256:14078204b6bb268c107ceff6d3c43f45a888105e5c2b18b14c32b3409d93a1b0
ARG BUNNY_TEST_DEPS_KEY
LABEL org.bunny.test-deps.key=$BUNNY_TEST_DEPS_KEY
WORKDIR /work/source
COPY . .
ENV PLAYWRIGHT_BROWSERS_PATH=/opt/playwright
RUN rm Dockerfile \
  && npm ci --include=dev --no-audit --no-fund --cache /tmp/npm-cache \
  && npx --no-install playwright install --with-deps chromium \
  && rm -rf /tmp/npm-cache /var/lib/apt/lists/* \
  && test -x /usr/bin/timeout
# The two-hour deadline bounds a job independently of the host caller. The entrypoint is the snapshot's own copy.
ENTRYPOINT ["/usr/bin/timeout", "--signal=TERM", "--kill-after=30", "7200", "node", "/snapshot/scripts/test-container/inside.mjs"]
