# Misc Utilities

## SVG

Utilities for controlling the appearance of SVG elements.

### Fill

Utilities for controlling the fill color of SVG elements.

| Concept       | CSS Rule              | Tailwind v4 Class  | `sz` Prop (Object Syntax) | Note |
| :------------ | :-------------------- | :----------------- | :------------------------ | :--- |
| **Color**     | `fill: ...`           | `fill-red-500`     | `{ fill: 'red-500' }`     |      |
| **None**      | `fill: none;`         | `fill-none`        | `{ fill: 'none' }`        |      |
| **Pick**      | `fill: inherit;`      | `fill-inherit`     | `{ fill: 'inherit' }`     |      |
| **Pick**      | `fill: currentColor;` | `fill-current`     | `{ fill: 'current' }`     |      |
| **Pick**      | `fill: transparent;`  | `fill-transparent` | `{ fill: 'transparent' }` |      |
| **Arbitrary** | `fill: #50d71e`       | `fill-[#50d71e]`   | `{ fill: '#50d71e' }`     |      |
| **Variable**  | `fill: var(--c)`      | `fill-(--c)`       | `{ fill: '--c' }`         |      |

### Stroke

Utilities for controlling the stroke color of SVG elements.

| Concept       | CSS Rule                | Tailwind v4 Class    | `sz` Prop (Object Syntax)   | Note |
| :------------ | :---------------------- | :------------------- | :-------------------------- | :--- |
| **Color**     | `stroke: ...`           | `stroke-red-500`     | `{ stroke: 'red-500' }`     |      |
| **None**      | `stroke: none;`         | `stroke-none`        | `{ stroke: 'none' }`        |      |
| **Pick**      | `stroke: inherit;`      | `stroke-inherit`     | `{ stroke: 'inherit' }`     |      |
| **Pick**      | `stroke: currentColor;` | `stroke-current`     | `{ stroke: 'current' }`     |      |
| **Pick**      | `stroke: transparent;`  | `stroke-transparent` | `{ stroke: 'transparent' }` |      |
| **Arbitrary** | `stroke: #50d71e`       | `stroke-[#50d71e]`   | `{ stroke: '#50d71e' }`     |      |
| **Variable**  | `stroke: var(--c)`      | `stroke-(--c)`       | `{ stroke: '--c' }`         |      |

### Stroke Width

Utilities for controlling the stroke width of SVG elements.

| Concept       | CSS Rule                 | Tailwind v4 Class | `sz` Prop (Object Syntax)   | Note                                                         |
| :------------ | :----------------------- | :---------------- | :-------------------------- | :----------------------------------------------------------- |
| **Scale**     | `stroke-width: <number>` | `stroke-<number>` | `{ strokeWidth: <number> }` | v4: fully dynamic, no static scale, accept any integer bare. |
| **Arbitrary** | `stroke-width: 0.5`      | `stroke-[0.5]`    | `{ strokeWidth: 0.5 }`      | decimal                                                      |
| **Arbitrary** | `stroke-width: 0.5rem`   | `stroke-[0.5rem]` | `{ strokeWidth: '0.5rem' }` | CSS unit                                                     |
| **Variable**  | `stroke-width: var(--w)` | `stroke-(--w)`    | `{ strokeWidth: '--w' }`    | **Sugar**: Auto-detects `--`.                                |

## Accessibility

Utilities for controlling accessibility-related properties.

### Forced Color Adjust

Utilities for controlling whether browsers should automatically adjust element colors in high contrast modes.

| Concept  | CSS Rule                     | Tailwind v4 Class          | `sz` Prop (Object Syntax)       | Note |
| :------- | :--------------------------- | :------------------------- | :------------------------------ | :--- |
| **Auto** | `forced-color-adjust: auto;` | `forced-color-adjust-auto` | `{ forcedColorAdjust: 'auto' }` |      |
| **None** | `forced-color-adjust: none;` | `forced-color-adjust-none` | `{ forcedColorAdjust: 'none' }` |      |

---

## `css: {}` — Arbitrary CSS Escape Hatch

For CSS properties with no `sz` prop or Tailwind utility equivalent.
Each key-value pair in the `css` object generates a Tailwind arbitrary-property class `[prop:value]`.
Keys are camelCase CSS properties; the compiler converts them to kebab-case automatically.
CSS custom properties (`--*`) are passed through unchanged.

**TypeScript:** `css?` is typed as `CSS.Properties & { [cssVar: \`--${string}\`]: string | number }` — full IDE autocomplete and typo protection.

| Concept             | Example `sz` Prop                                 | Output Class                    | Note                           |
| :------------------ | :------------------------------------------------ | :------------------------------ | :----------------------------- |
| **Regular prop**    | `{ css: { writingMode: 'vertical-lr' } }`         | `[writing-mode:vertical-lr]`    | camelCase → kebab-case         |
| **Multi-word**      | `{ css: { touchAction: 'none' } }`                | `[touch-action:none]`           |                                |
| **CSS custom prop** | `{ css: { '--my-color': 'red' } }`                | `[--my-color:red]`              | `--*` passed through unchanged |
| **Inside variant**  | `{ hover: { css: { cursor: 'crosshair' } } }`     | `hover:[cursor:crosshair]`      | works in all variants          |
| **Responsive**      | `{ md: { css: { writingMode: 'vertical-lr' } } }` | `md:[writing-mode:vertical-lr]` |                                |
| **Numeric value**   | `{ css: { zIndex: 10 } }`                         | `[z-index:10]`                  | numbers coerced to string      |

### Notes

- `css: {}` is intentional bypass — no sz-layer mapping applied. `{ css: { backgroundColor: 'red' } }` outputs `[background-color:red]`, not `bg-red`.
- Spaces in values are normalised to underscores: `repeat(3, 1fr)` → `repeat(3,_1fr)`.
- Works inside `dynamic()` at runtime — the same compiler logic handles the `css` key.
