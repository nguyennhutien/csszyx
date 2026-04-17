# Effects

Controlling effects like shadows, opacity, and blends.

## Box Shadow

Controlling the box shadow of an element.

| Concept                | CSS Rule                                    | Tailwind v4 Class                                                                                                 | `sz` Prop (Object Syntax)                                                                                                                    | Note                                         |
| :--------------------- | :------------------------------------------ | :---------------------------------------------------------------------------------------------------------------- | :------------------------------------------------------------------------------------------------------------------------------------------- | :------------------------------------------- |
| **Shadow**             | `box-shadow: 0 1px 2px 0 rgb(0 0 0 / 0.05)` | `shadow-2xs`, `shadow-xs`, `shadow-sm`, `shadow`, `shadow-md`, `shadow-lg`, `shadow-xl`, `shadow-2xl`             | `{ shadow: '2xs' }`, `{ shadow: 'xs' }`, `{ shadow: 'sm' }`, `{ shadow: 'md' }`, `{ shadow: 'lg' }`, `{ shadow: 'xl' }`, `{ shadow: '2xl' }` | **v4.1**: `2xs`, `xs`.                       |
| **Inset Shadow**       | `box-shadow: inset (etc)`                   | `inset-shadow-2xs`, `inset-shadow-xs`, `inset-shadow-sm`, `inset-shadow-md`, `inset-shadow-lg`, `inset-shadow-xl` | `{ insetShadow: '2xs' }`                                                                                                                     | **New in v4**: Distinct from `shadow-inner`. |
| **Ring**               | `box-shadow: 0 1px 2px 0 rgb(0 0 0 / 0.05)` | `ring`, `ring-1`                                                                                                  | `{ ring: 1 }`                                                                                                                                |                                              |
| **Inset Ring**         | `box-shadow: inset (etc)`                   | `inset-ring`, `inset-ring-1`                                                                                      | `{ insetRing: 1 }`                                                                                                                           |                                              |
| **None**               | `box-shadow: 0 0 #0000`                     | `shadow-none`                                                                                                     | `{ shadow: 'none' }`                                                                                                                         |                                              |
| **Inset None**         | `box-shadow: inset 0 0 #0000`               | `inset-shadow-none`                                                                                               | `{ insetShadow: 'none' }`                                                                                                                    |                                              |
| **Ring None**          | `box-shadow: 0 0 #0000`                     | `ring-none`                                                                                                       | `{ ring: 'none' }`                                                                                                                           |                                              |
| **Color**              | `box-shadow: 0 1px 2px 0 rgb(0 0 0 / 0.05)` | `shadow-blue-500`, `inset-shadow-blue-500`, `ring-blue-500`                                                       | `{ shadowColor: 'blue-500' }`                                                                                                                |                                              |
| **Color + Opacity**    | `--tw-shadow-color: (value) / 50%`          | `shadow-blue-500/50`                                                                                              | `{ shadowColor: { color: 'blue-500', op: 50 } }`                                                                                             |                                              |
| **CSS Var + Opacity**  | `--tw-shadow-color: var(--c) / 50%`         | `shadow-(--c)/50`                                                                                                 | `{ shadowColor: { color: '--c', op: 50 } }`                                                                                                  | CSS variables are auto-wrapped in `(...)`.   |
| **Inset Sh Color**     | `--tw-inset-shadow-color: (value)`          | `inset-shadow-blue-500`                                                                                           | `{ insetShadowColor: 'blue-500' }`                                                                                                           | Separate key for inset shadow color.         |
| **Inset Sh Var**       | `--tw-inset-shadow-color: var(--c)`         | `inset-shadow-(color:--c)`                                                                                        | `{ insetShadowColor: '--c' }`                                                                                                                | CSS variable with `color:` type hint.        |
| **Inset Sh + Opacity** | `--tw-inset-shadow-color: (value) / 30%`    | `inset-shadow-black/30`                                                                                           | `{ insetShadowColor: { color: 'black', op: 30 } }`                                                                                           |                                              |
| **Inset Sh Var + Op**  | `--tw-inset-shadow-color: var(--c) / 30%`   | `inset-shadow-(--c)/30`                                                                                           | `{ insetShadowColor: { color: '--c', op: 30 } }`                                                                                             | CSS variables are auto-wrapped in `(...)`.   |
| **Inherit/Custom**     | `box-shadow: 0 1px 2px 0 rgb(0 0 0 / 0.05)` | `shadow-inherit`, `shadow-current`, `shadow-black`, `shadow-white`, `shadow-transparent`                          | `{ shadowColor: 'inherit' }` etc.                                                                                                            |                                              |
| **Custom Var**         | `--tw-shadow-color: var(--value)`           | `shadow-(color:--my-color)`                                                                                       | `{ shadowColor: '--my-color' }`                                                                                                              | **New in v4**: Sets variable explicitly.     |
| **Arbitrary**          | `box-shadow: 0 1px 2px 0 rgb(0 0 0 / 0.05)` | `shadow-[0_35px_60px_-15px_rgba(0,0,0,0.3)]`                                                                      | `{ shadow: '0 35px 60px -15px rgba(0,0,0,0.3)' }`                                                                                            |                                              |
| **Var**                | `box-shadow: var(--s)`                      | `shadow-(--s)`                                                                                                    | `{ shadow: '--s' }`                                                                                                                          | **Sugar**: Auto-detects `--`.                |

## Text Shadow

Controlling the shadow of a text element.

| Concept       | CSS Rule             | Tailwind v4 Class                                                   | `sz` Prop (Object Syntax)                              | Note           |
| :------------ | :------------------- | :------------------------------------------------------------------ | :----------------------------------------------------- | :------------- |
| **Shadow**    | `text-shadow: (etc)` | `text-shadow`, `text-shadow-sm`, `text-shadow-md`, `text-shadow-lg` | `{ textShadow: 'sm' }`                                 | **New in v4**. |
| **None**      | `text-shadow: none`  | `text-shadow-none`                                                  | `{ textShadow: 'none' }`                               |                |
| **Color**     | `text-shadow: (etc)` | `text-shadow-blue-500`                                              | `{ textShadowColor: 'blue-500' }`                      |                |
| **Arbitrary** | `text-shadow: (etc)` | `text-shadow-[2px_2px_4px_var(--tw-shadow-color)]`                  | `{ textShadow: '2px 2px 4px var(--tw-shadow-color)' }` |                |

## Opacity

Controlling the opacity of an element.

| Concept       | CSS Rule            | Tailwind v4 Class                | `sz` Prop (Object Syntax)                                | Note                                |
| :------------ | :------------------ | :------------------------------- | :------------------------------------------------------- | :---------------------------------- |
| **Dynamic**   | `opacity: 0 to 1`   | `opacity-<number>` (any integer) | `{ opacity: 50 }`, `{ opacity: 88 }`, `{ opacity: 999 }` | v4: fully dynamic, no static scale. |
| **Arbitrary** | `opacity: .33`      | `opacity-[.33]`                  | `{ opacity: '.33' }`                                     |                                     |
| **Var**       | `opacity: var(--o)` | `opacity-(--o)`                  | `{ opacity: '--o' }`                                     |                                     |

## Mix Blend Mode

Controlling how an element's content should blend with the background.

| Concept          | CSS Rule                       | Tailwind v4 Class        | `sz` Prop (Object Syntax)      | Note |
| :--------------- | :----------------------------- | :----------------------- | :----------------------------- | :--- |
| **Normal**       | `mix-blend-mode: normal`       | `mix-blend-normal`       | `{ mixBlend: 'normal' }`       |      |
| **Multiply**     | `mix-blend-mode: multiply`     | `mix-blend-multiply`     | `{ mixBlend: 'multiply' }`     |      |
| **Screen**       | `mix-blend-mode: screen`       | `mix-blend-screen`       | `{ mixBlend: 'screen' }`       |      |
| **Overlay**      | `mix-blend-mode: overlay`      | `mix-blend-overlay`      | `{ mixBlend: 'overlay' }`      |      |
| **Darken**       | `mix-blend-mode: darken`       | `mix-blend-darken`       | `{ mixBlend: 'darken' }`       |      |
| **Lighten**      | `mix-blend-mode: lighten`      | `mix-blend-lighten`      | `{ mixBlend: 'lighten' }`      |      |
| **Color Dodge**  | `mix-blend-mode: color-dodge`  | `mix-blend-color-dodge`  | `{ mixBlend: 'color-dodge' }`  |      |
| **Color Burn**   | `mix-blend-mode: color-burn`   | `mix-blend-color-burn`   | `{ mixBlend: 'color-burn' }`   |      |
| **Hard Light**   | `mix-blend-mode: hard-light`   | `mix-blend-hard-light`   | `{ mixBlend: 'hard-light' }`   |      |
| **Soft Light**   | `mix-blend-mode: soft-light`   | `mix-blend-soft-light`   | `{ mixBlend: 'soft-light' }`   |      |
| **Difference**   | `mix-blend-mode: difference`   | `mix-blend-difference`   | `{ mixBlend: 'difference' }`   |      |
| **Exclusion**    | `mix-blend-mode: exclusion`    | `mix-blend-exclusion`    | `{ mixBlend: 'exclusion' }`    |      |
| **Hue**          | `mix-blend-mode: hue`          | `mix-blend-hue`          | `{ mixBlend: 'hue' }`          |      |
| **Saturation**   | `mix-blend-mode: saturation`   | `mix-blend-saturation`   | `{ mixBlend: 'saturation' }`   |      |
| **Color**        | `mix-blend-mode: color`        | `mix-blend-color`        | `{ mixBlend: 'color' }`        |      |
| **Luminosity**   | `mix-blend-mode: luminosity`   | `mix-blend-luminosity`   | `{ mixBlend: 'luminosity' }`   |      |
| **Plus Lighter** | `mix-blend-mode: plus-lighter` | `mix-blend-plus-lighter` | `{ mixBlend: 'plus-lighter' }` |      |
| **Plus Darker**  | `mix-blend-mode: plus-darker`  | `mix-blend-plus-darker`  | `{ mixBlend: 'plus-darker' }`  |      |

## Background Blend Mode

Controlling how an element's background image should blend with its background color.

| Concept   | CSS Rule                       | Tailwind v4 Class                                                                                                                                                                                                                                                                                                                              | `sz` Prop (Object Syntax)      | Note |
| :-------- | :----------------------------- | :--------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | :----------------------------- | :--- |
| **Modes** | `background-blend-mode: (etc)` | `bg-blend-normal`, `bg-blend-multiply`, `bg-blend-screen`, `bg-blend-overlay`, `bg-blend-darken`, `bg-blend-lighten`, `bg-blend-color-dodge`, `bg-blend-color-burn`, `bg-blend-hard-light`, `bg-blend-soft-light`, `bg-blend-difference`, `bg-blend-exclusion`, `bg-blend-hue`, `bg-blend-saturation`, `bg-blend-color`, `bg-blend-luminosity` | `{ bgBlend: 'multiply' }` etc. |      |

## Masking (v4.1+)

Controlling the masking of an element with images, gradients, and CSS properties.

> **Source:** [Tailwind CSS v4.1 Documentation](https://tailwindcss.com/docs/mask-image)

### mask-image: Gradient Masks

| Concept        | CSS Rule                                      | Tailwind v4 Class | `sz` Prop (Object Syntax) | Note                       |
| :------------- | :-------------------------------------------- | :---------------- | :------------------------ | :------------------------- |
| **None**       | `mask-image: none`                            | `mask-none`       | `{ mask: 'none' }`        |                            |
| **Linear**     | `mask-image: linear-gradient(45deg, ...)`     | `mask-linear-45`  | `{ mask: 'linear-45' }`   | Angle in degrees.          |
| **Linear Neg** | `mask-image: linear-gradient(-45deg, ...)`    | `-mask-linear-45` | `{ mask: '-linear-45' }`  | Negative angle prefix `-`. |
| **Radial**     | `mask-image: radial-gradient(...)`            | `mask-radial`     | `{ mask: 'radial' }`      |                            |
| **Conic**      | `mask-image: conic-gradient(from 90deg, ...)` | `mask-conic-90`   | `{ mask: 'conic-90' }`    |                            |

### mask-image: Direction Keywords

| Concept             | CSS Rule                                            | Tailwind v4 Class   | `sz` Prop (Object Syntax)  | Note |
| :------------------ | :-------------------------------------------------- | :------------------ | :------------------------- | :--- |
| **To Top**          | `mask-image: linear-gradient(to top, ...)`          | `mask-linear-to-t`  | `{ mask: 'linear-to-t' }`  |      |
| **To Top Right**    | `mask-image: linear-gradient(to top right, ...)`    | `mask-linear-to-tr` | `{ mask: 'linear-to-tr' }` |      |
| **To Right**        | `mask-image: linear-gradient(to right, ...)`        | `mask-linear-to-r`  | `{ mask: 'linear-to-r' }`  |      |
| **To Bottom Right** | `mask-image: linear-gradient(to bottom right, ...)` | `mask-linear-to-br` | `{ mask: 'linear-to-br' }` |      |
| **To Bottom**       | `mask-image: linear-gradient(to bottom, ...)`       | `mask-linear-to-b`  | `{ mask: 'linear-to-b' }`  |      |
| **To Bottom Left**  | `mask-image: linear-gradient(to bottom left, ...)`  | `mask-linear-to-bl` | `{ mask: 'linear-to-bl' }` |      |
| **To Left**         | `mask-image: linear-gradient(to left, ...)`         | `mask-linear-to-l`  | `{ mask: 'linear-to-l' }`  |      |
| **To Top Left**     | `mask-image: linear-gradient(to top left, ...)`     | `mask-linear-to-tl` | `{ mask: 'linear-to-tl' }` |      |

### mask-image: Shape Modifiers (Radial)

| Concept     | CSS Rule                          | Tailwind v4 Class | `sz` Prop (Object Syntax)  | Note                  |
| :---------- | :-------------------------------- | :---------------- | :------------------------- | :-------------------- |
| **Circle**  | `--tw-mask-radial-shape: circle`  | `mask-circle`     | `{ maskShape: 'circle' }`  | For radial gradients. |
| **Ellipse** | `--tw-mask-radial-shape: ellipse` | `mask-ellipse`    | `{ maskShape: 'ellipse' }` | Default shape.        |

### mask-image: Arbitrary Values

| Concept      | CSS Rule                           | Tailwind v4 Class             | `sz` Prop (Object Syntax)          | Note               |
| :----------- | :--------------------------------- | :---------------------------- | :--------------------------------- | :----------------- |
| **URL**      | `mask-image: url(/img.png)`        | `mask-[url(/img.png)]`        | `{ mask: "url('/img.png')" }`      | Arbitrary syntax.  |
| **Gradient** | `mask-image: linear-gradient(...)` | `mask-[linear-gradient(...)]` | `{ mask: 'linear-gradient(...)' }` | Spaces become `_`. |
| **Variable** | `mask-image: var(--my-mask)`       | `mask-(--my-mask)`            | `{ mask: '--my-mask' }`            | CSS variable.      |

### mask-size

| Concept       | CSS Rule              | Tailwind v4 Class | `sz` Prop (Object Syntax) | Note             |
| :------------ | :-------------------- | :---------------- | :------------------------ | :--------------- |
| **Auto**      | `mask-size: auto`     | `mask-auto`       | `{ maskSize: 'auto' }`    |                  |
| **Cover**     | `mask-size: cover`    | `mask-cover`      | `{ maskSize: 'cover' }`   |                  |
| **Contain**   | `mask-size: contain`  | `mask-contain`    | `{ maskSize: 'contain' }` |                  |
| **Arbitrary** | `mask-size: 50%`      | `mask-size-[50%]` | `{ maskSize: '50%' }`     | Arbitrary value. |
| **Variable**  | `mask-size: var(--s)` | `mask-size-(--s)` | `{ maskSize: '--s' }`     | CSS variable.    |

### mask-position

| Concept          | CSS Rule                         | Tailwind v4 Class                 | `sz` Prop (Object Syntax)        | Note               |
| :--------------- | :------------------------------- | :-------------------------------- | :------------------------------- | :----------------- |
| **Center**       | `mask-position: center`          | `mask-center`                     | `{ maskPos: 'center' }`          |                    |
| **Top**          | `mask-position: top`             | `mask-top`                        | `{ maskPos: 'top' }`             |                    |
| **Bottom**       | `mask-position: bottom`          | `mask-bottom`                     | `{ maskPos: 'bottom' }`          |                    |
| **Left**         | `mask-position: left`            | `mask-left`                       | `{ maskPos: 'left' }`            |                    |
| **Right**        | `mask-position: right`           | `mask-right`                      | `{ maskPos: 'right' }`           |                    |
| **Top Left**     | `mask-position: top left`        | `mask-top-left`                   | `{ maskPos: 'top-left' }`        |                    |
| **Top Right**    | `mask-position: top right`       | `mask-top-right`                  | `{ maskPos: 'top-right' }`       |                    |
| **Bottom Left**  | `mask-position: bottom left`     | `mask-bottom-left`                | `{ maskPos: 'bottom-left' }`     |                    |
| **Bottom Right** | `mask-position: bottom right`    | `mask-bottom-right`               | `{ maskPos: 'bottom-right' }`    |                    |
| **Arbitrary**    | `mask-position: center top 1rem` | `mask-position-[center_top_1rem]` | `{ maskPos: 'center_top_1rem' }` | Spaces become `_`. |

### mask-repeat

| Concept       | CSS Rule                 | Tailwind v4 Class   | `sz` Prop (Object Syntax)     | Note     |
| :------------ | :----------------------- | :------------------ | :---------------------------- | :------- |
| **Repeat**    | `mask-repeat: repeat`    | `mask-repeat`       | `{ maskRepeat: 'repeat' }`    | Default. |
| **No Repeat** | `mask-repeat: no-repeat` | `mask-no-repeat`    | `{ maskRepeat: 'no-repeat' }` |          |
| **Repeat X**  | `mask-repeat: repeat-x`  | `mask-repeat-x`     | `{ maskRepeat: 'repeat-x' }`  |          |
| **Repeat Y**  | `mask-repeat: repeat-y`  | `mask-repeat-y`     | `{ maskRepeat: 'repeat-y' }`  |          |
| **Space**     | `mask-repeat: space`     | `mask-repeat-space` | `{ maskRepeat: 'space' }`     |          |
| **Round**     | `mask-repeat: round`     | `mask-repeat-round` | `{ maskRepeat: 'round' }`     |          |

### mask-origin

| Concept         | CSS Rule                   | Tailwind v4 Class     | `sz` Prop (Object Syntax)   | Note      |
| :-------------- | :------------------------- | :-------------------- | :-------------------------- | :-------- |
| **Border Box**  | `mask-origin: border-box`  | `mask-origin-border`  | `{ maskOrigin: 'border' }`  |           |
| **Padding Box** | `mask-origin: padding-box` | `mask-origin-padding` | `{ maskOrigin: 'padding' }` |           |
| **Content Box** | `mask-origin: content-box` | `mask-origin-content` | `{ maskOrigin: 'content' }` |           |
| **Fill Box**    | `mask-origin: fill-box`    | `mask-origin-fill`    | `{ maskOrigin: 'fill' }`    | SVG only. |
| **Stroke Box**  | `mask-origin: stroke-box`  | `mask-origin-stroke`  | `{ maskOrigin: 'stroke' }`  | SVG only. |
| **View Box**    | `mask-origin: view-box`    | `mask-origin-view`    | `{ maskOrigin: 'view' }`    | SVG only. |

### mask-clip

| Concept         | CSS Rule                 | Tailwind v4 Class   | `sz` Prop (Object Syntax) | Note      |
| :-------------- | :----------------------- | :------------------ | :------------------------ | :-------- |
| **Border Box**  | `mask-clip: border-box`  | `mask-clip-border`  | `{ maskClip: 'border' }`  |           |
| **Padding Box** | `mask-clip: padding-box` | `mask-clip-padding` | `{ maskClip: 'padding' }` |           |
| **Content Box** | `mask-clip: content-box` | `mask-clip-content` | `{ maskClip: 'content' }` |           |
| **Fill Box**    | `mask-clip: fill-box`    | `mask-clip-fill`    | `{ maskClip: 'fill' }`    | SVG only. |
| **Stroke Box**  | `mask-clip: stroke-box`  | `mask-clip-stroke`  | `{ maskClip: 'stroke' }`  | SVG only. |
| **View Box**    | `mask-clip: view-box`    | `mask-clip-view`    | `{ maskClip: 'view' }`    | SVG only. |
| **No Clip**     | `mask-clip: no-clip`     | `mask-no-clip`      | `{ maskClip: 'no-clip' }` |           |

### mask-mode

Controls how element masks are interpreted.

| Concept          | CSS Rule                  | Tailwind v4 Class | `sz` Prop (Object Syntax)      | Note                |
| :--------------- | :------------------------ | :---------------- | :----------------------------- | :------------------ |
| **Alpha**        | `mask-mode: alpha`        | `mask-alpha`      | `{ maskMode: 'alpha' }`        | Uses alpha channel. |
| **Luminance**    | `mask-mode: luminance`    | `mask-luminance`  | `{ maskMode: 'luminance' }`    | Uses luminance.     |
| **Match Source** | `mask-mode: match-source` | `mask-match`      | `{ maskMode: 'match-source' }` | Auto-detect.        |

### mask-type

Controls how SVG masks are interpreted. **Note:** Uses `mask-type-` prefix (different from `mask-mode`).

| Concept       | CSS Rule               | Tailwind v4 Class     | `sz` Prop (Object Syntax)   | Note              |
| :------------ | :--------------------- | :-------------------- | :-------------------------- | :---------------- |
| **Alpha**     | `mask-type: alpha`     | `mask-type-alpha`     | `{ maskType: 'alpha' }`     | For SVG `<mask>`. |
| **Luminance** | `mask-type: luminance` | `mask-type-luminance` | `{ maskType: 'luminance' }` | For SVG `<mask>`. |

### mask-composite

Controls how multiple masks are combined.

| Concept       | CSS Rule                    | Tailwind v4 Class | `sz` Prop (Object Syntax)        | Note            |
| :------------ | :-------------------------- | :---------------- | :------------------------------- | :-------------- |
| **Add**       | `mask-composite: add`       | `mask-add`        | `{ maskComposite: 'add' }`       | Union of masks. |
| **Subtract**  | `mask-composite: subtract`  | `mask-subtract`   | `{ maskComposite: 'subtract' }`  | Difference.     |
| **Intersect** | `mask-composite: intersect` | `mask-intersect`  | `{ maskComposite: 'intersect' }` | Intersection.   |
| **Exclude**   | `mask-composite: exclude`   | `mask-exclude`    | `{ maskComposite: 'exclude' }`   | XOR.            |

### Compiler Mappings

```typescript
// mask-mode: direct mapping (no prefix)
{
  maskMode: "alpha";
} // → mask-alpha
{
  maskMode: "luminance";
} // → mask-luminance
{
  maskMode: "match-source";
} // → mask-match

// mask-type: uses mask-type- prefix
{
  maskType: "alpha";
} // → mask-type-alpha
{
  maskType: "luminance";
} // → mask-type-luminance

// mask-composite: direct mapping (no prefix)
{
  maskComposite: "add";
} // → mask-add
{
  maskComposite: "subtract";
} // → mask-subtract

// mask-size: direct mapping
{
  maskSize: "cover";
} // → mask-cover
{
  maskSize: "contain";
} // → mask-contain
{
  maskSize: "auto";
} // → mask-auto

// mask-position: mask- prefix
{
  maskPos: "center";
} // → mask-center
{
  maskPos: "top-left";
} // → mask-top-left

// mask-repeat: special handling
{
  maskRepeat: "repeat";
} // → mask-repeat (not mask-repeat-repeat)
{
  maskRepeat: "no-repeat";
} // → mask-no-repeat
{
  maskRepeat: "repeat-x";
} // → mask-repeat-x

// mask-origin/clip: uses -origin-/-clip- infix
{
  maskOrigin: "border";
} // → mask-origin-border
{
  maskClip: "content";
} // → mask-clip-content

// mask-image: arbitrary values are auto-wrapped by compiler — no brackets needed in sz
{
  mask: "linear-gradient(...)";
} // → mask-[linear-gradient(...)]
{
  mask: "url(/img.png)";
} // → mask-[url(/img.png)]
```

### Key Differences

| Property         | Format                                | Example                        |
| ---------------- | ------------------------------------- | ------------------------------ |
| `mask-mode`      | `mask-{value}`                        | `mask-alpha`                   |
| `mask-type`      | `mask-type-{value}`                   | `mask-type-alpha`              |
| `mask-composite` | `mask-{value}`                        | `mask-add`                     |
| `mask-size`      | `mask-{value}`                        | `mask-cover`                   |
| `mask-position`  | `mask-{value}`                        | `mask-center`                  |
| `mask-repeat`    | `mask-{value}` / `mask-repeat-{x\|y}` | `mask-repeat`, `mask-repeat-x` |
| `mask-origin`    | `mask-origin-{value}`                 | `mask-origin-border`           |
| `mask-clip`      | `mask-clip-{value}`                   | `mask-clip-content`            |
