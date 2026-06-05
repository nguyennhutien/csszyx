# Core Concepts

## Styling with Utility Classes

## Basic Utilities

Simple property-value mappings.

| Concept              | CSS Property                             | Tailwind v4 Class | `sz` Prop (Canonical) |
| :------------------- | :--------------------------------------- | :---------------- | :-------------------- |
| **Padding**          | `padding: 1.5rem`                        | `p-6`             | `{ p: 6 }`            |
| **Background Color** | `background-color: var(--color-sky-500)` | `bg-sky-500`      | `{ bg: 'sky-500' }`   |
| **Text Color**       | `color: white`                           | `text-white`      | `{ color: 'white' }`  |
| **Border Radius**    | `border-radius: var(--radius-lg)`        | `rounded-lg`      | `{ rounded: 'lg' }`   |
| **Box Shadow**       | `box-shadow: var(--shadow-xl)`           | `shadow-xl`       | `{ shadow: 'xl' }`    |
| **Flex Container**   | `display: flex`                          | `flex`            | `{ flex: true }`      |

## State Modifiers (Hover, Focus)

Handling pseudo-classes using nested objects or string prefixes.

| Concept              | CSS Rule (Simplified)                 | Tailwind v4 Class           | `sz` Prop (Canonical)       | `sz` Prop (Object Syntax)                    |
| :------------------- | :------------------------------------ | :-------------------------- | :-------------------------- | :------------------------------------------- |
| **Hover State**      | `&:hover { background-color: (etc) }` | `hover:bg-sky-700`          | `{ hover: 'bg-sky-700' }`   | `{ hover: { bg: 'sky-700' } }`               |
| **Focus State**      | `&:focus { outline: (etc) }`          | `focus:outline-none`        | `{ focus: 'outline-none' }` | `{ focus: { outline: 'none' } }`             |
| **Active State**     | `&:active { opacity: 0.8 }`           | `active:opacity-80`         | `{ active: 'opacity-80' }`  | `{ active: { opacity: 80 } }`                |
| **Disabled + Hover** | `&:disabled:hover { (etc) }`          | `disabled:hover:bg-sky-500` | N/A (Complex string)        | `{ disabled: { hover: { bg: 'sky-500' } } }` |

## Responsive Design (Breakpoints)

Handling media queries via properties.

| Concept              | CSS Rule                            | Tailwind v4 Class | `sz` Prop (Object Syntax) |
| :------------------- | :---------------------------------- | :---------------- | :------------------------ |
| **Small Breakpoint** | `@media (width >= 40rem) { (etc) }` | `sm:grid-cols-3`  | `{ sm: { gridCols: 3 } }` |
| **Medium Layout**    | `@media (width >= 48rem) { (etc) }` | `md:flex`         | `{ md: { flex: true } }`  |
| **Large Spacing**    | `@media (width >= 64rem) { (etc) }` | `lg:px-8`         | `{ lg: { px: 8 } }`       |

## Dark Mode

Handling `prefers-color-scheme` or class-based dark mode.

| Concept             | CSS Rule                                        | Tailwind v4 Class  | `sz` Prop (Object Syntax)      |
| :------------------ | :---------------------------------------------- | :----------------- | :----------------------------- |
| **Dark Background** | `@media (prefers-color-scheme: dark) { (etc) }` | `dark:bg-gray-800` | `{ dark: { bg: 'gray-800' } }` |
| **Dark Text**       | `(etc) { color: white }`                        | `dark:text-white`  | `{ dark: { color: 'white' } }` |

## Composition (Filters & Transforms)

Composing multiple classes for a single effect.

| Concept              | CSS Rule                         | Tailwind v4 Class   | `sz` Prop (Canonical)             |
| :------------------- | :------------------------------- | :------------------ | :-------------------------------- |
| **Filter Blur**      | `filter: blur((etc)) (etc)`      | `blur-sm`           | `{ blur: 'sm' }`                  |
| **Filter Grayscale** | `filter: grayscale((etc)) (etc)` | `grayscale`         | `{ grayscale: true }`             |
| **Combined**         | `filter: (etc)`                  | `blur-sm grayscale` | `{ blur: 'sm', grayscale: true }` |

## Arbitrary Values

Mapping precise, non-theme values to JIT syntax (Arbitrary Properties or Values).

| Concept             | CSS Property                  | Tailwind v4 Class              | `sz` Prop (Object Syntax)           | Note                                      |
| :------------------ | :---------------------------- | :----------------------------- | :---------------------------------- | :---------------------------------------- |
| **Arbitrary Color** | `background-color: #316ff6`   | `bg-[#316ff6]`                 | `{ bg: '#316ff6' }`                 | Preferred over inline styles for caching. |
| **Arbitrary Size**  | `width: 333px`                | `w-[333px]`                    | `{ w: '333px' }`                    | Explicit unit required string.            |
| **Data Prop**       | `content: attr(data-content)` | `content-[attr(data-content)]` | `{ content: 'attr(data-content)' }` | Complex arbitrary strings.                |

**Global Parsing Rule**: The compiler **MUST normalize whitespace** in arbitrary variant _keys_ before generation.

- `{ '[ & > span ]': (etc) }` -> `[&>span]:(etc)` — whitespace in arbitrary selector keys is stripped
- Values never need brackets: `{ w: 'calc(100% - 20px)' }` -> `w-[calc(100%_-_20px)]` — the compiler auto-wraps arbitrary values
- This ensures robust matching regardless of user formatting.

## Complex Selectors & Modifiers

Handling `group-*`, `peer-*`, and arbitrary variants.

| Concept                | CSS Rule                              | Tailwind v4 Class         | `sz` Prop (Object Syntax)                   | Note                                                          |
| :--------------------- | :------------------------------------ | :------------------------ | :------------------------------------------ | :------------------------------------------------------------ |
| **Group Hover**        | `.group:hover .group-hover:text-blue` | `group-hover:text-blue`   | `{ group: { hover: { color: 'blue' } } }`   | **Sugar**: Nested `group` key acts as modifier scope.         |
| **Peer Focus**         | `.peer:focus ~ .peer-focus:text-blue` | `peer-focus:text-blue`    | `{ peer: { focus: { color: 'blue' } } }`    | **Sugar**: Nested `peer` key.                                 |
| **Data Attribute**     | `&[data-active] (etc)`                | `data-[active]:text-blue` | `{ data: { active: { color: 'blue' } } }`   | **Sugar**: Maps to `data-[key]`.                              |
| **ARIA Attribute**     | `&[aria-expanded="true"] (etc)`       | `aria-expanded:text-blue` | `{ aria: { expanded: { color: 'blue' } } }` | **Sugar**: Maps to `aria-[key]`.                              |
| **Arbitrary Variant**  | `& > span`                            | `[&>span]:text-blue`      | `{ '[& > span]': { color: 'blue' } }`       |                                                               |
| **Important Modifier** | `color: red !important`               | `text-red-500!`           | `{ color: 'red-500!' }`                     | **New**: Trailing `!` in value maps to trailing `!` in class. |

## Style Conflict Management

Inherently solved by the `sz` object model.

| Concept                   | Traditional Class Issue                              | `sz` Solution                               | Explanation                                                                                                                         |
| :------------------------ | :--------------------------------------------------- | :------------------------------------------ | :---------------------------------------------------------------------------------------------------------------------------------- |
| **Duplicate Properties**  | `class="p-4 p-8"` (Last one wins based on CSS order) | `{ p: 4, p: 8 }` (Syntax Error or Override) | JS objects cannot have duplicate keys. Last key wins _at source_, predictable.                                                      |
| **Longhand vs Shorthand** | `px-4 p-8` (Conflict)                                | `{ px: 4, p: 8 }`                           | The compiler must handle logical ordering (e.g. general `p` before specific `px`). **Implementation details** in compiler strategy. |

## Prefix Option

Handling global configuration prefixes.

| Concept            | Config          | Tailwind v4 Output | `sz` Prop Input                                                         |
| :----------------- | :-------------- | :----------------- | :---------------------------------------------------------------------- |
| **Utility Prefix** | `prefix: 'tw-'` | `tw-text-center`   | `{ textAlign: 'center' }`                                               |
| **Result**         |                 |                    | Compiler prepends `tw-` to all generated utility classes if configured. |

## Hover, Focus, and Other States

## Pseudo-classes

Standard interactive states.

| Concept                  | Tailwind v4 Class                            | `sz` Prop (Object Syntax)                                                  | Note                        |
| :----------------------- | :------------------------------------------- | :------------------------------------------------------------------------- | :-------------------------- |
| **Hover, Focus, Active** | `hover:bg-red focus:bg-blue active:bg-green` | `{ hover: { bg: 'red' }, focus: { bg: 'blue' }, active: { bg: 'green' } }` |                             |
| **First/Last Child**     | `first:pt-0 last:pb-0`                       | `{ first: { pt: 0 }, last: { pb: 0 } }`                                    |                             |
| **Odd/Even Child**       | `odd:bg-white even:bg-gray`                  | `{ odd: { bg: 'white' }, even: { bg: 'gray' } }`                           |                             |
| **First of Type**        | `first-of-type:block`                        | `{ firstOfType: { block: true } }`                                         | **Sugar**: CamelCase alias. |
| **Only Child**           | `only:block`                                 | `{ only: { block: true } }`                                                |                             |
| **Empty**                | `empty:hidden`                               | `{ empty: { hidden: true } }`                                              |                             |
| **Visited**              | `visited:text-purple`                        | `{ visited: { color: 'purple' } }`                                         |                             |
| **Focus Within**         | `focus-within:ring`                          | `{ focusWithin: { ring: true } }`                                          | **Sugar**: CamelCase alias. |
| **Focus Visible**        | `focus-visible:ring`                         | `{ focusVisible: { ring: true } }`                                         | **Sugar**: CamelCase alias. |
| **Target**               | `target:shadow`                              | `{ target: { shadow: true } }`                                             |                             |

## :has()

Styling based on descendants.

| Concept            | Tailwind v4 Class           | `sz` Prop (Object Syntax)                       | Note                                  |
| :----------------- | :-------------------------- | :---------------------------------------------- | :------------------------------------ |
| **Has Descendant** | `has-[img]:bg-blue`         | `{ has: { img: { bg: 'blue' } } }`              | **Sugar**: Nested selector.           |
| **Has State**      | `has-[:checked]:bg-blue`    | `{ has: { checked: { bg: 'blue' } } }`          | **Sugar**: Auto-detects pseudo-class. |
| **Arbitrary Has**  | `has-[.custom-class]:block` | `{ has: { '.custom-class': { block: true } } }` |                                       |

## Styling based on parent state (Groups)

Styling children based on parent `group` class.

| Concept                      | Tailwind v4 Class                     | `sz` Prop (Object Syntax)                                         | Note                                 |
| :--------------------------- | :------------------------------------ | :---------------------------------------------------------------- | :----------------------------------- |
| **Group Hover**              | `group-hover:text-white`              | `{ group: { hover: { color: 'white' } } }`                        | **Sugar**: Nested scope.             |
| **Group Focus**              | `group-focus:text-white`              | `{ group: { focus: { color: 'white' } } }`                        |                                      |
| **Group Active**             | `group-active:text-white`             | `{ group: { active: { color: 'white' } } }`                       |                                      |
| **Nested Groups**            | `group-hover/name:text-white`         | `{ group: { name: { hover: { color: 'white' } } } }`              | **Sugar**: Scope name as nested key. |
| **Arbitrary Groups**         | `group-[.is-published]:block`         | `{ group: { '.is-published': { block: true } } }`                 |                                      |
| **Group Has**                | `group-has-[a]:block`                 | `{ group: { has: { a: { block: true } } } }`                      |                                      |
| **Group Data**               | `group-data-[active]:text-blue`       | `{ group: { data: { active: { color: 'blue' } } } }`              | **Sugar**: Nested `data` key.        |
| **Group Data (named)**       | `group-data-[active]/card:text-blue`  | `{ group: { card: { data: { active: { color: 'blue' } } } } }`    | Name before `data` key.              |
| **Group Data (value match)** | `group-data-[state=open]:block`       | `{ group: { data: { 'state=open': { block: true } } } }`          | `=` in key → bracket form always.    |
| **Group ARIA**               | `group-aria-expanded:block`           | `{ group: { aria: { expanded: { block: true } } } }`              | Standard states: bare form.          |
| **Group ARIA (arbitrary)**   | `group-aria-[current=page]:font-bold` | `{ group: { aria: { 'current=page': { fontWeight: 'bold' } } } }` | Non-standard: bracket form.          |

## Styling based on sibling state (Peers)

Styling based on previous sibling `peer` class.

| Concept                     | Tailwind v4 Class                   | `sz` Prop (Object Syntax)                                  | Note                                 |
| :-------------------------- | :---------------------------------- | :--------------------------------------------------------- | :----------------------------------- |
| **Peer Hover**              | `peer-hover:text-white`             | `{ peer: { hover: { color: 'white' } } }`                  | **Sugar**: Nested scope.             |
| **Peer Checked**            | `peer-checked:bg-blue`              | `{ peer: { checked: { bg: 'blue' } } }`                    |                                      |
| **Differentiating Peers**   | `peer-checked/name:bg-blue`         | `{ peer: { name: { checked: { bg: 'blue' } } } }`          | **Sugar**: Scope name as nested key. |
| **Arbitrary Peers**         | `peer-[.is-dirty]:block`            | `{ peer: { '.is-dirty': { block: true } } }`               |                                      |
| **Peer Data**               | `peer-data-[active]:text-blue`      | `{ peer: { data: { active: { color: 'blue' } } } }`        | **Sugar**: Nested `data` key.        |
| **Peer Data (value match)** | `peer-data-[state=open]:block`      | `{ peer: { data: { 'state=open': { block: true } } } }`    | `=` in key → bracket form always.    |
| **Peer ARIA**               | `peer-aria-checked:bg-blue`         | `{ peer: { aria: { checked: { bg: 'blue' } } } }`          | Standard states: bare form.          |
| **Peer ARIA (arbitrary)**   | `peer-aria-[invalid=true]:text-red` | `{ peer: { aria: { 'invalid=true': { color: 'red' } } } }` | Non-standard: bracket form.          |

## :not()

Inverse conditions.

| Concept          | Tailwind v4 Class                   | `sz` Prop (Object Syntax)                                    | Note |
| :--------------- | :---------------------------------- | :----------------------------------------------------------- | :--- |
| **Not Hover**    | `not-hover:opacity-75`              | `{ not: { hover: { opacity: 75 } } }`                        |      |
| **Not First**    | `not-first:mt-4`                    | `{ not: { first: { mt: 4 } } }`                              |      |
| **Not Supports** | `not-supports-[display:grid]:block` | `{ not: { supports: { 'display:grid': { block: true } } } }` |      |

## Pseudo-elements

Advanced content styling.

| Concept          | Tailwind v4 Class       | `sz` Prop (Object Syntax)            | Note                  |
| :--------------- | :---------------------- | :----------------------------------- | :-------------------- |
| **Before/After** | `before:content-['']`   | `{ before: { (etc) } }`              | Defaults used.        |
| **Placeholder**  | `placeholder:text-gray` | `{ placeholder: { color: 'gray' } }` |                       |
| **File**         | `file:border`           | `{ file: { border: true } }`         |                       |
| **Marker**       | `marker:text-blue`      | `{ marker: { color: 'blue' } }`      |                       |
| **Selection**    | `selection:bg-pink`     | `{ selection: { bg: 'pink' } }`      |                       |
| **First Line**   | `first-line:uppercase`  | `{ firstLine: { uppercase: true } }` | **Sugar**: CamelCase. |
| **First Letter** | `first-letter:text-7xl` | `{ firstLetter: { text: '7xl' } }`   | **Sugar**: CamelCase. |
| **Backdrop**     | `backdrop:blur`         | `{ backdrop: { blur: true } }`       |                       |

## Media & Feature Queries

Environment-based styling.

| Concept               | Tailwind v4 Class                 | `sz` Prop (Object Syntax)                           | Note                          |
| :-------------------- | :-------------------------------- | :-------------------------------------------------- | :---------------------------- |
| **Breakpoints**       | `md:block lg:flex`                | `{ md: { block: true }, lg: { flex: true } }`       |                               |
| **Container Queries** | `@md:block @lg:flex`              | `{ '@md': { block: true }, '@lg': { flex: true } }` | **Note**: String key for `@`. |
| **Reduced Motion**    | `motion-reduce:hidden`            | `{ motionReduce: { hidden: true } }`                | **Sugar**: CamelCase.         |
| **Prefers Contrast**  | `contrast-more:border`            | `{ contrastMore: { border: true } }`                |                               |
| **Forced Colors**     | `forced-colors:border-gray`       | `{ forcedColors: { borderColor: 'gray' } }`         | **Sugar**: CamelCase.         |
| **Inverted Colors**   | `inverted-colors:invert`          | `{ invertedColors: { invert: true } }`              | **Sugar**: CamelCase.         |
| **Pointer**           | `pointer-coarse:p-4`              | `{ pointerCoarse: { p: 4 } }`                       | **Sugar**: CamelCase.         |
| **Any-Pointer**       | `any-pointer-fine:cursor-pointer` | `{ anyPointerFine: { cursor: 'pointer' } }`         | v4.1. **Sugar**: CamelCase.   |
| **User Valid**        | `user-valid:border-green-500`     | `{ userValid: { borderColor: 'green-500' } }`       | v4.1. Form validation state.  |
| **User Invalid**      | `user-invalid:border-red-500`     | `{ userInvalid: { borderColor: 'red-500' } }`       | v4.1. Form validation state.  |
| **Details Content**   | `details-content:block`           | `{ detailsContent: { block: true } }`               | v4.1. **Sugar**: CamelCase.   |
| **Print**             | `print:hidden`                    | `{ print: { hidden: true } }`                       |                               |
| **Orientation**       | `portrait:hidden`                 | `{ portrait: { hidden: true } }`                    |                               |
| **Scripting**         | `noscript:block`                  | `{ noscript: { block: true } }`                     |                               |
| **Supports**          | `supports-[display:grid]:grid`    | `{ supports: { 'display:grid': { grid: true } } }`  |                               |
| **Starting Style**    | `starting:opacity-0`              | `{ starting: { opacity: 0 } }`                      |                               |

## Attribute Selectors

Data and state attributes.

| Concept             | Tailwind v4 Class       | `sz` Prop (Object Syntax)               | Note |
| :------------------ | :---------------------- | :-------------------------------------- | :--- |
| **Data Attributes** | `data-[active]:bg-blue` | `{ data: { active: { bg: 'blue' } } }`  |      |
| **ARIA States**     | `aria-checked:bg-blue`  | `{ aria: { checked: { bg: 'blue' } } }` |      |
| **RTL/LTR**         | `rtl:mr-2`              | `{ rtl: { mr: 2 } }`                    |      |
| **Open**            | `open:bg-white`         | `{ open: { bg: 'white' } }`             |      |
| **Inert**           | `inert:opacity-50`      | `{ inert: { opacity: 50 } }`            |      |

## Helper Variants (Child/Descendants)

Mapping for common descendant patterns.

| Concept             | Tailwind v4 Class | `sz` Prop (Object Syntax) | Note                    |
| :------------------ | :---------------- | :------------------------ | :---------------------- |
| **Direct Children** | `*:p-4`           | `{ '*': { p: 4 } }`       | Map `*` to `*` variant. |
| **Descendants**     | `[&_*]:p-4`       | `{ '[&_*]': { p: 4 } }`   | Raw selector fallback.  |

## Custom Variants

Extensibility.

| Concept         | Tailwind v4 Class | `sz` Prop (Object Syntax) | Note                                                               |
| :-------------- | :---------------- | :------------------------ | :----------------------------------------------------------------- |
| **Custom Name** | `my-variant:p-4`  | `{ myVariant: { p: 4 } }` | **Rule**: Users can use CamelCase key matching registered variant. |

## Responsive design

Targeting specific screen sizes and container states.

| Concept                  | CSS Rule                    | Tailwind v4 Class         | `sz` Prop (Object Syntax)                         | Note                                |
| :----------------------- | :-------------------------- | :------------------------ | :------------------------------------------------ | :---------------------------------- |
| **Mobile First**         | `min-width: (etc)`          | `w-full md:w-1/2`         | `{ w: 'full', md: { w: '1/2' } }`                 | Unprefixed utilities target mobile. |
| **Breakpoint Range**     | `768px <= width < 1280px`   | `md:max-xl:flex`          | `{ md: { maxXl: { flex: true } } }`               | **Sugar**: CamelCase for `max-xl`.  |
| **Single Breakpoint**    | `md only`                   | `md:max-lg:flex`          | `{ md: { maxLg: { flex: true } } }`               | Target specific range.              |
| **Custom Breakpoint**    | `@media (min-width: 320px)` | `min-[320px]:text-center` | `{ min: { '[320px]': { textAlign: 'center' } } }` | Arbitrary one-off breakpoint.       |
| **Max-Width Breakpoint** | `@media (max-width: 600px)` | `max-[600px]:bg-sky-300`  | `{ max: { '[600px]': { bg: 'sky-300' } } }`       |                                     |

## Container Query Disambiguation

> ⚠️ **IMPORTANT:** `container` and `@container` are **different** Tailwind classes!

## Container Utility (max-width responsive)

The `container` class sets `width: 100%` and applies responsive max-widths.

| CSS           | Tailwind    | sz Prop               |
| ------------- | ----------- | --------------------- |
| `width: 100%` | `container` | `{ container: true }` |

## Container Query Rule

The `@container` class enables CSS container queries.

| Concept                  | Tailwind v4 Class    | `sz` Prop (Object Syntax)                   | Note                                      |
| :----------------------- | :------------------- | :------------------------------------------ | :---------------------------------------- |
| **Mark Container**       | `@container`         | `{ '@container': true }`                    |                                           |
| **Named Container**      | `@container/sidebar` | `{ '@container': 'sidebar' }`               | **Sugar**: Value string = container name. |
| **Container Breakpoint** | `@md:flex`           | `{ '@md': { flex: true } }`                 | **Note**: `@` prefix in key.              |
| **Named Query**          | `@md/sidebar:block`  | `{ '@md': { sidebar: { block: true } } }`   | **Sugar**: Nest name inside query key.    |
| **Container Range**      | `@sm:@max-md:block`  | `{ '@sm': { '@maxMd': { block: true } } }`  |                                           |
| **Arbitrary Query**      | `@min-[475px]:flex`  | `{ '@min': { '[475px]': { flex: true } } }` |                                           |
| **Container Units**      | `w-[50cqw]`          | `{ w: '50cqw' }`                            |                                           |

## Dark mode

Styling for dark color schemes.

| Concept               | CSS Rule                              | Tailwind v4 Class | `sz` Prop (Object Syntax)    | Note                                       |
| :-------------------- | :------------------------------------ | :---------------- | :--------------------------- | :----------------------------------------- |
| **Media Strategy**    | `@media (prefers-color-scheme: dark)` | `dark:bg-black`   | `{ dark: { bg: 'black' } }`  | Default behavior.                          |
| **Selector Strategy** | `.dark &`                             | `dark:bg-black`   | `{ dark: { bg: 'black' } }`  | Enabled via config `darkMode: 'selector'`. |
| **Variant**           | `[data-mode="dark"] &`                | `dark:bg-black`   | `{ dark: { bg: 'black' } }`  | Custom selector config.                    |
| **Force Light**       | N/A                                   | `light:bg-white`  | `{ light: { bg: 'white' } }` | Override dark mode.                        |

## Theme variables

Using design tokens.

| Concept              | CSS Rule                       | Tailwind v4 Class   | `sz` Prop (Object Syntax) | Note                                                   |
| :------------------- | :----------------------------- | :------------------ | :------------------------ | :----------------------------------------------------- |
| **Using Theme Var**  | `color: var(--color-mint-500)` | `text-mint-500`     | `{ color: 'mint-500' }`   | **Rule**: Use the utility name derived from variable.  |
| **Arbitrary Var**    | `width: var(--spacing-4)`      | `w-(--spacing-4)`   | `{ w: '--spacing-4' }`    | **Sugar**: Auto-detects `--` prefix and wraps in `()`. |
| **Var In Arbitrary** | `padding: var(--my-pad)`       | `p-[var(--my-pad)]` | `{ p: 'var(--my-pad)' }`  |                                                        |

## Colors

Palette and opacity.

| Concept               | CSS Rule                  | Tailwind v4 Class       | `sz` Prop (Object Syntax)                      | Note                                             |
| --------------------- | ------------------------- | ----------------------- | ---------------------------------------------- | ------------------------------------------------ |
| **Standard Color**    | `background-color: (etc)` | `bg-blue-500`           | `{ bg: 'blue-500' }`                           |                                                  |
| **Opacity Modifier**  | `(etc) / 0.5`             | `bg-blue-500/50`        | `{ bg: { color: 'blue-500', op: 50 } }`        | v4: any integer is bare.                         |
| **Opacity 0.5-step**  | `(etc) / 0.755`           | `bg-black/75.5`         | `{ bg: { color: 'black', op: 75.5 } }`         | Decimals with 0.5 step are bare.                 |
| **Arbitrary Opacity** | `(etc) / 0.73`            | `bg-pink-500/[78%]`     | `{ bg: { color: 'pink-500', op: '78%' } }`     | `%`, leading `.`, non-0.5 decimals go to `[]`.   |
| **Variable Opacity**  | `(etc) / var(--alpha)`    | `bg-blue-500/(--alpha)` | `{ bg: { color: 'blue-500', op: '--alpha' } }` | Color opacity modifiers use `()` for CSS vars.   |
| **Inherited Opacity** | `color-mix((etc))`        | `text-current/50`       | `{ color: { color: 'current', op: 50 } }`      | Use `current` color to modify inherited opacity. |

## Adding custom styles

Extending the framework.

## Using arbitrary values

One-off values without configuration.

| Concept             | CSS Property             | Tailwind v4 Class     | `sz` Prop (Object Syntax)   | Note                            |
| :------------------ | :----------------------- | :-------------------- | :-------------------------- | :------------------------------ |
| **Arbitrary Value** | `mask-image: url((etc))` | `mask-[url((etc))]`   | `{ mask: 'url((etc))' }`    | Auto-detects custom value.      |
| **Arbitrary Prop**  | `mask-type: luminance`   | `mask-type-luminance` | `{ maskType: 'luminance' }` | Maps known props automatically. |
| **CSS Variable**    | `--my-var: 10px`         | `[--my-var:10px]`     | `{ '--my-var': '10px' }`    | String key for unknowns.        |

## Using custom CSS & Plugins

Integrating external styles.

| Concept        | Tailwind v4 Approach   | `sz` Equivalent         | Note                              |
| :------------- | :--------------------- | :---------------------- | :-------------------------------- |
| **CSS Import** | `@import "custom.css"` | `import './custom.css'` | Standard module bundler behavior. |
| **Plugin**     | `@plugin "my-plugin"`  | Config `plugins: []`    | Compiler configuration.           |

## Functions & directives

Configuration and logic.

| Concept            | Config                | Tailwind v4 Output | `sz` Prop Input           | Note                                            |
| :----------------- | :-------------------- | :----------------- | :------------------------ | :---------------------------------------------- |
| **Utility Prefix** | `prefix: 'tw-'`       | `tw-text-center`   | `{ textAlign: 'center' }` |                                                 |
| **@apply**         | `@apply items-center` | N/A                | `{ (etc)commonOps }`      | **Discouraged**: Use JS Object Spread.          |
| **theme()**        | `theme('spacing.4')`  | `w-(--spacing-4)`  | `{ w: '--spacing-4' }`    | **Rule**: Use CSS Variable sugar (no parens).   |
| **@utility**       | `@utility tab-active` | `tab-active`       | `{ tabActive: true }`     | **Blind Support**: CamelCase maps to ClassName. |
| **@theme**         | `@theme { (etc) }`    | N/A                | N/A                       | Configured in CSS, used via Vars/Classes.       |

## Detecting classes in source files

Strategy for static analysis vs runtime generation.

**Core Decision**: `CSSzyx` uses **AST Parsing**, not Regex Scanning. This allows for smarter static extraction and shake-tree logic.

| Concept                       | Tailwind Scanner (Regex) | `sz` Compiler (AST)      | Note                                                                                                                                                                                                                       |
| :---------------------------- | :----------------------- | :----------------------- | :------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **String Interpolation**      | ❌ Fails `bg-${color}`   | ✅ **Runtime Support**   | Compiler marks as dynamic, handled at runtime via variable injection.                                                                                                                                                      |
| **Conditionals**              | ❌ Fails logic           | ✅ **Static Extraction** | `{ bg: active ? 'blue' : 'gray' }` and `{ scale: shrunk ? 75 : 100 }` → both branches compiled to static Tailwind classes at build time. CSS variable fallback only when a branch is a runtime expression (not a literal). |
| **Variable reference**        | ❌ Not applicable        | ✅ **Build time**        | `sz={myVar}` — pass variable directly when no override needed. Compiler resolves the binding to its object literal initializer (incl. `as const`, `satisfies`, explicit type annotation).                                  |
| **Object Spread**             | ❌ Fails spread          | ✅ **Static Analysis**   | `sz={{ ...baseProps, key: val }}` — use spread only when overriding/adding; last key wins. Resolved at build time for local literals. Multiple/nested spreads supported. Imported vars fall back to `_sz()` — no crash.    |
| **Array variable items**      | ❌ Not applicable        | ✅ **Build time**        | `sz={[varA, varB]}` and `sz={[varA, cond && varB]}` — variable array elements resolved at build time. Static elements merged to single string; conditional elements use `_szMerge` at runtime.                             |
| **Ternary variable branches** | ❌ Not applicable        | ✅ **Build time**        | `sz={cond ? varA : varB}` — both branches compiled to static strings when variables are local literals.                                                                                                                    |
| **Chained variables**         | ❌ Not applicable        | ✅ **Build time**        | `const b = { ...a, key: val }; <div sz={b} />` — compiler resolves the chain recursively.                                                                                                                                  |
| **Safelist**                  | Required for dynamic     | **Not Required**         | Auto-detected for static logic; Auto-injected for runtime values.                                                                                                                                                          |

**Performance Rule**: Prefer **Static Strings** in `sz` objects.

- ✅ `sz({ color: isErr ? 'red-500' : 'green-500' })` (Zero Runtime)
- ⚠️ `sz({ color:`red-${shade}`})` (Runtime injection overhead)
