# Vendored web fonts

These are the exact `woff2` files the docs site was already serving. They used
to be fetched from `fonts.gstatic.com` on every build; they are committed here
so no build depends on Google answering.

## Why they are committed

`fontProviders.google()` made every build anywhere — CI, Cloudflare preview,
Cloudflare production, the release job, a laptop — depend on
`fonts.gstatic.com`. It failed **five times in three days**, always
`[CannotFetchFontFile]` with HTTP 404, across all three families and both CI
systems.

The cause is not an unreliable network. Astro caches the _resolved_ gstatic URL
for about two days and does not re-resolve inside that window. When Google
rotates a file, the cached URL is simply gone, and any build that fetches in
that gap fails. Caching more on our side makes the exposure longer, not
shorter, because the cached thing is the stale URL.

## What is here

Five files, ~169 KB total. Each style is one variable font covering the whole
weight range, which is why five files serve twenty-two `@font-face`
declarations.

| File                                | Family         | Style  | Weights |
| ----------------------------------- | -------------- | ------ | ------- |
| `ibm-plex-sans-latin-normal.woff2`  | IBM Plex Sans  | normal | 300–700 |
| `ibm-plex-sans-latin-italic.woff2`  | IBM Plex Sans  | italic | 300–700 |
| `jetbrains-mono-latin-normal.woff2` | JetBrains Mono | normal | 400–700 |
| `jetbrains-mono-latin-italic.woff2` | JetBrains Mono | italic | 400–700 |
| `geist-mono-latin-normal.woff2`     | Geist Mono     | normal | 400–700 |

All are the `latin` subset, matching the `unicode-range` Google served. That
range is carried verbatim in `astro.config.mjs`; dropping it would make
browsers download a face for text it cannot render.

## Licences

All three families are SIL Open Font License 1.1, which permits redistribution
provided the licence travels with the files. The texts here are copied from
each upstream repository:

| Family         | Upstream                                                              | Licence file             |
| -------------- | --------------------------------------------------------------------- | ------------------------ |
| IBM Plex Sans  | [IBM/plex](https://github.com/IBM/plex)                               | `OFL-IBM-Plex-Sans.txt`  |
| JetBrains Mono | [JetBrains/JetBrainsMono](https://github.com/JetBrains/JetBrainsMono) | `OFL-JetBrains-Mono.txt` |
| Geist Mono     | [vercel/geist-font](https://github.com/vercel/geist-font)             | `OFL-Geist-Mono.txt`     |

## Updating

Changing a family, weight or style means the vendored files no longer cover
what the config declares, and the build will fail on a missing face rather than
silently serve the wrong one.

To refresh: point `astro.config.mjs` back at `fontProviders.google()`, build
once, copy the emitted files out of `dist/_astro/fonts/` under the names above,
then switch back. Verify by diffing the generated `@font-face` blocks and the
`woff2` bytes against the fetched build — they should be identical apart from
the two content hashes.
