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
| **Flex Container**   | `display: flex`                          | `flex`            | `{ display: 'flex' }` |

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

| Concept              | CSS Rule                            | Tailwind v4 Class | `sz` Prop (Object Syntax)     |
| :------------------- | :---------------------------------- | :---------------- | :---------------------------- |
| **Small Breakpoint** | `@media (width >= 40rem) { (etc) }` | `sm:grid-cols-3`  | `{ sm: { gridCols: 3 } }`     |
| **Medium Layout**    | `@media (width >= 48rem) { (etc) }` | `md:flex`         | `{ md: { display: 'flex' } }` |
| **Large Spacing**    | `@media (width >= 64rem) { (etc) }` | `lg:px-8`         | `{ lg: { px: 8 } }`           |

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
| **First of Type**        | `first-of-type:block`                        | `{ firstOfType: { display: 'block' } }`                                    | **Sugar**: CamelCase alias. |
| **Only Child**           | `only:block`                                 | `{ only: { display: 'block' } }`                                           |                             |
| **Empty**                | `empty:hidden`                               | `{ empty: { display: 'none' } }`                                           |                             |
| **Visited**              | `visited:text-purple`                        | `{ visited: { color: 'purple' } }`                                         |                             |
| **Focus Within**         | `focus-within:ring`                          | `{ focusWithin: { ring: true } }`                                          | **Sugar**: CamelCase alias. |
| **Focus Visible**        | `focus-visible:ring`                         | `{ focusVisible: { ring: true } }`                                         | **Sugar**: CamelCase alias. |
| **Target**               | `target:shadow`                              | `{ target: { shadow: true } }`                                             |                             |

## :has()

Styling based on descendants.

| Concept            | Tailwind v4 Class           | `sz` Prop (Object Syntax)                            | Note                                  |
| :----------------- | :-------------------------- | :--------------------------------------------------- | :------------------------------------ |
| **Has Descendant** | `has-[img]:bg-blue`         | `{ has: { img: { bg: 'blue' } } }`                   | **Sugar**: Nested selector.           |
| **Has State**      | `has-[:checked]:bg-blue`    | `{ has: { checked: { bg: 'blue' } } }`               | **Sugar**: Auto-detects pseudo-class. |
| **Arbitrary Has**  | `has-[.custom-class]:block` | `{ has: { '.custom-class': { display: 'block' } } }` |                                       |

## Styling based on parent state (Groups)

Styling children based on parent `group` class.

| Concept                      | Tailwind v4 Class                     | `sz` Prop (Object Syntax)                                      | Note                                 |
| :--------------------------- | :------------------------------------ | :------------------------------------------------------------- | :----------------------------------- |
| **Group Hover**              | `group-hover:text-white`              | `{ group: { hover: { color: 'white' } } }`                     | **Sugar**: Nested scope.             |
| **Group Focus**              | `group-focus:text-white`              | `{ group: { focus: { color: 'white' } } }`                     |                                      |
| **Group Active**             | `group-active:text-white`             | `{ group: { active: { color: 'white' } } }`                    |                                      |
| **Nested Groups**            | `group-hover/name:text-white`         | `{ group: { name: { hover: { color: 'white' } } } }`           | **Sugar**: Scope name as nested key. |
| **Arbitrary Groups**         | `group-[.is-published]:block`         | `{ group: { '.is-published': { display: 'block' } } }`         |                                      |
| **Group Has**                | `group-has-[a]:block`                 | `{ group: { has: { a: { display: 'block' } } } }`              |                                      |
| **Group Data**               | `group-data-[active]:text-blue`       | `{ group: { data: { active: { color: 'blue' } } } }`           | **Sugar**: Nested `data` key.        |
| **Group Data (named)**       | `group-data-[active]/card:text-blue`  | `{ group: { card: { data: { active: { color: 'blue' } } } } }` | Name before `data` key.              |
| **Group Data (value match)** | `group-data-[state=open]:block`       | `{ group: { data: { 'state=open': { display: 'block' } } } }`  | `=` in key → bracket form always.    |
| **Group ARIA**               | `group-aria-expanded:block`           | `{ group: { aria: { expanded: { display: 'block' } } } }`      | Standard states: bare form.          |
| **Group ARIA (arbitrary)**   | `group-aria-[current=page]:font-bold` | `{ group: { aria: { 'current=page': { weight: 'bold' } } } }`  | Non-standard: bracket form.          |

## Styling based on sibling state (Peers)

Styling based on previous sibling `peer` class.

| Concept                     | Tailwind v4 Class                   | `sz` Prop (Object Syntax)                                    | Note                                 |
| :-------------------------- | :---------------------------------- | :----------------------------------------------------------- | :----------------------------------- |
| **Peer Hover**              | `peer-hover:text-white`             | `{ peer: { hover: { color: 'white' } } }`                    | **Sugar**: Nested scope.             |
| **Peer Checked**            | `peer-checked:bg-blue`              | `{ peer: { checked: { bg: 'blue' } } }`                      |                                      |
| **Differentiating Peers**   | `peer-checked/name:bg-blue`         | `{ peer: { name: { checked: { bg: 'blue' } } } }`            | **Sugar**: Scope name as nested key. |
| **Arbitrary Peers**         | `peer-[.is-dirty]:block`            | `{ peer: { '.is-dirty': { display: 'block' } } }`            |                                      |
| **Peer Data**               | `peer-data-[active]:text-blue`      | `{ peer: { data: { active: { color: 'blue' } } } }`          | **Sugar**: Nested `data` key.        |
| **Peer Data (value match)** | `peer-data-[state=open]:block`      | `{ peer: { data: { 'state=open': { display: 'block' } } } }` | `=` in key → bracket form always.    |
| **Peer ARIA**               | `peer-aria-checked:bg-blue`         | `{ peer: { aria: { checked: { bg: 'blue' } } } }`            | Standard states: bare form.          |
| **Peer ARIA (arbitrary)**   | `peer-aria-[invalid=true]:text-red` | `{ peer: { aria: { 'invalid=true': { color: 'red' } } } }`   | Non-standard: bracket form.          |

## :not()

Inverse conditions.

| Concept          | Tailwind v4 Class                   | `sz` Prop (Object Syntax)                                         | Note |
| :--------------- | :---------------------------------- | :---------------------------------------------------------------- | :--- |
| **Not Hover**    | `not-hover:opacity-75`              | `{ not: { hover: { opacity: 75 } } }`                             |      |
| **Not First**    | `not-first:mt-4`                    | `{ not: { first: { mt: 4 } } }`                                   |      |
| **Not Supports** | `not-supports-[display:grid]:block` | `{ not: { supports: { 'display:grid': { display: 'block' } } } }` |      |

## Pseudo-elements

Advanced content styling.

| Concept          | Tailwind v4 Class       | `sz` Prop (Object Syntax)                       | Note                  |
| :--------------- | :---------------------- | :---------------------------------------------- | :-------------------- |
| **Before/After** | `before:content-['']`   | `{ before: { (etc) } }`                         | Defaults used.        |
| **Placeholder**  | `placeholder:text-gray` | `{ placeholder: { color: 'gray' } }`            |                       |
| **File**         | `file:border`           | `{ file: { border: true } }`                    |                       |
| **Marker**       | `marker:text-blue`      | `{ marker: { color: 'blue' } }`                 |                       |
| **Selection**    | `selection:bg-pink`     | `{ selection: { bg: 'pink' } }`                 |                       |
| **First Line**   | `first-line:uppercase`  | `{ firstLine: { textTransform: 'uppercase' } }` | **Sugar**: CamelCase. |
| **First Letter** | `first-letter:text-7xl` | `{ firstLetter: { text: '7xl' } }`              | **Sugar**: CamelCase. |
| **Backdrop**     | `backdrop:blur`         | `{ backdrop: { blur: true } }`                  |                       |

## Media & Feature Queries

Environment-based styling.

| Concept               | Tailwind v4 Class                 | `sz` Prop (Object Syntax)                                     | Note                          |
| :-------------------- | :-------------------------------- | :------------------------------------------------------------ | :---------------------------- |
| **Breakpoints**       | `md:block lg:flex`                | `{ md: { display: 'block' }, lg: { display: 'flex' } }`       |                               |
| **Container Queries** | `@md:block @lg:flex`              | `{ '@md': { display: 'block' }, '@lg': { display: 'flex' } }` | **Note**: String key for `@`. |
| **Reduced Motion**    | `motion-reduce:hidden`            | `{ motionReduce: { display: 'none' } }`                       | **Sugar**: CamelCase.         |
| **Prefers Contrast**  | `contrast-more:border`            | `{ contrastMore: { border: true } }`                          |                               |
| **Forced Colors**     | `forced-colors:border-gray`       | `{ forcedColors: { borderColor: 'gray' } }`                   | **Sugar**: CamelCase.         |
| **Inverted Colors**   | `inverted-colors:invert`          | `{ invertedColors: { invert: true } }`                        | **Sugar**: CamelCase.         |
| **Pointer**           | `pointer-coarse:p-4`              | `{ pointerCoarse: { p: 4 } }`                                 | **Sugar**: CamelCase.         |
| **Any-Pointer**       | `any-pointer-fine:cursor-pointer` | `{ anyPointerFine: { cursor: 'pointer' } }`                   | v4.1. **Sugar**: CamelCase.   |
| **User Valid**        | `user-valid:border-green-500`     | `{ userValid: { borderColor: 'green-500' } }`                 | v4.1. Form validation state.  |
| **User Invalid**      | `user-invalid:border-red-500`     | `{ userInvalid: { borderColor: 'red-500' } }`                 | v4.1. Form validation state.  |
| **Details Content**   | `details-content:block`           | `{ detailsContent: { display: 'block' } }`                    | v4.1. **Sugar**: CamelCase.   |
| **Print**             | `print:hidden`                    | `{ print: { display: 'none' } }`                              |                               |
| **Orientation**       | `portrait:hidden`                 | `{ portrait: { display: 'none' } }`                           |                               |
| **Scripting**         | `noscript:block`                  | `{ noscript: { display: 'block' } }`                          |                               |
| **Supports**          | `supports-[display:grid]:grid`    | `{ supports: { 'display:grid': { display: 'grid' } } }`       |                               |
| **Starting Style**    | `starting:opacity-0`              | `{ starting: { opacity: 0 } }`                                |                               |

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
| **Breakpoint Range**     | `768px <= width < 1280px`   | `md:max-xl:flex`          | `{ md: { maxXl: { display: 'flex' } } }`          | **Sugar**: CamelCase for `max-xl`.  |
| **Single Breakpoint**    | `md only`                   | `md:max-lg:flex`          | `{ md: { maxLg: { display: 'flex' } } }`          | Target specific range.              |
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

| Concept                  | Tailwind v4 Class    | `sz` Prop (Object Syntax)                        | Note                                      |
| :----------------------- | :------------------- | :----------------------------------------------- | :---------------------------------------- |
| **Mark Container**       | `@container`         | `{ '@container': true }`                         |                                           |
| **Named Container**      | `@container/sidebar` | `{ '@container': 'sidebar' }`                    | **Sugar**: Value string = container name. |
| **Container Breakpoint** | `@md:flex`           | `{ '@md': { display: 'flex' } }`                 | **Note**: `@` prefix in key.              |
| **Named Query**          | `@md/sidebar:block`  | `{ '@md': { sidebar: { display: 'block' } } }`   | **Sugar**: Nest name inside query key.    |
| **Container Range**      | `@sm:@max-md:block`  | `{ '@sm': { '@maxMd': { display: 'block' } } }`  |                                           |
| **Arbitrary Query**      | `@min-[475px]:flex`  | `{ '@min': { '[475px]': { display: 'flex' } } }` |                                           |
| **Container Units**      | `w-[50cqw]`          | `{ w: '50cqw' }`                                 |                                           |

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

| Concept                       | Tailwind Scanner (Regex) | `sz` Compiler (AST)      | Note                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                            |
| :---------------------------- | :----------------------- | :----------------------- | :-------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **String Interpolation**      | ❌ Fails `bg-${color}`   | ✅ **Runtime Support**   | Compiler marks as dynamic, handled at runtime via variable injection.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                           |
| **Conditionals**              | ❌ Fails logic           | ✅ **Static Extraction** | `{ bg: active ? 'blue' : 'gray' }` and `{ scale: shrunk ? 75 : 100 }` → both branches compiled to static Tailwind classes at build time. CSS variable fallback only when a branch is a runtime expression (not a literal).                                                                                                                                                                                                                                                                                                                                      |
| **Variable reference**        | ❌ Not applicable        | ✅ **Build time**        | `sz={myVar}` — pass variable directly when no override needed. Compiler resolves the binding to its object literal initializer (incl. `as const`, `satisfies`, explicit type annotation).                                                                                                                                                                                                                                                                                                                                                                       |
| **Object Spread**             | ❌ Fails spread          | ✅ **Static Analysis**   | `sz={{ ...baseProps, key: val }}` — use spread only when overriding/adding; last key wins. Resolved at build time for local literals. Multiple/nested spreads supported. Imported vars fall back to `_sz()` — no crash.                                                                                                                                                                                                                                                                                                                                         |
| **Array variable items**      | ❌ Not applicable        | ✅ **Build time**        | `sz={[varA, varB]}` and `sz={[varA, cond && varB]}` — LATER WINS composition. All-static-object arrays deep-merge at build (later leaf wins per key path, sibling keys survive) into one className; arrays with strings/conditions/dynamic elements emit `_szcn(...)` — a compiler-injected helper (`_` = generated code, never hand-authored; the unmemoized twin of `szcn`) applying the same later-wins rule per property group at runtime; dynamic elements (e.g. a forwarded `szsc` slot) pass through `_szPart` (string passthrough / sz-object compile). |
| **Ternary variable branches** | ❌ Not applicable        | ✅ **Build time**        | `sz={cond ? varA : varB}` — both branches compiled to static strings when variables are local literals.                                                                                                                                                                                                                                                                                                                                                                                                                                                         |
| **Chained variables**         | ❌ Not applicable        | ✅ **Build time**        | `const b = { ...a, key: val }; <div sz={b} />` — compiler resolves the chain recursively.                                                                                                                                                                                                                                                                                                                                                                                                                                                                       |
| **Safelist**                  | Required for dynamic     | **Not Required**         | Auto-detected for static logic; Auto-injected for runtime values.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                               |

**Performance Rule**: Prefer **Static Strings** in `sz` objects.

- ✅ `sz({ color: isErr ? 'red-500' : 'green-500' })` (Zero Runtime)
- ⚠️ `sz({ color:`red-${shade}`})` (Runtime injection overhead)

## TypeScript: `sz` on custom components

The JSX augmentation (`@csszyx/types/jsx`) adds `sz` to **host elements only**
(`<div>`, `<span>`, … via React `HTMLAttributes` / `SVGAttributes`). A custom
component has its own props type, so `sz` is **not auto-typed** there.

Two independent layers:

- **Compile** — the transform lowers `sz` → `className` on ANY element, custom
  included: `<Card sz={{ p: 4 }} />` → `<Card className="p-4" />`. So it works at
  runtime as long as the component forwards `className` down to a host element.
- **Type** — only auto-typed when the component's props derive from host attributes.

| Component props type                                    | `sz` typed?  |
| :------------------------------------------------------ | :----------- |
| `{ title: string }` (fresh type)                        | ❌ TS error  |
| `ComponentProps<'div'>` / `extends HTMLAttributes<T>`   | ✅ inherited |
| `{ title: string } & Pick<ComponentProps<'div'>, 'sz'>` | ✅ just `sz` |

Add `sz` to a fresh props type by picking it (no import needed) or declaring it:

```tsx
import type { ComponentProps } from "react";
type Props = { title: string } & Pick<ComponentProps<"div">, "sz">;
// equivalent: import type { SzPropValue } from '@csszyx/types'; then `sz?: SzPropValue`
```

Pick is for CONCRETE tags only. On a generic component (`E extends ElementType`),
`Pick<ComponentProps<E>, 'sz'>` distributes over union members without the
augmentation and resolves order-dependently (sz can flip optional→required when an
unrelated file changes). Generic wrappers declare the prop directly — `sz?: SzInput`
(from `csszyx`) — which is stable and also accepts szv factory output
(`sz={someSzv({ v })}`; `SzPropValue` rejects it, `SzInput` is the forwarding type).

The augmentation must be in scope (a `/// <reference types="@csszyx/types/jsx" />`
or the project's `csszyx-env.d.ts`), otherwise `sz` is not a key of
`ComponentProps<'div'>` and `Pick` fails.

## Styling parts of a compound component

No special API. `sz` compiles to `className` on ANY element — host tags, custom
components, and dotted names (`Card.Header`) — and each is safelisted + mangled like
a normal `sz`. So style a compound component's parts by giving each part its own `sz`:

```tsx
<Card sz={{ p: 4 }}>
  <Card.Header sz={{ bg: "gray-100", font: "bold" }}>Title</Card.Header>
  <Card.Body sz={{ text: "sm" }}>Body</Card.Body>
</Card>
// → each part compiled to className at build time; all classes safelisted.
```

Build it as a plain React compound component; each part forwards `sz` (already
rewritten to `className` by the transform) onto a host element. Type each part with
`ComponentProps<'div'>` (or the relevant tag) to get `sz` + `className` for free.
Merge a part's own defaults with the consumer's override via `szcn` (mangle-aware,
last-wins) — the RECOMMENDED pattern for slot defaults. Multi-property prefixes
(`text`, `bg`, `border`, `font`, `flex`, `divide`, `ring`, `outline`) are
value-classified into property groups: same property → later wins
(`szcn('text-base','text-sm')` → `text-sm`); different properties co-exist
(`text-red-500` never removes `text-sm`); unclassifiable values are always kept
(fail-safe). Custom `@theme` tokens join their groups automatically when the CSS
is scanned (`build.scanCss`); classes written in plain CSS register via
`registerSzcnGroups({ colors: [...], textSizes: [...] })` from `@csszyx/runtime`.

## `szs` — slot map for a component's internal parts

For parts a component renders ITSELF (no consumer content), `szs` maps slot names
to sz values. The transform compiles each VALUE to its class string (key kept),
safelisting + mangling like `sz`, and rewrites the attribute to `szsc` ("szs,
compiled") — the string-typed prop the component reads. Consumers WRITE `szs`,
components READ `szsc`; declare both from one slot union with `SzsProps`.

```tsx
type CardProps = { title: string } & SzsProps<"header" | "icon">; // from @csszyx/types
<Card szs={{ header: { bg: "gray-100" }, icon: { color: "red-500" } }} />;
// → <Card szsc={{ header: "bg-gray-100", icon: "text-red-500" }} />
// component: <header className={props.szsc?.header} />   // plain string — no cast
// szsc is undefined when the consumer didn't style the slot or the call site
// wasn't compiled (build warns) — an object can never reach className.
```

Rules: custom components only (host element → dev warn, unchanged). Slot values
must be STATIC — a pure object literal (nested variants OK) or a raw class string;
identifiers/conditionals/spreads leave the attribute unchanged with a dev warning.
Keys are identifiers. `sz` styles the element itself; `szs` styles its internal
parts — a component can take both.

**AI contract (do exactly this):**

- Type props with `SzsProps<'a' | 'b'>` from `@csszyx/types` (intersect for
  extra props: `{ title: string } & SzsProps<'a'>`). Read `props.szsc?.<slot>`
  in the component; the consumer passes `szs={{ … }}`.
- `szsc?.<slot>` is ALREADY a `string | undefined`. Forward it straight:
  `className={szsc?.icon}`, or compose defaults with an array `sz={[{…}, szsc?.icon]}`.
- Compose slot + default with `sz={[default, szsc?.slot]}` (array = later-wins).
  Do NOT wrap it in `szcn(...)` in `className` — that pattern is obsolete.
- `szsClass()` was REMOVED — do not emit it. `_szcn`/`_szPart` are
  compiler-injected (the `_` marks generated code) — never write, import, or
  suggest them; they appear only in compiler OUTPUT.
- Never emit `szsc={{…}}` yourself — the compiler produces it from `szs`.
  Author `szs`, read `szsc`.

Migration from ≤0.10: `className={szcn('font-medium', szsClass(szs?.title))}`
→ `sz={[{ weight: 'medium' }, szsc?.title]}` (and props `Szs<'title'>` →
`SzsProps<'title'>`, read `szsc` not `szs`).
