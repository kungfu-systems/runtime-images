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
artifacts. Image publication is a trusted manual workflow using an exact
source-built package release, checksum, Kungfu source SHA, and package version.
Do not weaken the claim boundary to make a check pass.
