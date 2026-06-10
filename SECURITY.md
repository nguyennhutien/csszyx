# Security Policy

## Supported Versions

Security fixes target the latest published release of the `csszyx`
packages on npm. Older versions are not patched retroactively —
upgrade to the latest release to receive fixes.

## Reporting a Vulnerability

Please **do not** open a public issue for security problems.

Report privately via GitHub's private vulnerability reporting:
**[Security → Report a vulnerability](../../security/advisories/new)**.

Include what you can of the following:

- Affected package(s) (e.g. `csszyx`, `@csszyx/compiler`, `@csszyx/unplugin`)
  and version
- Reproduction steps or a minimal proof of concept
- Impact assessment (what an attacker gains)

You will get an acknowledgement as soon as possible, normally within a
few days. Once a fix ships, the advisory is published and credit is
given to the reporter unless anonymity is requested.

## Scope Notes

- CSSzyx is a build-time tool: the compiler, unplugin, and CLI run in
  development and CI environments. Vulnerabilities that let crafted
  source input escalate beyond the build process (e.g. arbitrary file
  read/write outside the project, command execution) are in scope and
  treated as high severity.
- The runtime packages (`@csszyx/runtime`, `@csszyx/dynamic`) ship to
  browsers; XSS or injection vectors through their public APIs are in
  scope.
- Dependency advisories are monitored continuously (Dependabot, npm
  audit, cargo audit in CI); duplicate reports of known upstream CVEs
  are appreciated but may be closed as tracked.
