# Sizing

Controlling the width and height of elements.

## Width

Controlling the width.

| Concept            | CSS Rule                                 | Tailwind v4 Class | `sz` Prop (Object Syntax) | Note                                                           |
| :----------------- | :--------------------------------------- | :---------------- | :------------------------ | :------------------------------------------------------------- |
| **Spacing**        | `width: calc(var(--spacing) * <number>)` | `w-<number>`      | `{ w: <number> }`         | v4: fully dynamic, accept any integer or 0.5-step decimal bare |
| **Px**             | `width: 1px`                             | `w-px`            | `{ w: 'px' }`             |                                                                |
| **Fraction**       | `width: calc(<int>/<int> * 100%)`        | `w-<int>/<int>`   | `{ w: '<int>/<int>' }`    | v4: any integer/integer fraction works bare                    |
| **Full**           | `width: 100%`                            | `w-full`          | `{ w: 'full' }`           |                                                                |
| **Screen**         | `width: 100vw`                           | `w-screen`        | `{ w: 'screen' }`         |                                                                |
| **Viewport (SVW)** | `width: 100svw`                          | `w-svw`           | `{ w: 'svw' }`            |                                                                |
| **Viewport (LVW)** | `width: 100lvw`                          | `w-lvw`           | `{ w: 'lvw' }`            |                                                                |
| **Viewport (DVW)** | `width: 100dvw`                          | `w-dvw`           | `{ w: 'dvw' }`            |                                                                |
| **Min Content**    | `width: min-content`                     | `w-min`           | `{ w: 'min' }`            |                                                                |
| **Max Content**    | `width: max-content`                     | `w-max`           | `{ w: 'max' }`            |                                                                |
| **Fit Content**    | `width: fit-content`                     | `w-fit`           | `{ w: 'fit' }`            |                                                                |
| **Auto**           | `width: auto`                            | `w-auto`          | `{ w: 'auto' }`           |                                                                |
| **Arbitrary**      | `width: 27px`                            | `w-[27px]`        | `{ w: '27px' }`           |                                                                |
| **CSS Variable**   | `width: var(--w)`                        | `w-(--w)`         | `{ w: '--w' }`            | **Sugar**: Auto-detects `--`.                                  |

## Min Width

Controlling the minimum width.

| Concept          | CSS Rule                                     | Tailwind v4 Class   | `sz` Prop (Object Syntax) | Note                                                           |
| :--------------- | :------------------------------------------- | :------------------ | :------------------------ | :------------------------------------------------------------- |
| **Spacing**      | `min-width: calc(var(--spacing) * <number>)` | `min-w-<number>`    | `{ minW: <number> }`      | v4: fully dynamic, accept any integer or 0.5-step decimal bare |
| **Px**           | `min-width: 1px`                             | `min-w-px`          | `{ minW: 'px' }`          |                                                                |
| **Fraction**     | `min-width: calc(<int>/<int> * 100%)`        | `min-w-<int>/<int>` | `{ minW: '<int>/<int>' }` | v4: any integer/integer fraction works bare                    |
| **Full**         | `min-width: 100%`                            | `min-w-full`        | `{ minW: 'full' }`        |                                                                |
| **Min Content**  | `min-width: min-content`                     | `min-w-min`         | `{ minW: 'min' }`         |                                                                |
| **Max Content**  | `min-width: max-content`                     | `min-w-max`         | `{ minW: 'max' }`         |                                                                |
| **Fit Content**  | `min-width: fit-content`                     | `min-w-fit`         | `{ minW: 'fit' }`         |                                                                |
| **Arbitrary**    | `min-width: 3px`                             | `min-w-[3px]`       | `{ minW: '3px' }`         |                                                                |
| **CSS Variable** | `min-width: var(--w)`                        | `min-w-(--w)`       | `{ minW: '--w' }`         | **Sugar**: Auto-detects `--`.                                  |

## Max Width

Controlling the maximum width.

| Concept          | CSS Rule                                     | Tailwind v4 Class   | `sz` Prop (Object Syntax) | Note                                                           |
| :--------------- | :------------------------------------------- | :------------------ | :------------------------ | :------------------------------------------------------------- |
| **Spacing**      | `max-width: calc(var(--spacing) * <number>)` | `max-w-<number>`    | `{ maxW: <number> }`      | v4: fully dynamic, accept any integer or 0.5-step decimal bare |
| **Px**           | `max-width: 1px`                             | `max-w-px`          | `{ maxW: 'px' }`          |                                                                |
| **Fraction**     | `max-width: calc(<int>/<int> * 100%)`        | `max-w-<int>/<int>` | `{ maxW: '<int>/<int>' }` | v4: any integer/integer fraction works bare                    |
| **Full**         | `max-width: 100%`                            | `max-w-full`        | `{ maxW: 'full' }`        |                                                                |
| **None**         | `max-width: none`                            | `max-w-none`        | `{ maxW: 'none' }`        |                                                                |
| **Prose**        | `max-width: 65ch`                            | `max-w-prose`       | `{ maxW: 'prose' }`       | Requires `@tailwindcss/typography`.                            |
| **Min Content**  | `max-width: min-content`                     | `max-w-min`         | `{ maxW: 'min' }`         |                                                                |
| **Max Content**  | `max-width: max-content`                     | `max-w-max`         | `{ maxW: 'max' }`         |                                                                |
| **Fit Content**  | `max-width: fit-content`                     | `max-w-fit`         | `{ maxW: 'fit' }`         |                                                                |
| **Arbitrary**    | `max-width: 3px`                             | `max-w-[3px]`       | `{ maxW: '3px' }`         |                                                                |
| **CSS Variable** | `max-width: var(--w)`                        | `max-w-(--w)`       | `{ maxW: '--w' }`         | **Sugar**: Auto-detects `--`.                                  |

### Breakpoints (xs-7xl)

| Concept | CSS Rule           | Tailwind v4 Class | `sz` Prop (Object Syntax) | Note |
| :------ | :----------------- | :---------------- | :------------------------ | :--- |
| **XS**  | `max-width: 20rem` | `max-w-xs`        | `{ maxW: 'xs' }`          |      |
| **SM**  | `max-width: 24rem` | `max-w-sm`        | `{ maxW: 'sm' }`          |      |
| **MD**  | `max-width: 28rem` | `max-w-md`        | `{ maxW: 'md' }`          |      |
| **LG**  | `max-width: 32rem` | `max-w-lg`        | `{ maxW: 'lg' }`          |      |
| **XL**  | `max-width: 36rem` | `max-w-xl`        | `{ maxW: 'xl' }`          |      |
| **2XL** | `max-width: 42rem` | `max-w-2xl`       | `{ maxW: '2xl' }`         |      |
| **3XL** | `max-width: 48rem` | `max-w-3xl`       | `{ maxW: '3xl' }`         |      |
| **4XL** | `max-width: 56rem` | `max-w-4xl`       | `{ maxW: '4xl' }`         |      |
| **5XL** | `max-width: 64rem` | `max-w-5xl`       | `{ maxW: '5xl' }`         |      |
| **6XL** | `max-width: 72rem` | `max-w-6xl`       | `{ maxW: '6xl' }`         |      |
| **7XL** | `max-width: 80rem` | `max-w-7xl`       | `{ maxW: '7xl' }`         |      |

### Screen Breakpoints

| Max Width Screen SM | `max-width: 640px` | `max-w-screen-sm` | `{ maxW: 'screen-sm' }` |
| Max Width Screen MD | `max-width: 768px` | `max-w-screen-md` | `{ maxW: 'screen-md' }` |
| Max Width Screen LG | `max-width: 1024px` | `max-w-screen-lg` | `{ maxW: 'screen-lg' }` |
| Max Width Screen XL | `max-width: 1280px` | `max-w-screen-xl` | `{ maxW: 'screen-xl' }` |
| Max Width Screen 2XL | `max-width: 1536px` | `max-w-screen-2xl` | `{ maxW: 'screen-2xl' }` |

## Height

Controlling the height.

| Concept            | CSS Rule                                  | Tailwind v4 Class | `sz` Prop (Object Syntax) | Note                                                           |
| :----------------- | :---------------------------------------- | :---------------- | :------------------------ | :------------------------------------------------------------- |
| **Spacing**        | `height: calc(var(--spacing) * <number>)` | `h-<number>`      | `{ h: <number> }`         | v4: fully dynamic, accept any integer or 0.5-step decimal bare |
| **Px**             | `height: 1px`                             | `h-px`            | `{ h: 'px' }`             |                                                                |
| **Fraction**       | `height: calc(<int>/<int> * 100%)`        | `h-<int>/<int>`   | `{ h: '<int>/<int>' }`    | v4: any integer/integer fraction works bare                    |
| **Full**           | `height: 100%`                            | `h-full`          | `{ h: 'full' }`           |                                                                |
| **Screen**         | `height: 100vh`                           | `h-screen`        | `{ h: 'screen' }`         |                                                                |
| **Viewport (SVH)** | `height: 100svh`                          | `h-svh`           | `{ h: 'svh' }`            |                                                                |
| **Viewport (LVH)** | `height: 100lvh`                          | `h-lvh`           | `{ h: 'lvh' }`            |                                                                |
| **Viewport (DVH)** | `height: 100dvh`                          | `h-dvh`           | `{ h: 'dvh' }`            |                                                                |
| **Min Content**    | `height: min-content`                     | `h-min`           | `{ h: 'min' }`            |                                                                |
| **Max Content**    | `height: max-content`                     | `h-max`           | `{ h: 'max' }`            |                                                                |
| **Fit Content**    | `height: fit-content`                     | `h-fit`           | `{ h: 'fit' }`            |                                                                |
| **Auto**           | `height: auto`                            | `h-auto`          | `{ h: 'auto' }`           |                                                                |
| **Arbitrary**      | `height: 3px`                             | `h-[3px]`         | `{ h: '3px' }`            |                                                                |
| **CSS Variable**   | `height: var(--h)`                        | `h-(--h)`         | `{ h: '--h' }`            | **Sugar**: Auto-detects `--`.                                  |

## Min Height

Controlling the minimum height.

| Concept            | CSS Rule                                      | Tailwind v4 Class   | `sz` Prop (Object Syntax) | Note                                                           |
| :----------------- | :-------------------------------------------- | :------------------ | :------------------------ | :------------------------------------------------------------- |
| **Spacing**        | `min-height: calc(var(--spacing) * <number>)` | `min-h-<number>`    | `{ minH: <number> }`      | v4: fully dynamic, accept any integer or 0.5-step decimal bare |
| **Px**             | `min-height: 1px`                             | `min-h-px`          | `{ minH: 'px' }`          |                                                                |
| **Fraction**       | `min-height: calc(<int>/<int> * 100%)`        | `min-h-<int>/<int>` | `{ minH: '<int>/<int>' }` | v4: any integer/integer fraction works bare                    |
| **Full**           | `min-height: 100%`                            | `min-h-full`        | `{ minH: 'full' }`        |                                                                |
| **Screen**         | `min-height: 100vh`                           | `min-h-screen`      | `{ minH: 'screen' }`      |                                                                |
| **Viewport (SVH)** | `min-height: 100svh`                          | `min-h-svh`         | `{ minH: 'svh' }`         |                                                                |
| **Viewport (LVH)** | `min-height: 100lvh`                          | `min-h-lvh`         | `{ minH: 'lvh' }`         |                                                                |
| **Viewport (DVH)** | `min-height: 100dvh`                          | `min-h-dvh`         | `{ minH: 'dvh' }`         |                                                                |
| **Min Content**    | `min-height: min-content`                     | `min-h-min`         | `{ minH: 'min' }`         |                                                                |
| **Max Content**    | `min-height: max-content`                     | `min-h-max`         | `{ minH: 'max' }`         |                                                                |
| **Fit Content**    | `min-height: fit-content`                     | `min-h-fit`         | `{ minH: 'fit' }`         |                                                                |
| **Arbitrary**      | `min-height: 3px`                             | `min-h-[3px]`       | `{ minH: '3px' }`         |                                                                |
| **CSS Variable**   | `min-height: var(--h)`                        | `min-h-(--h)`       | `{ minH: '--h' }`         | **Sugar**: Auto-detects `--`.                                  |

## Max Height

Controlling the maximum height.

| Concept            | CSS Rule                                      | Tailwind v4 Class   | `sz` Prop (Object Syntax) | Note                                                           |
| :----------------- | :-------------------------------------------- | :------------------ | :------------------------ | :------------------------------------------------------------- |
| **Spacing**        | `max-height: calc(var(--spacing) * <number>)` | `max-h-<number>`    | `{ maxH: <number> }`      | v4: fully dynamic, accept any integer or 0.5-step decimal bare |
| **Px**             | `max-height: 1px`                             | `max-h-px`          | `{ maxH: 'px' }`          |                                                                |
| **Fraction**       | `max-height: calc(<int>/<int> * 100%)`        | `max-h-<int>/<int>` | `{ maxH: '<int>/<int>' }` | v4: any integer/integer fraction works bare                    |
| **Full**           | `max-height: 100%`                            | `max-h-full`        | `{ maxH: 'full' }`        |                                                                |
| **Screen**         | `max-height: 100vh`                           | `max-h-screen`      | `{ maxH: 'screen' }`      |                                                                |
| **Viewport (SVH)** | `max-height: 100svh`                          | `max-h-svh`         | `{ maxH: 'svh' }`         |                                                                |
| **Viewport (LVH)** | `max-height: 100lvh`                          | `max-h-lvh`         | `{ maxH: 'lvh' }`         |                                                                |
| **Viewport (DVH)** | `max-height: 100dvh`                          | `max-h-dvh`         | `{ maxH: 'dvh' }`         |                                                                |
| **Min Content**    | `max-height: min-content`                     | `max-h-min`         | `{ maxH: 'min' }`         |                                                                |
| **Max Content**    | `max-height: max-content`                     | `max-h-max`         | `{ maxH: 'max' }`         |                                                                |
| **Fit Content**    | `max-height: fit-content`                     | `max-h-fit`         | `{ maxH: 'fit' }`         |                                                                |
| **Arbitrary**      | `max-height: 3px`                             | `max-h-[3px]`       | `{ maxH: '3px' }`         |                                                                |
| **CSS Variable**   | `max-height: var(--h)`                        | `max-h-(--h)`       | `{ maxH: '--h' }`         | **Sugar**: Auto-detects `--`.                                  |

## Size

Utilities for setting both the width and height of an element.

| Concept          | CSS Rule                                          | Tailwind v4 Class  | `sz` Prop (Object Syntax) | Note                                                           |
| :--------------- | :------------------------------------------------ | :----------------- | :------------------------ | :------------------------------------------------------------- |
| **Spacing**      | `width & height: calc(var(--spacing) * <number>)` | `size-<number>`    | `{ size: <number> }`      | v4: fully dynamic, accept any integer or 0.5-step decimal bare |
| **Px**           | `width & height: 1px`                             | `size-px`          | `{ size: 'px' }`          |                                                                |
| **Fraction**     | `width & height: calc(<int>/<int> * 100%)`        | `size-<int>/<int>` | `{ size: '<int>/<int>' }` | v4: any integer/integer fraction works bare                    |
| **Full**         | `width: 100%; height: 100%`                       | `size-full`        | `{ size: 'full' }`        |                                                                |
| **Min Content**  | `width: min-content; height: min-content`         | `size-min`         | `{ size: 'min' }`         |                                                                |
| **Max Content**  | `width: max-content; height: max-content`         | `size-max`         | `{ size: 'max' }`         |                                                                |
| **Fit Content**  | `width: fit-content; height: fit-content`         | `size-fit`         | `{ size: 'fit' }`         |                                                                |
| **Arbitrary**    | `width: 3px; height: 3px`                         | `size-[3px]`       | `{ size: '3px' }`         |                                                                |
| **CSS Variable** | `width: var(--s); height: var(--s)`               | `size-(--s)`       | `{ size: '--s' }`         | **Sugar**: Auto-detects `--`.                                  |

## Container

Component-like utility for fixing an element's width to the current breakpoint.

| Concept    | CSS Rule                                        | Tailwind v4 Class | `sz` Prop (Object Syntax) | Note                                                    |
| :--------- | :---------------------------------------------- | :---------------- | :------------------------ | :------------------------------------------------------ |
| **Enable** | `width: 100%; max-width: 100% (at breakpoints)` | `container`       | `{ container: true }`     | **Top-level prop**. Better DX than `maxW: 'container'`. |

## Typography Plugin (Prose)

Handling `@tailwindcss/typography` classes.

| Concept          | CSS Rule                          | Tailwind v4 Class | `sz` Prop (Object Syntax) | Note                                                                  |
| :--------------- | :-------------------------------- | :---------------- | :------------------------ | :-------------------------------------------------------------------- |
| **Enable Prose** | `color: inherit; max-width: 65ch` | `prose`           | `{ prose: true }`         | **Standard mapping**. Output class regardless of plugin installation. |
| **Size**         | `font-size: 1.125rem`             | `prose-lg`        | `{ prose: 'lg' }`         |                                                                       |
| **Invert**       | `--tw-prose-body: (varies)`       | `prose-invert`    | `{ proseInvert: true }`   |                                                                       |
| **Gray (Color)** | `--tw-prose-body: (varies)`       | `prose-gray`      | `{ prose: 'gray' }`       |                                                                       |
