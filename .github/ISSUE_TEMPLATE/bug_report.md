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
or StackBlitz. Include the engine artifact if relevant: paste the sentence
under the build's `[csszyx] active-parser:` line. It reads
"This build parses with the native engine." or "... with the wasm engine.",
and "... with the wasm engine in place of the default native engine." when a
default build fell back to wasm, which can differ from `build.parser`.

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
