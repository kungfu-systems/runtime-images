# Security policy

Hub Starter is a pre-Alpha development candidate and is not supported for
production or untrusted networks. Bind it only to localhost and use disposable,
non-sensitive development data.

Report suspected vulnerabilities privately through GitHub Security Advisories
for `kungfu-systems/runtime-images`. Do not open a public issue containing
credentials, exploit details, private logs, customer data, or signed URLs.

The project accepts no Docker socket, privileged mode, host networking,
capability additions, real Home mounts, or embedded credentials. See
`contracts/hub-starter-runtime.contract.json` for the machine boundary.
