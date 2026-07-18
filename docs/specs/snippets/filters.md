# Filters

Applying graphical effects like blur or color shifts.

## Filter

Utilities for controlling the overall filter property.

| Concept           | CSS Rule                 | Tailwind v4 Class      | `sz` Prop (Object Syntax)    | Note                               |
| :---------------- | :----------------------- | :--------------------- | :--------------------------- | :--------------------------------- |
| **Filter None**   | `filter: none;`          | `filter-none`          | `{ filter: 'none' }`         |                                    |
| **Filter Var**    | `filter: var(--c);`      | `filter-(--c)`         | `{ filter: '--c' }`          |                                    |
| **Filter Arb**    | `filter: blur(5px);`     | `filter-[blur(5px)]`   | `{ filter: 'blur(5px)' }`    |                                    |
| **Backdrop None** | `backdrop-filter: none;` | `backdrop-filter-none` | `{ backdropFilter: 'none' }` |                                    |
| **Defaults**      | `filter: blur(8px)`      | `blur`                 | `{ blur: true }`             | **Boolean**: Sets default effects. |

| Filter Item               | CSS Rule                                              | Tailwind v4 Class                                                            | `sz` Prop (Object Syntax)                                    | Note                                             |
| :------------------------ | :---------------------------------------------------- | :--------------------------------------------------------------------------- | :----------------------------------------------------------- | :----------------------------------------------- |
| **Blur Scale**            | `filter: blur(var(--blur-xs))` to `3xl`               | `blur-xs` to `blur-3xl`                                                      | `{ blur: 'xs' }` to `{ blur: '3xl' }`                        |                                                  |
| **Blur None**             | `filter: blur(0);`                                    | `blur-none`                                                                  | `{ blur: 'none' }`                                           |                                                  |
| **Blur Var**              | `filter: blur(var(--c))`                              | `blur-(--c)`                                                                 | `{ blur: '--c' }`                                            |                                                  |
| **Blur Arb**              | `filter: var(--c)`                                    | `blur-[4px]`                                                                 | `{ blur: '4px' }`                                            |                                                  |
| **Brightness**            | `filter: brightness(0%)` to `200%`                    | `brightness-0` to `brightness-200`                                           | `{ brightness: 0 }` to `{ brightness: 200 }`                 |                                                  |
| **Brightness Var**        | `filter: brightness(var(--c))`                        | `brightness-(--c)`                                                           | `{ brightness: '--c' }`                                      |                                                  |
| **Brightness Arb**        | `filter: brightness(1.25)`                            | `brightness-[1.25]`                                                          | `{ brightness: '1.25' }`                                     |                                                  |
| **Contrast**              | `filter: contrast(0%)` to `200%`                      | `contrast-0` to `contrast-200`                                               | `{ contrast: 0 }` to `{ contrast: 200 }`                     |                                                  |
| **Contrast Var**          | `filter: contrast(var(--c))`                          | `contrast-(--c)`                                                             | `{ contrast: '--c' }`                                        |                                                  |
| **Contrast Arb**          | `filter: contrast(1.5)`                               | `contrast-[1.5]`                                                             | `{ contrast: '1.5' }`                                        |                                                  |
| **Drop Shadow**           | `filter: drop-shadow(var(--drop-shadow-xs))` to `2xl` | `drop-shadow-xs` to `drop-shadow-2xl`                                        | `{ dropShadow: 'xs' }` to `{ dropShadow: '2xl' }`            |                                                  |
| **Drop Shadow None**      | `filter: drop-shadow(0 0 #0000)`                      | `drop-shadow-none`                                                           | `{ dropShadow: 'none' }`                                     |                                                  |
| **Drop Shadow Size + Op** | `filter: drop-shadow((size) / 12.5%)`                 | `drop-shadow-sm/12.5`                                                        | `{ dropShadow: 'sm/12.5' }`                                  | **TW 4.3.3**: fractional opacity on named sizes. |
| **Drop Shadow Var**       | `filter: drop-shadow(var(--c))`                       | `drop-shadow-(--c)`                                                          | `{ dropShadow: '--c' }`                                      |                                                  |
| **Drop Shadow Arb**       | `filter: drop-shadow(0 25px 25px rgb(0 0 0/0.15))`    | `drop-shadow-[0_25px_25px_rgb(0_0_0/0.15)]`                                  | `{ dropShadow: '0 25px 25px rgb(0 0 0/0.15)' }`              | Spaces auto-encoded to `_`.                      |
| **Drop Shadow + Variant** | (hover state)                                         | `hover:drop-shadow-[0_0_15px_rgba(45,213,151,0.5)]`                          | `{ hover: { dropShadow: '0 0 15px rgba(45,213,151,0.5)' } }` | Works in any variant context.                    |
| **Drop Shadow Color**     | `--tw-drop-shadow-color: (etc)`                       | `drop-shadow-slate-500`, `drop-shadow-red-500`, `drop-shadow-blue-500`, etc. | `{ dropShadowColor: 'red-500' }`                             | Full palette support.                            |
| **Drop Shadow Var Col**   | `--tw-drop-shadow-color: var(--c)`                    | `drop-shadow-(color:--c)`                                                    | `{ dropShadowColor: '--c' }`                                 | **New in v4**.                                   |
| **Grayscale**             | `filter: grayscale(100%)`                             | `grayscale`                                                                  | `{ grayscale: true }`                                        |                                                  |
| **Grayscale Scale**       | `filter: grayscale(0%)` to `100%`                     | `grayscale-0` to `grayscale-100`                                             | `{ grayscale: 0 }` to `{ grayscale: 100 }`                   |                                                  |
| **Grayscale Var**         | `filter: grayscale(var(--c))`                         | `grayscale-(--c)`                                                            | `{ grayscale: '--c' }`                                       |                                                  |
| **Grayscale Arb**         | `filter: grayscale(50%)`                              | `grayscale-[50%]`                                                            | `{ grayscale: '50%' }`                                       |                                                  |
| **Hue Rotate**            | `filter: hue-rotate(0deg)` to `180deg`                | `hue-rotate-0` to `hue-rotate-180`                                           | `{ hueRotate: 0 }` to `{ hueRotate: 180 }`                   |                                                  |
| **Hue Rotate Neg**        | `filter: hue-rotate(calc(ndeg * -1))`                 | `-hue-rotate-15`                                                             | `{ hueRotate: -15 }`                                         |                                                  |
| **Hue Rotate Var**        | `filter: hue-rotate(var(--c))`                        | `hue-rotate-(--c)`                                                           | `{ hueRotate: '--c' }`                                       |                                                  |
| **Hue Rotate Arb**        | `filter: hue-rotate(90deg)`                           | `hue-rotate-[90deg]`                                                         | `{ hueRotate: '90deg' }`                                     |                                                  |
| **Invert**                | `filter: invert(100%)`                                | `invert`                                                                     | `{ invert: true }`                                           |                                                  |
| **Invert Scale**          | `filter: invert(0%)` to `100%`                        | `invert-0` to `invert-100`                                                   | `{ invert: 0 }` to `{ invert: 100 }`                         |                                                  |
| **Invert Var**            | `filter: invert(var(--c))`                            | `invert-(--c)`                                                               | `{ invert: '--c' }`                                          |                                                  |
| **Invert Arb**            | `filter: invert(25%)`                                 | `invert-[25%]`                                                               | `{ invert: '25%' }`                                          |                                                  |
| **Saturate**              | `filter: saturate(0%)` to `200%`                      | `saturate-0` to `saturate-200`                                               | `{ saturate: 0 }` to `{ saturate: 200 }`                     |                                                  |
| **Saturate Var**          | `filter: saturate(var(--c))`                          | `saturate-(--c)`                                                             | `{ saturate: '--c' }`                                        |                                                  |
| **Saturate Arb**          | `filter: saturate(1.5)`                               | `saturate-[1.5]`                                                             | `{ saturate: '1.5' }`                                        |                                                  |
| **Sepia**                 | `filter: sepia(100%)`                                 | `sepia`                                                                      | `{ sepia: true }`                                            |                                                  |
| **Sepia Scale**           | `filter: sepia(0%)` to `100%`                         | `sepia-0` to `sepia-100`                                                     | `{ sepia: 0 }` to `{ sepia: 100 }`                           |                                                  |
| **Sepia Var**             | `filter: sepia(var(--c))`                             | `sepia-(--c)`                                                                | `{ sepia: '--c' }`                                           |                                                  |
| **Sepia Arb**             | `filter: sepia(50%)`                                  | `sepia-[50%]`                                                                | `{ sepia: '50%' }`                                           |                                                  |

## Backdrop Filter

Utilities for controlling the backdrop-filter property.

| Concept       | CSS Rule                      | Tailwind v4 Class             | `sz` Prop (Object Syntax)         | Note |
| :------------ | :---------------------------- | :---------------------------- | :-------------------------------- | :--- |
| **None**      | `backdrop-filter: none;`      | `backdrop-filter-none`        | `{ backdropFilter: 'none' }`      |      |
| **Variable**  | `backdrop-filter: var(--c);`  | `backdrop-filter-(--c)`       | `{ backdropFilter: '--c' }`       |      |
| **Arbitrary** | `backdrop-filter: blur(5px);` | `backdrop-filter-[blur(5px)]` | `{ backdropFilter: 'blur(5px)' }` |      |

| Filter Item         | CSS Rule                                        | Tailwind v4 Class                | `sz` Prop (Object Syntax)            | Note |
| :------------------ | :---------------------------------------------- | :------------------------------- | :----------------------------------- | :--- |
| **Blur Scale**      | `backdrop-filter: blur(var(--b))`               | `backdrop-blur-xs` to `3xl`      | `{ backdropBlur: 'xs' }` to `3xl`    |      |
| **Blur None**       | `backdrop-filter: blur(0);`                     | `backdrop-blur-none`             | `{ backdropBlur: 'none' }`           |      |
| **Blur Var**        | `backdrop-filter: blur(var(--c))`               | `backdrop-blur-(--c)`            | `{ backdropBlur: '--c' }`            |      |
| **Blur Arb**        | `backdrop-filter: var(--c)`                     | `backdrop-blur-[4px]`            | `{ backdropBlur: '4px' }`            |      |
| **Brightness**      | `backdrop-filter: brightness(0%)` to `200%`     | `backdrop-brightness-0` to `200` | `{ backdropBrightness: 0 }` to `200` |      |
| **Brightness Var**  | `backdrop-filter: var(--c)`                     | `backdrop-brightness-(--c)`      | `{ backdropBrightness: '--c' }`      |      |
| **Brightness Arb**  | `backdrop-filter: brightness(1.25)`             | `backdrop-brightness-[1.25]`     | `{ backdropBrightness: '1.25' }`     |      |
| **Contrast**        | `backdrop-filter: contrast(0%)` to `200%`       | `backdrop-contrast-0` to `200`   | `{ backdropContrast: 0 }` to `200`   |      |
| **Contrast Var**    | `backdrop-filter: var(--c)`                     | `backdrop-contrast-(--c)`        | `{ backdropContrast: '--c' }`        |      |
| **Contrast Arb**    | `backdrop-filter: contrast(1.5)`                | `backdrop-contrast-[1.5]`        | `{ backdropContrast: '1.5' }`        |      |
| **Grayscale**       | `backdrop-filter: grayscale(100%)`              | `backdrop-grayscale`             | `{ backdropGrayscale: true }`        |      |
| **Grayscale Scale** | `backdrop-filter: grayscale(0%)` to `100%`      | `backdrop-grayscale-0` to `100`  | `{ backdropGrayscale: 0 }` to `100`  |      |
| **Grayscale Var**   | `backdrop-filter: var(--c)`                     | `backdrop-grayscale-(--c)`       | `{ backdropGrayscale: '--c' }`       |      |
| **Grayscale Arb**   | `backdrop-filter: grayscale(50%)`               | `backdrop-grayscale-[50%]`       | `{ backdropGrayscale: '50%' }`       |      |
| **Hue Rotate**      | `backdrop-filter: hue-rotate(0deg)` to `180deg` | `backdrop-hue-rotate-0` to `180` | `{ backdropHueRotate: 0 }` to `180`  |      |
| **Hue Rotate Neg**  | `backdrop-filter: var(--c)`                     | `-backdrop-hue-rotate-15`        | `{ backdropHueRotate: -15 }`         |      |
| **Hue Rotate Var**  | `backdrop-filter: var(--c)`                     | `backdrop-hue-rotate-(--c)`      | `{ backdropHueRotate: '--c' }`       |      |
| **Hue Rotate Arb**  | `backdrop-filter: hue-rotate(90deg)`            | `backdrop-hue-rotate-[90deg]`    | `{ backdropHueRotate: '90deg' }`     |      |
| **Invert**          | `backdrop-filter: invert(100%)`                 | `backdrop-invert`                | `{ backdropInvert: true }`           |      |
| **Invert Scale**    | `backdrop-filter: invert(0%)` to `100%`         | `backdrop-invert-0` to `100`     | `{ backdropInvert: 0 }` to `100`     |      |
| **Invert Var**      | `backdrop-filter: var(--c)`                     | `backdrop-invert-(--c)`          | `{ backdropInvert: '--c' }`          |      |
| **Invert Arb**      | `backdrop-filter: invert(25%)`                  | `backdrop-invert-[25%]`          | `{ backdropInvert: '25%' }`          |      |
| **Opacity**         | `backdrop-filter: opacity(0%)` to `100%`        | `backdrop-opacity-0` to `100`    | `{ backdropOpacity: 0 }` to `100`    |      |
| **Opacity Var**     | `backdrop-filter: var(--c)`                     | `backdrop-opacity-(--c)`         | `{ backdropOpacity: '--c' }`         |      |
| **Opacity Arb**     | `backdrop-filter: opacity(75%)`                 | `backdrop-opacity-[75%]`         | `{ backdropOpacity: '75%' }`         |      |
| **Saturate**        | `backdrop-filter: saturate(0%)` to `200%`       | `backdrop-saturate-0` to `200`   | `{ backdropSaturate: 0 }` to `200`   |      |
| **Saturate Var**    | `backdrop-filter: var(--c)`                     | `backdrop-saturate-(--c)`        | `{ backdropSaturate: '--c' }`        |      |
| **Saturate Arb**    | `backdrop-filter: saturate(1.5)`                | `backdrop-saturate-[1.5]`        | `{ backdropSaturate: '1.5' }`        |      |
| **Sepia**           | `backdrop-filter: sepia(100%)`                  | `backdrop-sepia`                 | `{ backdropSepia: true }`            |      |
| **Sepia Scale**     | `backdrop-filter: sepia(0%)` to `100%`          | `backdrop-sepia-0` to `100`      | `{ backdropSepia: 0 }` to `100`      |      |
| **Sepia Var**       | `backdrop-filter: var(--c)`                     | `backdrop-sepia-(--c)`           | `{ backdropSepia: '--c' }`           |      |
| **Sepia Arb**       | `backdrop-filter: sepia(50%)`                   | `backdrop-sepia-[50%]`           | `{ backdropSepia: '50%' }`           |      |
