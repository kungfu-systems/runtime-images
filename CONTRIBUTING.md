# Contributing

Use a branch and pull request against the active development line. Every commit
must include a Developer Certificate of Origin signoff (`git commit -s`).

Before opening a pull request:

```sh
npm ci --ignore-scripts --registry=https://registry.npmjs.org/
npm run check
bash -n scripts/smoke-image.sh
```

Do not commit packages, credentials, `.env`, generated state, or smoke
artifacts. The manual candidate workflows are dry-run or qualification-only.
They cannot publish images, OCI applications, GitHub Releases, or floating
channels.

Alpha and release publication is owned by the Buildchain transaction after a
protected channel pull request passes `Verify`. The transaction consumes the
exact locked source-built Kungfu packages, publishes versioned multi-platform
image and Compose artifacts, verifies them, writes durable evidence, and emits
a Release Passport before release refs finalize. Do not weaken that claim
boundary to make a check pass.
