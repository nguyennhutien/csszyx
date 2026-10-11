---
name: Bug report
about: Report incorrect or broken behavior in CSSzyx
title: ""
labels: bug
assignees: ""
---

## What happened

A clear description of the bug.

## Reproduction

The smallest `sz` input / config that reproduces it, ideally a minimal repo
or StackBlitz. Include the engine artifact if relevant: the parser named in the
build's `[csszyx] active parser:` line (rust / wasm), which can differ
from `build.parser` when a default build falls back to wasm.

```tsx
// e.g. <div sz={{ ... }} />
```

## Expected vs actual output

- Expected className / CSS:
- Actual className / CSS:

## Environment

- CSSzyx version:
- Bundler + version (Vite / webpack / Turbopack / Astro / …):
- Tailwind version:
- Node / OS:

## Additional context

Logs, screenshots, or anything else that helps.
