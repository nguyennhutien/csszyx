/**
 * Tell Tailwind's own classes from the ones a project wrote.
 *
 * A merge removes a class when a later one sets everything it sets. That is
 * safe only for a class that does nothing but style: a class the project
 * declared with `@utility`, registered through a plugin, or selects in a rule
 * of its own is often a hook for script or for another rule, and the class's
 * signature — the CSS of its own rule — cannot show that. `.reveal.is-visible`
 * and `querySelector('.reveal')` are not in `reveal`'s signature.
 *
 * Tailwind records no origin on a utility, so the question is asked of a
 * second design system compiled from the same stylesheets with every project
 * definition taken out: a class that one still serves is Tailwind's own. The
 * helpers here do the taking out; the emitted-class oracle runs the compile,
 * since it is the one place allowed to load a design system.
 *
 * Every helper errs towards "the project's": a class read as the project's is
 * kept, which is what the build did before 0.18, while a class misread as
 * Tailwind's can be removed and no library can bring it back.
 *
 * @module
 */

/** Where a class a design system serves comes from. */
export type ClassOrigin =
    /** Served by Tailwind itself, with any theme value and any variant. */
    | 'tailwind'
    /** Declared by `@utility`, a plugin, or a stylesheet the project imports. */
    | 'custom'
    /** Tailwind's own, and named in a selector of the project's CSS. */
    | 'hook';

/**
 * The answer, or why there is none.
 *
 * Unavailable means no class can be shown to be Tailwind's own, so a merge
 * removes nothing.
 */
export type OriginOracle =
    | {
          ok: true;
          /**
           * The origin of a class the project serves.
           *
           * @param candidate - Class as written, variants and prefix included.
           * @returns Where it comes from.
           */
          origin(candidate: string): ClassOrigin;
      }
    | { ok: false; reason: string };

/** Plugin API members that register a class; every other member still runs. */
const REGISTRARS = new Set(['addUtilities', 'matchUtilities', 'addComponents', 'matchComponents']);

/** An at-rule name, read where a statement starts. */
const AT_KEYWORD = /@([\w-]+)/y;

/** Hex digits of an escaped code point. */
const HEX_DIGIT = /[0-9a-f]/i;

/** A character that continues an identifier without an escape. */
const NAME_CHAR = /[\w-]/;

/**
 * One escape inside an identifier: a hex code point with the one whitespace
 * that may end it (a CRLF counts as one), or a character as is.
 */
const ESCAPE = /\\(?:([0-9a-f]{1,6})(?:\r\n|[ \t\n\r\f])?|([\s\S]))/gi;

/** A statement that names classes in its parameters rather than in a selector. */
const CUSTOM_VARIANT = /^\s*@custom-variant\b/;

/** The `@utility` a prelude opens, with its name. */
const UTILITY_PRELUDE = /^\s*@utility\s+(\S+)/;

/** The largest code point; a larger escape reads as U+FFFD, as CSS says. */
const MAX_CODE_POINT = 0x10ffff;

/** Whether a stylesheet declares anything a merge must tell from Tailwind's. */
const CUSTOM_SOURCE = /@(?:utility|plugin|config)\b/;

/**
 * Index just past the comment starting at `start`.
 *
 * @param css - Stylesheet text.
 * @param start - Index of the `/` of `/*`.
 * @returns Index after `*\/`, or the end of the text.
 */
function afterComment(css: string, start: number): number {
    const end = css.indexOf('*/', start + 2);
    return end === -1 ? css.length : end + 2;
}

/**
 * Index just past the string starting at `start`.
 *
 * @param css - Stylesheet text.
 * @param start - Index of the opening quote.
 * @returns Index after the closing quote, or the end of the text.
 */
function afterString(css: string, start: number): number {
    const quote = css[start];
    let index = start + 1;
    while (index < css.length) {
        const char = css[index];
        if (char === '\\') index += 2;
        else if (char === quote || char === '\n') return index + 1;
        else index += 1;
    }
    return css.length;
}

/**
 * Index just past an unquoted `url(...)` starting at `start`, or null when
 * `start` does not begin one.
 *
 * Its body is one token up to the `)`: a quote or a brace inside it is not
 * a string or a block. Read otherwise, an apostrophe in `url(it's.png)` would
 * swallow a minified stylesheet to the end of the line.
 *
 * @param css - Stylesheet text.
 * @param start - Where to look.
 * @returns The index after the closing `)`, or null.
 */
function afterUnquotedUrl(css: string, start: number): number | null {
    if (css.slice(start, start + 4).toLowerCase() !== 'url(') return null;
    if (NAME_CHAR.test(css.charAt(start - 1))) return null;
    let index = start + 4;
    while (/\s/.test(css.charAt(index))) index += 1;
    const first = css.charAt(index);
    if (first === '"' || first === "'") return null;
    while (index < css.length) {
        const char = css[index];
        if (char === ')') return index + 1;
        index += char === '\\' ? 2 : 1;
    }
    return css.length;
}

/**
 * Index just past whatever is skipped at `index`: a comment, a string, an
 * unquoted url, or an escaped character. Null when nothing there is skipped.
 *
 * @param css - Stylesheet text.
 * @param index - Where to look.
 * @returns The index after the skipped text, or null.
 */
function afterOpaque(css: string, index: number): number | null {
    const char = css[index];
    if (char === '/' && css[index + 1] === '*') return afterComment(css, index);
    if (char === '"' || char === "'") return afterString(css, index);
    if (char === '\\') return Math.min(index + 2, css.length);
    if (char === 'u' || char === 'U') return afterUnquotedUrl(css, index);
    return null;
}

/**
 * Index just past the statement starting at `start`: through its block when
 * it has one, through its `;` when it has not, and up to the `}` that closes
 * the block it sits in when it has neither.
 *
 * @param css - Stylesheet text.
 * @param start - Index of the statement's first character.
 * @returns The index after it.
 */
function afterStatement(css: string, start: number): number {
    let depth = 0;
    let index = start;
    while (index < css.length) {
        const skipped = afterOpaque(css, index);
        if (skipped !== null) {
            index = skipped;
            continue;
        }
        const char = css[index];
        if (char === '{') depth += 1;
        else if (char === '}') {
            if (depth === 0) return index;
            depth -= 1;
            if (depth === 0) return index + 1;
        } else if (char === ';' && depth === 0) return index + 1;
        index += 1;
    }
    return css.length;
}

/**
 * The stylesheet without the project's utilities: every `@utility` block and
 * every `@apply` statement is removed, and nothing else changes.
 *
 * `@apply` goes too, because applying a utility this removes would stop the
 * compile.
 *
 * @param css - Stylesheet text.
 * @returns The text a design system of Tailwind's own classes compiles from.
 */
export function stripCustomUtilities(css: string): string {
    let out = '';
    let index = 0;
    let atStatementStart = true;
    while (index < css.length) {
        const skipped = afterOpaque(css, index);
        if (skipped !== null) {
            if (css[index] !== '/') atStatementStart = false;
            out += css.slice(index, skipped);
            index = skipped;
            continue;
        }
        const char = css[index] as string;
        if (atStatementStart && char === '@') {
            AT_KEYWORD.lastIndex = index;
            const name = AT_KEYWORD.exec(css)?.[1];
            if (name === 'utility' || name === 'apply') {
                index = afterStatement(css, index);
                continue;
            }
        }
        if (char === '{' || char === '}' || char === ';') atStatementStart = true;
        else if (!/\s/.test(char)) atStatementStart = false;
        out += char;
        index += 1;
    }
    return out;
}

/**
 * Read one class name as the selector engine does: escapes resolved.
 *
 * @param escaped - The identifier as written in the stylesheet.
 * @returns The class name.
 */
function unescapeIdentifier(escaped: string): string {
    return escaped.replace(ESCAPE, (_, hex: string | undefined, char: string | undefined) => {
        if (hex === undefined) return char as string;
        const codePoint = Number.parseInt(hex, 16);
        const invalid =
            codePoint === 0 ||
            (codePoint >= 0xd800 && codePoint <= 0xdfff) ||
            codePoint > MAX_CODE_POINT;
        return String.fromCodePoint(invalid ? 0xfffd : codePoint);
    });
}

/**
 * Index just past the escape at `start`: a hex code point of up to six digits
 * with the one whitespace that may end it, or one other character.
 *
 * @param text - Selector text.
 * @param start - Index of the backslash.
 * @returns The index after the escape.
 */
function afterEscape(text: string, start: number): number {
    let index = start + 1;
    if (!HEX_DIGIT.test(text.charAt(index))) return Math.min(index + 1, text.length);
    while (index < start + 7 && HEX_DIGIT.test(text.charAt(index))) index += 1;
    if (text.startsWith('\r\n', index)) return index + 2;
    const next = text.charAt(index);
    return next !== '' && ' \t\n\r\f'.includes(next) ? index + 1 : index;
}

/**
 * Index just past the identifier at `start`, or `start` when none begins there.
 *
 * An identifier starts with a letter, `_`, a non-ASCII character or an escape,
 * after at most one `-`; so `.5rem` and `.-5` read as no class.
 *
 * @param text - Selector text.
 * @param start - Index just after a `.`.
 * @returns The index after the identifier.
 */
function afterIdentifier(text: string, start: number): number {
    const first = text[start] === '-' ? start + 1 : start;
    const char = text.charAt(first);
    const startsName = char === '\\' || char === '_' || /[a-z]/i.test(char) || char > '\u007f';
    if (!startsName) return start;
    let index = first;
    while (index < text.length) {
        const current = text[index] as string;
        if (current === '\\') index = afterEscape(text, index);
        else if (NAME_CHAR.test(current) || current > '\u007f') index += 1;
        else break;
    }
    return index;
}

/**
 * The classes one selector names: every `.` that begins an identifier.
 *
 * @param prelude - Selector text, comments and strings already removed.
 * @returns Class names, unescaped.
 */
function classSelectorsIn(prelude: string): string[] {
    const classes: string[] = [];
    let index = prelude.indexOf('.');
    while (index !== -1) {
        const end = afterIdentifier(prelude, index + 1);
        if (end > index + 1) classes.push(unescapeIdentifier(prelude.slice(index + 1, end)));
        index = prelude.indexOf('.', Math.max(end, index + 1));
    }
    return classes;
}

/**
 * Hand every statement's prelude to `visit`: the text before its `{` or `;`,
 * with comments and unquoted urls left out and escapes kept. A string stands
 * in the prelude as one `"`, its text in `strings`, in order: a class name
 * inside one is not a selector, but an attribute selector's value is.
 *
 * @param css - Stylesheet text.
 * @param visit - Called with each prelude, the character that ends it, and
 *        the text of its strings.
 */
function forEachPrelude(
    css: string,
    visit: (prelude: string, end: '{' | ';', strings: readonly string[]) => void,
): void {
    let prelude = '';
    let strings: string[] = [];
    let index = 0;
    while (index < css.length) {
        const skipped = afterOpaque(css, index);
        if (skipped !== null) {
            const char = css[index];
            if (char === '\\') prelude += css.slice(index, skipped);
            else if (char === '"' || char === "'") {
                prelude += '"';
                strings.push(unescapeIdentifier(css.slice(index + 1, skipped - 1)));
            }
            index = skipped;
            continue;
        }
        const char = css[index] as string;
        if (char === '{' || char === ';') visit(prelude, char, strings);
        if (char === '{' || char === '}' || char === ';') {
            prelude = '';
            strings = [];
        } else prelude += char;
        index += 1;
    }
}

/**
 * Whether a prelude selects elements: a rule's selector, or the parameters of
 * a parenthesised `@custom-variant`. The name after `@utility` defines a
 * class rather than selecting one.
 *
 * @param prelude - The statement's prelude.
 * @param end - The character that ends it.
 * @returns True when its class names are selections.
 */
function selectsElements(prelude: string, end: '{' | ';'): boolean {
    return end === '{' ? !UTILITY_PRELUDE.test(prelude) : CUSTOM_VARIANT.test(prelude);
}

/**
 * Every class a rule of this stylesheet selects on.
 *
 * Read from the text before each `{`, and from a parenthesised
 * `@custom-variant` statement, with comments, strings and unquoted urls left
 * out, so a value such as `.5rem` or `url(x.png)` is never read as a
 * selector. The name after `@utility` is a definition, not a selection, and
 * is skipped.
 *
 * @param css - Stylesheet text.
 * @returns Class names, unescaped, in the order found; repeats possible.
 */
export function classesInSelectors(css: string): string[] {
    const classes: string[] = [];
    forEachPrelude(css, (prelude, end) => {
        if (!selectsElements(prelude, end)) return;
        // One at a time: a selector list can hold more classes than a spread
        // fits on the stack.
        for (const name of classSelectorsIn(prelude)) classes.push(name);
    });
    return classes;
}

/** How an attribute selector on `class` compares its value. */
export type ClassAttributeOperator = '=' | '~=' | '|=' | '^=' | '$=' | '*=';

/** One attribute selector on `class`: `[class~="shadow-md"]`, `[class*=shadow i]`. */
export interface ClassAttributeMatcher {
    readonly operator: ClassAttributeOperator;
    readonly value: string;
    /** The `i` flag: compare without case. */
    readonly insensitive: boolean;
}

/** The classes a project's rules select on, by name and by attribute. */
export interface ClassHooks {
    readonly names: Set<string>;
    readonly attributes: ClassAttributeMatcher[];
}

/**
 * An attribute selector on `class`, read from a prelude where every string
 * stands as one `"`.
 */
const CLASS_ATTRIBUTE =
    /^\[\s*(?:[\w-]*\|)?class\s*([~|^$*]?=)\s*("|[^\s\]"]+)\s*(?:([is])\s*)?\]/i;

/**
 * Empty hooks.
 *
 * @returns No names and no attribute selectors.
 */
export function noClassHooks(): ClassHooks {
    return { names: new Set(), attributes: [] };
}

/**
 * Record the attribute selectors on `class` one prelude holds.
 *
 * @param prelude - Selector text, each string as one `"`.
 * @param strings - The strings' text, in order.
 * @param into - Where the matchers go.
 */
function attributeMatchersIn(
    prelude: string,
    strings: readonly string[],
    into: ClassAttributeMatcher[],
): void {
    let seen = 0;
    for (let index = 0; index < prelude.length; index += 1) {
        const char = prelude[index];
        if (char === '"') seen += 1;
        if (char !== '[') continue;
        const match = CLASS_ATTRIBUTE.exec(prelude.slice(index));
        if (match === null) continue;
        const [, operator, raw, flag] = match;
        const quoted = raw === '"';
        into.push({
            operator: operator as ClassAttributeOperator,
            // Every `"` stands for one string, so the one after `[` is the value.
            value: (quoted ? strings[seen] : raw) as string,
            insensitive: flag?.toLowerCase() === 'i',
        });
    }
}

/**
 * Record every class this stylesheet's rules select on, by name or by an
 * attribute selector on `class`.
 *
 * @param css - Stylesheet text.
 * @param into - Where the hooks go.
 */
export function collectClassHooks(css: string, into: ClassHooks): void {
    forEachPrelude(css, (prelude, end, strings) => {
        if (!selectsElements(prelude, end)) return;
        for (const name of classSelectorsIn(prelude)) into.names.add(name);
        attributeMatchersIn(prelude, strings, into.attributes);
    });
}

/**
 * Whether one attribute selector can match an element because of this class.
 *
 * `=` and `~=` compare whole names. The other operators compare the class
 * attribute's text, which removing any class may change, so a class counts
 * when it and a part of the value contain one another.
 *
 * @param matcher - The attribute selector.
 * @param candidate - Class as written.
 * @returns True when a merge that removes the class could change the match.
 */
function attributeSelects(matcher: ClassAttributeMatcher, candidate: string): boolean {
    const name = matcher.insensitive ? candidate.toLowerCase() : candidate;
    const value = matcher.insensitive ? matcher.value.toLowerCase() : matcher.value;
    const parts = value.split(/\s+/).filter(part => part !== '');
    if (matcher.operator === '~=') return value === name;
    if (matcher.operator === '=') return parts.includes(name);
    return parts.some(part => name.includes(part) || part.includes(name));
}

/**
 * Whether a project rule selects on this class.
 *
 * @param hooks - What the project's rules select on.
 * @param candidate - Class as written.
 * @returns True for a hook.
 */
export function isHook(hooks: ClassHooks, candidate: string): boolean {
    return (
        hooks.names.has(candidate) ||
        hooks.attributes.some(matcher => attributeSelects(matcher, candidate))
    );
}

/**
 * Utility names the project declares itself, whether or not Tailwind has one
 * of the same name.
 */
export interface DeclaredUtilities {
    /** Static names: `@utility flex`, `addUtilities({ '.hook': … })`. */
    readonly names: Set<string>;
    /** Functional roots: `@utility tab-*` and `matchUtilities({ tab })` give `tab`. */
    readonly roots: Set<string>;
}

/**
 * An empty record of declared utilities.
 *
 * @returns Names and roots, both empty.
 */
export function noDeclaredUtilities(): DeclaredUtilities {
    return { names: new Set(), roots: new Set() };
}

/**
 * Record every `@utility` this stylesheet declares.
 *
 * @param css - Stylesheet text.
 * @param declared - Where the names go.
 */
export function declareUtilitiesIn(css: string, declared: DeclaredUtilities): void {
    forEachPrelude(css, (prelude, end) => {
        const name = end === '{' ? UTILITY_PRELUDE.exec(prelude)?.[1] : undefined;
        if (name === undefined) return;
        if (name.endsWith('-*')) declared.roots.add(name.slice(0, -2));
        else declared.names.add(name);
    });
}

/**
 * Indices of every `char` in `text` outside brackets and parentheses.
 *
 * @param text - A candidate or part of one.
 * @param char - The separator to find.
 * @returns Its top-level indices, in order.
 */
function topLevelIndices(text: string, char: ':' | '/'): number[] {
    const found: number[] = [];
    let depth = 0;
    for (let index = 0; index < text.length; index += 1) {
        const current = text[index];
        if (current === '[' || current === '(') depth += 1;
        else if (current === ']' || current === ')') depth -= 1;
        else if (current === char && depth === 0) found.push(index);
    }
    return found;
}

/**
 * The utility a candidate applies, without variants, importance, a leading
 * `-` or a `/` modifier: `md:-shadow-lg/50!` gives `shadow-lg`.
 *
 * @param candidate - Class as written.
 * @returns The utility name.
 */
function utilityOf(candidate: string): string {
    const separator = topLevelIndices(candidate, ':').at(-1);
    const utility = candidate.slice(separator === undefined ? 0 : separator + 1);
    const plain = utility.replace(/^!|!$/g, '');
    const unsigned = plain.startsWith('-') ? plain.slice(1) : plain;
    const [modifier] = topLevelIndices(unsigned, '/');
    return modifier === undefined ? unsigned : unsigned.slice(0, modifier);
}

/**
 * Whether the project declares the utility a candidate applies.
 *
 * @param declared - Names and roots the project declares.
 * @param candidate - Class as written.
 * @returns True for a declared static name or a name under a declared root.
 */
export function isDeclared(declared: DeclaredUtilities, candidate: string): boolean {
    const utility = utilityOf(candidate);
    if (declared.names.has(utility)) return true;
    for (const root of declared.roots) {
        if (utility === root || utility.startsWith(`${root}-`)) return true;
    }
    return false;
}

/**
 * Whether a stylesheet defines classes of its own, so that telling them from
 * Tailwind's takes a second compile.
 *
 * @param css - Stylesheet text.
 * @returns True when it has `@utility`, `@plugin` or `@config`.
 */
export function hasCustomSource(css: string): boolean {
    return CUSTOM_SOURCE.test(css);
}

/**
 * Record what one registrar call would have registered.
 *
 * @param key - The registrar called.
 * @param utilities - Its first argument.
 * @param declared - Where the names go.
 */
function recordRegistration(key: string, utilities: unknown, declared: DeclaredUtilities): void {
    const groups = Array.isArray(utilities) ? utilities : [utilities];
    for (const group of groups) {
        if (group === null || typeof group !== 'object') continue;
        for (const name of Object.keys(group)) {
            if (key.startsWith('match')) declared.roots.add(name);
            else
                for (const selected of classesInSelectors(`${name}{}`))
                    declared.names.add(selected);
        }
    }
}

/**
 * The plugin API with every class registrar turned into a recorder that
 * registers nothing.
 *
 * @param api - What Tailwind hands a plugin.
 * @param declared - Where the names it would have registered go.
 * @returns The same API, minus the registrars.
 */
function silenced(api: object, declared: DeclaredUtilities): object {
    return new Proxy(api, {
        get(target, key, receiver) {
            if (typeof key !== 'string' || !REGISTRARS.has(key)) {
                return Reflect.get(target, key, receiver);
            }
            return (utilities: unknown) => recordRegistration(key, utilities, declared);
        },
    });
}

/**
 * A plugin or config module that registers no class, keeping every variant,
 * base style and theme value it adds.
 *
 * Followed into a config's `plugins` and `presets`: removing only the
 * `@plugin` line would leave a plugin the config lists registered.
 *
 * @param module - What the module exports.
 * @param declared - Where the names it would have registered go.
 * @returns The same module with its class registrations silenced.
 */
export function withoutRegisteredClasses(
    module: unknown,
    declared: DeclaredUtilities = noDeclaredUtilities(),
): unknown {
    if (typeof module === 'function') {
        const plugin = module as ((...args: unknown[]) => unknown) & {
            __isOptionsFunction?: boolean;
        };
        if (plugin.__isOptionsFunction === true) {
            return Object.assign(
                (options: unknown) => withoutRegisteredClasses(plugin(options), declared),
                {
                    __isOptionsFunction: true,
                },
            );
        }
        return (api: object) => plugin(silenced(api, declared));
    }
    if (module === null || typeof module !== 'object') return module;
    const record = module as Record<string, unknown>;
    const result: Record<string, unknown> = { ...record };
    const { handler, plugins, presets } = record;
    if (typeof handler === 'function') {
        result.handler = (api: object) =>
            (handler as (api: object) => unknown)(silenced(api, declared));
    }
    const follow = (entry: unknown): unknown => withoutRegisteredClasses(entry, declared);
    if (Array.isArray(plugins)) result.plugins = plugins.map(follow);
    if (Array.isArray(presets)) result.presets = presets.map(follow);
    return result;
}
