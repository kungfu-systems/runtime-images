# syntax=docker/dockerfile:1.7
# SPDX-License-Identifier: Apache-2.0

ARG BUILD_IMAGE=ghcr.io/kungfu-systems/build-images/kungfu-verify@sha256:cb6d939d567c129903d6e3ad858e2c09a9475b3b8f81b1aad10279d0e63a920d
ARG RUNTIME_IMAGE=node:24-trixie-slim@sha256:5301bbf5e8046148348b1dea15436326f43c579031f8d76654a631225bdfe467

FROM ${BUILD_IMAGE} AS package
ARG KUNGFU_PACKAGE_SHA256
ARG KUNGFU_PACKAGE_VERSION
ARG KUNGFU_SOURCE_SHA
USER root
COPY kungfu-episodes-cli-linux-x64.tar.gz /tmp/kungfu-episodes-cli-linux-x64.tar.gz
RUN set -eu; \
    test -n "${KUNGFU_PACKAGE_SHA256}"; \
    test -n "${KUNGFU_PACKAGE_VERSION}"; \
    printf '%s' "${KUNGFU_SOURCE_SHA}" | grep -Eq '^[0-9a-f]{40}$'; \
    echo "${KUNGFU_PACKAGE_SHA256}  /tmp/kungfu-episodes-cli-linux-x64.tar.gz" | sha256sum -c -; \
    mkdir -p /opt/kungfu; \
    tar -xzf /tmp/kungfu-episodes-cli-linux-x64.tar.gz -C /opt/kungfu --strip-components=1; \
    rm /tmp/kungfu-episodes-cli-linux-x64.tar.gz; \
    jq -e --arg version "${KUNGFU_PACKAGE_VERSION}" \
      '.schema == "kungfu.product.cli/v1" and .platform == "linux-x64" and .entries.kungfu != null' \
      /opt/kungfu/product.json >/dev/null; \
    jq -e --arg source "${KUNGFU_SOURCE_SHA}" --arg version "${KUNGFU_PACKAGE_VERSION}" \
      '.schema == "kungfu.product.compatibility/v1" and .source_commit == $source and .versions.product == $version' \
      /opt/kungfu/runtime/product-compatibility.json >/dev/null; \
    jq -e --arg source "${KUNGFU_SOURCE_SHA}" --arg version "${KUNGFU_PACKAGE_VERSION}" \
      '.schema == "kungfu.product-upgrade.manifest/v1" and .sourceCommit == $source and .productVersion == $version and .platform == "linux" and .architecture == "x64"' \
      /opt/kungfu/upgrade/kungfu-release-manifest.json >/dev/null; \
    entry=$(jq -r '.entries.kungfu' /opt/kungfu/product.json); \
    case "${entry}" in /*|../*|*/../*|*/..) exit 66 ;; esac; \
    test -x "/opt/kungfu/${entry}"; \
    test "${entry}" = kungfu; \
    chmod -R a-w /opt/kungfu

FROM ${RUNTIME_IMAGE} AS runtime
ARG KUNGFU_PACKAGE_SHA256
ARG KUNGFU_PACKAGE_VERSION
ARG KUNGFU_SOURCE_SHA
ARG BUILD_IMAGES_SHA=3056c23e70b83f5bb63062f04027a93e79039e4b
ARG BUILD_IMAGE_DIGEST=sha256:cb6d939d567c129903d6e3ad858e2c09a9475b3b8f81b1aad10279d0e63a920d
ARG SOURCE_REVISION

LABEL org.opencontainers.image.title="Kungfu Hub Starter" \
      org.opencontainers.image.description="Pre-Alpha localhost-only development runtime for Kungfu-managed work" \
      org.opencontainers.image.source="https://github.com/kungfu-systems/runtime-images" \
      org.opencontainers.image.revision="${SOURCE_REVISION}" \
      org.opencontainers.image.licenses="Apache-2.0" \
      tech.kungfu.product.version="${KUNGFU_PACKAGE_VERSION}" \
      tech.kungfu.product.source="${KUNGFU_SOURCE_SHA}" \
      tech.kungfu.product.package.sha256="${KUNGFU_PACKAGE_SHA256}" \
      tech.kungfu.build-images.source="${BUILD_IMAGES_SHA}" \
      tech.kungfu.build-image.digest="${BUILD_IMAGE_DIGEST}" \
      tech.kungfu.hub-starter.contract="kungfu.hub-starter-runtime/v1" \
      tech.kungfu.release.channel="development-pre-alpha"

ENV NODE_ENV=production \
    PORT=8080 \
    HUB_STATE_ROOT=/state \
    KUNGFU_BIN=/opt/kungfu/kungfu \
    KUNGFU_INSTALL_SOURCE=archive \
    KUNGFU_DIR=/opt/kungfu \
    KUNGFU_UPGRADE_MANIFEST=/opt/kungfu/upgrade/kungfu-release-manifest.json \
    KUNGFU_PACKAGE_SHA256=${KUNGFU_PACKAGE_SHA256} \
    KUNGFU_SOURCE_SHA=${KUNGFU_SOURCE_SHA}

COPY --from=package --chown=root:root /opt/kungfu /opt/kungfu
COPY --chown=root:root src /opt/hub/src
COPY --chown=root:root web /opt/hub/web
COPY --chown=root:root package.json /opt/hub/package.json
RUN ln -s /opt/kungfu/kungfu /usr/local/bin/kungfu && \
    test -x /usr/local/bin/kungfu && \
    mkdir -p /state /opt/hub && \
    chown node:node /state && \
    chmod 0755 /state /opt/hub

USER node
WORKDIR /opt/hub
VOLUME ["/state"]
EXPOSE 8080
HEALTHCHECK --interval=5s --timeout=4s --start-period=90s --retries=24 \
  CMD node -e "fetch('http://127.0.0.1:8080/healthz').then(r=>{if(!r.ok)process.exit(1)}).catch(()=>process.exit(1))"
ENTRYPOINT ["node", "src/server.mjs"]
