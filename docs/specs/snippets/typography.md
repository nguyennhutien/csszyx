# Typography

Controlling the style, size, and layout of text.

## Font Family

Controlling the font family.

| Concept          | CSS Rule                                                                        | Tailwind v4 Class        | `sz` Prop (Object Syntax)     | Note                                                               |
| :--------------- | :------------------------------------------------------------------------------ | :----------------------- | :---------------------------- | :----------------------------------------------------------------- |
| **Sans**         | `font-family: ui-sans-serif, system-ui, sans-serif`                             | `font-sans`              | `{ fontFamily: 'sans' }`      | **Preferred key**.                                                 |
| **Serif**        | `font-family: ui-serif, Georgia, Cambria, "Times New Roman", Times, serif`      | `font-serif`             | `{ fontFamily: 'serif' }`     |                                                                    |
| **Mono**         | `font-family: ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, monospace` | `font-mono`              | `{ fontFamily: 'mono' }`      |                                                                    |
| **Arbitrary**    | `font-family: "My Font"`                                                        | `font-['My_Font']`       | `{ fontFamily: "'My Font'" }` |                                                                    |
| **CSS Variable** | `font-family: var(--f)`                                                         | `font-(family-name:--f)` | `{ fontFamily: '--f' }`       | **Sugar**: Auto-detects `--`. Type hint disambiguates from weight. |

## Font Size

Controlling the font size.

| Concept          | CSS Rule                                    | Tailwind v4 Class                                                                                                                                       | `sz` Prop (Object Syntax)               | Note                                                              |
| :--------------- | :------------------------------------------ | :------------------------------------------------------------------------------------------------------------------------------------------------------ | :-------------------------------------- | :---------------------------------------------------------------- |
| **Scale**        | `font-size: (size); line-height: (leading)` | `text-xs`, `text-sm`, `text-base`, `text-lg`, `text-xl`, `text-2xl`, `text-3xl`, `text-4xl`, `text-5xl`, `text-6xl`, `text-7xl`, `text-8xl`, `text-9xl` | `{ text: 'xs' }`, `{ text: 'sm' }` etc. | Sets size & leading.                                              |
| **Number**       | `font-size: 16px`                           | `text-[16px]`                                                                                                                                           | `{ text: '16px' }`                      | CamelCase `fontSize` also valid.                                  |
| **Arbitrary**    | `font-size: 1.5rem`                         | `text-[1.5rem]`                                                                                                                                         | `{ text: '1.5rem' }`                    |                                                                   |
| **CSS Variable** | `font-size: var(--size)`                    | `text-(length:--size)`                                                                                                                                  | `{ text: '--size' }`                    | **Sugar**: Auto-detects `--`. Type hint disambiguates from color. |

## Font Weight

Controlling the font weight.

| Concept          | CSS Rule                | Tailwind v4 Class                                                                                                                        | `sz` Prop (Object Syntax)                                     | Note                                                               |
| :--------------- | :---------------------- | :--------------------------------------------------------------------------------------------------------------------------------------- | :------------------------------------------------------------ | :----------------------------------------------------------------- |
| **Keywords**     | `font-weight: 100-900`  | `font-thin`, `font-extralight`, `font-light`, `font-normal`, `font-medium`, `font-semibold`, `font-bold`, `font-extrabold`, `font-black` | `{ fontWeight: 'thin' }`, `{ fontWeight: 'extralight' }` etc. |                                                                    |
| **Number**       | `font-weight: 100-900`  | `font-100`, `font-200`, `font-300`, `font-400`, `font-500`, `font-600`, `font-700`, `font-800`, `font-900`                               | `{ fontWeight: 100 }`, `{ fontWeight: 200 }` etc.             | v4 shorthand.                                                      |
| **Alias**        | (Sugar)                 | `font-bold`                                                                                                                              | `{ weight: 'bold' }`                                          | Sugar for `fontWeight`.                                            |
| **Arbitrary**    | `font-weight: 550`      | `font-[550]`                                                                                                                             | `{ fontWeight: 550 }`                                         |                                                                    |
| **CSS Variable** | `font-weight: var(--w)` | `font-(weight:--w)`                                                                                                                      | `{ fontWeight: '--w' }`                                       | **Sugar**: Auto-detects `--`. Type hint disambiguates from family. |

## Font Stretch

Controlling the font width.

| Concept                | CSS Rule                 | Tailwind v4 Class     | `sz` Prop (Object Syntax) | Note |
| :--------------------- | :----------------------- | :-------------------- | :------------------------ | :--- |
| Font Stretch 50%       | `font-stretch: 50%`      | `font-stretch-50%`    | `{ fontStretch: '50%' }`  |      |
| Font Stretch 75%       | `font-stretch: 75%`      | `font-stretch-75%`    | `{ fontStretch: '75%' }`  |      |
| Font Stretch 100%      | `font-stretch: 100%`     | `font-stretch-100%`   | `{ fontStretch: '100%' }` |      |
| Font Stretch 125%      | `font-stretch: 125%`     | `font-stretch-125%`   | `{ fontStretch: '125%' }` |      |
| Font Stretch 150%      | `font-stretch: 150%`     | `font-stretch-150%`   | `{ fontStretch: '150%' }` |      |
| Font Stretch Arbitrary | `font-stretch: 110%`     | `font-stretch-[110%]` | `{ fontStretch: '110%' }` |      |
| CSS Variable           | `font-stretch: var(--s)` | `font-stretch-(--s)`  | `{ fontStretch: '--s' }`  |      |

## Font Variant Numeric

Controlling numeric glyphs.

| Concept     | CSS Rule                                      | Tailwind v4 Class                                                                                                                                        | `sz` Prop (Object Syntax)             | Note                          |
| :---------- | :-------------------------------------------- | :------------------------------------------------------------------------------------------------------------------------------------------------------- | :------------------------------------ | :---------------------------- |
| **Variant** | `font-variant-numeric: ordinal, slashed-zero` | `normal-nums`, `ordinal`, `slashed-zero`, `lining-nums`, `oldstyle-nums`, `proportional-nums`, `tabular-nums`, `diagonal-fractions`, `stacked-fractions` | `{ fontVariant: 'normal-nums' }` etc. |                               |
| **Boolean** | `font-variant-numeric: slashed-zero`          | `slashed-zero`                                                                                                                                           | `{ slashedZero: true }`               | **Overwrites** `fontVariant`. |
| **Boolean** | `font-variant-numeric: ordinal`               | `ordinal`                                                                                                                                                | `{ ordinal: true }`                   | **Overwrites** `fontVariant`. |

## Font Features

Controlling font-feature-settings. Added in Tailwind v4.2.

| Concept       | CSS Rule                          | Tailwind v4 Class          | `sz` Prop (Object Syntax)      | Note |
| :------------ | :-------------------------------- | :------------------------- | :----------------------------- | :--- |
| **Normal**    | `font-feature-settings: normal`   | `font-features-normal`     | `{ fontFeatures: 'normal' }`   |      |
| **Arbitrary** | `font-feature-settings: "liga" 1` | `font-features-["liga"_1]` | `{ fontFeatures: '"liga" 1' }` |      |

## Font Style & Smoothing

Controlling the font style and smoothing.

| Concept         | CSS Rule                              | Tailwind v4 Class      | `sz` Prop (Object Syntax)        | Note                         |
| :-------------- | :------------------------------------ | :--------------------- | :------------------------------- | :--------------------------- |
| **Italic**      | `font-style: italic`                  | `italic`               | `{ fontStyle: 'italic' }`        |                              |
| **Not Italic**  | `font-style: normal`                  | `not-italic`           | `{ fontStyle: 'normal' }`        | Resets to upright.           |
| **Antialiased** | `-webkit-font-smoothing: antialiased` | `antialiased`          | `{ fontSmoothing: 'grayscale' }` | Grayscale antialiasing.      |
| **Subpixel**    | `-webkit-font-smoothing: auto`        | `subpixel-antialiased` | `{ fontSmoothing: 'subpixel' }`  | Subpixel (RGB) antialiasing. |

## Letter Spacing (Tracking)

Controlling the tracking (letter spacing).

| Concept          | CSS Rule                   | Tailwind v4 Class  | `sz` Prop (Object Syntax) | Note |
| :--------------- | :------------------------- | :----------------- | :------------------------ | :--- |
| Tracking Tighter | `-0.05em`                  | `tracking-tighter` | `{ tracking: 'tighter' }` |      |
| Tracking Tight   | `-0.025em`                 | `tracking-tight`   | `{ tracking: 'tight' }`   |      |
| Tracking Normal  | `0em`                      | `tracking-normal`  | `{ tracking: 'normal' }`  |      |
| Tracking Wide    | `0.025em`                  | `tracking-wide`    | `{ tracking: 'wide' }`    |      |
| Tracking Wider   | `0.05em`                   | `tracking-wider`   | `{ tracking: 'wider' }`   |      |
| Tracking Widest  | `0.1em`                    | `tracking-widest`  | `{ tracking: 'widest' }`  |      |
| Arbitrary        | `letter-spacing: .25em`    | `tracking-[.25em]` | `{ tracking: '.25em' }`   |      |
| CSS Variable     | `letter-spacing: var(--t)` | `tracking-(--t)`   | `{ tracking: '--t' }`     |      |

## Line Height (Leading)

Controlling the leading (line height).

| Concept          | CSS Rule                   | Tailwind v4 Class                                                                                       | `sz` Prop (Object Syntax)  | Note                          |
| :--------------- | :------------------------- | :------------------------------------------------------------------------------------------------------ | :------------------------- | :---------------------------- |
| **Keywords**     | `line-height: 1.5`         | `leading-none`, `leading-tight`, `leading-snug`, `leading-normal`, `leading-relaxed`, `leading-loose`   | `{ leading: 'none' }` etc. |                               |
| **Fixed**        | `line-height: .75rem`(etc) | `leading-3`, `leading-4`, `leading-5`, `leading-6`, `leading-7`, `leading-8`, `leading-9`, `leading-10` | `{ leading: 3 }` etc.      | Maps to spacing scale.        |
| **Arbitrary**    | `line-height: 3rem`        | `leading-[3rem]`                                                                                        | `{ leading: '3rem' }`      |                               |
| **CSS Variable** | `line-height: var(--l)`    | `leading-(--l)`                                                                                         | `{ leading: '--l' }`       | **Sugar**: Auto-detects `--`. |

### Text/Leading Shorthand

When both `text` (font-size) and `leading` (line-height) are specified together, they are automatically merged into a single Tailwind class using the `/` shorthand syntax.

| Input                               | Output             | Note                                     |
| :---------------------------------- | :----------------- | :--------------------------------------- |
| `{ text: 'lg', leading: 7 }`        | `text-lg/7`        | Numeric leading merged with text size.   |
| `{ text: 'sm', leading: 'tight' }`  | `text-sm/tight`    | Keyword leading merged with text size.   |
| `{ text: 'xl', leading: '1.5rem' }` | `text-xl/[1.5rem]` | Arbitrary leading merged with text size. |
| `{ text: 'lg' }`                    | `text-lg`          | No merge — `leading` not present.        |
| `{ leading: 7 }`                    | `leading-7`        | No merge — `text` not present.           |

## Text Align

Controlling the alignment of text.

| Concept   | CSS Rule                          | Tailwind v4 Class                                                                  | `sz` Prop (Object Syntax)    | Note |
| :-------- | :-------------------------------- | :--------------------------------------------------------------------------------- | :--------------------------- | :--- |
| **Align** | `text-align: left, center, right` | `text-left`, `text-center`, `text-right`, `text-justify`, `text-start`, `text-end` | `{ textAlign: 'left' }` etc. |      |

## Text Color

Controlling the text color.

| Concept               | CSS Rule          | Tailwind v4 Class                                                              | `sz` Prop (Object Syntax)                  | Note                                       |
| :-------------------- | :---------------- | :----------------------------------------------------------------------------- | :----------------------------------------- | :----------------------------------------- |
| **Keywords**          | `color: inherit`  | `text-inherit`, `text-current`, `text-transparent`, `text-black`, `text-white` | `{ color: 'inherit' }` etc.                |                                            |
| **Color**             | `color: (value)`  | `text-slate-50`(etc)`text-slate-950` (and full palette)                        | `{ color: 'slate-50' }` etc.               | Full color palette.                        |
| **Opacity**           | `color: (value)`  | `text-blue-500/50`                                                             | `{ color: { color: 'blue-500', op: 50 } }` |                                            |
| **CSS Var + Opacity** | `color: var(--c)` | `text-(--c)/50`                                                                | `{ color: { color: '--c', op: 50 } }`      | CSS variables are auto-wrapped in `(...)`. |
| **Arbitrary**         | `color: (value)`  | `text-[#50d71e]`                                                               | `{ color: '#50d71e' }`                     |                                            |
| **CSS Variable**      | `color: var(--c)` | `text-(--c)`                                                                   | `{ color: '--c' }`                         | **Sugar**: Auto-detects `--`.              |

## Text Decoration

Controlling the decoration of text.

| Concept           | CSS Rule                                       | Tailwind v4 Class                                                                                                                     | `sz` Prop (Object Syntax)           | Note                                                          |
| :---------------- | :--------------------------------------------- | :------------------------------------------------------------------------------------------------------------------------------------ | :---------------------------------- | :------------------------------------------------------------ |
| **Line (string)** | `text-decoration-line: underline`              | `underline`, `overline`, `line-through`, `no-underline`                                                                               | `{ decoration: 'underline' }` etc.  | String key. `'none'` → `no-underline` (resets ALL decoration) |
| **Style**         | `text-decoration-style: solid`                 | `decoration-solid`, `decoration-dashed`, `decoration-dotted`, `decoration-double`, `decoration-wavy`                                  | `{ decorationStyle: 'solid' }` etc. |                                                               |
| **Thickness**     | `text-decoration-thickness: auto`              | `decoration-0`, `decoration-1`, `decoration-2`, `decoration-4`, `decoration-8`, `decoration-auto`, `decoration-from-font`             | `{ decorationThickness: 1 }` etc.   |                                                               |
| **Offset**        | `text-underline-offset: auto`                  | `underline-offset-0`, `underline-offset-1`, `underline-offset-2`, `underline-offset-4`, `underline-offset-8`, `underline-offset-auto` | `{ underlineOffset: 1 }` etc.       |                                                               |
| **Color**         | `text-decoration-color: var(--color-blue-500)` | `decoration-blue-500`                                                                                                                 | `{ decorationColor: 'blue-500' }`   |                                                               |
| **Arbitrary**     | `text-decoration: (value)`                     | `decoration-[3px]`                                                                                                                    | `{ decorationThickness: '3px' }`    |                                                               |
| **Var**           | `text-decoration: (value)`                     | `decoration-(--v)`                                                                                                                    | `{ decorationThickness: '--v' }`    | **Sugar**: Auto-detects `--`.                                 |

## Text Transform

Controlling the capitalization of text.

| Concept       | CSS Rule                    | Tailwind v4 Class                                     | `sz` Prop (Object Syntax)                                                       | Note                   |
| :------------ | :-------------------------- | :---------------------------------------------------- | :------------------------------------------------------------------------------ | :--------------------- |
| **Transform** | `text-transform: uppercase` | `uppercase`, `lowercase`, `capitalize`, `normal-case` | `{ textTransform: 'uppercase' }` (also `'lowercase'`, `'capitalize'`, `'none'`) | `'none'` → normal-case |

## Text Overflow & Whitespace

Controlling text wrapping and overflow.

| Concept                 | CSS Rule                                       | Tailwind v4 Class                                                                                                                   | `sz` Prop (Object Syntax)                            | Note                                                                                                                       |
| :---------------------- | :--------------------------------------------- | :---------------------------------------------------------------------------------------------------------------------------------- | :--------------------------------------------------- | :------------------------------------------------------------------------------------------------------------------------- |
| **Overflow**            | `text-overflow: ellipsis`                      | `truncate`, `text-ellipsis`, `text-clip`                                                                                            | `{ textOverflow: 'ellipsis' }`(etc)                  |                                                                                                                            |
| **Wrap**                | `text-wrap: wrap`                              | `text-wrap`, `text-nowrap`, `text-balance`, `text-pretty`                                                                           | `{ textWrap: 'wrap' }`(etc)                          |                                                                                                                            |
| **Indent Spacing**      | `text-indent: calc(var(--spacing) * <number>)` | `indent-<number>`                                                                                                                   | `{ indent: <number> }`                               | v4: fully dynamic, accept any integer or 0.5-step decimal bare                                                             |
| **Indent Px**           | `text-indent: 1px`                             | `indent-px`                                                                                                                         | `{ indent: 'px' }`                                   |                                                                                                                            |
| **Indent Arbitrary**    | `text-indent: 50%`                             | `indent-[50%]`                                                                                                                      | `{ indent: '50%' }`                                  |                                                                                                                            |
| **Indent CSS Variable** | `text-indent: var(--i)`                        | `indent-(--i)`                                                                                                                      | `{ indent: '--i' }`                                  | **Sugar**: Auto-detects `--`.                                                                                              |
| **Vertical**            | `vertical-align: baseline`                     | `align-baseline`, `align-top`, `align-middle`, `align-bottom`, `align-text-top`, `align-text-bottom`, `align-sub`, `align-super`    | `{ align: 'middle' }`(etc)                           |                                                                                                                            |
| **Arbitrary Vertical**  | `vertical-align: (value)`                      | `align-[4px]`                                                                                                                       | `{ align: '4px' }`                                   |                                                                                                                            |
| **Var Vertical**        | `vertical-align: (value)`                      | `align-(--v)`                                                                                                                       | `{ align: '--v' }`                                   |                                                                                                                            |
| **Whitespace**          | `white-space: normal`                          | `whitespace-normal`, `whitespace-nowrap`, `whitespace-pre`, `whitespace-pre-line`, `whitespace-pre-wrap`, `whitespace-break-spaces` | `{ whitespace: 'normal' }`(etc)                      |                                                                                                                            |
| **Word Break**          | `word-break: break-all`                        | `break-normal`, `break-all`, `break-keep`                                                                                           | `{ break: 'all' }`                                   | v4.1: `break-words` moved to `wrap`                                                                                        |
| **Overflow Wrap**       | `overflow-wrap: anywhere`                      | `wrap-normal`, `wrap-break-word`, `wrap-anywhere`                                                                                   | `{ wrap: 'anywhere' }`                               | v4.1: new `wrap-*` prefix (was `break-*`)                                                                                  |
| **Hyphens**             | `hyphens: manual`                              | `hyphens-none`, `hyphens-manual`, `hyphens-auto`                                                                                    | `{ hyphens: 'auto' }`                                |                                                                                                                            |
| **Content**             | `content: none`                                | `content-none`                                                                                                                      | `{ content: 'none' }`                                |                                                                                                                            |
| **Content Empty**       | `content: ""`                                  | `content-['']`                                                                                                                      | `{ content: '""' }` or `{ content: "''" }`           | Compiler normalizes double-quote form `'""'` to single-quote output `content-['']`. Both JS forms produce identical class. |
| **Arbitrary Content**   | `content: (value)`                             | `content-['hello']`                                                                                                                 | `{ content: "'hello'" }` or `{ content: '"hello"' }` | Double-quote-wrapped values are normalized to single-quote brackets at compile time.                                       |
| **Var Content**         | `content: (value)`                             | `content-(--c)`                                                                                                                     | `{ content: '--c' }`                                 |                                                                                                                            |
| **Line Clamp**          | `line-clamp`                                   | `line-clamp-1`, `line-clamp-2`, `line-clamp-3`, `line-clamp-4`, `line-clamp-5`, `line-clamp-6`, `line-clamp-none`                   | `{ lineClamp: 1 }`(etc)                              |                                                                                                                            |
| **Arbitrary Clamp**     | `line-clamp`                                   | `line-clamp-[7]`                                                                                                                    | `{ lineClamp: 7 }`                                   |                                                                                                                            |
| **Var Clamp**           | `line-clamp`                                   | `line-clamp-(--c)`                                                                                                                  | `{ lineClamp: '--c' }`                               |                                                                                                                            |

## List Style

Controlling list styles.

| Concept            | CSS Rule                            | Tailwind v4 Class                        | `sz` Prop (Object Syntax)                                     | Note                          |
| :----------------- | :---------------------------------- | :--------------------------------------- | :------------------------------------------------------------ | :---------------------------- |
| **Type**           | `list-style-type: disc`             | `list-none`, `list-disc`, `list-decimal` | `{ list: 'none' }`, `{ list: 'disc' }`, `{ list: 'decimal' }` |                               |
| **Arbitrary Type** | `list-style-type: (value)`          | `list-[upper-roman]`                     | `{ list: 'upper-roman' }`                                     |                               |
| **Var Type**       | `list-style-type: var(--t)`         | `list-(--t)`                             | `{ list: '--t' }`                                             | **Sugar**: Auto-detects `--`. |
| **Position**       | `list-style-position: inside`       | `list-inside`, `list-outside`            | `{ listPos: 'inside' }`, `{ listPos: 'outside' }`             |                               |
| **Image**          | `list-style-image: none`            | `list-image-none`                        | `{ listImg: 'none' }`                                         |                               |
| **Arbitrary Img**  | `list-style-image: url('/img.png')` | `list-image-[url('/img.png')]`           | `{ listImg: "url('/img.png')" }`                              |                               |
| **Var Image**      | `list-style-image: var(--i)`        | `list-image-(--i)`                       | `{ listImg: '--i' }`                                          | **Sugar**: Auto-detects `--`. |
