# Tables

Controlling the layout and style of tables.

## Border Collapse

Utilities for controlling whether table borders should collapse or be separated.

| Concept      | CSS Rule                     | Tailwind v4 Class | `sz` Prop (Object Syntax)        | Note |
| :----------- | :--------------------------- | :---------------- | :------------------------------- | :--- |
| **Collapse** | `border-collapse: collapse;` | `border-collapse` | `{ borderCollapse: 'collapse' }` |      |
| **Separate** | `border-collapse: separate;` | `border-separate` | `{ borderCollapse: 'separate' }` |      |

## Border Spacing

Utilities for controlling the spacing between table borders.

| Concept            | CSS Rule                                           | Tailwind v4 Class      | `sz` Prop (Object Syntax)  | Note |
| :----------------- | :------------------------------------------------- | :--------------------- | :------------------------- | :--- |
| Border Spacing 0   | `border-spacing: 0px`                              | `border-spacing-0`     | `{ borderSpacing: 0 }`     |      |
| Border Spacing px  | `border-spacing: 1px`                              | `border-spacing-px`    | `{ borderSpacing: 'px' }`  |      |
| Border Spacing 0.5 | `border-spacing: 0.125rem`                         | `border-spacing-0.5`   | `{ borderSpacing: 0.5 }`   |      |
| Border Spacing 1   | `border-spacing: 0.25rem`                          | `border-spacing-1`     | `{ borderSpacing: 1 }`     |      |
| Border Spacing 1.5 | `border-spacing: 0.375rem`                         | `border-spacing-1.5`   | `{ borderSpacing: 1.5 }`   |      |
| Border Spacing 2   | `border-spacing: 0.5rem`                           | `border-spacing-2`     | `{ borderSpacing: 2 }`     |      |
| Border Spacing 2.5 | `border-spacing: 0.625rem`                         | `border-spacing-2.5`   | `{ borderSpacing: 2.5 }`   |      |
| Border Spacing 3   | `border-spacing: 0.75rem`                          | `border-spacing-3`     | `{ borderSpacing: 3 }`     |      |
| Border Spacing 3.5 | `border-spacing: 0.875rem`                         | `border-spacing-3.5`   | `{ borderSpacing: 3.5 }`   |      |
| Border Spacing 4   | `border-spacing: 1rem`                             | `border-spacing-4`     | `{ borderSpacing: 4 }`     |      |
| Border Spacing 5   | `border-spacing: 1.25rem`                          | `border-spacing-5`     | `{ borderSpacing: 5 }`     |      |
| Border Spacing 6   | `border-spacing: 1.5rem`                           | `border-spacing-6`     | `{ borderSpacing: 6 }`     |      |
| Border Spacing 7   | `border-spacing: 1.75rem`                          | `border-spacing-7`     | `{ borderSpacing: 7 }`     |      |
| Border Spacing 8   | `border-spacing: 2rem`                             | `border-spacing-8`     | `{ borderSpacing: 8 }`     |      |
| Border Spacing 9   | `border-spacing: 2.25rem`                          | `border-spacing-9`     | `{ borderSpacing: 9 }`     |      |
| Border Spacing 10  | `border-spacing: 2.5rem`                           | `border-spacing-10`    | `{ borderSpacing: 10 }`    |      |
| Border Spacing 11  | `border-spacing: 2.75rem`                          | `border-spacing-11`    | `{ borderSpacing: 11 }`    |      |
| Border Spacing 12  | `border-spacing: 3rem`                             | `border-spacing-12`    | `{ borderSpacing: 12 }`    |      |
| Border Spacing 14  | `border-spacing: 3.5rem`                           | `border-spacing-14`    | `{ borderSpacing: 14 }`    |      |
| Border Spacing 16  | `border-spacing: 4rem`                             | `border-spacing-16`    | `{ borderSpacing: 16 }`    |      |
| Border Spacing 20  | `border-spacing: 5rem`                             | `border-spacing-20`    | `{ borderSpacing: 20 }`    |      |
| Border Spacing 24  | `border-spacing: 6rem`                             | `border-spacing-24`    | `{ borderSpacing: 24 }`    |      |
| Border Spacing 28  | `border-spacing: 7rem`                             | `border-spacing-28`    | `{ borderSpacing: 28 }`    |      |
| Border Spacing 32  | `border-spacing: 8rem`                             | `border-spacing-32`    | `{ borderSpacing: 32 }`    |      |
| Border Spacing 36  | `border-spacing: 9rem`                             | `border-spacing-36`    | `{ borderSpacing: 36 }`    |      |
| Border Spacing 40  | `border-spacing: 10rem`                            | `border-spacing-40`    | `{ borderSpacing: 40 }`    |      |
| Border Spacing 44  | `border-spacing: 11rem`                            | `border-spacing-44`    | `{ borderSpacing: 44 }`    |      |
| Border Spacing 48  | `border-spacing: 12rem`                            | `border-spacing-48`    | `{ borderSpacing: 48 }`    |      |
| Border Spacing 52  | `border-spacing: 13rem`                            | `border-spacing-52`    | `{ borderSpacing: 52 }`    |      |
| Border Spacing 56  | `border-spacing: 14rem`                            | `border-spacing-56`    | `{ borderSpacing: 56 }`    |      |
| Border Spacing 60  | `border-spacing: 15rem`                            | `border-spacing-60`    | `{ borderSpacing: 60 }`    |      |
| Border Spacing 64  | `border-spacing: 16rem`                            | `border-spacing-64`    | `{ borderSpacing: 64 }`    |      |
| Border Spacing 72  | `border-spacing: 18rem`                            | `border-spacing-72`    | `{ borderSpacing: 72 }`    |      |
| Border Spacing 80  | `border-spacing: 20rem`                            | `border-spacing-80`    | `{ borderSpacing: 80 }`    |      |
| Border Spacing 96  | `border-spacing: 24rem`                            | `border-spacing-96`    | `{ borderSpacing: 96 }`    |      |
| **X/Y Spacing**    | `border-spacing-x: (etc); border-spacing-y: (etc)` | `border-spacing-x-4`   | `{ borderSpacingX: 4 }`    |      |
| **Arbitrary**      | `border-spacing: 3px`                              | `border-spacing-[3px]` | `{ borderSpacing: '3px' }` |      |
| **Variable**       | `border-spacing: var(--s)`                         | `border-spacing-(--s)` | `{ borderSpacing: '--s' }` |      |

## Table Layout

Utilities for controlling the table layout algorithm.

| Concept   | CSS Rule               | Tailwind v4 Class | `sz` Prop (Object Syntax)  | Note |
| :-------- | :--------------------- | :---------------- | :------------------------- | :--- |
| **Auto**  | `table-layout: auto;`  | `table-auto`      | `{ tableLayout: 'auto' }`  |      |
| **Fixed** | `table-layout: fixed;` | `table-fixed`     | `{ tableLayout: 'fixed' }` |      |

## Caption Side

Utilities for controlling the alignment of table captions.

| Concept    | CSS Rule                | Tailwind v4 Class | `sz` Prop (Object Syntax) | Note |
| :--------- | :---------------------- | :---------------- | :------------------------ | :--- |
| **Top**    | `caption-side: top;`    | `caption-top`     | `{ caption: 'top' }`      |      |
| **Bottom** | `caption-side: bottom;` | `caption-bottom`  | `{ caption: 'bottom' }`   |      |
