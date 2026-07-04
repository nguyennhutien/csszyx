# docs/ — specifications and internal docs

This directory holds the **specification sources** for CSSzyx. It is not the
documentation website: the user-facing docs site (csszyx.com) is an Astro
Starlight app that lives in [`apps/docs`](../apps/docs) — run it with
`pnpm --filter @csszyx/docs dev` from the repo root.

## What lives here

| Path                                           | Purpose                                                                                                                                                                                                                                                                         |
| ---------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| [`specs/snippets/`](./specs/snippets)          | **The sz-prop specification** — per-category mapping tables (`sz` key → Tailwind class), edge cases, and notes. Together with `packages/compiler/tests/` these are the source of truth for what the compiler supports; the website and `llms*.txt` files are derived from them. |
| [`specs/SPEC_INDEX.md`](./specs/SPEC_INDEX.md) | Index into the snippet categories.                                                                                                                                                                                                                                              |
| [`guides/migration.md`](./guides/migration.md) | Migration notes (Tailwind `className` → `sz`).                                                                                                                                                                                                                                  |
| [`security.md`](./security.md)                 | Security notes for runtime injection (`purifySz`, untrusted sz input).                                                                                                                                                                                                          |

When changing sz-prop behavior, the snippet tables here must be updated in the
same change as the compiler tests, the website reference pages, and the
`llms*.txt` files — the four surfaces must tell the same truth.

## Legacy content

`.vitepress/`, `guide/`, `api/`, `config/`, `examples/`, and `index.md` are the
remains of an earlier VitePress site that predates `apps/docs`. The local
`package.json` is not part of the pnpm workspace, so this content is not built
or deployed anywhere. Do not update it — new documentation goes to
`apps/docs/src/content/docs/`.

## License

MIT
