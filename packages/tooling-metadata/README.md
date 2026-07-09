# @csszyx/tooling-metadata

Shared, engine-neutral implementation metadata for csszyx editor and language
tooling. It exposes plain, read-only data — the `sz` property map, boolean
shorthands, known variants, and curated value suggestions — generated from the
csszyx compiler tables at build time.

**This is a private, internal package.** It is not published to npm. Both
consumers bundle its data in at build time, so nothing installs it directly:

- [`@csszyx/ts-plugin`](https://www.npmjs.com/package/@csszyx/ts-plugin) inlines
  it via esbuild — the published plugin has no runtime dependencies.
- The **csszyx** VS Code extension inlines it into its bundle the same way.

Keeping the data in one internal package means both integrations stay in
lock-step with the compiler and cannot drift apart. Third parties that want the
raw property tables can read them from the public `@csszyx/compiler` package.

## Exports

| Export                    | Shape                      | Meaning                                       |
| ------------------------- | -------------------------- | --------------------------------------------- |
| `METADATA_SCHEMA_VERSION` | `number`                   | Schema version consumers validate before use. |
| `PROPERTY_MAP`            | `Record<string, string>`   | `sz` key → emitted Tailwind utility prefix.   |
| `BOOLEAN_SHORTHANDS`      | `readonly string[]`        | Keys usable as bare boolean flags.            |
| `KNOWN_VARIANTS`          | `readonly string[]`        | Recognized variant/modifier keys.             |
| `SUGGESTION_MAP`          | `Record<string, string>`   | Alias → canonical `sz` key.                   |
| `VALUE_SUGGESTIONS`       | `Record<string, string[]>` | Curated example values per `sz` key.          |

`VALUE_SUGGESTIONS` is advisory: it lists common values for discovery and does
not enumerate or validate the full value space of a property.

## License

MIT
