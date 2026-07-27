# syntax=docker/dockerfile:1.7
# SPDX-License-Identifier: Apache-2.0

ARG RUNTIME_IMAGE=node:24-trixie-slim@sha256:ae91dcc111a68c9d2d81ff2a17bda61be126426176fde6fe7d08ab13b7f50573

FROM ${RUNTIME_IMAGE} AS package
ARG TARGETARCH
ARG KUNGFU_PACKAGE_SHA256_AMD64
ARG KUNGFU_PACKAGE_SHA256_ARM64
ARG KUNGFU_PACKAGE_VERSION
ARG KUNGFU_SOURCE_SHA
USER root
COPY kungfu-episodes-cli-linux-x64.tar.gz /tmp/kungfu-episodes-cli-linux-x64.tar.gz
COPY kungfu-episodes-cli-linux-arm64.tar.gz /tmp/kungfu-episodes-cli-linux-arm64.tar.gz
RUN set -eu; \
    case "${TARGETARCH}" in \
      amd64) package_platform=linux-x64; package_arch=x64; package_sha="${KUNGFU_PACKAGE_SHA256_AMD64}" ;; \
      arm64) package_platform=linux-arm64; package_arch=arm64; package_sha="${KUNGFU_PACKAGE_SHA256_ARM64}" ;; \
      *) echo "unsupported target architecture: ${TARGETARCH}" >&2; exit 64 ;; \
    esac; \
    package_archive="/tmp/kungfu-episodes-cli-${package_platform}.tar.gz"; \
    test -n "${package_sha}"; \
    test -n "${KUNGFU_PACKAGE_VERSION}"; \
    printf '%s' "${KUNGFU_SOURCE_SHA}" | grep -Eq '^[0-9a-f]{40}$'; \
    echo "${package_sha}  ${package_archive}" | sha256sum -c -; \
    mkdir -p /opt/kungfu; \
    tar -xzf "${package_archive}" -C /opt/kungfu --strip-components=1; \
    node -e 'const p=require(process.argv[1]); if(p.schema!=="kungfu.product.cli/v1"||p.platform!==process.argv[2]||!p.entries?.kungfu) process.exit(1)' /opt/kungfu/product.json "${package_platform}"; \
    node -e 'const p=require(process.argv[1]); if(p.schema!=="kungfu.product.compatibility/v1"||p.source_commit!==process.argv[2]||p.versions?.product!==process.argv[3]) process.exit(1)' /opt/kungfu/runtime/product-compatibility.json "${KUNGFU_SOURCE_SHA}" "${KUNGFU_PACKAGE_VERSION}"; \
    node -e 'const p=require(process.argv[1]); if(p.schema!=="kungfu.product-upgrade.manifest/v1"||p.sourceCommit!==process.argv[2]||p.productVersion!==process.argv[3]||p.platform!=="linux"||p.architecture!==process.argv[4]) process.exit(1)' /opt/kungfu/upgrade/kungfu-release-manifest.json "${KUNGFU_SOURCE_SHA}" "${KUNGFU_PACKAGE_VERSION}" "${package_arch}"; \
    entry=$(node -e 'process.stdout.write(require(process.argv[1]).entries.kungfu)' /opt/kungfu/product.json); \
    case "${entry}" in /*|../*|*/../*|*/..) exit 66 ;; esac; \
    test -x "/opt/kungfu/${entry}"; \
    test "${entry}" = kungfu; \
    chmod -R a-w /opt/kungfu

FROM ${RUNTIME_IMAGE} AS runtime
ARG TARGETPLATFORM
ARG KUNGFU_PACKAGE_SHA256_AMD64
ARG KUNGFU_PACKAGE_SHA256_ARM64
ARG KUNGFU_PACKAGE_VERSION
ARG KUNGFU_SOURCE_SHA
ARG SOURCE_REVISION

LABEL org.opencontainers.image.title="Kungfu Hub Starter" \
      org.opencontainers.image.description="Pre-Alpha localhost-only development runtime for Kungfu-managed work" \
      org.opencontainers.image.source="https://github.com/kungfu-systems/runtime-images" \
      org.opencontainers.image.revision="${SOURCE_REVISION}" \
      org.opencontainers.image.licenses="Apache-2.0" \
      tech.kungfu.product.version="${KUNGFU_PACKAGE_VERSION}" \
      tech.kungfu.product.source="${KUNGFU_SOURCE_SHA}" \
      tech.kungfu.product.package.amd64.sha256="${KUNGFU_PACKAGE_SHA256_AMD64}" \
      tech.kungfu.product.package.arm64.sha256="${KUNGFU_PACKAGE_SHA256_ARM64}" \
      tech.kungfu.runtime.platform="${TARGETPLATFORM}" \
      tech.kungfu.hub-starter.contract="kungfu.hub-starter-runtime/v1" \
      tech.kungfu.release.channel="development-pre-alpha"

ENV NODE_ENV=production \
    PORT=8080 \
    HUB_STATE_ROOT=/state \
    KUNGFU_BIN=/opt/kungfu/kungfu \
    KUNGFU_INSTALL_SOURCE=archive \
    KUNGFU_DIR=/opt/kungfu \
    KUNGFU_UPGRADE_MANIFEST=/opt/kungfu/upgrade/kungfu-release-manifest.json \
    KUNGFU_PACKAGE_SHA256_AMD64=${KUNGFU_PACKAGE_SHA256_AMD64} \
    KUNGFU_PACKAGE_SHA256_ARM64=${KUNGFU_PACKAGE_SHA256_ARM64} \
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
