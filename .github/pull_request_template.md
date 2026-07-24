## Summary

Describe the runtime behavior and why it belongs in Runtime Images.

## Validation

- [ ] `npm run check`
- [ ] `bash -n scripts/smoke-image.sh`
- [ ] Commits are signed off (DCO)

## Image and authority boundary

- [ ] Exact Kungfu source, package checksum, build-image digest, and runtime image digest are preserved
- [ ] No floating tags, credentials, private data, real Home, host path, Docker socket, host network, privilege, or added capability
- [ ] Web/Node adapters remain projections over public Kungfu commands
- [ ] Pre-Alpha and non-production claims remain explicit
- [ ] State deletion is never automatic
