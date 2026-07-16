# Security Policy

## Supported Versions

Security fixes target the latest published release of the `csszyx`
packages on npm. Older versions are not patched retroactively —
upgrade to the latest release to receive fixes.

## Verifying Releases

CSSzyx distributes its public packages through the npm registry. Each package
is built and published by the repository's GitHub Actions release workflow with
npm provenance enabled. The resulting Sigstore attestations link a package to
the source commit and workflow that produced it; keyless signing uses a
short-lived certificate instead of a long-lived project signing key.

To verify an installed release, follow npm's
[provenance verification guidance](https://docs.npmjs.com/viewing-package-provenance/)
using the latest npm CLI (provenance verification requires npm 9.5.0 or later):

```bash
npm install --ignore-scripts csszyx@<version>
npm audit signatures
```

The audit verifies both npm registry signatures and provenance attestations for
the installed dependency tree. A missing or invalid signature or attestation
causes the command to fail. To inspect the complete Sigstore bundles, including
their verification material and transparency-log entries, run:

```bash
npm audit signatures --json --include-attestations
```

The same provenance can be inspected without installing the package. Open the
chosen version on [npm](https://www.npmjs.com/package/csszyx), select the green
provenance check mark, and verify that it identifies:

- repository `nguyennhutien/csszyx`;
- build workflow `.github/workflows/release.yml`;
- the source commit corresponding to the release; and
- a public transparency-log entry.

The official [CSSzyx VS Code extension](https://marketplace.visualstudio.com/items?itemName=csszyx.csszyx)
is distributed through the Visual Studio Marketplace. The Marketplace signs
published extensions, and VS Code verifies that signature during installation.
Install the extension through the Marketplace and do not disable the
`extensions.verifySignature` setting.

Provenance and marketplace signatures establish the origin and integrity of an
artifact; they do not prove that its source code is free of vulnerabilities.
Security issues should still be reported through the private process below.

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

| Stage                                                 | Target                                                  |
| ----------------------------------------------------- | ------------------------------------------------------- |
| Acknowledge the report                                | within 7 days                                           |
| Initial assessment + severity                         | within 14 days                                          |
| Fix or mitigation for a confirmed high-severity issue | within 30 days                                          |
| Public disclosure                                     | coordinated with the reporter, after a fix is available |

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
