# Project Governance

This document describes how the CSSzyx project is run: the roles, how
decisions are made, and how someone becomes a maintainer.

## Roles

### Users

Anyone who uses CSSzyx. Users are encouraged to file issues, ask questions,
and propose improvements.

### Contributors

Anyone who submits a pull request, files a triaged issue, improves the docs,
or helps others. Contribution requirements are in
[`CONTRIBUTING.md`](CONTRIBUTING.md).

### Maintainers

Maintainers have write access and are responsible for reviewing and merging
changes, cutting releases, and stewarding the roadmap and security response.

Current maintainers:

- Tien Nguyen ([@nguyennhutien](https://github.com/nguyennhutien)) — lead
  maintainer.

The project is actively seeking additional independent maintainers. Two
best-practice criteria (independent review of every change, and more than one
unassociated significant contributor) require a second maintainer; growing the
maintainer team is an explicit goal — see "Becoming a Maintainer" below.

## Decision-Making

- **Routine changes** (bug fixes, docs, dependency updates) are decided by a
  maintainer through normal review and merge.
- **Significant changes** (public API, new packages, breaking changes,
  architecture) are proposed as a GitHub issue or discussion first, recorded as
  an Architecture Decision Record in the maintainers' notes, and merged once a
  maintainer approves and no maintainer objects. The reasoning that a decision
  record holds is summarised in the issue or discussion it came from, so it stays
  readable without the notes.
- **Disagreements** are resolved by discussion aiming for consensus. While the
  project has a single lead maintainer, the lead maintainer is the final
  decision-maker; as the maintainer team grows, ties are broken by a majority of
  maintainers.

## Release Process

Releases are automated with release-please and published to npm with build
provenance (Sigstore). The process is documented in the release workflow and
the project rules. Only maintainers can trigger a release.

## Security

Vulnerability reports follow [`SECURITY.md`](SECURITY.md). Security fixes take
priority over feature work and may be released out of the normal cadence.

## Becoming a Maintainer

Contributors who have a sustained track record of high-quality contributions
(code, review, triage, docs) may be invited to become maintainers by an
existing maintainer. The goal is at least two independent maintainers so that
every change can be reviewed by someone other than its author. If you are
interested, start by contributing regularly and reviewing open pull requests,
then reach out to a maintainer.

## Code of Conduct

All participation is governed by the
[Code of Conduct](CODE_OF_CONDUCT.md).
