# syntax=docker/dockerfile:1.7
# SPDX-License-Identifier: Apache-2.0

ARG RUNTIME_IMAGE=node:24-trixie-slim@sha256:ae91dcc111a68c9d2d81ff2a17bda61be126426176fde6fe7d08ab13b7f50573

FROM ${RUNTIME_IMAGE} AS dependencies
WORKDIR /build
COPY package.json package-lock.json ./
RUN npm ci --omit=dev --ignore-scripts && npm cache clean --force

FROM ${RUNTIME_IMAGE} AS runtime
ARG SOURCE_REVISION
LABEL org.opencontainers.image.title="Kungfu course business reference" \
      org.opencontainers.image.description="Bounded PostgreSQL course example with a deterministic mock Agent Work adapter" \
      org.opencontainers.image.source="https://github.com/kungfu-systems/runtime-images" \
      org.opencontainers.image.revision="${SOURCE_REVISION}" \
      org.opencontainers.image.licenses="Apache-2.0" \
      tech.kungfu.course-business-reference.contract="course.agent-work-port/v2" \
      tech.kungfu.course-business-reference.backend="mock-non-kungfu"
ENV NODE_ENV=production \
    PORT=8090 \
    AGENT_WORK_BACKEND=mock \
    SESSION_SECURE=false
COPY --from=dependencies --chown=root:root /build/node_modules /opt/course/node_modules
COPY --chown=root:root course-business-reference/src /opt/course/src
COPY --chown=root:root course-business-reference/web /opt/course/web
COPY --chown=root:root course-business-reference/migrations /opt/course/migrations
RUN mkdir -p /state && chown node:node /state && chmod 0755 /state /opt/course
USER node
WORKDIR /opt/course
VOLUME ["/state"]
EXPOSE 8090
HEALTHCHECK --interval=5s --timeout=4s --start-period=30s --retries=24 \
  CMD node -e "fetch('http://127.0.0.1:8090/readyz').then(r=>{if(!r.ok)process.exit(1)}).catch(()=>process.exit(1))"
ENTRYPOINT ["node", "src/server.mjs"]
