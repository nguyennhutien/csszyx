# Borders

Controlling borders, outlines, rings, and dividers.

## Border Radius

Controlling the border radius of an element.

| Concept             | CSS Rule                                                                    | Tailwind v4 Class                                                                                               | `sz` Prop (Object Syntax) | Note                          |
| :------------------ | :-------------------------------------------------------------------------- | :-------------------------------------------------------------------------------------------------------------- | :------------------------ | :---------------------------- |
| **All Sides**       | `border-radius: 0.25rem`                                                    | `rounded`, `rounded-sm`, `rounded-md`, `rounded-lg`, `rounded-xl`, `rounded-2xl`, `rounded-3xl`, `rounded-full` | `{ rounded: 'sm' }`       |                               |
| **None**            | `border-radius: 0px`                                                        | `rounded-none`                                                                                                  | `{ rounded: 'none' }`     |                               |
| **Top**             | `border-top-left-radius: 0.125rem; border-top-right-radius: 0.125rem`       | `rounded-t-sm`                                                                                                  | `{ roundedT: 'sm' }`      |                               |
| **Right**           | `border-top-right-radius: 0.125rem; border-bottom-right-radius: 0.125rem`   | `rounded-r-sm`                                                                                                  | `{ roundedR: 'sm' }`      |                               |
| **Bottom**          | `border-bottom-right-radius: 0.125rem; border-bottom-left-radius: 0.125rem` | `rounded-b-sm`                                                                                                  | `{ roundedB: 'sm' }`      |                               |
| **Left**            | `border-top-left-radius: 0.125rem; border-bottom-left-radius: 0.125rem`     | `rounded-l-sm`                                                                                                  | `{ roundedL: 'sm' }`      |                               |
| **Top Left**        | `border-top-left-radius`                                                    | `rounded-tl-sm`                                                                                                 | `{ roundedTl: 'sm' }`     |                               |
| **Top Right**       | `border-top-right-radius`                                                   | `rounded-tr-sm`                                                                                                 | `{ roundedTr: 'sm' }`     |                               |
| **Bottom Right**    | `border-bottom-right-radius`                                                | `rounded-br-sm`                                                                                                 | `{ roundedBr: 'sm' }`     |                               |
| **Bottom Left**     | `border-bottom-left-radius`                                                 | `rounded-bl-sm`                                                                                                 | `{ roundedBl: 'sm' }`     |                               |
| **Start (Logical)** | `border-start-start-radius`                                                 | `rounded-s-sm`                                                                                                  | `{ roundedS: 'sm' }`      |                               |
| **End (Logical)**   | `border-end-end-radius`                                                     | `rounded-e-sm`                                                                                                  | `{ roundedE: 'sm' }`      |                               |
| **Start-Start**     | `border-start-start-radius`                                                 | `rounded-ss-sm`                                                                                                 | `{ roundedSs: 'sm' }`     |                               |
| **Start-End**       | `border-start-end-radius`                                                   | `rounded-se-sm`                                                                                                 | `{ roundedSe: 'sm' }`     |                               |
| **End-Start**       | `border-end-start-radius`                                                   | `rounded-es-sm`                                                                                                 | `{ roundedEs: 'sm' }`     |                               |
| **End-End**         | `border-end-end-radius`                                                     | `rounded-ee-sm`                                                                                                 | `{ roundedEe: 'sm' }`     |                               |
| **Arbitrary**       | `border-radius: 5px`                                                        | `rounded-[5px]`                                                                                                 | `{ rounded: '5px' }`      |                               |
| **CSS Variable**    | `border-radius: var(--r)`                                                   | `rounded-(--r)`                                                                                                 | `{ rounded: '--r' }`      | **Sugar**: Auto-detects `--`. |

## Border Width

Controlling the width of an element's borders.

| Concept         | CSS Rule                    | Tailwind v4 Class                              | `sz` Prop (Object Syntax)        | Note                      |
| :-------------- | :-------------------------- | :--------------------------------------------- | :------------------------------- | :------------------------ |
| **All Sides**   | `border-width: 1px`         | `border`                                       | `{ border: true }`               | **Default**: 1px.         |
| **Width Scale** | `border-width: 2px`         | `border-0`, `border-2`, `border-4`, `border-8` | `{ border: 0 }`, `{ border: 2 }` |                           |
| **X Axis**      | `border-inline-width: 2px`  | `border-x-2`                                   | `{ borderX: 2 }`                 |                           |
| **Y Axis**      | `border-block-width: 2px`   | `border-y-2`                                   | `{ borderY: 2 }`                 |                           |
| **Top**         | `border-top-width: 2px`     | `border-t-2`                                   | `{ borderT: 2 }`                 |                           |
| **Right**       | `border-right-width: 2px`   | `border-r-2`                                   | `{ borderR: 2 }`                 |                           |
| **Bottom**      | `border-bottom-width: 2px`  | `border-b-2`                                   | `{ borderB: 2 }`                 |                           |
| **Left**        | `border-left-width: 2px`    | `border-l-2`                                   | `{ borderL: 2 }`                 |                           |
| **Start**       | `border-inline-start-width` | `border-s-2`                                   | `{ borderS: 2 }`                 |                           |
| **End**         | `border-inline-end-width`   | `border-e-2`                                   | `{ borderE: 2 }`                 |                           |
| **Block Start** | `border-block-start-width`  | `border-bs-2`                                  | `{ borderBs: 2 }`                | v4.2: logical block-side. |
| **Block End**   | `border-block-end-width`    | `border-be-2`                                  | `{ borderBe: 2 }`                | v4.2: logical block-side. |
| **Arbitrary**   | `border-width: 3px`         | `border-[3px]`                                 | `{ border: '3px' }`              |                           |
| **Variable**    | `border-width: var(--w)`    | `border-(--w)`                                 | `{ border: '--w' }`              |                           |

## Border Color

Controlling the color of an element's borders.

| Concept               | CSS Rule                      | Tailwind v4 Class   | `sz` Prop (Object Syntax)                       | Note                                       |
| :-------------------- | :---------------------------- | :------------------ | :---------------------------------------------- | :----------------------------------------- |
| **Color**             | `border-color: currentColor`  | `border-red-500`    | `{ borderColor: 'red-500' }`                    |                                            |
| **Opacity**           | `border-color: currentColor`  | `border-red-500/50` | `{ borderColor: { color: 'red-500', op: 50 } }` |                                            |
| **CSS Var + Opacity** | `border-color: var(--c) / 50` | `border-(--c)/50`   | `{ borderColor: { color: '--c', op: 50 } }`     | CSS variables are auto-wrapped in `(...)`. |
| **X/Y/T/R/B/L**       | `border-color: currentColor`  | `border-t-red-500`  | `{ borderTColor: 'red-500' }`                   | Verbose keys to avoid conflict with Width. |
| **Arbitrary**         | `border-color: currentColor`  | `border-[#50d71e]`  | `{ borderColor: '#50d71e' }`                    |                                            |
| **Variable**          | `border-color: var(--c)`      | `border-(--c)`      | `{ borderColor: '--c' }`                        |                                            |

## Border Style

Controlling the style of an element's borders.

| Concept    | CSS Rule               | Tailwind v4 Class | `sz` Prop (Object Syntax)   | Note |
| :--------- | :--------------------- | :---------------- | :-------------------------- | :--- |
| **Solid**  | `border-style: solid`  | `border-solid`    | `{ borderStyle: 'solid' }`  |      |
| **Dashed** | `border-style: dashed` | `border-dashed`   | `{ borderStyle: 'dashed' }` |      |
| **Dotted** | `border-style: dotted` | `border-dotted`   | `{ borderStyle: 'dotted' }` |      |
| **Double** | `border-style: double` | `border-double`   | `{ borderStyle: 'double' }` |      |
| **Hidden** | `border-style: hidden` | `border-hidden`   | `{ borderStyle: 'hidden' }` |      |
| **None**   | `border-style: none`   | `border-none`     | `{ borderStyle: 'none' }`   |      |

## Divide Width

Utilities for controlling the border width between elements.

| Concept       | CSS Rule                                                       | Tailwind v4 Class                                      | `sz` Prop (Object Syntax)  | Note                 |
| :------------ | :------------------------------------------------------------- | :----------------------------------------------------- | :------------------------- | :------------------- |
| **X**         | `border-inline-start-width: 0px; border-inline-end-width: 1px` | `divide-x`                                             | `{ divideX: true }`        | Applied to children. |
| **X Scale**   | `border-inline-end-width: 1px`                                 | `divide-x-0`, `divide-x-2`, `divide-x-4`, `divide-x-8` | `{ divideX: 2 }`           |                      |
| **X Reverse** | `--tw-divide-x-reverse: 1`                                     | `divide-x-reverse`                                     | `{ divideXReverse: true }` |                      |
| **Y**         | `border-top-width: 0px; border-bottom-width: 1px`              | `divide-y`                                             | `{ divideY: true }`        |                      |
| **Y Scale**   | `border-bottom-width: 1px`                                     | `divide-y-0`, `divide-y-2`, `divide-y-4`, `divide-y-8` | `{ divideY: 2 }`           |                      |
| **Y Reverse** | `--tw-divide-y-reverse: 1`                                     | `divide-y-reverse`                                     | `{ divideYReverse: true }` |                      |
| **Arbitrary** | `border-inline-end-width: 3px`                                 | `divide-x-[3px]`                                       | `{ divideX: '3px' }`       |                      |
| **Variable**  | `border-inline-end-width: var(--w)`                            | `divide-x-(--w)`                                       | `{ divideX: '--w' }`       |                      |

## Divide Color

Utilities for controlling the border color between elements.

| Concept               | CSS Rule                      | Tailwind v4 Class   | `sz` Prop (Object Syntax)                       | Note                                       |
| :-------------------- | :---------------------------- | :------------------ | :---------------------------------------------- | :----------------------------------------- |
| **Color**             | `border-color: currentColor`  | `divide-red-500`    | `{ divideColor: 'red-500' }`                    |                                            |
| **Opacity**           | `border-color: currentColor`  | `divide-red-500/50` | `{ divideColor: { color: 'red-500', op: 50 } }` |                                            |
| **CSS Var + Opacity** | `border-color: var(--c) / 50` | `divide-(--c)/50`   | `{ divideColor: { color: '--c', op: 50 } }`     | CSS variables are auto-wrapped in `(...)`. |
| **Arbitrary**         | `border-color: currentColor`  | `divide-[#50d71e]`  | `{ divideColor: '#50d71e' }`                    |                                            |
| **Variable**          | `border-color: var(--c)`      | `divide-(--c)`      | `{ divideColor: '--c' }`                        |                                            |

## Divide Style

Utilities for controlling the border style between elements.

| Concept    | CSS Rule               | Tailwind v4 Class | `sz` Prop (Object Syntax)   | Note |
| :--------- | :--------------------- | :---------------- | :-------------------------- | :--- |
| **Solid**  | `border-style: solid`  | `divide-solid`    | `{ divideStyle: 'solid' }`  |      |
| **Dashed** | `border-style: dashed` | `divide-dashed`   | `{ divideStyle: 'dashed' }` |      |
| **Dotted** | `border-style: dotted` | `divide-dotted`   | `{ divideStyle: 'dotted' }` |      |
| **Double** | `border-style: double` | `divide-double`   | `{ divideStyle: 'double' }` |      |
| **None**   | `border-style: none`   | `divide-none`     | `{ divideStyle: 'none' }`   |      |

## Outline Width

Controlling the width of an element's outline.

| Concept       | CSS Rule                  | Tailwind v4 Class                                                          | `sz` Prop (Object Syntax) | Note |
| :------------ | :------------------------ | :------------------------------------------------------------------------- | :------------------------ | :--- |
| **Width**     | `outline-width: 1px`      | `outline`, `outline-0`, `outline-1`, `outline-2`, `outline-4`, `outline-8` | `{ outline: 1 }`          |      |
| **Arbitrary** | `outline-width: 3px`      | `outline-[3px]`                                                            | `{ outline: '3px' }`      |      |
| **Variable**  | `outline-width: var(--w)` | `outline-(--w)`                                                            | `{ outline: '--w' }`      |      |

## Outline Color

Controlling the color of an element's outline.

| Concept       | CSS Rule                      | Tailwind v4 Class   | `sz` Prop (Object Syntax)     | Note |
| :------------ | :---------------------------- | :------------------ | :---------------------------- | :--- |
| **Color**     | `outline-color: currentColor` | `outline-red-500`   | `{ outlineColor: 'red-500' }` |      |
| **Arbitrary** | `outline-color: currentColor` | `outline-[#50d71e]` | `{ outlineColor: '#50d71e' }` |      |
| **Variable**  | `outline-color: var(--c)`     | `outline-(--c)`     | `{ outlineColor: '--c' }`     |      |

## Outline Style

Controlling the style of an element's outline.

| Concept    | CSS Rule                                               | Tailwind v4 Class | `sz` Prop (Object Syntax)    | Note                              |
| :--------- | :----------------------------------------------------- | :---------------- | :--------------------------- | :-------------------------------- |
| **None**   | `outline: 2px solid transparent; outline-offset: 2px;` | `outline-none`    | `{ outline: 'none' }`        | **Reset**: Resets outline styles. |
| **Solid**  | `outline-style: solid`                                 | `outline-solid`   | `{ outlineStyle: 'solid' }`  |                                   |
| **Dashed** | `outline-style: dashed`                                | `outline-dashed`  | `{ outlineStyle: 'dashed' }` |                                   |
| **Dotted** | `outline-style: dotted`                                | `outline-dotted`  | `{ outlineStyle: 'dotted' }` |                                   |
| **Double** | `outline-style: double`                                | `outline-double`  | `{ outlineStyle: 'double' }` |                                   |
| **Hidden** | `outline-style: hidden`                                | `outline-hidden`  | `{ outlineStyle: 'hidden' }` |                                   |

## Outline Offset

Controlling the offset of an element's outline.

| Concept       | CSS Rule                   | Tailwind v4 Class                                                                                  | `sz` Prop (Object Syntax)  | Note |
| :------------ | :------------------------- | :------------------------------------------------------------------------------------------------- | :------------------------- | :--- |
| **Offset**    | `outline-offset: 0px`      | `outline-offset-0`, `outline-offset-1`, `outline-offset-2`, `outline-offset-4`, `outline-offset-8` | `{ outlineOffset: 0 }`     |      |
| **Arbitrary** | `outline-offset: 3px`      | `outline-offset-[3px]`                                                                             | `{ outlineOffset: '3px' }` |      |
| **Variable**  | `outline-offset: var(--o)` | `outline-offset-(--o)`                                                                             | `{ outlineOffset: '--o' }` |      |
