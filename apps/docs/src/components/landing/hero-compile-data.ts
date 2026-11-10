/**
 * The `sz` to Tailwind pairs the landing hero animates through.
 *
 * Each `sz` is written as source and `tw` is the class it compiles to; a test
 * lowers every pair, so an example that stops compiling to its class fails it.
 */

// ── Compiler animation data ────────────────────────────────────────
// Object form is intentional: property values sit after `:` in the bundle, which is
// outside the lookbehind of the mangler's Pass 3 regex (?<=(?:[,(]|&&)\s*).
// Array tuple form `[sz, tw]` would place the `tw` string after `,` → Pass 3 would
// mangle it, replacing e.g. "flex" with the mangled token "z".
/** One example: the `sz` as written, and the class it compiles to. */
export interface CompileEntry {
    sz: string;
    tw: string;
}
export const compileData: CompileEntry[] = [
    // Common
    { sz: "{display: 'flex'}", tw: "flex" },
    { sz: "{shrink: 0}", tw: "shrink-0" },
    { sz: "{grayscale: true}", tw: "grayscale" },
    { sz: "{firstLine: {textTransform: 'uppercase'}}", tw: "first-line:uppercase" },
    { sz: "{bg: 'sky-500'}", tw: "bg-sky-500" },
    { sz: "{fontFamily: 'mono'}", tw: "font-mono" },
    { sz: "{bgRepeat: 'no-repeat'}", tw: "bg-no-repeat" },

    // Complex deep nesting resulting in single classes
    { sz: "{peer: {hover: {color: 'white'}}}", tw: "peer-hover:text-white" },
    { sz: "{selection: {bg: 'highlight-bg'}}", tw: "selection:bg-highlight-bg" },
    { sz: "{selection: {text: 'highlight-fb'}}", tw: "selection:text-highlight-fb" },
    { sz: "{insetShadowColor: { color: 'red-500', op: 30 }}", tw: "inset-shadow-red-500/30" },
    { sz: "{hover: {active: {focus: {bg: 'blue-600'}}}}", tw: "hover:active:focus:bg-blue-600" },
    { sz: "{disabled: {hover: {opacity: 80}}}", tw: "disabled:hover:opacity-80" },
    { sz: "{md: {dark: {text: {color: 'white', op: 90}}}}", tw: "md:dark:text-white/90" },
    { sz: "{groupHover: {last: {borderB: 2}}}", tw: "group-hover:last:border-b-2" },
    { sz: "{sm: {focusWithin: {ringOffsetColor: 'primary'}}}", tw: "sm:focus-within:ring-offset-primary" },
    { sz: "{lg: {peerChecked: {scale: 105}}}", tw: "lg:peer-checked:scale-105" },
    { sz: "{ariaExpanded: {flex: 1}}", tw: "aria-expanded:flex-1" },
    { sz: "{'in-[.group.is-published]': {bg: 'green-50'}}", tw: "in-[.group.is-published]:bg-green-50" },
    { sz: "{has: {':checked': {text: 'blue-900'}}}", tw: "has-[:checked]:text-blue-900" },
    { sz: "{supports: {'display:grid': {gridCols: 2}}}", tw: "supports-[display:grid]:grid-cols-2" },
    { sz: "{motionReduce: {transition: 'none'}}", tw: "motion-reduce:transition-none" },
    { sz: "{bgImg: { gradient: 'conic', dir: 'at 50% 75%' }}", tw: "bg-conic-[at_50%_75%]" },

    // Abstract property combinations
    { sz: "{'[&>span]': {color: 'blue'}}", tw: "[&>span]:text-blue" },
    { sz: `{before: {content: '""', display: 'block'}}`, tw: "before:content-[''] before:block" },
    { sz: "{xl: {portrait: {bgImg: {gradient: 'linear', dir: 'to-r'}}}}", tw: "xl:portrait:bg-linear-to-r" },
    { sz: "{lg: {landscape: {w: 'full'}}}", tw: "lg:landscape:w-full" },
    { sz: "{print: {display: 'none'}}", tw: "print:hidden" },
    { sz: "{selection: {bg: 'fuchsia-300'}}", tw: "selection:bg-fuchsia-300" },
    { sz: "{marker: {text: 'sky-400'}}", tw: "marker:text-sky-400" },
    { sz: "{file: {border: 0, bg: 'transparent'}}", tw: "file:border-0 file:bg-transparent" },
    { sz: "{placeholder: {text: 'slate-400'}}", tw: "placeholder:text-slate-400" },

    // Arbitrary values and variants
    { sz: "{maxW: '1200px'}", tw: "max-w-[1200px]" },
    { sz: "{w: 'calc(100vh-2rem)'}", tw: "w-[calc(100vh-2rem)]" },
    { sz: "{gridCols: '200px minmax(900px, 1fr) 100px'}", tw: "grid-cols-[200px_minmax(900px,_1fr)_100px]" },
    { sz: "{bgImg: 'url(…)'}", tw: "bg-[url(…)]" },
    { sz: "{text: '#50d71e'}", tw: "text-[#50d71e]" },
    { sz: "{animate: 'spin 3s linear infinite'}", tw: "animate-[spin_3s_linear_infinite]" },
    { sz: "{dropShadow: '0 0 15px rgba(255,255,255,0.02)'}", tw: "drop-shadow-[0_0_15px_rgba(255,255,255,0.02)]" },

    // Specific edge cases
    { sz: "{bgImg: {gradient: 'conic', dir: -145}}", tw: "-bg-conic-145" },
    { sz: "{focusVisible: {ring: 2, ringColor: 'rose-500'}}", tw: "focus-visible:ring-2 focus-visible:ring-rose-500" },
    { sz: "{data: {'state=open': {animate: 'slide-down'}}}", tw: "data-[state=open]:animate-slide-down" },
    { sz: "{even: {bg: 'slate-100'}}", tw: "even:bg-slate-100" },
    { sz: "{only: {flex: 1}}", tw: "only:flex-1" },

    // Spacing utilities
    { sz: "{p: 4}", tw: "p-4" },
    { sz: "{px: 6}", tw: "px-6" },
    { sz: "{m: 'auto'}", tw: "m-auto" },
    { sz: "{gap: 6}", tw: "gap-6" },

    // Sizing
    { sz: "{w: 'full'}", tw: "w-full" },
    { sz: "{h: 'screen'}", tw: "h-screen" },
    { sz: "{maxW: '2xl'}", tw: "max-w-2xl" },

    // Layout
    { sz: "{overflow: 'hidden'}", tw: "overflow-hidden" },
    { sz: "{z: 10}", tw: "z-10" },
    { sz: "{position: 'absolute'}", tw: "absolute" },
    { sz: "{display: 'inline-flex'}", tw: "inline-flex" },

    // Flexbox & Grid
    { sz: "{flexDir: 'col'}", tw: "flex-col" },
    { sz: "{items: 'center'}", tw: "items-center" },
    { sz: "{justify: 'between'}", tw: "justify-between" },
    { sz: "{gridCols: 3}", tw: "grid-cols-3" },
    { sz: "{grow: true}", tw: "grow" },

    // Typography
    { sz: "{text: 'xl'}", tw: "text-xl" },
    { sz: "{weight: 'bold'}", tw: "font-bold" },
    { sz: "{tracking: 'tight'}", tw: "tracking-tight" },
    { sz: "{truncate: true}", tw: "truncate" },

    // Borders & Effects
    { sz: "{rounded: 'full'}", tw: "rounded-full" },
    { sz: "{ring: 2}", tw: "ring-2" },
    { sz: "{shadow: 'lg'}", tw: "shadow-lg" },
    { sz: "{opacity: 50}", tw: "opacity-50" },
    { sz: "{blur: 'sm'}", tw: "blur-sm" },

    // Transforms
    { sz: "{rotate: 45}", tw: "rotate-45" },
    { sz: "{scale: 105}", tw: "scale-105" },

    // Backgrounds
    { sz: "{bg: {color: 'blue-500', op: 50}}", tw: "bg-blue-500/50" },
    { sz: "{from: 'blue-500'}", tw: "from-blue-500" },
    { sz: "{to: 'purple-500'}", tw: "to-purple-500" },
];
