/**
 * The freeze corpus for ADR 0031 PR B: one engine source per (code, variant)
 * of every diagnostic the Rust engine renders.
 *
 * A code can have more than one wording — `removed-key` alone renders six —
 * and `CODE_SOURCES` pins only one of them per code. Before the wording moves
 * out of the engine's `format!` sites into the diagnostic registry, each form
 * gets a source here, so the suite that reads this list can pin its rendered
 * text on both artifacts and prove the move changed no byte.
 *
 * Order and `variant` names follow the inventory of Rust diagnostic sites
 * (`rust-diagnostics.json` of the ADR 0031 council). Where `CODE_SOURCES`
 * already renders the variant, the entry reuses that source rather than
 * keeping a second copy of it.
 *
 * Every source renders exactly one issue. A syntax error renders the parser's
 * message alone: the summary and `panicked` forms stand in only where the
 * parser gives no message, which no source reaches, so they have no entry.
 *
 * NOT a `.test.ts` file on purpose: vitest must not collect it as a suite.
 */
import type { SzDiagnosticCode, TransformSourceCodeOptions } from '../src/index.js';
import { CODE_SOURCES } from './diagnostic-code-sources.js';

/** One engine source that renders one form of one diagnostic code. */
export interface FreezeSource {
    /** The code the engine reports in `issues`. */
    code: SzDiagnosticCode;
    /** The form of the sentence, named as the inventory names it. */
    variant: string;
    /** The source text the engine transforms. */
    source: string;
    /** The file name to pass, when the form depends on it. */
    filename?: string;
    /** The transform options the form needs, such as a merge table. */
    options?: TransformSourceCodeOptions;
}

/**
 * The `CODE_SOURCES` entry of a code, as the freeze entry of one variant.
 *
 * @param code The diagnostic code whose shared source renders the variant.
 * @param variant The inventory name of the form that source renders.
 * @returns The freeze entry, carrying the shared source and its options.
 */
function shared(code: SzDiagnosticCode, variant: string): FreezeSource {
    const entry = CODE_SOURCES.find(([sourceCode]) => sourceCode === code);
    if (!entry) {
        throw new Error(`CODE_SOURCES has no source for ${code}`);
    }
    const [, source, options] = entry;
    return options ? { code, variant, source, options } : { code, variant, source };
}

/**
 * A first line that sends the file through the parser: a file whose `sz` is all
 * static takes the fast path and never reports a syntax error.
 */
const PARSED = 'export const A = ({ c }) => <div sz={{ p: c ? 4 : 2 }} />;\n';

/** Every (code, variant) the engine renders, in the inventory's order. */
export const FREEZE_SOURCES: ReadonlyArray<FreezeSource> = [
    {
        code: 'merge-classifier-unavailable',
        variant: 'unreadable',
        source: 'export const A = () => <div sz={{ p: 4 }} />;',
        // A signature id must be a u32, so the table fails to deserialize.
        options: { mergeTable: { format: 1, signatures: { p: -1 }, coverage: [] } },
    },
    shared('merge-classifier-unavailable', 'format-mismatch'),
    shared('nesting-depth', 'exceeded'),
    shared('ast-budget', 'exceeded'),
    {
        code: 'parse-error',
        variant: 'syntax-unrecoverable',
        // An error oxc cannot recover from sets its `panicked` flag, and still
        // carries a message: no Rust panic is involved.
        source: `${PARSED}const broken = ;`,
    },
    shared('unsupported-dynamic-sz', 'unsupported'),
    shared('szs-slot-map', 'host-element'),
    {
        code: 'szs-slot-map',
        variant: 'unsupported',
        source: 'export const A = ({ v }) => <Popup szs={{ body: v }} />;',
    },
    { code: 'fallback-missing-css', variant: 'szr', source: 'export const a = szr(cfg);' },
    { code: 'fallback-missing-css', variant: 'szv-catalog', source: 'export const v = szv(cfg);' },
    {
        code: 'fallback-missing-css',
        variant: 'sz-variant-key',
        source: 'export const A = ({ x }) => <div sz={{ m: 1, hover: x }} />;',
    },
    shared('fallback-missing-css', 'sz'),
    shared('fallback-nudge', 'sz'),
    shared('unresolvable-spread', 'spread'),
    shared('style-override', 'spread'),
    shared('runtime-value', 'no-var-form'),
    shared('off-scale-value', 'spacing-step'),
    shared('per-side-border-style', 'side-style'),
    {
        code: 'property-object',
        variant: 'object-on-property',
        // A variant name as the nested key, so no unknown-key rides along.
        source: 'export const A = () => <div sz={{ p: { hover: 4 } }} />;',
    },
    shared('unknown-field', 'mask-member'),
    {
        code: 'removed-key',
        variant: 'runtime-alias',
        source: 'export const A = ({ c }) => <div sz={{ touchAction: c }} />;',
    },
    shared('global-before-group', 'replaced-by-group'),
    shared('moved-value', 'moved'),
    {
        code: 'moved-value',
        variant: 'mask-layer',
        source: "export const A = () => <div sz={{ mask: 'linear-45' }} />;",
    },
    shared('runtime-family-conflict', 'runtime-beside-family'),
    shared('spread-split-class', 'split'),
    shared('duplicate-sz', 'merged'),
    shared('numeric-font-weight', 'numeric-string'),
    {
        code: 'removed-key',
        variant: 'sugar-replaced',
        source: 'export const A = () => <div sz={{ tabularNums: true }} />;',
    },
    {
        code: 'removed-key',
        variant: 'sugar',
        source: 'export const A = () => <div sz={{ inlineFlex: true }} />;',
    },
    shared('removed-key', 'removed'),
    {
        code: 'removed-key',
        variant: 'replaced',
        source: 'export const A = () => <div sz={{ slashedZero: true }} />;',
    },
    shared('canonical-key', 'alias'),
    shared('numeric-key', 'numeric'),
    shared('unknown-key', 'unknown'),
    {
        code: 'non-variant-object',
        variant: 'owned-key-object',
        // An empty object, so no unknown-key for a nested key rides along.
        source: 'export const A = () => <div sz={{ container: {} }} />;',
    },
    {
        code: 'closed-enum-value',
        variant: 'sibling-group',
        source: "export const A = () => <div sz={{ nums: 'oldstyle' }} />;",
    },
    shared('closed-enum-value', 'dead'),
    {
        code: 'closed-enum-value',
        variant: 'css-value',
        source: "export const A = () => <div sz={{ justify: 'flex-start' }} />;",
    },
    {
        code: 'closed-enum-value',
        variant: 'font-style',
        source: "export const A = () => <div sz={{ fontStyle: 'oblique' }} />;",
    },
    {
        code: 'closed-enum-value',
        variant: 'font-smoothing',
        source: "export const A = () => <div sz={{ fontSmoothing: 'auto' }} />;",
    },
    shared('slash-opacity-string', 'string'),
    shared('color-slash-opacity', 'object'),
    shared('class-precedence', 'runtime-classname'),
    {
        code: 'fallback-nudge',
        variant: 'sz-array-element',
        source: 'export const A = ({ pad }) => <div sz={[{ m: pad }]} />;',
    },
    shared('sz-recover', 'non-literal'),
    {
        code: 'sz-recover',
        variant: 'unknown-mode',
        source: 'export const A = () => <div szRecover="ssr" sz={{ p: 4 }} />;',
    },
    { code: 'parse-error', variant: 'syntax', source: `${PARSED}return 1;` },
    shared('mangle-vars-hoist-skipped', 'hoist-skipped'),
    {
        code: 'mangle-vars-hoist-skipped',
        variant: 'hoist-skipped-max-depth',
        // The usages sit deeper under their common ancestor than the default
        // hoist depth allows.
        source:
            'export const A = ({ pad }) => <section><div><article><aside><div><div>' +
            '<span sz={{ p: pad }} /></div></div></aside></article></div>' +
            '<button sz={{ p: pad }} /></section>;',
        options: { mangleVars: true },
    },
];
