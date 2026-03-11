# Flexbox & Grid

Controlling flex and grid layouts.

## Flex Basis

Controlling initial size of flex items.

| Concept             | CSS Rule                                       | Tailwind v4 Class              | `sz` Prop (Object Syntax) | Note                                                                             |
| :------------------ | :--------------------------------------------- | :----------------------------- | :------------------------ | :------------------------------------------------------------------------------- |
| **Auto**            | `flex-basis: auto`                             | `basis-auto`                   | `{ basis: 'auto' }`       |                                                                                  |
| **Full**            | `flex-basis: 100%`                             | `basis-full`                   | `{ basis: 'full' }`       |                                                                                  |
| **Spacing Scale**   | `flex-basis: calc(var(--spacing) * <number>);` | `basis-<number>` (any integer) | `{ basis: <number> }`     | v4: fully dynamic, no static scale, accept any integer or 0.5-step decimal bare. |
| **Fraction**        | `flex-basis: calc(<fraction> * 100%)`          | `basis-<fraction>`             | `{ basis: '<fraction>' }` | v4: accept any integer/integer fraction (string) bare.                           |
| **Container (3XS)** | `flex-basis: 16rem`                            | `basis-3xs`                    | `{ basis: '3xs' }`        |                                                                                  |
| **Container (2XS)** | `flex-basis: 18rem`                            | `basis-2xs`                    | `{ basis: '2xs' }`        |                                                                                  |
| **Container (XS)**  | `flex-basis: 20rem`                            | `basis-xs`                     | `{ basis: 'xs' }`         |                                                                                  |
| **Container (SM)**  | `flex-basis: 24rem`                            | `basis-sm`                     | `{ basis: 'sm' }`         |                                                                                  |
| **Container (MD)**  | `flex-basis: 28rem`                            | `basis-md`                     | `{ basis: 'md' }`         |                                                                                  |
| **Container (LG)**  | `flex-basis: 32rem`                            | `basis-lg`                     | `{ basis: 'lg' }`         |                                                                                  |
| **Container (XL)**  | `flex-basis: 36rem`                            | `basis-xl`                     | `{ basis: 'xl' }`         |                                                                                  |
| **Container (2XL)** | `flex-basis: 42rem`                            | `basis-2xl`                    | `{ basis: '2xl' }`        |                                                                                  |
| **Container (3XL)** | `flex-basis: 48rem`                            | `basis-3xl`                    | `{ basis: '3xl' }`        |                                                                                  |
| **Container (4XL)** | `flex-basis: 56rem`                            | `basis-4xl`                    | `{ basis: '4xl' }`        |                                                                                  |
| **Container (5XL)** | `flex-basis: 64rem`                            | `basis-5xl`                    | `{ basis: '5xl' }`        |                                                                                  |
| **Container (6XL)** | `flex-basis: 72rem`                            | `basis-6xl`                    | `{ basis: '6xl' }`        |                                                                                  |
| **Container (7XL)** | `flex-basis: 80rem`                            | `basis-7xl`                    | `{ basis: '7xl' }`        |                                                                                  |
| **Zero**            | `flex-basis: 0px`                              | `basis-0`                      | `{ basis: 0 }`            |                                                                                  |
| **Px**              | `flex-basis: 1px`                              | `basis-px`                     | `{ basis: 'px' }`         |                                                                                  |
| **Arbitrary**       | `flex-basis: 14.28%`                           | `basis-[14.28%]`               | `{ basis: '14.28%' }`     |                                                                                  |
| **Arbitrary**       | `flex-basis: 2.5/4`                            | `basis-[2.5/4]`                | `{ basis: '2.5/4' }`      |                                                                                  |
| **CSS Variable**    | `flex-basis: var(--basis)`                     | `basis-(--basis)`              | `{ basis: '--basis' }`    | **Sugar**: Auto-detects `--`.                                                    |

## Flex Direction

Controlling direction of flex items.

| Concept            | CSS Rule                         | Tailwind v4 Class  | `sz` Prop (Canonical)        |
| :----------------- | :------------------------------- | :----------------- | :--------------------------- |
| **Row**            | `flex-direction: row`            | `flex-row`         | `{ flexDir: 'row' }`         |
| **Row Reverse**    | `flex-direction: row-reverse`    | `flex-row-reverse` | `{ flexDir: 'row-reverse' }` |
| **Column**         | `flex-direction: column`         | `flex-col`         | `{ flexDir: 'col' }`         |
| **Column Reverse** | `flex-direction: column-reverse` | `flex-col-reverse` | `{ flexDir: 'col-reverse' }` |

## Flex Wrap

Controlling wrapping of flex items.

| Concept          | CSS Rule                  | Tailwind v4 Class   | `sz` Prop (Canonical)          |
| :--------------- | :------------------------ | :------------------ | :----------------------------- |
| **Wrap**         | `flex-wrap: wrap`         | `flex-wrap`         | `{ flexWrap: 'wrap' }`         |
| **Wrap Reverse** | `flex-wrap: wrap-reverse` | `flex-wrap-reverse` | `{ flexWrap: 'wrap-reverse' }` |
| **No Wrap**      | `flex-wrap: nowrap`       | `flex-nowrap`       | `{ flexWrap: 'nowrap' }`       |

## Flex Grow

Controlling flex item growth.

| Concept          | CSS Rule                      | Tailwind v4 Class         | `sz` Prop (Canonical)          | Note                                                        |
| :--------------- | :---------------------------- | :------------------------ | :----------------------------- | :---------------------------------------------------------- |
| **Grow**         | `flex-grow: 1`                | `grow`                    | `{ grow: true }`               |                                                             |
| **Grow 0**       | `flex-grow: <number>`         | `grow-<number>`           | `{ grow: <number> }`           | v4: fully dynamic, no static scale, accept any integer bare |
| **Arbitrary**    | `flex-grow: 2.5`              | `grow-[2.5]`              | `{ grow: 2.5 }`                | decimal                                                     |
| **Arbitrary**    | `flex-grow: calc(1rem + 2px)` | `grow-[calc(1rem_+_2px)]` | `{ grow: 'calc(1rem + 2px)' }` | string                                                      |
| **CSS Variable** | `flex-grow: var(--grow)`      | `grow-(--grow)`           | `{ grow: '--grow' }`           | **Sugar**: Auto-detects `--`.                               |

## Flex Shrink

Controlling flex item shrinking.

| Concept          | CSS Rule                        | Tailwind v4 Class           | `sz` Prop (Canonical)            | Note                                                        |
| :--------------- | :------------------------------ | :-------------------------- | :------------------------------- | :---------------------------------------------------------- |
| **Shrink**       | `flex-shrink: 1`                | `shrink`                    | `{ shrink: true }`               |                                                             |
| **Shrink 0**     | `flex-shrink: <number>`         | `shrink-<number>`           | `{ shrink: <number> }`           | v4: fully dynamic, no static scale, accept any integer bare |
| **Arbitrary**    | `flex-shrink: 2.5`              | `shrink-[2.5]`              | `{ shrink: 2.5 }`                | decimal                                                     |
| **Arbitrary**    | `flex-shrink: calc(1rem + 2px)` | `shrink-[calc(1rem_+_2px)]` | `{ shrink: 'calc(1rem + 2px)' }` | string                                                      |
| **CSS Variable** | `flex-shrink: var(--shrink)`    | `shrink-(--shrink)`         | `{ shrink: '--shrink' }`         | **Sugar**: Auto-detects `--`.                               |

## Flex

Controlling flex item resizing behaviour.

| Concept          | CSS Rule                        | Tailwind v4 Class | `sz` Prop (Object Syntax) | Note                                                        |
| :--------------- | :------------------------------ | :---------------- | :------------------------ | :---------------------------------------------------------- |
| **1**            | `flex: <number> 1 0%`           | `flex-<number>`   | `{ flex: <number> }`      | v4: fully dynamic, no static scale, accept any integer bare |
| **Fraction**     | `flex: calc(<fraction> * 100%)` | `flex-<fraction>` | `{ flex: '<fraction>' }`  | v4: accept any integer/integer fraction (string) bare.      |
| **Auto**         | `flex: auto`                    | `flex-auto`       | `{ flex: 'auto' }`        |                                                             |
| **Initial**      | `flex: 0 auto`                  | `flex-initial`    | `{ flex: 'initial' }`     |                                                             |
| **None**         | `flex: none`                    | `flex-none`       | `{ flex: 'none' }`        |                                                             |
| **Arbitrary**    | `flex: 3.5`                     | `flex-[3.5]`      | `{ flex: 3.5 }`           | decimal                                                     |
| **Arbitrary**    | `flex: 3.5/4` (not working)     | `flex-[3.5/4]`    | `{ flex: '3.5/4' }`       | not integer/integer fraction                                |
| **Arbitrary**    | `flex: 2 2 0%`                  | `flex-[2_2_0%]`   | `{ flex: '2 2 0%' }`      |                                                             |
| **CSS Variable** | `flex: var(--flex)`             | `flex-(--flex)`   | `{ flex: '--flex' }`      | **Sugar**: Auto-detects `--`.                               |

## Order

Controlling flex/grid item order.

| Concept          | CSS Rule              | Tailwind v4 Class     | `sz` Prop (Object Syntax)  | Note                                                        |
| :--------------- | :-------------------- | :-------------------- | :------------------------- | :---------------------------------------------------------- |
| **1-12**         | `order: <number>`     | `order-<number>`      | `{ order: <number> }`      | v4: fully dynamic, no static scale, accept any integer bare |
| **First**        | `order: -9999`        | `order-first`         | `{ order: 'first' }`       |                                                             |
| **Last**         | `order: 9999`         | `order-last`          | `{ order: 'last' }`        |                                                             |
| **None**         | `order: 0`            | `order-none`          | `{ order: 'none' }`        |                                                             |
| **Negative**     | `order: -<number>`    | `-order-<number>`     | `{ order: -<number> }`     |                                                             |
| **Arbitrary**    | `order: calc(100/5)`  | `order-[calc(100/5)]` | `{ order: 'calc(100/5)' }` |                                                             |
| **CSS Variable** | `order: var(--order)` | `order-(--order)`     | `{ order: '--order' }`     | **Sugar**: Auto-detects `--`.                               |

## Grid Template Columns

Specifying the columns in a grid layout.

| Concept          | CSS Rule                                                  | Tailwind v4 Class         | `sz` Prop (Canonical)         | `sz` Prop (Alias) | Note                                                        |
| :--------------- | :-------------------------------------------------------- | :------------------------ | :---------------------------- | :---------------- | :---------------------------------------------------------- |
| **1-12**         | `grid-template-columns: repeat(<number>, minmax(0, 1fr))` | `grid-cols-<number>`      | `{ gridCols: <number> }`      |                   | v4: fully dynamic, no static scale, accept any integer bare |
| **None**         | `grid-template-columns: none`                             | `grid-cols-none`          | `{ gridCols: 'none' }`        |                   |                                                             |
| **Subgrid**      | `grid-template-columns: subgrid`                          | `grid-cols-subgrid`       | `{ gridCols: 'subgrid' }`     |                   |                                                             |
| **Arbitrary**    | `grid-template-columns: 200px`                            | `grid-cols-[200px]`       | `{ gridCols: '200px' }`       |                   |                                                             |
| **CSS Variable** | `grid-template-columns: var(--grid-cols)`                 | `grid-cols-(--grid-cols)` | `{ gridCols: '--grid-cols' }` |                   | **Sugar**: Auto-detects `--`.                               |

## Grid Template Rows

Specifying the rows in a grid layout.

| Concept          | CSS Rule                                               | Tailwind v4 Class         | `sz` Prop (Canonical)         | `sz` Prop (Alias) | Note                                                        |
| :--------------- | :----------------------------------------------------- | :------------------------ | :---------------------------- | :---------------- | :---------------------------------------------------------- |
| **1-12**         | `grid-template-rows: repeat(<number>, minmax(0, 1fr))` | `grid-rows-<number>`      | `{ gridRows: <number> }`      |                   | v4: fully dynamic, no static scale, accept any integer bare |
| **None**         | `grid-template-rows: none`                             | `grid-rows-none`          | `{ gridRows: 'none' }`        |                   |                                                             |
| **Subgrid**      | `grid-template-rows: subgrid`                          | `grid-rows-subgrid`       | `{ gridRows: 'subgrid' }`     |                   |                                                             |
| **Arbitrary**    | `grid-template-rows: 200px`                            | `grid-rows-[200px]`       | `{ gridRows: '200px' }`       |                   |                                                             |
| **CSS Variable** | `grid-template-rows: var(--grid-rows)`                 | `grid-rows-(--grid-rows)` | `{ gridRows: '--grid-rows' }` |                   | **Sugar**: Auto-detects `--`.                               |

## Grid Column (Start/End/Span)

Controlling column sizing and placement.

| Concept                | CSS Rule                                                   | Tailwind v4 Class         | `sz` Prop (Canonical)         | Note                                                        |
| :--------------------- | :--------------------------------------------------------- | :------------------------ | :---------------------------- | :---------------------------------------------------------- |
| **Auto**               | `grid-column: auto`                                        | `col-auto`                | `{ col: 'auto' }`             |                                                             |
| **Span**               | `grid-column: span <number> / span <number>`               | `col-span-<number>`       | `{ colSpan: <number> }`       | v4: fully dynamic, no static scale, accept any integer bare |
| **Span Full**          | `grid-column: 1 / -1`                                      | `col-span-full`           | `{ colSpan: 'full' }`         |                                                             |
| **Span Arbitrary**     | `grid-column: span 50px / span 50px`                       | `col-span-[50px]`         | `{ colSpan: '50px' }`         |                                                             |
| **Span CSS Variable**  | `grid-column: span var(--col-span) / span var(--col-span)` | `col-span-(--col-span)`   | `{ colSpan: '--col-span' }`   | **Sugar**: Auto-detects `--`.                               |
| **Start**              | `grid-column-start: <number>`                              | `col-start-<number>`      | `{ colStart: <number> }`      | v4: fully dynamic, no static scale, accept any integer bare |
| **Start Negative**     | `grid-column-start: calc(<number> * -1)`                   | `-col-start-<number>`     | `{ colStart: -<number> }`     |                                                             |
| **Start Auto**         | `grid-column-start: auto`                                  | `col-start-auto`          | `{ colStart: 'auto' }`        |                                                             |
| **Start Arbitrary**    | `grid-column-start: calc(100/5)`                           | `col-start-[calc(100/5)]` | `{ colStart: 'calc(100/5)' }` |                                                             |
| **Start CSS Variable** | `grid-column-start: var(--col-start)`                      | `col-start-(--col-start)` | `{ colStart: '--col-start' }` | **Sugar**: Auto-detects `--`.                               |
| **End**                | `grid-column-end: <number>`                                | `col-end-<number>`        | `{ colEnd: <number> }`        | v4: fully dynamic, no static scale, accept any integer bare |
| **End Negative**       | `grid-column-end: calc(<number> * -1)`                     | `-col-end-<number>`       | `{ colEnd: -<number> }`       |                                                             |
| **End Auto**           | `grid-column-end: auto`                                    | `col-end-auto`            | `{ colEnd: 'auto' }`          |                                                             |
| **End Arbitrary**      | `grid-column-end: calc(100/5)`                             | `col-end-[calc(100/5)]`   | `{ colEnd: 'calc(100/5)' }`   |                                                             |
| **End CSS Variable**   | `grid-column-end: var(--col-end)`                          | `col-end-(--col-end)`     | `{ colEnd: '--col-end' }`     | **Sugar**: Auto-detects `--`.                               |
| **Short**              | `grid-column: <number>`                                    | `col-<number>`            | `{ col: <number> }`           | v4: fully dynamic, no static scale, accept any integer bare |
| **Short Negative**     | `grid-column: calc(<number> * -1)`                         | `-col-<number>`           | `{ col: -<number> }`          |                                                             |
| **Short Arbitrary**    | `grid-column: calc(100/5)`                                 | `col-[calc(100/5)]`       | `{ col: 'calc(100/5)' }`      |                                                             |
| **Short CSS Variable** | `grid-column: var(--col)`                                  | `col-(--col)`             | `{ col: '--col' }`            | **Sugar**: Auto-detects `--`.                               |

## Grid Row (Start/End/Span)

Controlling row sizing and placement.

| Concept                | CSS Rule                                                | Tailwind v4 Class         | `sz` Prop (Canonical)         | Note                                                        |
| :--------------------- | :------------------------------------------------------ | :------------------------ | :---------------------------- | :---------------------------------------------------------- |
| **Auto**               | `grid-row: auto`                                        | `row-auto`                | `{ row: 'auto' }`             |                                                             |
| **Span**               | `grid-row: span <number> / span <number>`               | `row-span-<number>`       | `{ rowSpan: <number> }`       | v4: fully dynamic, no static scale, accept any integer bare |
| **Span Full**          | `grid-row: 1 / -1`                                      | `row-span-full`           | `{ rowSpan: 'full' }`         |                                                             |
| **Span Arbitrary**     | `grid-row: span 50px / span 50px`                       | `row-span-[50px]`         | `{ rowSpan: '50px' }`         |                                                             |
| **Span CSS Variable**  | `grid-row: span var(--row-span) / span var(--row-span)` | `row-span-(--row-span)`   | `{ rowSpan: '--row-span' }`   | **Sugar**: Auto-detects `--`.                               |
| **Start**              | `grid-row-start: <number>`                              | `row-start-<number>`      | `{ rowStart: <number> }`      | v4: fully dynamic, no static scale, accept any integer bare |
| **Start Negative**     | `grid-row-start: calc(<number> * -1)`                   | `-row-start-<number>`     | `{ rowStart: -<number> }`     |                                                             |
| **Start Auto**         | `grid-row-start: auto`                                  | `row-start-auto`          | `{ rowStart: 'auto' }`        |                                                             |
| **Start Arbitrary**    | `grid-row-start: calc(100/5)`                           | `row-start-[calc(100/5)]` | `{ rowStart: 'calc(100/5)' }` |                                                             |
| **Start CSS Variable** | `grid-row-start: var(--row-start)`                      | `row-start-(--row-start)` | `{ rowStart: '--row-start' }` | **Sugar**: Auto-detects `--`.                               |
| **End**                | `grid-row-end: <number>`                                | `row-end-<number>`        | `{ rowEnd: <number> }`        | v4: fully dynamic, no static scale, accept any integer bare |
| **End Negative**       | `grid-row-end: calc(<number> * -1)`                     | `-row-end-<number>`       | `{ rowEnd: -<number> }`       |                                                             |
| **End Auto**           | `grid-row-end: auto`                                    | `row-end-auto`            | `{ rowEnd: 'auto' }`          |                                                             |
| **End Arbitrary**      | `grid-row-end: calc(100/5)`                             | `row-end-[calc(100/5)]`   | `{ rowEnd: 'calc(100/5)' }`   |                                                             |
| **End CSS Variable**   | `grid-row-end: var(--row-end)`                          | `row-end-(--row-end)`     | `{ rowEnd: '--row-end' }`     | **Sugar**: Auto-detects `--`.                               |
| **Short**              | `grid-row: <number>`                                    | `row-<number>`            | `{ row: <number> }`           | v4: fully dynamic, no static scale, accept any integer bare |
| **Short Negative**     | `grid-row: calc(<number> * -1)`                         | `-row-<number>`           | `{ row: -<number> }`          |                                                             |
| **Short Arbitrary**    | `grid-row: calc(100/5)`                                 | `row-[calc(100/5)]`       | `{ row: 'calc(100/5)' }`      |                                                             |
| **Short CSS Variable** | `grid-row: var(--row)`                                  | `row-(--row)`             | `{ row: '--row' }`            | **Sugar**: Auto-detects `--`.                               |

## Grid Auto Flow

Controlling auto-placement algorithm.

| Concept       | CSS Rule                       | Tailwind v4 Class     | `sz` Prop (Canonical)       |
| :------------ | :----------------------------- | :-------------------- | :-------------------------- |
| **Row**       | `grid-auto-flow: row`          | `grid-flow-row`       | `{ gridFlow: 'row' }`       |
| **Col**       | `grid-auto-flow: column`       | `grid-flow-col`       | `{ gridFlow: 'col' }`       |
| **Dense**     | `grid-auto-flow: dense`        | `grid-flow-dense`     | `{ gridFlow: 'dense' }`     |
| **Row Dense** | `grid-auto-flow: row dense`    | `grid-flow-row-dense` | `{ gridFlow: 'row-dense' }` |
| **Col Dense** | `grid-auto-flow: column dense` | `grid-flow-col-dense` | `{ gridFlow: 'col-dense' }` |

## Grid Auto Columns

Controlling implicit column sizing.

| Concept          | CSS Rule                              | Tailwind v4 Class           | `sz` Prop (Canonical)           |
| :--------------- | :------------------------------------ | :-------------------------- | :------------------------------ |
| **Auto**         | `grid-auto-columns: auto`             | `auto-cols-auto`            | `{ autoCols: 'auto' }`          |
| **Min**          | `grid-auto-columns: min-content`      | `auto-cols-min`             | `{ autoCols: 'min' }`           |
| **Max**          | `grid-auto-columns: max-content`      | `auto-cols-max`             | `{ autoCols: 'max' }`           |
| **Fr**           | `grid-auto-columns: minmax(0, 1fr)`   | `auto-cols-fr`              | `{ autoCols: 'fr' }`            |
| **Arbitrary**    | `grid-auto-columns: minmax(0, 2fr)`   | `auto-cols-[minmax(0,2fr)]` | `{ autoCols: 'minmax(0,2fr)' }` |
| **CSS Variable** | `grid-auto-columns: var(--auto-cols)` | `auto-cols-(--auto-cols)`   | `{ autoCols: '--auto-cols' }`   |

## Grid Auto Rows

Controlling implicit row sizing.

| Concept          | CSS Rule                           | Tailwind v4 Class           | `sz` Prop (Canonical)           |
| :--------------- | :--------------------------------- | :-------------------------- | :------------------------------ |
| **Auto**         | `grid-auto-rows: auto`             | `auto-rows-auto`            | `{ autoRows: 'auto' }`          |
| **Min**          | `grid-auto-rows: min-content`      | `auto-rows-min`             | `{ autoRows: 'min' }`           |
| **Max**          | `grid-auto-rows: max-content`      | `auto-rows-max`             | `{ autoRows: 'max' }`           |
| **Fr**           | `grid-auto-rows: minmax(0, 1fr)`   | `auto-rows-fr`              | `{ autoRows: 'fr' }`            |
| **Arbitrary**    | `grid-auto-rows: minmax(0, 2fr)`   | `auto-rows-[minmax(0,2fr)]` | `{ autoRows: 'minmax(0,2fr)' }` |
| **CSS Variable** | `grid-auto-rows: var(--auto-rows)` | `auto-rows-(--auto-rows)`   | `{ autoRows: '--auto-rows' }`   |

## Gap

Controlling gutters.

| Concept                | CSS Rule                                      | Tailwind v4 Class | `sz` Prop (Canonical) | Note                                                                             |
| :--------------------- | :-------------------------------------------- | :---------------- | :-------------------- | :------------------------------------------------------------------------------- |
| **Gap**                | `gap: calc(var(--spacing) * <number>)`        | `gap-<number>`    | `{ gap: <number> }`   | v4: fully dynamic, no static scale, accept any integer or 0.5-step decimal bare. |
| **Gap Arbitrary**      | `gap: 24px`                                   | `gap-[24px]`      | `{ gap: '24px' }`     |                                                                                  |
| **Gap CSS Variable**   | `gap: var(--gap)`                             | `gap-(--gap)`     | `{ gap: '--gap' }`    | **Sugar**: Auto-detects `--`.                                                    |
| **Gap X**              | `column-gap: calc(var(--spacing) * <number>)` | `gap-x-<number>`  | `{ gapX: <number> }`  | v4: fully dynamic, no static scale, accept any integer or 0.5-step decimal bare. |
| **Gap X Arbitrary**    | `column-gap: 24px`                            | `gap-x-[24px]`    | `{ gapX: '24px' }`    |                                                                                  |
| **Gap X CSS Variable** | `column-gap: var(--gap-x)`                    | `gap-x-(--gap-x)` | `{ gapX: '--gap-x' }` | **Sugar**: Auto-detects `--`.                                                    |
| **Gap Y**              | `row-gap: calc(var(--spacing) * <number>)`    | `gap-y-<number>`  | `{ gapY: <number> }`  | v4: fully dynamic, no static scale, accept any integer or 0.5-step decimal bare. |
| **Gap Y Arbitrary**    | `row-gap: 24px`                               | `gap-y-[24px]`    | `{ gapY: '24px' }`    |                                                                                  |
| **Gap Y CSS Variable** | `row-gap: var(--gap-y)`                       | `gap-y-(--gap-y)` | `{ gapY: '--gap-y' }` | **Sugar**: Auto-detects `--`.                                                    |

## Justify Content

Controlling placement along the main axis.

| Concept         | CSS Rule                         | Tailwind v4 Class     | `sz` Prop (Canonical)        |
| :-------------- | :------------------------------- | :-------------------- | :--------------------------- |
| **Normal**      | `justify-content: normal`        | `justify-normal`      | `{ justify: 'normal' }`      |
| **Start**       | `justify-content: flex-start`    | `justify-start`       | `{ justify: 'start' }`       |
| **End**         | `justify-content: flex-end`      | `justify-end`         | `{ justify: 'end' }`         |
| **End Safe**    | `justify-content: safe flex-end` | `justify-end-safe`    | `{ justify: 'end-safe' }`    |
| **Center**      | `justify-content: center`        | `justify-center`      | `{ justify: 'center' }`      |
| **Center Safe** | `justify-content: safe center`   | `justify-center-safe` | `{ justify: 'center-safe' }` |
| **Between**     | `justify-content: space-between` | `justify-between`     | `{ justify: 'between' }`     |
| **Around**      | `justify-content: space-around`  | `justify-around`      | `{ justify: 'around' }`      |
| **Evenly**      | `justify-content: space-evenly`  | `justify-evenly`      | `{ justify: 'evenly' }`      |
| **Stretch**     | `justify-content: stretch`       | `justify-stretch`     | `{ justify: 'stretch' }`     |
| **Baseline**    | `justify-content: baseline`      | `justify-baseline`    | `{ justify: 'baseline' }`    |

## Justify Items

Controlling grid item alignment inline axis.

| Concept         | CSS Rule                     | Tailwind v4 Class           | `sz` Prop (Canonical)             |
| :-------------- | :--------------------------- | :-------------------------- | :-------------------------------- |
| **Start**       | `justify-items: start`       | `justify-items-start`       | `{ justifyItems: 'start' }`       |
| **End**         | `justify-items: end`         | `justify-items-end`         | `{ justifyItems: 'end' }`         |
| **End Safe**    | `justify-items: safe end`    | `justify-items-end-safe`    | `{ justifyItems: 'end-safe' }`    |
| **Center**      | `justify-items: center`      | `justify-items-center`      | `{ justifyItems: 'center' }`      |
| **Center Safe** | `justify-items: safe center` | `justify-items-center-safe` | `{ justifyItems: 'center-safe' }` |
| **Stretch**     | `justify-items: stretch`     | `justify-items-stretch`     | `{ justifyItems: 'stretch' }`     |
| **Normal**      | `justify-items: normal`      | `justify-items-normal`      | `{ justifyItems: 'normal' }`      |

## Justify Self

Controlling individual item alignment.

| Concept         | CSS Rule                    | Tailwind v4 Class          | `sz` Prop (Canonical)            | `sz` Prop (Alias) |
| :-------------- | :-------------------------- | :------------------------- | :------------------------------- | :---------------- |
| **Auto**        | `justify-self: auto`        | `justify-self-auto`        | `{ justifySelf: 'auto' }`        |                   |
| **Start**       | `justify-self: start`       | `justify-self-start`       | `{ justifySelf: 'start' }`       |                   |
| **End**         | `justify-self: end`         | `justify-self-end`         | `{ justifySelf: 'end' }`         |                   |
| **End Safe**    | `justify-self: safe end`    | `justify-self-end-safe`    | `{ justifySelf: 'end-safe' }`    |                   |
| **Center**      | `justify-self: center`      | `justify-self-center`      | `{ justifySelf: 'center' }`      |                   |
| **Center Safe** | `justify-self: safe center` | `justify-self-center-safe` | `{ justifySelf: 'center-safe' }` |                   |
| **Stretch**     | `justify-self: stretch`     | `justify-self-stretch`     | `{ justifySelf: 'stretch' }`     |                   |

## Align Content

Controlling placement along the cross axis.

| Concept      | CSS Rule                       | Tailwind v4 Class  | `sz` Prop (Canonical)          |
| :----------- | :----------------------------- | :----------------- | :----------------------------- |
| **Normal**   | `align-content: normal`        | `content-normal`   | `{ alignContent: 'normal' }`   |
| **Start**    | `align-content: flex-start`    | `content-start`    | `{ alignContent: 'start' }`    |
| **End**      | `align-content: flex-end`      | `content-end`      | `{ alignContent: 'end' }`      |
| **Center**   | `align-content: center`        | `content-center`   | `{ alignContent: 'center' }`   |
| **Between**  | `align-content: space-between` | `content-between`  | `{ alignContent: 'between' }`  |
| **Around**   | `align-content: space-around`  | `content-around`   | `{ alignContent: 'around' }`   |
| **Evenly**   | `align-content: space-evenly`  | `content-evenly`   | `{ alignContent: 'evenly' }`   |
| **Stretch**  | `align-content: stretch`       | `content-stretch`  | `{ alignContent: 'stretch' }`  |
| **Baseline** | `align-content: baseline`      | `content-baseline` | `{ alignContent: 'baseline' }` |

## Align Items

Controlling flex item alignment cross axis.

| Concept           | CSS Rule                     | Tailwind v4 Class     | `sz` Prop (Canonical)        | `sz` Prop (Alias)         |
| :---------------- | :--------------------------- | :-------------------- | :--------------------------- | :------------------------ |
| **Start**         | `align-items: flex-start`    | `items-start`         | `{ items: 'start' }`         | `{ alignItems: 'start' }` |
| **End**           | `align-items: flex-end`      | `items-end`           | `{ items: 'end' }`           |                           |
| **End Safe**      | `align-items: safe end`      | `items-end-safe`      | `{ items: 'end-safe' }`      |                           |
| **Center**        | `align-items: center`        | `items-center`        | `{ items: 'center' }`        |                           |
| **Center Safe**   | `align-items: safe center`   | `items-center-safe`   | `{ items: 'center-safe' }`   |                           |
| **Baseline**      | `align-items: baseline`      | `items-baseline`      | `{ items: 'baseline' }`      |                           |
| **Baseline Last** | `align-items: last baseline` | `items-baseline-last` | `{ items: 'baseline-last' }` |                           |
| **Stretch**       | `align-items: stretch`       | `items-stretch`       | `{ items: 'stretch' }`       |                           |

## Align Self

Controlling individual item alignment.

| Concept           | CSS Rule                    | Tailwind v4 Class    | `sz` Prop (Canonical)       |
| :---------------- | :-------------------------- | :------------------- | :-------------------------- |
| **Auto**          | `align-self: auto`          | `self-auto`          | `{ self: 'auto' }`          |
| **Start**         | `align-self: flex-start`    | `self-start`         | `{ self: 'start' }`         |
| **End**           | `align-self: flex-end`      | `self-end`           | `{ self: 'end' }`           |
| **End Safe**      | `align-self: safe end`      | `self-end-safe`      | `{ self: 'end-safe' }`      |
| **Center**        | `align-self: center`        | `self-center`        | `{ self: 'center' }`        |
| **Center Safe**   | `align-self: safe center`   | `self-center-safe`   | `{ self: 'center-safe' }`   |
| **Stretch**       | `align-self: stretch`       | `self-stretch`       | `{ self: 'stretch' }`       |
| **Baseline**      | `align-self: baseline`      | `self-baseline`      | `{ self: 'baseline' }`      |
| **Baseline Last** | `align-self: last baseline` | `self-baseline-last` | `{ self: 'baseline-last' }` |

## Place Content

Shorthand for align-content and justify-content.

| Concept         | CSS Rule                       | Tailwind v4 Class           | `sz` Prop (Canonical)             | `sz` Prop (Alias) |
| :-------------- | :----------------------------- | :-------------------------- | :-------------------------------- | :---------------- |
| **Center**      | `place-content: center`        | `place-content-center`      | `{ placeContent: 'center' }`      |                   |
| **Center Safe** | `place-content: safe center`   | `place-content-center-safe` | `{ placeContent: 'center-safe' }` |                   |
| **Start**       | `place-content: start`         | `place-content-start`       | `{ placeContent: 'start' }`       |                   |
| **End**         | `place-content: end`           | `place-content-end`         | `{ placeContent: 'end' }`         |                   |
| **End Safe**    | `place-content: safe end`      | `place-content-end-safe`    | `{ placeContent: 'end-safe' }`    |                   |
| **Between**     | `place-content: space-between` | `place-content-between`     | `{ placeContent: 'between' }`     |                   |
| **Around**      | `place-content: space-around`  | `place-content-around`      | `{ placeContent: 'around' }`      |                   |
| **Evenly**      | `place-content: space-evenly`  | `place-content-evenly`      | `{ placeContent: 'evenly' }`      |                   |
| **Stretch**     | `place-content: stretch`       | `place-content-stretch`     | `{ placeContent: 'stretch' }`     |                   |
| **Baseline**    | `place-content: baseline`      | `place-content-baseline`    | `{ placeContent: 'baseline' }`    |                   |

## Place Items

Shorthand for align-items and justify-items.

| Concept         | CSS Rule                   | Tailwind v4 Class         | `sz` Prop (Canonical)           | `sz` Prop (Alias) |
| :-------------- | :------------------------- | :------------------------ | :------------------------------ | :---------------- |
| **Start**       | `place-items: start`       | `place-items-start`       | `{ placeItems: 'start' }`       |                   |
| **End**         | `place-items: end`         | `place-items-end`         | `{ placeItems: 'end' }`         |                   |
| **End Safe**    | `place-items: safe end`    | `place-items-end-safe`    | `{ placeItems: 'end-safe' }`    |                   |
| **Center**      | `place-items: center`      | `place-items-center`      | `{ placeItems: 'center' }`      |                   |
| **Center Safe** | `place-items: safe center` | `place-items-center-safe` | `{ placeItems: 'center-safe' }` |                   |
| **Stretch**     | `place-items: stretch`     | `place-items-stretch`     | `{ placeItems: 'stretch' }`     |                   |
| **Baseline**    | `place-items: baseline`    | `place-items-baseline`    | `{ placeItems: 'baseline' }`    |                   |

## Place Self

Shorthand for align-self and justify-self.

| Concept         | CSS Rule                  | Tailwind v4 Class        | `sz` Prop (Canonical)          | `sz` Prop (Alias) |
| :-------------- | :------------------------ | :----------------------- | :----------------------------- | :---------------- |
| **Auto**        | `place-self: auto`        | `place-self-auto`        | `{ placeSelf: 'auto' }`        |                   |
| **Start**       | `place-self: start`       | `place-self-start`       | `{ placeSelf: 'start' }`       |                   |
| **End**         | `place-self: end`         | `place-self-end`         | `{ placeSelf: 'end' }`         |                   |
| **End Safe**    | `place-self: safe end`    | `place-self-end-safe`    | `{ placeSelf: 'end-safe' }`    |                   |
| **Center**      | `place-self: center`      | `place-self-center`      | `{ placeSelf: 'center' }`      |                   |
| **Center Safe** | `place-self: safe center` | `place-self-center-safe` | `{ placeSelf: 'center-safe' }` |                   |
| **Stretch**     | `place-self: stretch`     | `place-self-stretch`     | `{ placeSelf: 'stretch' }`     |                   |
