# Stages used by the Jenkins pipeline (see scripts/test.sh and scripts/start.sh):
#   test-results  scratch stage exporting the JUnit report; never fails
#   verified      refuses to continue when the test verdict is red
#   runtime       the published image
FROM node:24-alpine AS base
WORKDIR /app
COPY package.json package-lock.json ./
RUN npm ci

FROM base AS build
COPY tsconfig*.json vite.config.ts vitest.config.ts ./
COPY src ./src
RUN npm run build

FROM build AS test
COPY scripts/image-tests.sh /usr/local/bin/image-tests.sh
RUN sh /usr/local/bin/image-tests.sh /out

FROM scratch AS test-results
COPY --from=test /out /

FROM build AS verified
COPY --from=test /out/exit-code /tmp/exit-code
RUN [ "$(cat /tmp/exit-code)" = "0" ] || { echo "Tests failed - refusing to build the image" >&2; exit 1; }

FROM node:24-alpine AS runtime
ARG VCS_REF=unknown
ARG BUILD_DATE=unknown
LABEL org.opencontainers.image.title="upload-tester" \
      org.opencontainers.image.source="https://github.com/ruepp-jenkins/upload-tester" \
      org.opencontainers.image.revision="${VCS_REF}" \
      org.opencontainers.image.created="${BUILD_DATE}"
ENV NODE_ENV=production PORT=8080
WORKDIR /app
COPY package.json package-lock.json ./
RUN npm ci --omit=dev && npm cache clean --force
COPY --from=verified /app/dist ./dist
USER node
EXPOSE 8080
HEALTHCHECK --interval=30s --timeout=3s CMD wget -qO- http://127.0.0.1:8080/api/health || exit 1
CMD ["node", "dist/server/index.js"]
