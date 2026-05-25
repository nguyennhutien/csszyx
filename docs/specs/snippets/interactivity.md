# Interactivity

Utilities for controlling how users interact with elements.

## Accent Color

Utilities for controlling the accent color of a form control.

| Concept       | CSS Rule                 | Tailwind v4 Class  | `sz` Prop (Object Syntax) | Note |
| :------------ | :----------------------- | :----------------- | :------------------------ | :--- |
| **Color**     | `accent-color: (etc)`    | `accent-red-500`   | `{ accent: 'red-500' }`   |      |
| **Arbitrary** | `accent-color: (etc)`    | `accent-[#50d71e]` | `{ accent: '#50d71e' }`   |      |
| **Variable**  | `accent-color: var(--c)` | `accent-(--c)`     | `{ accent: '--c' }`       |      |

## Appearance

Utilities for suppressing native form control styling.

| Concept  | CSS Rule            | Tailwind v4 Class | `sz` Prop (Object Syntax) | Note |
| :------- | :------------------ | :---------------- | :------------------------ | :--- |
| **None** | `appearance: none;` | `appearance-none` | `{ appearance: 'none' }`  |      |
| **Auto** | `appearance: auto;` | `appearance-auto` | `{ appearance: 'auto' }`  |      |

## Caret Color

Utilities for controlling the color of the text input cursor.

| Concept       | CSS Rule                | Tailwind v4 Class | `sz` Prop (Object Syntax) | Note |
| :------------ | :---------------------- | :---------------- | :------------------------ | :--- |
| **Color**     | `caret-color: (etc)`    | `caret-red-500`   | `{ caret: 'red-500' }`    |      |
| **Arbitrary** | `caret-color: (etc)`    | `caret-[#50d71e]` | `{ caret: '#50d71e' }`    |      |
| **Variable**  | `caret-color: var(--c)` | `caret-(--c)`     | `{ caret: '--c' }`        |      |

## Color Scheme

Utilities for specifying the color scheme an element should be rendered with.

| Concept        | CSS Rule                   | Tailwind v4 Class   | `sz` Prop (Object Syntax)  | Note |
| :------------- | :------------------------- | :------------------ | :------------------------- | :--- |
| **Dark**       | `color-scheme: dark`       | `scheme-dark`       | `{ scheme: 'dark' }`       |      |
| **Light**      | `color-scheme: light`      | `scheme-light`      | `{ scheme: 'light' }`      |      |
| **Normal**     | `color-scheme: normal`     | `scheme-normal`     | `{ scheme: 'normal' }`     |      |
| **Light-Dark** | `color-scheme: light dark` | `scheme-light-dark` | `{ scheme: 'light-dark' }` |      |
| **Only Dark**  | `color-scheme: only dark`  | `scheme-only-dark`  | `{ scheme: 'only-dark' }`  |      |
| **Only Light** | `color-scheme: only light` | `scheme-only-light` | `{ scheme: 'only-light' }` |      |

## Cursor

Utilities for controlling the cursor style when hovering over an element.

| Concept       | CSS Rule           | Tailwind v4 Class                    | `sz` Prop (Object Syntax)           | Note |
| :------------ | :----------------- | :----------------------------------- | :---------------------------------- | :--- |
| **Keywords**  | `cursor: (etc)`    | `cursor-pointer`, `cursor-wait`(etc) | `{ cursor: 'pointer' }`             |      |
| **Arbitrary** | `cursor: (etc)`    | `cursor-[url(h.cur),_pointer]`       | `{ cursor: 'url(h.cur),_pointer' }` |      |
| **Variable**  | `cursor: var(--c)` | `cursor-(--c)`                       | `{ cursor: '--c' }`                 |      |

## Field Sizing

Utilities for controlling the sizing of form fields.

| Concept     | CSS Rule                 | Tailwind v4 Class      | `sz` Prop (Object Syntax)    | Note |
| :---------- | :----------------------- | :--------------------- | :--------------------------- | :--- |
| **Fixed**   | `field-sizing: fixed;`   | `field-sizing-fixed`   | `{ fieldSizing: 'fixed' }`   |      |
| **Content** | `field-sizing: content;` | `field-sizing-content` | `{ fieldSizing: 'content' }` |      |

## Pointer Events

Utilities for controlling whether an element responds to pointer events.

| Concept  | CSS Rule                | Tailwind v4 Class     | `sz` Prop (Object Syntax)   | Note |
| :------- | :---------------------- | :-------------------- | :-------------------------- | :--- |
| **None** | `pointer-events: none;` | `pointer-events-none` | `{ pointerEvents: 'none' }` |      |
| **Auto** | `pointer-events: auto;` | `pointer-events-auto` | `{ pointerEvents: 'auto' }` |      |

## Resize

Utilities for controlling whether an element is resizable.

| Concept        | CSS Rule              | Tailwind v4 Class | `sz` Prop (Object Syntax) | Note |
| :------------- | :-------------------- | :---------------- | :------------------------ | :--- |
| **None**       | `resize: none;`       | `resize-none`     | `{ resize: 'none' }`      |      |
| **Both**       | `resize: both;`       | `resize`          | `{ resize: true }`        |      |
| **Vertical**   | `resize: vertical;`   | `resize-y`        | `{ resize: 'y' }`         |      |
| **Horizontal** | `resize: horizontal;` | `resize-x`        | `{ resize: 'x' }`         |      |

## Scroll Behavior

Utilities for controlling the scroll behavior of an element.

| Concept    | CSS Rule                   | Tailwind v4 Class | `sz` Prop (Object Syntax) | Note |
| :--------- | :------------------------- | :---------------- | :------------------------ | :--- |
| **Auto**   | `scroll-behavior: auto;`   | `scroll-auto`     | `{ scroll: 'auto' }`      |      |
| **Smooth** | `scroll-behavior: smooth;` | `scroll-smooth`   | `{ scroll: 'smooth' }`    |      |

## Scroll Margin

Utilities for controlling the scroll offset of an element.

| Concept           | CSS Rule                           | Tailwind v4 Class | `sz` Prop (Object Syntax) | Note                 |
| :---------------- | :--------------------------------- | :---------------- | :------------------------ | :------------------- |
| Scroll Margin 0   | `scroll-margin: 0px`               | `scroll-m-0`      | `{ scrollM: 0 }`          |                      |
| Scroll Margin px  | `scroll-margin: 1px`               | `scroll-m-px`     | `{ scrollM: 'px' }`       |                      |
| Scroll Margin 0.5 | `scroll-margin: 0.125rem`          | `scroll-m-0.5`    | `{ scrollM: 0.5 }`        |                      |
| Scroll Margin 1   | `scroll-margin: 0.25rem`           | `scroll-m-1`      | `{ scrollM: 1 }`          |                      |
| Scroll Margin 1.5 | `scroll-margin: 0.375rem`          | `scroll-m-1.5`    | `{ scrollM: 1.5 }`        |                      |
| Scroll Margin 2   | `scroll-margin: 0.5rem`            | `scroll-m-2`      | `{ scrollM: 2 }`          |                      |
| Scroll Margin 2.5 | `scroll-margin: 0.625rem`          | `scroll-m-2.5`    | `{ scrollM: 2.5 }`        |                      |
| Scroll Margin 3   | `scroll-margin: 0.75rem`           | `scroll-m-3`      | `{ scrollM: 3 }`          |                      |
| Scroll Margin 3.5 | `scroll-margin: 0.875rem`          | `scroll-m-3.5`    | `{ scrollM: 3.5 }`        |                      |
| Scroll Margin 4   | `scroll-margin: 1rem`              | `scroll-m-4`      | `{ scrollM: 4 }`          |                      |
| Scroll Margin 5   | `scroll-margin: 1.25rem`           | `scroll-m-5`      | `{ scrollM: 5 }`          |                      |
| Scroll Margin 6   | `scroll-margin: 1.5rem`            | `scroll-m-6`      | `{ scrollM: 6 }`          |                      |
| Scroll Margin 7   | `scroll-margin: 1.75rem`           | `scroll-m-7`      | `{ scrollM: 7 }`          |                      |
| Scroll Margin 8   | `scroll-margin: 2rem`              | `scroll-m-8`      | `{ scrollM: 8 }`          |                      |
| Scroll Margin 9   | `scroll-margin: 2.25rem`           | `scroll-m-9`      | `{ scrollM: 9 }`          |                      |
| Scroll Margin 10  | `scroll-margin: 2.5rem`            | `scroll-m-10`     | `{ scrollM: 10 }`         |                      |
| Scroll Margin 11  | `scroll-margin: 2.75rem`           | `scroll-m-11`     | `{ scrollM: 11 }`         |                      |
| Scroll Margin 12  | `scroll-margin: 3rem`              | `scroll-m-12`     | `{ scrollM: 12 }`         |                      |
| Scroll Margin 14  | `scroll-margin: 3.5rem`            | `scroll-m-14`     | `{ scrollM: 14 }`         |                      |
| Scroll Margin 16  | `scroll-margin: 4rem`              | `scroll-m-16`     | `{ scrollM: 16 }`         |                      |
| Scroll Margin 20  | `scroll-margin: 5rem`              | `scroll-m-20`     | `{ scrollM: 20 }`         |                      |
| Scroll Margin 24  | `scroll-margin: 6rem`              | `scroll-m-24`     | `{ scrollM: 24 }`         |                      |
| Scroll Margin 28  | `scroll-margin: 7rem`              | `scroll-m-28`     | `{ scrollM: 28 }`         |                      |
| Scroll Margin 32  | `scroll-margin: 8rem`              | `scroll-m-32`     | `{ scrollM: 32 }`         |                      |
| Scroll Margin 36  | `scroll-margin: 9rem`              | `scroll-m-36`     | `{ scrollM: 36 }`         |                      |
| Scroll Margin 40  | `scroll-margin: 10rem`             | `scroll-m-40`     | `{ scrollM: 40 }`         |                      |
| Scroll Margin 44  | `scroll-margin: 11rem`             | `scroll-m-44`     | `{ scrollM: 44 }`         |                      |
| Scroll Margin 48  | `scroll-margin: 12rem`             | `scroll-m-48`     | `{ scrollM: 48 }`         |                      |
| Scroll Margin 52  | `scroll-margin: 13rem`             | `scroll-m-52`     | `{ scrollM: 52 }`         |                      |
| Scroll Margin 56  | `scroll-margin: 14rem`             | `scroll-m-56`     | `{ scrollM: 56 }`         |                      |
| Scroll Margin 60  | `scroll-margin: 15rem`             | `scroll-m-60`     | `{ scrollM: 60 }`         |                      |
| Scroll Margin 64  | `scroll-margin: 16rem`             | `scroll-m-64`     | `{ scrollM: 64 }`         |                      |
| Scroll Margin 72  | `scroll-margin: 18rem`             | `scroll-m-72`     | `{ scrollM: 72 }`         |                      |
| Scroll Margin 80  | `scroll-margin: 20rem`             | `scroll-m-80`     | `{ scrollM: 80 }`         |                      |
| Scroll Margin 96  | `scroll-margin: 24rem`             | `scroll-m-96`     | `{ scrollM: 96 }`         |                      |
| **X/Y/T/R/B/L**   | `scroll-margin-top: (etc)`         | `scroll-mt-4`     | `{ scrollMt: 4 }`         |                      |
| **Block Start**   | `scroll-margin-block-start: (etc)` | `scroll-mbs-4`    | `{ scrollMbs: 4 }`        | v4.2: logical block. |
| **Block End**     | `scroll-margin-block-end: (etc)`   | `scroll-mbe-4`    | `{ scrollMbe: 4 }`        | v4.2: logical block. |
| **Negative**      | `scroll-margin: -(etc)`            | `-scroll-m-4`     | `{ scrollM: -4 }`         |                      |
| **Arbitrary**     | `scroll-margin: 5px`               | `scroll-m-[5px]`  | `{ scrollM: '5px' }`      |                      |
| **Variable**      | `scroll-margin: var(--m)`          | `scroll-m-(--m)`  | `{ scrollM: '--m' }`      |                      |

## Scroll Padding

Utilities for controlling an element's scroll padding.

| Concept            | CSS Rule                            | Tailwind v4 Class | `sz` Prop (Object Syntax) | Note                 |
| :----------------- | :---------------------------------- | :---------------- | :------------------------ | :------------------- |
| Scroll Padding 0   | `scroll-padding: 0px`               | `scroll-p-0`      | `{ scrollP: 0 }`          |                      |
| Scroll Padding px  | `scroll-padding: 1px`               | `scroll-p-px`     | `{ scrollP: 'px' }`       |                      |
| Scroll Padding 0.5 | `scroll-padding: 0.125rem`          | `scroll-p-0.5`    | `{ scrollP: 0.5 }`        |                      |
| Scroll Padding 1   | `scroll-padding: 0.25rem`           | `scroll-p-1`      | `{ scrollP: 1 }`          |                      |
| Scroll Padding 1.5 | `scroll-padding: 0.375rem`          | `scroll-p-1.5`    | `{ scrollP: 1.5 }`        |                      |
| Scroll Padding 2   | `scroll-padding: 0.5rem`            | `scroll-p-2`      | `{ scrollP: 2 }`          |                      |
| Scroll Padding 2.5 | `scroll-padding: 0.625rem`          | `scroll-p-2.5`    | `{ scrollP: 2.5 }`        |                      |
| Scroll Padding 3   | `scroll-padding: 0.75rem`           | `scroll-p-3`      | `{ scrollP: 3 }`          |                      |
| Scroll Padding 3.5 | `scroll-padding: 0.875rem`          | `scroll-p-3.5`    | `{ scrollP: 3.5 }`        |                      |
| Scroll Padding 4   | `scroll-padding: 1rem`              | `scroll-p-4`      | `{ scrollP: 4 }`          |                      |
| Scroll Padding 5   | `scroll-padding: 1.25rem`           | `scroll-p-5`      | `{ scrollP: 5 }`          |                      |
| Scroll Padding 6   | `scroll-padding: 1.5rem`            | `scroll-p-6`      | `{ scrollP: 6 }`          |                      |
| Scroll Padding 7   | `scroll-padding: 1.75rem`           | `scroll-p-7`      | `{ scrollP: 7 }`          |                      |
| Scroll Padding 8   | `scroll-padding: 2rem`              | `scroll-p-8`      | `{ scrollP: 8 }`          |                      |
| Scroll Padding 9   | `scroll-padding: 2.25rem`           | `scroll-p-9`      | `{ scrollP: 9 }`          |                      |
| Scroll Padding 10  | `scroll-padding: 2.5rem`            | `scroll-p-10`     | `{ scrollP: 10 }`         |                      |
| Scroll Padding 11  | `scroll-padding: 2.75rem`           | `scroll-p-11`     | `{ scrollP: 11 }`         |                      |
| Scroll Padding 12  | `scroll-padding: 3rem`              | `scroll-p-12`     | `{ scrollP: 12 }`         |                      |
| Scroll Padding 14  | `scroll-padding: 3.5rem`            | `scroll-p-14`     | `{ scrollP: 14 }`         |                      |
| Scroll Padding 16  | `scroll-padding: 4rem`              | `scroll-p-16`     | `{ scrollP: 16 }`         |                      |
| Scroll Padding 20  | `scroll-padding: 5rem`              | `scroll-p-20`     | `{ scrollP: 20 }`         |                      |
| Scroll Padding 24  | `scroll-padding: 6rem`              | `scroll-p-24`     | `{ scrollP: 24 }`         |                      |
| Scroll Padding 28  | `scroll-padding: 7rem`              | `scroll-p-28`     | `{ scrollP: 28 }`         |                      |
| Scroll Padding 32  | `scroll-padding: 8rem`              | `scroll-p-32`     | `{ scrollP: 32 }`         |                      |
| Scroll Padding 36  | `scroll-padding: 9rem`              | `scroll-p-36`     | `{ scrollP: 36 }`         |                      |
| Scroll Padding 40  | `scroll-padding: 10rem`             | `scroll-p-40`     | `{ scrollP: 40 }`         |                      |
| Scroll Padding 44  | `scroll-padding: 11rem`             | `scroll-p-44`     | `{ scrollP: 44 }`         |                      |
| Scroll Padding 48  | `scroll-padding: 12rem`             | `scroll-p-48`     | `{ scrollP: 48 }`         |                      |
| Scroll Padding 52  | `scroll-padding: 13rem`             | `scroll-p-52`     | `{ scrollP: 52 }`         |                      |
| Scroll Padding 56  | `scroll-padding: 14rem`             | `scroll-p-56`     | `{ scrollP: 56 }`         |                      |
| Scroll Padding 60  | `scroll-padding: 15rem`             | `scroll-p-60`     | `{ scrollP: 60 }`         |                      |
| Scroll Padding 64  | `scroll-padding: 16rem`             | `scroll-p-64`     | `{ scrollP: 64 }`         |                      |
| Scroll Padding 72  | `scroll-padding: 18rem`             | `scroll-p-72`     | `{ scrollP: 72 }`         |                      |
| Scroll Padding 80  | `scroll-padding: 20rem`             | `scroll-p-80`     | `{ scrollP: 80 }`         |                      |
| Scroll Padding 96  | `scroll-padding: 24rem`             | `scroll-p-96`     | `{ scrollP: 96 }`         |                      |
| **X/Y/T/R/B/L**    | `scroll-padding-top: (etc)`         | `scroll-pt-4`     | `{ scrollPt: 4 }`         |                      |
| **Block Start**    | `scroll-padding-block-start: (etc)` | `scroll-pbs-4`    | `{ scrollPbs: 4 }`        | v4.2: logical block. |
| **Block End**      | `scroll-padding-block-end: (etc)`   | `scroll-pbe-4`    | `{ scrollPbe: 4 }`        | v4.2: logical block. |
| **Arbitrary**      | `scroll-padding: 5px`               | `scroll-p-[5px]`  | `{ scrollP: '5px' }`      |                      |
| **Variable**       | `scroll-padding: var(--p)`          | `scroll-p-(--p)`  | `{ scrollP: '--p' }`      |                      |

## Scroll Snap Align

Utilities for controlling the snap alignment of an element within a snap container.

| Concept    | CSS Rule                    | Tailwind v4 Class | `sz` Prop (Object Syntax) | Note |
| :--------- | :-------------------------- | :---------------- | :------------------------ | :--- |
| **Start**  | `scroll-snap-align: start`  | `snap-start`      | `{ snapAlign: 'start' }`  |      |
| **End**    | `scroll-snap-align: end`    | `snap-end`        | `{ snapAlign: 'end' }`    |      |
| **Center** | `scroll-snap-align: center` | `snap-center`     | `{ snapAlign: 'center' }` |      |
| **None**   | `scroll-snap-align: none`   | `snap-align-none` | `{ snapAlign: 'none' }`   |      |

## Scroll Snap Stop

Utilities for controlling whether an element's container stops on it.

| Concept    | CSS Rule                   | Tailwind v4 Class | `sz` Prop (Object Syntax) | Note |
| :--------- | :------------------------- | :---------------- | :------------------------ | :--- |
| **Normal** | `scroll-snap-stop: normal` | `snap-normal`     | `{ snapStop: 'normal' }`  |      |
| **Always** | `scroll-snap-stop: always` | `snap-always`     | `{ snapStop: 'always' }`  |      |

## Scroll Snap Type

Utilities for controlling how strictly snap points are enforced.

| Concept  | CSS Rule                 | Tailwind v4 Class | `sz` Prop (Object Syntax) | Note |
| :------- | :----------------------- | :---------------- | :------------------------ | :--- |
| **None** | `scroll-snap-type: none` | `snap-none`       | `{ snapType: 'none' }`    |      |
| **X**    | `scroll-snap-type: x`    | `snap-x`          | `{ snapType: 'x' }`       |      |
| **Y**    | `scroll-snap-type: y`    | `snap-y`          | `{ snapType: 'y' }`       |      |
| **Both** | `scroll-snap-type: both` | `snap-both`       | `{ snapType: 'both' }`    |      |

## Scroll Snap Strictness

Utilities for controlling the strictness of snap points.

| Concept       | CSS Rule                        | Tailwind v4 Class | `sz` Prop (Object Syntax)         | Note |
| :------------ | :------------------------------ | :---------------- | :-------------------------------- | :--- |
| **Mandatory** | `scroll-snap-type: * mandatory` | `snap-mandatory`  | `{ snapStrictness: 'mandatory' }` |      |
| **Proximity** | `scroll-snap-type: * proximity` | `snap-proximity`  | `{ snapStrictness: 'proximity' }` |      |

## Touch Action

Utilities for controlling how an element can be panned and zoomed by a user on a touchscreen.

| Concept      | CSS Rule              | Tailwind v4 Class                              | `sz` Prop (Object Syntax) | Note |
| :----------- | :-------------------- | :--------------------------------------------- | :------------------------ | :--- |
| **Keywords** | `touch-action: (etc)` | `touch-auto`, `touch-none`, `touch-pan-x`(etc) | `{ touch: 'auto' }`       |      |

## User Select

Utilities for controlling whether the user can select text in an element.

| Concept  | CSS Rule             | Tailwind v4 Class | `sz` Prop (Object Syntax) | Note |
| :------- | :------------------- | :---------------- | :------------------------ | :--- |
| **None** | `user-select: none;` | `select-none`     | `{ select: 'none' }`      |      |
| **Auto** | `user-select: auto;` | `select-auto`     | `{ select: 'auto' }`      |      |
| **Text** | `user-select: text;` | `select-text`     | `{ select: 'text' }`      |      |
| **All**  | `user-select: all;`  | `select-all`      | `{ select: 'all' }`       |      |

## Will Change

Utilities for hinting to the browser how an element will change.

| Concept       | CSS Rule                | Tailwind v4 Class                             | `sz` Prop (Object Syntax) | Note |
| :------------ | :---------------------- | :-------------------------------------------- | :------------------------ | :--- |
| **Keywords**  | `will-change: (etc)`    | `will-change-auto`, `will-change-scroll`(etc) | `{ willChange: 'auto' }`  |      |
| **Arbitrary** | `will-change: <v>`      | `will-change-[<v>]`                           | `{ willChange: '<v>' }`   |      |
| **Variable**  | `will-change: var(--c)` | `will-change-(--c)`                           | `{ willChange: '--c' }`   |      |

## Scrollbar Width (v4.3)

Utilities for controlling the scrollbar width.

| Concept  | CSS Rule                | Tailwind v4 Class | `sz` Prop (Object Syntax) | Note |
| :------- | :---------------------- | :---------------- | :------------------------ | :--- |
| **Auto** | `scrollbar-width: auto` | `scrollbar-auto`  | `{ scrollbar: 'auto' }`   |      |
| **Thin** | `scrollbar-width: thin` | `scrollbar-thin`  | `{ scrollbar: 'thin' }`   |      |
| **None** | `scrollbar-width: none` | `scrollbar-none`  | `{ scrollbar: 'none' }`   |      |

## Scrollbar Color (v4.3)

Utilities for controlling the scrollbar thumb and track colors.

| Concept      | CSS Rule                        | Tailwind v4 Class        | `sz` Prop (Object Syntax)      | Note |
| :----------- | :------------------------------ | :----------------------- | :----------------------------- | :--- |
| **Thumb**    | `scrollbar-color: <color> ...`  | `scrollbar-thumb-<name>` | `{ scrollbarThumb: '<name>' }` |      |
| **Track**    | `scrollbar-color: ... <color>`  | `scrollbar-track-<name>` | `{ scrollbarTrack: '<name>' }` |      |
| **Variable** | `scrollbar-color: var(--c) ...` | `scrollbar-thumb-(--c)`  | `{ scrollbarThumb: '--c' }`    |      |

## Scrollbar Gutter (v4.3)

Utilities for controlling the scrollbar gutter behavior.

| Concept    | CSS Rule                              | Tailwind v4 Class         | `sz` Prop (Object Syntax)       | Note |
| :--------- | :------------------------------------ | :------------------------ | :------------------------------ | :--- |
| **Auto**   | `scrollbar-gutter: auto`              | `scrollbar-gutter-auto`   | `{ scrollbarGutter: 'auto' }`   |      |
| **Stable** | `scrollbar-gutter: stable`            | `scrollbar-gutter-stable` | `{ scrollbarGutter: 'stable' }` |      |
| **Both**   | `scrollbar-gutter: stable both-edges` | `scrollbar-gutter-both`   | `{ scrollbarGutter: 'both' }`   |      |

## Zoom (v4.3)

Utilities for controlling the zoom level of an element.

| Concept      | CSS Rule         | Tailwind v4 Class | `sz` Prop (Object Syntax) | Note |
| :----------- | :--------------- | :---------------- | :------------------------ | :--- |
| **Scale**    | `zoom: <number>` | `zoom-<number>`   | `{ zoom: <number> }`      |      |
| **Variable** | `zoom: var(--z)` | `zoom-(--z)`      | `{ zoom: '--z' }`         |      |

## Tab Size (v4.3)

Utilities for controlling the width of tab characters.

| Concept       | CSS Rule             | Tailwind v4 Class | `sz` Prop (Object Syntax) | Note |
| :------------ | :------------------- | :---------------- | :------------------------ | :--- |
| **Number**    | `tab-size: <number>` | `tab-<number>`    | `{ tabSize: <number> }`   |      |
| **Arbitrary** | `tab-size: <v>`      | `tab-[<v>]`       | `{ tabSize: '<v>' }`      |      |
| **Variable**  | `tab-size: var(--t)` | `tab-(--t)`       | `{ tabSize: '--t' }`      |      |
