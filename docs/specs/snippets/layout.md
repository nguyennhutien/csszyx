# Layout

Controlling element positioning and visibility.

## Aspect Ratio

Setting aspect ratios.

| Concept          | CSS Rule                            | Tailwind v4 Class        | `sz` Prop (Object Syntax)     | Note                                                         |
| :--------------- | :---------------------------------- | :----------------------- | :---------------------------- | :----------------------------------------------------------- |
| **Auto**         | `aspect-ratio: auto`                | `aspect-auto`            | `{ aspect: 'auto' }`          |                                                              |
| **Square**       | `aspect-ratio: 1 / 1`               | `aspect-square`          | `{ aspect: 'square' }`        |                                                              |
| **Video**        | `aspect-ratio: 16 / 9`              | `aspect-video`           | `{ aspect: 'video' }`         |                                                              |
| **Arbitrary**    | `aspect-ratio: 4 / 3`               | `aspect-4/3`             | `{ aspect: '4/3' }`           | **Sugar**: Auto-detects fraction syntax only integer values. |
| **Arbitrary**    | `aspect-ratio: 4 / 2.5`             | `aspect-[4/2.5]`         | `{ aspect: '4/2.5' }`         | Decimal values require brackets.                             |
| **Arbitrary**    | `aspect-ratio: calc(4 * 3 + 1) / 3` | `aspect-[calc(4*3+1)/3]` | `{ aspect: 'calc(4*3+1)/3' }` |                                                              |
| **CSS Variable** | `aspect-ratio: var(--my-ratio)`     | `aspect-(--my-ratio)`    | `{ aspect: '--my-ratio' }`    | **Sugar**: Auto-detects `--`.                                |

## Columns

Multi-column layout.

| Concept          | CSS Rule                | Tailwind v4 Class   | `sz` Prop (Object Syntax) | Note                                                        |
| :--------------- | :---------------------- | :------------------ | :------------------------ | :---------------------------------------------------------- |
| **Auto**         | `columns: auto`         | `columns-auto`      | `{ columns: 'auto' }`     |                                                             |
| **Count (1-12)** | `columns: <number>`     | `columns-<number>`  | `{ columns: <number> }`   | v4: fully dynamic, no static scale, accept any integer bare |
| **Width (3xs)**  | `columns: 16rem`        | `columns-3xs`       | `{ columns: '3xs' }`      |                                                             |
| **Width (2xs)**  | `columns: 18rem`        | `columns-2xs`       | `{ columns: '2xs' }`      |                                                             |
| **Width (xs)**   | `columns: 20rem`        | `columns-xs`        | `{ columns: 'xs' }`       |                                                             |
| **Width (sm)**   | `columns: 24rem`        | `columns-sm`        | `{ columns: 'sm' }`       |                                                             |
| **Width (md)**   | `columns: 28rem`        | `columns-md`        | `{ columns: 'md' }`       |                                                             |
| **Width (lg)**   | `columns: 32rem`        | `columns-lg`        | `{ columns: 'lg' }`       |                                                             |
| **Width (xl)**   | `columns: 36rem`        | `columns-xl`        | `{ columns: 'xl' }`       |                                                             |
| **Width (2xl)**  | `columns: 42rem`        | `columns-2xl`       | `{ columns: '2xl' }`      |                                                             |
| **Width (3xl)**  | `columns: 48rem`        | `columns-3xl`       | `{ columns: '3xl' }`      |                                                             |
| **Width (4xl)**  | `columns: 56rem`        | `columns-4xl`       | `{ columns: '4xl' }`      |                                                             |
| **Width (5xl)**  | `columns: 64rem`        | `columns-5xl`       | `{ columns: '5xl' }`      |                                                             |
| **Width (6xl)**  | `columns: 72rem`        | `columns-6xl`       | `{ columns: '6xl' }`      |                                                             |
| **Width (7xl)**  | `columns: 80rem`        | `columns-7xl`       | `{ columns: '7xl' }`      |                                                             |
| **Arbitrary**    | `columns: 14rem`        | `columns-[14rem]`   | `{ columns: '14rem' }`    |                                                             |
| **CSS Variable** | `columns: var(--width)` | `columns-(--width)` | `{ columns: '--width' }`  | **Sugar**: Auto-detects `--`.                               |

## Break After

Controlling page/column breaks after an element.

| Concept        | CSS Rule                  | Tailwind v4 Class        | `sz` Prop (Object Syntax)      | Note |
| :------------- | :------------------------ | :----------------------- | :----------------------------- | :--- |
| **Auto**       | `break-after: auto`       | `break-after-auto`       | `{ breakAfter: 'auto' }`       |      |
| **Avoid**      | `break-after: avoid`      | `break-after-avoid`      | `{ breakAfter: 'avoid' }`      |      |
| **All**        | `break-after: all`        | `break-after-all`        | `{ breakAfter: 'all' }`        |      |
| **Avoid Page** | `break-after: avoid-page` | `break-after-avoid-page` | `{ breakAfter: 'avoid-page' }` |      |
| **Page**       | `break-after: page`       | `break-after-page`       | `{ breakAfter: 'page' }`       |      |
| **Left**       | `break-after: left`       | `break-after-left`       | `{ breakAfter: 'left' }`       |      |
| **Right**      | `break-after: right`      | `break-after-right`      | `{ breakAfter: 'right' }`      |      |
| **Column**     | `break-after: column`     | `break-after-column`     | `{ breakAfter: 'column' }`     |      |

## Break Before

Controlling page/column breaks before an element.

| Concept        | CSS Rule                   | Tailwind v4 Class         | `sz` Prop (Object Syntax)       | Note |
| :------------- | :------------------------- | :------------------------ | :------------------------------ | :--- |
| **Auto**       | `break-before: auto`       | `break-before-auto`       | `{ breakBefore: 'auto' }`       |      |
| **Avoid**      | `break-before: avoid`      | `break-before-avoid`      | `{ breakBefore: 'avoid' }`      |      |
| **All**        | `break-before: all`        | `break-before-all`        | `{ breakBefore: 'all' }`        |      |
| **Avoid Page** | `break-before: avoid-page` | `break-before-avoid-page` | `{ breakBefore: 'avoid-page' }` |      |
| **Page**       | `break-before: page`       | `break-before-page`       | `{ breakBefore: 'page' }`       |      |
| **Left**       | `break-before: left`       | `break-before-left`       | `{ breakBefore: 'left' }`       |      |
| **Right**      | `break-before: right`      | `break-before-right`      | `{ breakBefore: 'right' }`      |      |
| **Column**     | `break-before: column`     | `break-before-column`     | `{ breakBefore: 'column' }`     |      |

## Break Inside

Controlling page/column breaks within an element.

| Concept          | CSS Rule                     | Tailwind v4 Class           | `sz` Prop (Object Syntax)         | Note |
| :--------------- | :--------------------------- | :-------------------------- | :-------------------------------- | :--- |
| **Auto**         | `break-inside: auto`         | `break-inside-auto`         | `{ breakInside: 'auto' }`         |      |
| **Avoid**        | `break-inside: avoid`        | `break-inside-avoid`        | `{ breakInside: 'avoid' }`        |      |
| **Avoid Page**   | `break-inside: avoid-page`   | `break-inside-avoid-page`   | `{ breakInside: 'avoid-page' }`   |      |
| **Avoid Column** | `break-inside: avoid-column` | `break-inside-avoid-column` | `{ breakInside: 'avoid-column' }` |      |

## Box Decoration Break

Controlling box decoration fragments.

| Concept   | CSS Rule                      | Tailwind v4 Class      | `sz` Prop (Object Syntax)    | Note                            |
| :-------- | :---------------------------- | :--------------------- | :--------------------------- | :------------------------------ |
| **Slice** | `box-decoration-break: slice` | `box-decoration-slice` | `{ boxDecoration: 'slice' }` | **Sugar**: Shortened prop name. |
| **Clone** | `box-decoration-break: clone` | `box-decoration-clone` | `{ boxDecoration: 'clone' }` |                                 |

## Box Sizing

Controlling box model sizing.

| Concept         | CSS Rule                  | Tailwind v4 Class | `sz` Prop (Object Syntax) | Note |
| :-------------- | :------------------------ | :---------------- | :------------------------ | :--- |
| **Border Box**  | `box-sizing: border-box`  | `box-border`      | `{ box: 'border' }`       |      |
| **Content Box** | `box-sizing: content-box` | `box-content`     | `{ box: 'content' }`      |      |

## Display

Controlling display box type.

| Concept                | CSS Rule                      | Tailwind v4 Class    | `sz` Prop (Canonical)               | `sz` Prop (Boolean Sugar)    |
| :--------------------- | :---------------------------- | :------------------- | :---------------------------------- | :--------------------------- |
| **Block**              | `display: block`              | `block`              | `{ display: 'block' }`              | `{ block: true }`            |
| **Inline Block**       | `display: inline-block`       | `inline-block`       | `{ display: 'inline-block' }`       | `{ inlineBlock: true }`      |
| **Inline**             | `display: inline`             | `inline`             | `{ display: 'inline' }`             | `{ inline: true }`           |
| **Flex**               | `display: flex`               | `flex`               | `{ display: 'flex' }`               | `{ flex: true }`             |
| **Inline Flex**        | `display: inline-flex`        | `inline-flex`        | `{ display: 'inline-flex' }`        | `{ inlineFlex: true }`       |
| **Grid**               | `display: grid`               | `grid`               | `{ display: 'grid' }`               | `{ grid: true }`             |
| **Inline Grid**        | `display: inline-grid`        | `inline-grid`        | `{ display: 'inline-grid' }`        | `{ inlineGrid: true }`       |
| **Contents**           | `display: contents`           | `contents`           | `{ display: 'contents' }`           | `{ contents: true }`         |
| **Table**              | `display: table`              | `table`              | `{ display: 'table' }`              | `{ table: true }`            |
| **Inline Table**       | `display: inline-table`       | `inline-table`       | `{ display: 'inline-table' }`       | `{ inlineTable: true }`      |
| **Table Caption**      | `display: table-caption`      | `table-caption`      | `{ display: 'table-caption' }`      | `{ tableCaption: true }`     |
| **Table Cell**         | `display: table-cell`         | `table-cell`         | `{ display: 'table-cell' }`         | `{ tableCell: true }`        |
| **Table Column**       | `display: table-column`       | `table-column`       | `{ display: 'table-column' }`       | `{ tableColumn: true }`      |
| **Table Column Group** | `display: table-column-group` | `table-column-group` | `{ display: 'table-column-group' }` | `{ tableColumnGroup: true }` |
| **Table Footer Group** | `display: table-footer-group` | `table-footer-group` | `{ display: 'table-footer-group' }` | `{ tableFooterGroup: true }` |
| **Table Header Group** | `display: table-header-group` | `table-header-group` | `{ display: 'table-header-group' }` | `{ tableHeaderGroup: true }` |
| **Table Row Group**    | `display: table-row-group`    | `table-row-group`    | `{ display: 'table-row-group' }`    | `{ tableRowGroup: true }`    |
| **Table Row**          | `display: table-row`          | `table-row`          | `{ display: 'table-row' }`          | `{ tableRow: true }`         |
| **Flow Root**          | `display: flow-root`          | `flow-root`          | `{ display: 'flow-root' }`          | `{ flowRoot: true }`         |
| **List Item**          | `display: list-item`          | `list-item`          | `{ display: 'list-item' }`          | `{ listItem: true }`         |
| **Hidden**             | `display: none`               | `hidden`             | `{ display: 'none' }`               | `{ hidden: true }`           |
| **Screen Reader Only** | `position: absolute; ...`     | `sr-only`            | N/A                                 | `{ srOnly: true }`           |
| **Not Screen Reader**  | `position: static; ...`       | `not-sr-only`        | N/A                                 | `{ notSrOnly: true }`        |

## Floats

Controlling floated elements.

| Concept   | CSS Rule              | Tailwind v4 Class | `sz` Prop (Object Syntax) | Note |
| :-------- | :-------------------- | :---------------- | :------------------------ | :--- |
| **Right** | `float: right`        | `float-right`     | `{ float: 'right' }`      |      |
| **Left**  | `float: left`         | `float-left`      | `{ float: 'left' }`       |      |
| **Start** | `float: inline-start` | `float-start`     | `{ float: 'start' }`      |      |
| **End**   | `float: inline-end`   | `float-end`       | `{ float: 'end' }`        |      |
| **None**  | `float: none`         | `float-none`      | `{ float: 'none' }`       |      |

## Clear

Controlling flow relative to floats.

| Concept   | CSS Rule              | Tailwind v4 Class | `sz` Prop (Object Syntax) | Note |
| :-------- | :-------------------- | :---------------- | :------------------------ | :--- |
| **Left**  | `clear: left`         | `clear-left`      | `{ clear: 'left' }`       |      |
| **Right** | `clear: right`        | `clear-right`     | `{ clear: 'right' }`      |      |
| **Both**  | `clear: both`         | `clear-both`      | `{ clear: 'both' }`       |      |
| **None**  | `clear: none`         | `clear-none`      | `{ clear: 'none' }`       |      |
| **Start** | `clear: inline-start` | `clear-start`     | `{ clear: 'start' }`      |      |
| **End**   | `clear: inline-end`   | `clear-end`       | `{ clear: 'end' }`        |      |

## Isolation

Controlling stacking contexts.

| Concept     | CSS Rule             | Tailwind v4 Class | `sz` Prop (Object Syntax)  | Note                            |
| :---------- | :------------------- | :---------------- | :------------------------- | :------------------------------ |
| **Isolate** | `isolation: isolate` | `isolate`         | `{ isolation: 'isolate' }` | **Sugar**: `{ isolate: true }`. |
| **Auto**    | `isolation: auto`    | `isolation-auto`  | `{ isolation: 'auto' }`    |                                 |

## Object Fit

Controlling replaced element content.

| Concept        | CSS Rule                 | Tailwind v4 Class   | `sz` Prop (Object Syntax)     | Note |
| :------------- | :----------------------- | :------------------ | :---------------------------- | :--- |
| **Contain**    | `object-fit: contain`    | `object-contain`    | `{ objectFit: 'contain' }`    |      |
| **Cover**      | `object-fit: cover`      | `object-cover`      | `{ objectFit: 'cover' }`      |      |
| **Fill**       | `object-fit: fill`       | `object-fill`       | `{ objectFit: 'fill' }`       |      |
| **None**       | `object-fit: none`       | `object-none`       | `{ objectFit: 'none' }`       |      |
| **Scale Down** | `object-fit: scale-down` | `object-scale-down` | `{ objectFit: 'scale-down' }` |      |

## Object Position

Controlling replaced element alignment.

| Concept          | CSS Rule                        | Tailwind v4 Class     | `sz` Prop (Object Syntax)       | Note                          |
| :--------------- | :------------------------------ | :-------------------- | :------------------------------ | :---------------------------- |
| **Top Left**     | `object-position: top-left`     | `object-top-left`     | `{ objectPos: 'top-left' }`     |                               |
| **Top**          | `object-position: top`          | `object-top`          | `{ objectPos: 'top' }`          |                               |
| **Top Right**    | `object-position: top-right`    | `object-top-right`    | `{ objectPos: 'top-right' }`    |                               |
| **Left**         | `object-position: left`         | `object-left`         | `{ objectPos: 'left' }`         |                               |
| **Center**       | `object-position: center`       | `object-center`       | `{ objectPos: 'center' }`       |                               |
| **Right**        | `object-position: right`        | `object-right`        | `{ objectPos: 'right' }`        |                               |
| **Bottom Left**  | `object-position: bottom-left`  | `object-bottom-left`  | `{ objectPos: 'bottom-left' }`  |                               |
| **Bottom**       | `object-position: bottom`       | `object-bottom`       | `{ objectPos: 'bottom' }`       |                               |
| **Right Bottom** | `object-position: bottom-right` | `object-bottom-right` | `{ objectPos: 'bottom-right' }` |                               |
| **Arbitrary**    | `object-position: 50% 50%`      | `object-[50%_50%]`    | `{ objectPos: '50% 50%' }`      |                               |
| **CSS Variable** | `object-position: var(--pos)`   | `object-(--pos)`      | `{ objectPos: '--pos' }`        | **Sugar**: Auto-detects `--`. |

## Overflow

Controlling content overflow.

| Concept       | CSS Rule              | Tailwind v4 Class    | `sz` Prop (Object Syntax)  | Note |
| :------------ | :-------------------- | :------------------- | :------------------------- | :--- |
| **Auto**      | `overflow: auto`      | `overflow-auto`      | `{ overflow: 'auto' }`     |      |
| **Hidden**    | `overflow: hidden`    | `overflow-hidden`    | `{ overflow: 'hidden' }`   |      |
| **Clip**      | `overflow: clip`      | `overflow-clip`      | `{ overflow: 'clip' }`     |      |
| **Visible**   | `overflow: visible`   | `overflow-visible`   | `{ overflow: 'visible' }`  |      |
| **Scroll**    | `overflow: scroll`    | `overflow-scroll`    | `{ overflow: 'scroll' }`   |      |
| **X Auto**    | `overflow-x: auto`    | `overflow-x-auto`    | `{ overflowX: 'auto' }`    |      |
| **X Hidden**  | `overflow-x: hidden`  | `overflow-x-hidden`  | `{ overflowX: 'hidden' }`  |      |
| **X Clip**    | `overflow-x: clip`    | `overflow-x-clip`    | `{ overflowX: 'clip' }`    |      |
| **X Visible** | `overflow-x: visible` | `overflow-x-visible` | `{ overflowX: 'visible' }` |      |
| **X Scroll**  | `overflow-x: scroll`  | `overflow-x-scroll`  | `{ overflowX: 'scroll' }`  |      |
| **Y Auto**    | `overflow-y: auto`    | `overflow-y-auto`    | `{ overflowY: 'auto' }`    |      |
| **Y Hidden**  | `overflow-y: hidden`  | `overflow-y-hidden`  | `{ overflowY: 'hidden' }`  |      |
| **Y Clip**    | `overflow-y: clip`    | `overflow-y-clip`    | `{ overflowY: 'clip' }`    |      |
| **Y Visible** | `overflow-y: visible` | `overflow-y-visible` | `{ overflowY: 'visible' }` |      |
| **Y Scroll**  | `overflow-y: scroll`  | `overflow-y-scroll`  | `{ overflowY: 'scroll' }`  |      |

## Overscroll Behavior

Controlling scroll chaining.

| Concept       | CSS Rule                         | Tailwind v4 Class      | `sz` Prop (Object Syntax)    | Note |
| :------------ | :------------------------------- | :--------------------- | :--------------------------- | :--- |
| **Auto**      | `overscroll-behavior: auto`      | `overscroll-auto`      | `{ overscroll: 'auto' }`     |      |
| **Contain**   | `overscroll-behavior: contain`   | `overscroll-contain`   | `{ overscroll: 'contain' }`  |      |
| **None**      | `overscroll-behavior: none`      | `overscroll-none`      | `{ overscroll: 'none' }`     |      |
| **X Auto**    | `overscroll-behavior-x: auto`    | `overscroll-x-auto`    | `{ overscrollX: 'auto' }`    |      |
| **X Contain** | `overscroll-behavior-x: contain` | `overscroll-x-contain` | `{ overscrollX: 'contain' }` |      |
| **X None**    | `overscroll-behavior-x: none`    | `overscroll-x-none`    | `{ overscrollX: 'none' }`    |      |
| **Y Auto**    | `overscroll-behavior-y: auto`    | `overscroll-y-auto`    | `{ overscrollY: 'auto' }`    |      |
| **Y Contain** | `overscroll-behavior-y: contain` | `overscroll-y-contain` | `{ overscrollY: 'contain' }` |      |
| **Y None**    | `overscroll-behavior-y: none`    | `overscroll-y-none`    | `{ overscrollY: 'none' }`    |      |

## Position

Controlling positioning.

| Concept      | CSS Rule             | Tailwind v4 Class | `sz` Prop (Canonical)      | `sz` Prop (Boolean Sugar) |
| :----------- | :------------------- | :---------------- | :------------------------- | :------------------------ |
| **Static**   | `position: static`   | `static`          | `{ position: 'static' }`   | `{ static: true }`        |
| **Fixed**    | `position: fixed`    | `fixed`           | `{ position: 'fixed' }`    | `{ fixed: true }`         |
| **Absolute** | `position: absolute` | `absolute`        | `{ position: 'absolute' }` | `{ absolute: true }`      |
| **Relative** | `position: relative` | `relative`        | `{ position: 'relative' }` | `{ relative: true }`      |
| **Sticky**   | `position: sticky`   | `sticky`          | `{ position: 'sticky' }`   | `{ sticky: true }`        |

## Top / Right / Bottom / Left (Placement)

Positioning mapped elements.

| Concept                     | CSS Rule                                          | Tailwind v4 Class   | `sz` Prop (Object Syntax)  | Note                                                                             |
| :-------------------------- | :------------------------------------------------ | :------------------ | :------------------------- | :------------------------------------------------------------------------------- |
| **Inset**                   | `inset: calc(var(--spacing) * <number>)`          | `inset-<number>`    | `{ inset: <number> }`      | v4: fully dynamic, no static scale, accept any integer or 0.5-step decimal bare. |
| **Inset Negative**          | `inset: calc(var(--spacing) * -<number>)`         | `-inset-<number>`   | `{ inset: -<number> }`     | v4: accept any negative integer or 0.5-step decimal bare.                        |
| **Inset Fraction**          | `inset: calc(<fraction> * 100%)`                  | `inset-<fraction>`  | `{ inset: '<fraction>' }`  | v4: accept any integer/integer fraction (string) bare.                           |
| **Inset Fraction Negative** | `inset: calc(<fraction> * -100%)`                 | `-inset-<fraction>` | `{ inset: '-<fraction>' }` | v4: accept any negative integer/integer fraction (string) bare.                  |
| **Inset Pixel**             | `inset: 1px`                                      | `inset-px`          | `{ inset: 'px' }`          |                                                                                  |
| **Inset Pixel Negative**    | `inset: -1px`                                     | `-inset-px`         | `{ inset: '-px' }`         |                                                                                  |
| **Inset Full**              | `inset: 100%`                                     | `inset-full`        | `{ inset: 'full' }`        |                                                                                  |
| **Inset Full Negative**     | `inset: -100%`                                    | `-inset-full`       | `{ inset: '-full' }`       |                                                                                  |
| **Inset Auto**              | `inset: auto`                                     | `inset-auto`        | `{ inset: 'auto' }`        |                                                                                  |
| **Inset Arbitrary**         | `inset: 27px`                                     | `inset-[27px]`      | `{ inset: '27px' }`        |                                                                                  |
| **Inset CSS Variable**      | `inset: var(--inset)`                             | `inset-(--inset)`   | `{ inset: '--inset' }`     |                                                                                  |
| **Inset X**                 | `inset-inline: calc(var(--spacing) * <number>);`  | `inset-x-<number>`  | `{ insetX: <number> }`     | v4: fully dynamic, no static scale, accept any integer or 0.5-step decimal bare. |
| **Inset X Negative**        | `inset-inline: calc(var(--spacing) * -<number>);` | `-inset-x-<number>` | `{ insetX: -<number> }`    | v4: accept any integer or 0.5-step decimal bare.                                 |

| **Inset Y** | `inset-block: calc(var(--spacing) * <number>);` | `inset-y-<number>` | `{ insetY: <number> }` | v4: fully dynamic, no static scale, accept any integer or 0.5-step decimal bare. |

| **Start (L)** | `inset-inline-start: ...` | `inset-s-<number>` | `{ start: <number> }` | v4.2: emits `inset-s-*` (was `start-*`, same CSS, deprecated in TW v4.2). |
| **End (R)** | `inset-inline-end: ...` | `inset-e-<number>` | `{ end: <number> }` | v4.2: emits `inset-e-*` (was `end-*`, same CSS, deprecated in TW v4.2). |
| **Inset S** | `inset-inline-start: ...` | `inset-s-<number>` | `{ insetS: <number> }` | v4.2: explicit camelCase alias for `start`. |
| **Inset E** | `inset-inline-end: ...` | `inset-e-<number>` | `{ insetE: <number> }` | v4.2: explicit camelCase alias for `end`. |
| **Inset Block Start** | `inset-block-start: ...` | `inset-bs-<number>` | `{ insetBs: <number> }` | v4.2: logical block-start inset. |
| **Inset Block End** | `inset-block-end: ...` | `inset-be-<number>` | `{ insetBe: <number> }` | v4.2: logical block-end inset. |

| **Top** | `top: calc(var(--spacing) * <number>)` | `top-<number>` | `{ top: <number> }` | |
| **Top Negative** | `top: calc(var(--spacing) * -<number>)` | `-top-<number>` | `{ top: -<number> }` | |
| **Top Arbitrary** | `top: -1px` | `top-[-1px]` | `{ top: '-1px' }` | No `[]` needed in sz — compiler auto-wraps. |
| **Top CSS Variable** | `top: var(--offset)` | `top-(--offset)` | `{ top: '--offset' }` | |

| **Right** | `right: calc(var(--spacing) * <number>)` | `right-<number>` | `{ right: <number> }` | |
| **Right Negative** | `right: calc(var(--spacing) * -<number>)` | `-right-<number>` | `{ right: -<number> }` | |
| **Right Arbitrary** | `right: -1px` | `right-[-1px]` | `{ right: '-1px' }` | No `[]` needed in sz — compiler auto-wraps. |
| **Right CSS Variable** | `right: var(--offset)` | `right-(--offset)` | `{ right: '--offset' }` | |

| **Bottom** | `bottom: calc(var(--spacing) * <number>)` | `bottom-<number>` | `{ bottom: <number> }` | |
| **Bottom Negative** | `bottom: calc(var(--spacing) * -<number>)` | `-bottom-<number>` | `{ bottom: -<number> }` | |
| **Bottom Arbitrary** | `bottom: -1px` | `bottom-[-1px]` | `{ bottom: '-1px' }` | No `[]` needed in sz — compiler auto-wraps. |
| **Bottom CSS Variable** | `bottom: var(--offset)` | `bottom-(--offset)` | `{ bottom: '--offset' }` | |

| **Left** | `left: calc(var(--spacing) * <number>)` | `left-<number>` | `{ left: <number> }` | |
| **Left Negative** | `left: calc(var(--spacing) * -<number>)` | `-left-<number>` | `{ left: -<number> }` | |
| **Left Arbitrary** | `left: -1px` | `left-[-1px]` | `{ left: '-1px' }` | No `[]` needed in sz — compiler auto-wraps. |
| **Left CSS Variable** | `left: var(--offset)` | `left-(--offset)` | `{ left: '--offset' }` | |

## Visibility

Controlling visibility without layout change.

| Concept       | CSS Rule               | Tailwind v4 Class | `sz` Prop (Canonical)        | `sz` Prop (Boolean)   |
| :------------ | :--------------------- | :---------------- | :--------------------------- | :-------------------- |
| **Visible**   | `visibility: visible`  | `visible`         | `{ visibility: 'visible' }`  | `{ visible: true }`   |
| **Invisible** | `visibility: hidden`   | `invisible`       | `{ visibility: 'hidden' }`   | `{ invisible: true }` |
| **Collapse**  | `visibility: collapse` | `collapse`        | `{ visibility: 'collapse' }` | `{ collapse: true }`  |

## Z-Index

Controlling stack order.

| Concept          | CSS Rule                          | Tailwind v4 Class            | `sz` Prop (Object Syntax)         | Note                                                        |
| :--------------- | :-------------------------------- | :--------------------------- | :-------------------------------- | :---------------------------------------------------------- |
| **Index**        | `z-index: <number>`               | `z-<number>`                 | `{ z: <number> }`                 | v4: fully dynamic, no static scale, accept any integer bare |
| **Negative**     | `z-index: -<number>`              | `-z-<number>`                | `{ z: -<number> }`                | v4: fully dynamic, no static scale, accept any integer bare |
| **Auto**         | `z-index: auto`                   | `z-auto`                     | `{ z: 'auto' }`                   |                                                             |
| **Arbitrary**    | `z-index: calc(var(--index) + 1)` | `z-[calc(var(--index)_+_1)]` | `{ z: 'calc(var(--index) + 1)' }` |                                                             |
| **CSS Variable** | `z-index: var(--my-z)`            | `z-(--my-z)`                 | `{ z: '--my-z' }`                 |                                                             |
