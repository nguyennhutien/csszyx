# Backgrounds

Controlling the background of an element.

## Background Color

| Concept               | CSS Rule                                  | Tailwind v4 Class    | `sz` Prop (Object Syntax)                  | Note                                             |
| :-------------------- | :---------------------------------------- | :------------------- | :----------------------------------------- | :----------------------------------------------- |
| **Color**             | `background-color: ...`                   | `bg-blue-500`        | `{ bg: 'blue-500' }`                       |                                                  |
| **Inherit**           | `background-color: inherit`               | `bg-inherit`         | `{ bg: 'inherit' }`                        |                                                  |
| **Current**           | `background-color: currentColor`          | `bg-current`         | `{ bg: 'current' }`                        |                                                  |
| **Transparent**       | `background-color: transparent`           | `bg-transparent`     | `{ bg: 'transparent' }`                    |                                                  |
| **Arbitrary**         | `background-color: #333`                  | `bg-[#333]`          | `{ bg: '#333' }`                           |                                                  |
| **CSS Variable**      | `background-color: var(--my-color)`       | `bg-(--my-color)`    | `{ bg: '--my-color' }`                     | **Sugar**: Auto-detects `--`.                    |
| **With Opacity**      | `background-color: rgb(59 130 246 / 20%)` | `bg-blue-500/20`     | `{ bg: { color: 'blue-500', op: 20 } }`    | String slash (`'blue-500/20'`) is not supported. |
| **CSS Var + Opacity** | `background-color: var(--c) / 50%`        | `bg-(--my-color)/50` | `{ bg: { color: '--my-color', op: 50 } }`  | CSS variables are auto-wrapped in `(...)`.       |
| **Hex + Opacity**     | `background-color: #0d0d12` at 90%        | `bg-[#0d0d12]/90`    | `{ bg: { color: '#0d0d12', op: 90 } }`     | Hex/rgb/hsl values are auto-wrapped in `[...]`.  |
| **Decimal Opacity**   | `background-color: black / 5%`            | `bg-black/[0.05]`    | `{ bg: { color: 'black', op: 0.05 } }`     | Non-half-step decimals use arbitrary `/[0.05]`.  |
| **Percent Opacity**   | `background-color: pink-500 / 78%`        | `bg-pink-500/[78%]`  | `{ bg: { color: 'pink-500', op: '78%' } }` | String with `%` stays arbitrary.                 |

## Background Image

### String Patterns (Simple Cases)

| Concept              | CSS Rule                                           | Tailwind v4 Class                     | `sz` Prop (Object Syntax)                                                                                      | Note                               |
| :------------------- | :------------------------------------------------- | :------------------------------------ | :------------------------------------------------------------------------------------------------------------- | :--------------------------------- |
| **URL**              | `background-image: url(...)`                       | `bg-[url(...)]`                       | `{ bgImg: 'url(...)' }`                                                                                        |                                    |
| **None**             | `background-image: none`                           | `bg-none`                             | `{ bgImg: 'none' }`                                                                                            |                                    |
| **CSS Variable**     | `background-image: var(--my-image)`                | `bg-(image:--my-image)`               | `{ bgImg: '--my-image' }`                                                                                      | **Sugar**: Auto-detects `--`.      |
| **Repeating Linear** | `background-image: repeating-linear-gradient(...)` | `bg-[repeating-linear-gradient(...)]` | `{ bgImg: 'repeating-linear-gradient(315deg,currentColor 0,currentColor 1px,transparent 0,transparent 50%)' }` | Spaces normalised to `_` in class. |
| **Repeating Radial** | `background-image: repeating-radial-gradient(...)` | `bg-[repeating-radial-gradient(...)]` | `{ bgImg: 'repeating-radial-gradient(circle, red 0, blue 10px)' }`                                             |                                    |

### Object Patterns (Gradients)

**TypeScript Interface:**

```typescript
type BgImgValue = string | BgImgGradient;
type BgImgGradient = {
  gradient: "linear" | "radial" | "conic";
  dir?: string | number; // OPTIONAL
  in?: ColorInterpolation;
};
type ColorInterpolation =
  | "srgb"
  | "hsl"
  | "oklab"
  | "oklch"
  | "longer"
  | "shorter"
  | "increasing"
  | "decreasing";
```

#### Linear Gradient

| Concept                | CSS Rule                                 | Tailwind v4 Class              | `sz` Prop (Object Syntax)                                    | Note                                                      |
| :--------------------- | :--------------------------------------- | :----------------------------- | :----------------------------------------------------------- | :-------------------------------------------------------- |
| **Default**            | `linear-gradient(to right, ...)`         | `bg-linear-to-r`               | `{ bgImg: { gradient: 'linear' } }`                          | Default: `dir='to-r'`                                     |
| **Direction Keyword**  | `linear-gradient(to right, ...)`         | `bg-linear-to-r`               | `{ bgImg: { gradient: 'linear', dir: 'to-r' } }`             | All 8: to-t, to-tr, to-r, to-br, to-b, to-bl, to-l, to-tl |
| **Positive Angle**     | `linear-gradient(<number>deg, ...)`      | `bg-linear-<number>`           | `{ bgImg: { gradient: 'linear', dir: <number> } }`           | v4: any integer bare                                      |
| **Negative Angle**     | `linear-gradient(-<number>deg, ...)`     | `-bg-linear-<number>`          | `{ bgImg: { gradient: 'linear', dir: -<number> } }`          | v4: any integer bare                                      |
| **Arbitrary**          | `linear-gradient(25deg, red 5%...)`      | `bg-linear-[25deg,_red_5%...]` | `{ bgImg: { gradient: 'linear', dir: '25deg, red 5%...' } }` |                                                           |
| **CSS Variable**       | `linear-gradient(var(--my-gradient))`    | `bg-linear-(--var)`            | `{ bgImg: { gradient: 'linear', dir: '--var' } }`            | **Sugar**: Auto-detects `--`.                             |
| **With Interpolation** | `linear-gradient(in hsl, to right, ...)` | `bg-linear-to-r/hsl`           | `{ bgImg: { gradient: 'linear', dir: 'to-r', in: 'hsl' } }`  | Appends `/method` suffix                                  |

#### Radial Gradient

| Concept                | CSS Rule                            | Tailwind v4 Class        | `sz` Prop (Object Syntax)                              | Note                           |
| :--------------------- | :---------------------------------- | :----------------------- | :----------------------------------------------------- | :----------------------------- |
| **Default**            | `radial-gradient(...)`              | `bg-radial`              | `{ bgImg: { gradient: 'radial' } }`                    | `dir` optional, default center |
| **Position**           | `radial-gradient(at 50% 75%, ...)`  | `bg-radial-[at_50%_75%]` | `{ bgImg: { gradient: 'radial', dir: 'at 50% 75%' } }` |                                |
| **CSS Variable**       | `radial-gradient(var(--my-radial))` | `bg-radial-(--var)`      | `{ bgImg: { gradient: 'radial', dir: '--var' } }`      | **Sugar**: Auto-detects `--`.  |
| **With Interpolation** | `radial-gradient(in oklab, ...)`    | `bg-radial/oklab`        | `{ bgImg: { gradient: 'radial', in: 'oklab' } }`       | Appends `/method` suffix       |

#### Conic Gradient

| Concept            | CSS Rule                                  | Tailwind v4 Class                          | `sz` Prop (Object Syntax)                                                | Note                          |
| :----------------- | :---------------------------------------- | :----------------------------------------- | :----------------------------------------------------------------------- | :---------------------------- |
| **Default**        | `conic-gradient(...)`                     | `bg-conic`                                 | `{ bgImg: { gradient: 'conic' } }`                                       | No dir → `bg-conic`           |
| **Positive Angle** | `conic-gradient(from <number>deg, ...)`   | `bg-conic-<number>`                        | `{ bgImg: { gradient: 'conic', dir: <number> } }`                        | v4: any integer bare          |
| **Negative Angle** | `conic-gradient(from -<number>deg, ...)`  | `-bg-conic-<number>`                       | `{ bgImg: { gradient: 'conic', dir: -<number> } }`                       | v4: any integer bare          |
| **Arbitrary**      | `conic-gradient(in hsl shorter hue, ...)` | `bg-conic-[in_hsl_shorter_hue,_red,_blue]` | `{ bgImg: { gradient: 'conic', dir: 'in hsl shorter hue, red, blue' } }` |                               |
| **CSS Variable**   | `conic-gradient(var(--my-conic))`         | `bg-conic-(--var)`                         | `{ bgImg: { gradient: 'conic', dir: '--var' } }`                         | **Sugar**: Auto-detects `--`. |

### Color Interpolation (`in` key)

Appends `/method` suffix to gradient class:

| `in` value   | Suffix        | Example Output              |
| :----------- | :------------ | :-------------------------- |
| `srgb`       | `/srgb`       | `bg-linear-to-r/srgb`       |
| `hsl`        | `/hsl`        | `bg-linear-to-r/hsl`        |
| `oklab`      | `/oklab`      | `bg-linear-to-r/oklab`      |
| `oklch`      | `/oklch`      | `bg-linear-to-r/oklch`      |
| `longer`     | `/longer`     | `bg-linear-to-r/longer`     |
| `shorter`    | `/shorter`    | `bg-linear-to-r/shorter`    |
| `increasing` | `/increasing` | `bg-linear-to-r/increasing` |
| `decreasing` | `/decreasing` | `bg-linear-to-r/decreasing` |

## Gradient Color Stops

| Concept                        | CSS Rule                  | Tailwind v4 Class   | `sz` Prop (Object Syntax)   | Note                                                        |
| :----------------------------- | :------------------------ | :------------------ | :-------------------------- | :---------------------------------------------------------- |
| **From**                       | `--tw-gradient-from: ...` | `from-blue-500`     | `{ from: 'blue-500' }`      |                                                             |
| **Via**                        | `--tw-gradient-via: ...`  | `via-blue-500`      | `{ via: 'blue-500' }`       |                                                             |
| **To**                         | `--tw-gradient-to: ...`   | `to-blue-500`       | `{ to: 'blue-500' }`        |                                                             |
| **From Position**              | `... <number>%`           | `from-<number>%`    | `{ fromPos: <number> }`     | v4: fully dynamic, no static scale, accept any integer bare |
| **From Position Arbitrary**    | `... <decimal>%`          | `from-[<decimal>%]` | `{ fromPos: <decimal> }`    |                                                             |
| **From Position Arbitrary**    | `... 300px`               | `from-[300px]`      | `{ fromPos: '300px' }`      |                                                             |
| **From Position CSS Variable** | `... var(--from-pos)`     | `from-(--from-pos)` | `{ fromPos: '--from-pos' }` | **Sugar**: Auto-detects `--`.                               |
| **Via Position**               | `... <number>%`           | `via-<number>%`     | `{ viaPos: <number> }`      | v4: fully dynamic, no static scale, accept any integer bare |
| **Via Position Arbitrary**     | `... <decimal>%`          | `via-[<decimal>%]`  | `{ viaPos: <decimal> }`     |                                                             |
| **Via Position Arbitrary**     | `... 300px`               | `via-[300px]`       | `{ viaPos: '300px' }`       |                                                             |
| **Via Position CSS Variable**  | `... var(--via-pos)`      | `via-(--via-pos)`   | `{ viaPos: '--via-pos' }`   | **Sugar**: Auto-detects `--`.                               |
| **To Position**                | `... <number>%`           | `to-<number>%`      | `{ toPos: <number> }`       | v4: fully dynamic, no static scale, accept any integer bare |
| **To Position Arbitrary**      | `... <decimal>%`          | `to-[<decimal>%]`   | `{ toPos: <decimal> }`      |                                                             |
| **To Position Arbitrary**      | `... 300px`               | `to-[300px]`        | `{ toPos: '300px' }`        |                                                             |
| **To Position CSS Variable**   | `... var(--to-pos)`       | `to-(--to-pos)`     | `{ toPos: '--to-pos' }`     | **Sugar**: Auto-detects `--`.                               |

## Background Position

| Concept          | CSS Rule                               | Tailwind v4 Class      | `sz` Prop (Object Syntax)      | Note                          |
| :--------------- | :------------------------------------- | :--------------------- | :----------------------------- | :---------------------------- |
| **Top Left**     | `background-position: top left`        | `bg-top-left`          | `{ bgPos: 'top-left' }`        |                               |
| **Top**          | `background-position: top`             | `bg-top`               | `{ bgPos: 'top' }`             |                               |
| **Top Right**    | `background-position: top right`       | `bg-top-right`         | `{ bgPos: 'top-right' }`       |                               |
| **Left**         | `background-position: left`            | `bg-left`              | `{ bgPos: 'left' }`            |                               |
| **Center**       | `background-position: center`          | `bg-center`            | `{ bgPos: 'center' }`          |                               |
| **Right**        | `background-position: right`           | `bg-right`             | `{ bgPos: 'right' }`           |                               |
| **Bottom Left**  | `background-position: bottom left`     | `bg-bottom-left`       | `{ bgPos: 'bottom-left' }`     |                               |
| **Bottom**       | `background-position: bottom`          | `bg-bottom`            | `{ bgPos: 'bottom' }`          |                               |
| **Bottom Right** | `background-position: bottom right`    | `bg-bottom-right`      | `{ bgPos: 'bottom-right' }`    |                               |
| **Arbitrary**    | `background-position: center top 1rem` | `bg-[center_top_1rem]` | `{ bgPos: 'center top 1rem' }` |                               |
| **CSS Variable** | `background-position: var(--bg-pos)`   | `bg-(--bg-pos)`        | `{ bgPos: '--bg-pos' }`        | **Sugar**: Auto-detects `--`. |

## Background Size

| Concept          | CSS Rule                          | Tailwind v4 Class      | `sz` Prop (Object Syntax)  | Note                          |
| :--------------- | :-------------------------------- | :--------------------- | :------------------------- | :---------------------------- |
| **Auto**         | `background-size: auto`           | `bg-auto`              | `{ bgSize: 'auto' }`       |                               |
| **Cover**        | `background-size: cover`          | `bg-cover`             | `{ bgSize: 'cover' }`      |                               |
| **Contain**      | `background-size: contain`        | `bg-contain`           | `{ bgSize: 'contain' }`    |                               |
| **Arbitrary**    | `background-size: auto 100px`     | `bg-size-[auto_100px]` | `{ bgSize: 'auto 100px' }` |                               |
| **CSS Variable** | `background-size: var(--bg-size)` | `bg-size-(--bg-size)`  | `{ bgSize: '--bg-size' }`  | **Sugar**: Auto-detects `--`. |

## Background Attachment

| Concept    | CSS Rule                        | Tailwind v4 Class | `sz` Prop (Object Syntax) | Note |
| :--------- | :------------------------------ | :---------------- | :------------------------ | :--- |
| **Fixed**  | `background-attachment: fixed`  | `bg-fixed`        | `{ bgAttach: 'fixed' }`   |      |
| **Local**  | `background-attachment: local`  | `bg-local`        | `{ bgAttach: 'local' }`   |      |
| **Scroll** | `background-attachment: scroll` | `bg-scroll`       | `{ bgAttach: 'scroll' }`  |      |

## Background Clip

| Concept     | CSS Rule                       | Tailwind v4 Class | `sz` Prop (Object Syntax) | Note |
| :---------- | :----------------------------- | :---------------- | :------------------------ | :--- |
| **Border**  | `background-clip: border-box`  | `bg-clip-border`  | `{ bgClip: 'border' }`    |      |
| **Padding** | `background-clip: padding-box` | `bg-clip-padding` | `{ bgClip: 'padding' }`   |      |
| **Content** | `background-clip: content-box` | `bg-clip-content` | `{ bgClip: 'content' }`   |      |
| **Text**    | `background-clip: text`        | `bg-clip-text`    | `{ bgClip: 'text' }`      |      |

## Background Repeat

| Concept       | CSS Rule                       | Tailwind v4 Class | `sz` Prop (Object Syntax)   | Note |
| :------------ | :----------------------------- | :---------------- | :-------------------------- | :--- |
| **Repeat**    | `background-repeat: repeat`    | `bg-repeat`       | `{ bgRepeat: 'repeat' }`    |      |
| **No Repeat** | `background-repeat: no-repeat` | `bg-no-repeat`    | `{ bgRepeat: 'no-repeat' }` |      |
| **Repeat X**  | `background-repeat: repeat-x`  | `bg-repeat-x`     | `{ bgRepeat: 'repeat-x' }`  |      |
| **Repeat Y**  | `background-repeat: repeat-y`  | `bg-repeat-y`     | `{ bgRepeat: 'repeat-y' }`  |      |
| **Round**     | `background-repeat: round`     | `bg-repeat-round` | `{ bgRepeat: 'round' }`     |      |
| **Space**     | `background-repeat: space`     | `bg-repeat-space` | `{ bgRepeat: 'space' }`     |      |

## Background Origin

| Concept     | CSS Rule                         | Tailwind v4 Class   | `sz` Prop (Object Syntax) | Note |
| :---------- | :------------------------------- | :------------------ | :------------------------ | :--- |
| **Border**  | `background-origin: border-box`  | `bg-origin-border`  | `{ bgOrigin: 'border' }`  |      |
| **Padding** | `background-origin: padding-box` | `bg-origin-padding` | `{ bgOrigin: 'padding' }` |      |
| **Content** | `background-origin: content-box` | `bg-origin-content` | `{ bgOrigin: 'content' }` |      |
