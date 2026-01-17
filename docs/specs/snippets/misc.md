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
