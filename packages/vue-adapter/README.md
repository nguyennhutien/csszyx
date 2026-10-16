# @csszyx/vue-adapter

> ⚠️ **Experimental — not production-ready.** This adapter is an early
> preview. The API may change or break between releases, and detailed usage
> docs are not yet available. Use it in production at your own risk.

Vue SFC preprocessor for [csszyx](https://github.com/nguyennhutien/csszyx) —
transforms `sz` props into Tailwind CSS classes inside `.vue` single-file
components.

## Static `sz` values only

A Vue template has no csszyx runtime, so the adapter writes a class only for an
`sz` value the build resolves completely. React's runtime path, where `_sz()` or
a `--_sz-*` style variable resolves a value at render time, is not available in
a template today. These values are static:

- strings, numbers (`-2` and `+4` included) and booleans;
- nested variant objects, `{ hover: { bg: 'blue-700' } }`;
- template strings without a `${}` substitution;
- spreads of literal objects, and arrays of such objects;
- `null` and `undefined`, which leave the key unset.

```vue
<template>
  <div :sz="{ p: 4, hover: { bg: 'blue-700' } }">Card</div>
  <!-- written as <div class="p-4 hover:bg-blue-700">Card</div> -->
</template>
```

Any other value stops the build with its file and position. That includes a
name, even a `const` from `<script setup>`, a prop, a conditional, a call, an
array value such as `{ p: [4] }`, and a template string with `${}`:

```text
[csszyx] src/Card.vue:3:15: this sz value is only known at runtime, and a template has no csszyx runtime to resolve it
help: write the value as a literal, e.g. { p: 4 }, or bind class or style yourself for a value that changes at runtime
note: the attribute is left as written; no class is generated for it
```

For a value that changes at runtime, bind `class` or `style` yourself:

```vue
<div :class="big ? 'p-8' : 'p-4'" :style="{ width: `${size}px` }" />
```

The Vite plugin passes warnings to the bundler and fails on errors.
`preprocess()` returns both in `result.diagnostics`; pass `filename` to name
the file in each message, `parser: 'wasm'` to pin the engine artifact, and
`classPrefix: 'tw'` when your stylesheet sets `prefix(tw)` (the csszyx bundler
plugin reads it from the stylesheet and passes it for you).

## `sz` on a component

On a component, `sz` becomes a `class` attribute, as it does on an HTML tag.
Vue passes that `class` to the component's root element, so a component styles
itself from the caller's `sz` with no code of its own. A component with
`inheritAttrs: false` or several root elements has to bind `$attrs.class` where
it wants it.

```vue
<Card sz="{ p: 4 }" />
<!-- written as <Card class="p-4" />; Card's root element gets p-4 -->
```

A library component whose own prop is named `sz` gets that prop replaced by
`class`. Pass the prop through `v-bind`, which the adapter does not read:
`<Avatar v-bind="{ sz: size }" />`.

## Want to help develop it?

This adapter needs a real Vue project to harden and finish. If you would like
to use it seriously, contribute, or help shape its direction, please reach
out — that feedback is what moves it toward stable:

- **Open an issue:** <https://github.com/nguyennhutien/csszyx/issues>
- **Email:** <hello@csszyx.com>

For the stable, production-ready csszyx packages, see the
[main README](https://github.com/nguyennhutien/csszyx#readme).
