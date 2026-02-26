# Spacing

Controlling padding, margin, and space between elements.

## Padding

Controlling inner spacing.

| Concept             | CSS Rule                                                | Tailwind v4 Class | `sz` Prop (Object Syntax) | Note                                                                             |
| :------------------ | :------------------------------------------------------ | :---------------- | :------------------------ | :------------------------------------------------------------------------------- |
| **Px**              | `padding: 1px`                                          | `p-px`            | `{ p: 'px' }`             |                                                                                  |
| **All Sides**       | `padding: calc(var(--spacing) * <number>)`              | `p-<number>`      | `{ p: <number> }`         | v4: fully dynamic, no static scale, accept any integer or 0.5-step decimal bare. |
| **X Axis**          | `padding-inline: calc(var(--spacing) * <number>)`       | `px-<number>`     | `{ px: <number> }`        | v4: fully dynamic, no static scale, accept any integer or 0.5-step decimal bare. |
| **Y Axis**          | `padding-block: calc(var(--spacing) * <number>)`        | `py-<number>`     | `{ py: <number> }`        | v4: fully dynamic, no static scale, accept any integer or 0.5-step decimal bare. |
| **Top**             | `padding-top: calc(var(--spacing) * <number>)`          | `pt-<number>`     | `{ pt: <number> }`        | v4: fully dynamic, no static scale, accept any integer or 0.5-step decimal bare. |
| **Right**           | `padding-right: calc(var(--spacing) * <number>)`        | `pr-<number>`     | `{ pr: <number> }`        | v4: fully dynamic, no static scale, accept any integer or 0.5-step decimal bare. |
| **Bottom**          | `padding-bottom: calc(var(--spacing) * <number>)`       | `pb-<number>`     | `{ pb: <number> }`        | v4: fully dynamic, no static scale, accept any integer or 0.5-step decimal bare. |
| **Left**            | `padding-left: calc(var(--spacing) * <number>)`         | `pl-<number>`     | `{ pl: <number> }`        | v4: fully dynamic, no static scale, accept any integer or 0.5-step decimal bare. |
| **Start (Logical)** | `padding-inline-start: calc(var(--spacing) * <number>)` | `ps-<number>`     | `{ ps: <number> }`        | v4: fully dynamic, no static scale, accept any integer or 0.5-step decimal bare. |
| **End (Logical)**   | `padding-inline-end: calc(var(--spacing) * <number>)`   | `pe-<number>`     | `{ pe: <number> }`        | v4: fully dynamic, no static scale, accept any integer or 0.5-step decimal bare. |
| **Block Start**     | `padding-block-start: calc(var(--spacing) * <number>)`  | `pbs-<number>`    | `{ pbs: <number> }`       | v4.2: logical block-direction.                                                   |
| **Block End**       | `padding-block-end: calc(var(--spacing) * <number>)`    | `pbe-<number>`    | `{ pbe: <number> }`       | v4.2: logical block-direction.                                                   |
| **Arbitrary**       | `padding: 5px`                                          | `p-[5px]`         | `{ p: '5px' }`            |                                                                                  |
| **CSS Variable**    | `padding: var(--p)`                                     | `p-(--p)`         | `{ p: '--p' }`            | **Sugar**: Auto-detects `--`.                                                    |

## Margin

Controlling outer spacing.

| Concept                | CSS Rule                                               | Tailwind v4 Class | `sz` Prop (Object Syntax) | Note                                                                             |
| :--------------------- | :----------------------------------------------------- | :---------------- | :------------------------ | :------------------------------------------------------------------------------- |
| **Px**                 | `margin: 1px`                                          | `m-px`            | `{ m: 'px' }`             |                                                                                  |
| **Px Negative**        | `margin: -1px`                                         | `-m-px`           | `{ m: '-px' }`            |                                                                                  |
| **All Sides**          | `margin: calc(var(--spacing) * <number>)`              | `m-<number>`      | `{ m: <number> }`         | v4: fully dynamic, no static scale, accept any integer or 0.5-step decimal bare. |
| **All Sides Negative** | `margin: calc(var(--spacing) * -<number>)`             | `-m-<number>`     | `{ m: -<number> }`        | v4: fully dynamic, no static scale, accept any integer or 0.5-step decimal bare. |
| **X Axis**             | `margin-inline: calc(var(--spacing) * <number>)`       | `mx-<number>`     | `{ mx: <number> }`        | v4: fully dynamic, no static scale, accept any integer or 0.5-step decimal bare. |
| **Y Axis**             | `margin-block: calc(var(--spacing) * <number>)`        | `my-<number>`     | `{ my: <number> }`        | v4: fully dynamic, no static scale, accept any integer or 0.5-step decimal bare. |
| **Top**                | `margin-top: calc(var(--spacing) * <number>)`          | `mt-<number>`     | `{ mt: <number> }`        | v4: fully dynamic, no static scale, accept any integer or 0.5-step decimal bare. |
| **Right**              | `margin-right: calc(var(--spacing) * <number>)`        | `mr-<number>`     | `{ mr: <number> }`        | v4: fully dynamic, no static scale, accept any integer or 0.5-step decimal bare. |
| **Bottom**             | `margin-bottom: calc(var(--spacing) * <number>)`       | `mb-<number>`     | `{ mb: <number> }`        | v4: fully dynamic, no static scale, accept any integer or 0.5-step decimal bare. |
| **Left**               | `margin-left: calc(var(--spacing) * <number>)`         | `ml-<number>`     | `{ ml: <number> }`        | v4: fully dynamic, no static scale, accept any integer or 0.5-step decimal bare. |
| **Start (Logical)**    | `margin-inline-start: calc(var(--spacing) * <number>)` | `ms-<number>`     | `{ ms: <number> }`        | v4: fully dynamic, no static scale, accept any integer or 0.5-step decimal bare. |
| **End (Logical)**      | `margin-inline-end: calc(var(--spacing) * <number>)`   | `me-<number>`     | `{ me: <number> }`        | v4: fully dynamic, no static scale, accept any integer or 0.5-step decimal bare. |
| **Block Start**        | `margin-block-start: calc(var(--spacing) * <number>)`  | `mbs-<number>`    | `{ mbs: <number> }`       | v4.2: logical block-direction. Supports negative.                                |
| **Block End**          | `margin-block-end: calc(var(--spacing) * <number>)`    | `mbe-<number>`    | `{ mbe: <number> }`       | v4.2: logical block-direction. Supports negative.                                |
| **Negative**           | `margin-top: calc(var(--spacing) * -<number>)`         | `-mt-<number>`    | `{ mt: -<number> }`       | v4: fully dynamic, no static scale, accept any integer or 0.5-step decimal bare. |
| **Auto**               | `margin: auto`                                         | `m-auto`          | `{ m: 'auto' }`           |                                                                                  |
| **Arbitrary**          | `margin: 5px`                                          | `m-[5px]`         | `{ m: '5px' }`            |                                                                                  |
| **CSS Variable**       | `margin: var(--m)`                                     | `m-(--m)`         | `{ m: '--m' }`            | **Sugar**: Auto-detects `--`.                                                    |

## Space Between

Controlling spacing between child elements (Legacy/Alternative to Gap).

| Concept          | CSS Rule                  | Tailwind v4 Class   | `sz` Prop (Object Syntax) | Note                                                                             |
| :--------------- | :------------------------ | :------------------ | :------------------------ | :------------------------------------------------------------------------------- |
| **Space X**      | (on children)             | `space-x-<number>`  | `{ spaceX: <number> }`    | v4: fully dynamic, no static scale, accept any integer or 0.5-step decimal bare. |
| **Space Y**      | (on children)             | `space-y-<number>`  | `{ spaceY: <number> }`    | v4: fully dynamic, no static scale, accept any integer or 0.5-step decimal bare. |
| **Reverse X**    | `--tw-space-x-reverse: 1` | `space-x-reverse`   | `{ spaceXReverse: true }` |                                                                                  |
| **Reverse Y**    | `--tw-space-y-reverse: 1` | `space-y-reverse`   | `{ spaceYReverse: true }` |                                                                                  |
| **Negative**     | (on children)             | `-space-x-4`        | `{ spaceX: -<number> }`   | v4: fully dynamic, no static scale, accept any integer or 0.5-step decimal bare. |
| **Px**           | (on children)             | `space-x-px`        | `{ spaceX: 'px' }`        |                                                                                  |
| **Arbitrary**    | (on children)             | `space-x-[5px]`     | `{ spaceX: '5px' }`       |                                                                                  |
| **CSS Variable** | (on children)             | `space-x-(--space)` | `{ spaceX: '--space' }`   | **Sugar**: Auto-detects `--`.                                                    |
