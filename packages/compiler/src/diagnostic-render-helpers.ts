/**
 * The computed values the diagnostic templates name beside their args.
 *
 * Each one reads data both engines take from one source — a table the engine's
 * generated copy is built from, a generated constant — or only presents an arg,
 * so rendering it never runs engine logic a second time (ADR 0031). The
 * registry lists the same names (`COMPUTED` in
 * `scripts/diagnostics/registry.mjs`); a test holds the two lists equal.
 *
 * A lookup that misses renders `''`, as the engine's `unwrap_or_default` did.
 *
 * @module diagnostic-render-helpers
 */

import { SZ_DIAGNOSTIC_CONSTANTS } from './diagnostic-registry.generated.js';
import type { SzDiagnosticComputed } from './diagnostic-render.js';
import { GLOBAL_KEYWORD_GROUPS } from './keyword-families.js';
import { describeSzFallback, type SzFallbackKind } from './sz-fallback-matrix.js';
import {
    bareClosedEnumClass,
    CLOSED_ENUM_CLASSES,
    CLOSED_ENUM_VALUE_MOVES,
    MIGRATION_NOTES,
    SUGGESTION_MAP,
} from './transform-core.js';

/** One arg value, as the wire carries it. */
type Args = Parameters<SzDiagnosticComputed>[0];

/**
 * A text arg, or `''` when the issue has none.
 *
 * @param args - The issue's args.
 * @param name - The arg.
 * @returns The text.
 */
function text(args: Args, name: string): string {
    const value = args[name];
    return typeof value === 'string' ? value : '';
}

/**
 * The values a closed-enum key takes, in table order.
 *
 * @param key - The key.
 * @returns The values joined by `, `.
 */
function allowedOf(key: string): string {
    return Object.keys(CLOSED_ENUM_CLASSES[key] ?? {}).join(', ');
}

/**
 * Where `key: value` moved: under the key itself, then under its canonical
 * key, as the engine's `moved_value` looks it up.
 *
 * @param args - The issue's args.
 * @returns The key and value it moved to, when it did.
 */
function movedOf(args: Args): Record<'key' | 'value', string> | undefined {
    const key = text(args, 'key');
    const value = text(args, 'value');
    return (
        CLOSED_ENUM_VALUE_MOVES[`${key}:${value}`] ??
        CLOSED_ENUM_VALUE_MOVES[`${SUGGESTION_MAP[key]}:${value}`]
    );
}

/**
 * A value as a JS literal: `true` bare, anything else in single quotes.
 *
 * @param value - The value.
 * @returns The literal.
 */
function literal(value: string): string {
    return value === 'true' ? 'true' : `'${value}'`;
}

/**
 * The fallback matrix's entry for an issue: its `shape`, or the `variant` kind
 * for a variant key, which names the key path in place of a shape.
 *
 * @param args - The issue's args.
 * @returns The reason and the suggestion.
 */
function fallbackOf(args: Args): { reason: string; suggestion: string } {
    if (args.site === 'sz-variant-key') {
        return describeSzFallback('variant', text(args, 'keyPath'));
    }
    return describeSzFallback(
        text(args, 'shape') as SzFallbackKind,
        text(args, 'detail'),
        text(args, 'path'),
    );
}

/**
 * The earlier sides of a split element as a reader names them: each class in
 * a code span, and the earlier `sz` attributes as one item where the first sits.
 *
 * @param args - The issue's args.
 * @returns The items joined by ` and `.
 */
function earlierOf(args: Args): string {
    const classes = Array.isArray(args.classes) ? args.classes : [];
    const items = classes.map(codeSpan);
    const count = typeof args.szCount === 'number' ? args.szCount : 0;
    if (count > 0) {
        const named =
            count === 1
                ? 'the classes of an earlier `sz`'
                : `the classes of ${count} earlier \`sz\``;
        items.splice(typeof args.szAt === 'number' ? args.szAt : 0, 0, named);
    }
    return items.join(' and ');
}

/**
 * A Markdown code span around text that may itself hold a backtick. Mirrors
 * `code_span` in the engine's parser.
 *
 * @param value - The text.
 * @returns The span.
 */
function codeSpan(value: string): string {
    return value.includes('`') ? `\`\` ${value} \`\`` : `\`${value}\``;
}

/** Every computed value, by the name a template uses. */
export const SZ_DIAGNOSTIC_COMPUTED_VALUES: Readonly<Record<string, SzDiagnosticComputed>> = {
    canonical: args => SUGGESTION_MAP[text(args, 'key')] ?? '',
    note: args => MIGRATION_NOTES[text(args, 'key')] ?? '',
    enumAllowed: args => allowedOf(text(args, 'key')),
    canonicalAllowed: args => allowedOf(SUGGESTION_MAP[text(args, 'key')] ?? ''),
    bare: args => bareClosedEnumClass(text(args, 'key'), text(args, 'value')),
    movedKey: args => movedOf(args)?.key ?? '',
    movedValue: args => {
        const moved = movedOf(args);
        return moved === undefined ? '' : literal(moved.value);
    },
    groups: args =>
        (GLOBAL_KEYWORD_GROUPS[SUGGESTION_MAP[text(args, 'key')] ?? '']?.groups ?? '')
            .split(' ')
            .join(', '),
    maxNestingDepth: () => String(SZ_DIAGNOSTIC_CONSTANTS.maxNestingDepth),
    mergeTableFormat: () => String(SZ_DIAGNOSTIC_CONSTANTS.mergeTableFormat),
    fallbackReason: args => fallbackOf(args).reason,
    fallbackSuggestion: args => fallbackOf(args).suggestion,
    earlier: earlierOf,
    example: args => [...(Array.isArray(args.parts) ? args.parts : []), '{ … }'].join(', '),
    spreadPlace: args =>
        typeof args.spread === 'string' ? `\`{...${args.spread}}\`` : 'the spread',
    spellingHint: args =>
        typeof args.suggestion === 'string'
            ? `write \`${args.suggestion}\` if you meant it`
            : 'check the spelling',
    parserMessage: args => text(args, 'message').replace(/\.$/, ''),
    groupLiteral: args => literal(text(args, 'groupValue')),
};
