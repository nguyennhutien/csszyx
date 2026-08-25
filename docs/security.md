# Security

csszyx is **safe by default for authored sz** — styles written in source compile
to plain class strings at build time. Care is needed only when sz comes from
**untrusted input** (a JSON-driven UI, a CMS schema, end-user data), since `sz`
lets a caller control the keys and values that reach the runtime CSS pipeline.

> Security is defense-in-depth, not a guarantee: csszyx drives the realistic
> exploitability of untrusted sz to near-zero and documents the residual. It does
> not claim "zero risk" — arbitrary CSS values are by design a CSS sink.

## Purify untrusted sz

```tsx
import { dynamic, purifySz } from "@csszyx/dynamic";

const className = dynamic(purifySz(untrustedSzFromJson));
```

`purifySz` is allowlist-based: it drops unknown keys, rejects values that could
inject a second CSS declaration, blocks prototype-polluting keys
(`__proto__`/`constructor`/`prototype`), and bounds nesting depth. Its default
**strict** mode also strips `url()` / `image-set()` / `@import` / `expression()`.
Use `{ strict: false }` only for trusted input.

## Built-in protections

- **Runtime CSS injection** uses atomic `CSSStyleSheet.insertRule` — a
  `}`/`</style>` rule breakout throws and is ignored (no second rule, no markup).
- **Declaration values + arbitrary property names** are validated before
  injection (no `;`/`{`/`}`/`<`/`>`/control characters escaping the declaration).
- **Recursion depth** is capped (`SzDepthError`) so deeply nested untrusted sz
  cannot overflow the stack at render time.
- **SSR mangle map** is schema-validated (`isValidMangleMap`) before use;
  `verifyMangleChecksumAsync` recomputes the checksum via Web Crypto for real
  integrity verification without the WASM core (tamper-detection, not auth).

## Returned strings are React-escaped only

`dynamic()` / `_sz` / `_szMerge` return a plain class string — attribute-escaped
and safe inside React `className={...}`, but **never** interpolate it into raw
HTML. Use `stripSzProps` when forwarding `...rest` so a raw `sz` object never
reaches the DOM as `sz="[object Object]"`.

## CSP

The primary injection path uses a constructable `CSSStyleSheet` +
`adoptedStyleSheets` — no inline style text, CSP-clean, no `'unsafe-inline'`. The
`<style>` fallback adds rules via the CSSOM (still no inline content); under a
strict CSP, ensure `adoptedStyleSheets` is available or provide a nonce for the
fallback element.

JavaScript: a production build emits **no executable inline script**. The HTML
carries only inert data (`data-sz-checksum`, and the
`<script type="application/json">` hydration census, which `script-src` does not
apply to). The runtime mangle map is registered from a module inside your own
bundle (`mangleMapDelivery: 'bundle'`, the default), so `script-src 'self'` or
your nonce/hash covers it — never add `'unsafe-inline'` for csszyx. The
deprecated `'html'`/`'both'` modes and mangled **webpack** builds still ship one
inline installer; the full contract and a local-enforcement recipe are in the
docs site's Security page.
