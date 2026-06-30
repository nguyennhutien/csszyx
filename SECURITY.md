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

Once a fix ships, the advisory is published and credit is given to the
reporter unless anonymity is requested.

## Response Timeline

We aim to meet the following targets for every valid report:

| Stage | Target |
| --- | --- |
| Acknowledge the report | within 7 days |
| Initial assessment + severity | within 14 days |
| Fix or mitigation for a confirmed high-severity issue | within 30 days |
| Public disclosure | coordinated with the reporter, after a fix is available |

If a report stalls, send a polite follow-up via the same private advisory
thread.

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

## Assurance Case

A short argument for why CSSzyx is acceptably secure, with the evidence
that backs each claim:

- **Threat model.** CSSzyx is primarily a build-time tool (compiler,
  unplugin, CLI) that reads project source and emits class names and CSS;
  its runtime packages ship small string helpers to the browser. The main
  risks are therefore (a) crafted source escaping the build sandbox (file
  or command access), (b) injection/XSS through a runtime helper, and
  (c) a vulnerable dependency.
- **(a) Build-time isolation.** The native and JS engines parse with oxc
  and operate on the AST; they do not `eval` source or shell out on
  untrusted input. Path handling in the native loader is covered by
  `native-resolution-security` tests, and a parser fuzz target
  (`parser_panic_fuzz`) guards against panics on malformed input.
- **(b) Output safety.** Class-name and CSS generation is deterministic and
  escaped; the three engines are parity-gated so a change cannot silently
  diverge into unsafe output. Runtime helpers do not build HTML.
- **(c) Supply chain.** Dependencies are reviewed by Dependabot with
  SHA-pinned GitHub Actions and a cooldown; `npm audit` and `cargo audit`
  run in CI; releases are published with Sigstore build provenance.
- **Process.** Every change runs the full lint (Biome, ESLint incl. ReDoS
  rules, Clippy with `-D warnings`), type-check, and test suites in CI
  before release. Static analysis findings block the build.

Known limitations: the project currently has a single maintainer, so
independent review of every change is not yet guaranteed (see
[`GOVERNANCE.md`](GOVERNANCE.md)).
