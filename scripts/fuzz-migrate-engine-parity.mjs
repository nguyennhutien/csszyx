#!/usr/bin/env node

// Check both migrate engines against generated sources, in two passes.
//
// Every fixed corpus is thin in the same way: it holds the shapes someone
// thought of. A component library migrates nothing at all, and one app's
// pages repeat a handful of patterns.
//
// The first pass is a SWEEP, not a fuzz. Which sz key a class means is
// decided by a prefix and the shape of its value, and both of those are
// finite, so they are enumerated: every prefix whose answer depends on its
// value, against every value shape, with and without a modifier. Nothing is
// left to luck, which matters — the first version of this file sampled that
// product at random and a real one-unit divergence went unfound in 8000
// files, because the chance of drawing the exact pair was about 1 in 20000.
//
// The second pass is random, for the part that is genuinely open: how the
// classes sit in a file. Nesting, imports, attribute mixes, line endings,
// HTML pages. It is seeded, so a failure replays exactly.
//
// Usage:
//   node --import tsx/esm scripts/fuzz-migrate-engine-parity.mjs
//   node --import tsx/esm scripts/fuzz-migrate-engine-parity.mjs --files 2000 --seed 7
//   node --import tsx/esm scripts/fuzz-migrate-engine-parity.mjs --seed 7 --only 413
//   node --import tsx/esm scripts/fuzz-migrate-engine-parity.mjs --sweep-only

import {
    isRustMigrateAvailable,
    migrateRustBatch,
    migrateRustHtml,
} from '@csszyx/compiler/migrate';

import {
    transformHtmlSourceSimple,
    transformSource,
} from '../packages/cli/src/migrate/ast-transformer.ts';
import { parseClass } from '../packages/cli/src/migrate/class-parser.ts';
import {
    KNOWN_SIMPLE_VARIANTS,
    REVERSE_VARIANT_MAP,
    SORTED_PREFIXES,
} from '../packages/cli/src/migrate/reverse-map.ts';

const options = parseArgs(process.argv.slice(2));

if (!isRustMigrateAvailable()) {
    console.error(
        '[migrate-parity] the native engine is not available here. ' +
            'Build it with `pnpm --filter @csszyx/core native:build`.',
    );
    process.exit(1);
}

/**
 * Every CSS unit the parser reads as a dimension. Each one is swept: a unit
 * the two engines disagree about is a class that migrates to a size on one
 * side and a colour on the other.
 */
const DIMENSION_UNITS = [
    'vmin',
    'vmax',
    'rem',
    'svh',
    'svw',
    'dvh',
    'dvw',
    'lvh',
    'lvw',
    'cqw',
    'cqh',
    'cqi',
    'cqb',
    'turn',
    'grad',
    'px',
    'em',
    'ex',
    'ch',
    'vw',
    'vh',
    '%',
    'fr',
    'deg',
    'rad',
    'ms',
    's',
    'pt',
    'pc',
    'cm',
    'mm',
    'in',
];

/**
 * Every value shape the rules split on, as concrete strings, so the product
 * with the prefixes can be walked rather than sampled.
 */
const VALUES = [
    '0',
    '1',
    '4',
    '12',
    '2.5',
    '-4',
    '700',
    '99',
    'auto',
    'full',
    'screen',
    'px',
    'min',
    'max',
    'fit',
    'none',
    'sm',
    'md',
    'lg',
    'xl',
    '2xl',
    'red-500',
    'blue-50',
    'slate-900',
    'inherit',
    'current',
    'transparent',
    'black',
    'white',
    'wrap',
    'nowrap',
    'balance',
    'ellipsis',
    'clip',
    'center',
    'left',
    'justify',
    'start',
    'solid',
    'dashed',
    'dotted',
    'double',
    'wavy',
    'bold',
    'medium',
    'black',
    'sans',
    'serif',
    'mono',
    'stretch-condensed',
    'cover',
    'contain',
    'fixed',
    'local',
    'scroll',
    'repeat-x',
    'top',
    'bottom',
    'inside',
    'outside',
    'linear',
    'in',
    'out',
    'in-out',
    'colors',
    'transform',
    'all',
    'row',
    'col',
    'wrap-reverse',
    '1/2',
    '3/4',
    '4%',
    '12.5%',
    '(--brand)',
    '(color:--ink)',
    '[calc(100%-1rem)]',
    '[var(--x)]',
    '[url(/a.png)]',
    '[center_top_1rem]',
    '[#3f3]',
    '[😀]',
    '[ä]',
    "['x']",
    '[a,b]',
    ...DIMENSION_UNITS.map(unit => `[3${unit}]`),
    ...DIMENSION_UNITS.map(unit => `[-1.5${unit}]`),
];

/** Modifiers a value can carry after a top-level slash, in the random pass. */
const MODIFIERS = ['', '', '', '/50', '/[50%]', '/(--op)', '/6', '/[1.4]', '/12.5'];

/** Variant spellings, including every shape `mapVariant` documents. */
const VARIANTS = [
    ...KNOWN_SIMPLE_VARIANTS,
    ...Object.keys(REVERSE_VARIANT_MAP),
    'group-hover',
    'group-hover/sidebar',
    'peer-checked/draft',
    'group-[.is-published]',
    'group-has-[a]',
    'group-data-[open]',
    'peer-aria-[busy]',
    'has-[img]',
    'has-[:checked]',
    'not-hover',
    'not-supports-[display:grid]',
    'data-[active]',
    'data-active',
    'aria-checked',
    'aria-[current=page]',
    'supports-[display:grid]',
    'min-[320px]',
    'min-md',
    'max-lg',
    'max-[1024px]',
    '@md',
    '@md/sidebar',
    '@min-[475px]',
    '@container',
    '[&>*]',
];

/** Class roots that are whole classes on their own. */
const BARE_CLASSES = [
    'flex',
    'block',
    'hidden',
    'truncate',
    'grow',
    'shrink',
    'italic',
    'underline',
    'antialiased',
    'sr-only',
    'container',
    '@container',
    'group',
    'peer',
    'group/item',
    'mystery-class',
    'legacy-thing',
];

const prefixes = [...SORTED_PREFIXES];
const ambiguousPrefixes = findAmbiguousPrefixes();

/** Classes per swept file: enough to amortise the parse, few enough to read. */
const SWEEP_TOKENS_PER_FILE = 60;

let state = options.seed >>> 0;
let sweptClasses = 0;
let checked = 0;
let changed = 0;
const failures = [];

runSweep();
if (!options.sweepOnly && failures.length < options.maxFailures) {
    runRandom();
}

report();
process.exit(failures.length > 0 ? 1 : 0);

/**
 * The prefixes whose sz key depends on the shape of their value.
 *
 * Uniform prefixes are where nothing can go wrong: `p-4` and `p-[3fr]` are
 * both padding. The rules live on the prefixes that answer differently for
 * different values. They are found by asking rather than listed, so a prefix
 * that becomes ambiguous later is covered without anyone remembering to add
 * it — the same reason the tables are generated.
 *
 * @returns {string[]} The prefixes worth sweeping.
 */
function findAmbiguousPrefixes() {
    const probes = ['4', 'red-500', '[3px]', 'solid', '(--v)', '[3fr]', 'none', 'bold', 'cover'];
    return prefixes.filter(prefix => {
        const props = new Set(probes.map(probe => parseClass(`${prefix}-${probe}`)?.prop ?? null));
        props.delete(null);
        return props.size > 1;
    });
}

/**
 * Walk every value-dependent prefix against every value shape, with and
 * without a modifier, and check each generated file through both engines.
 */
function runSweep() {
    const classes = [];
    for (const prefix of ambiguousPrefixes) {
        for (const value of VALUES) {
            classes.push(`${prefix}-${value}`);
            classes.push(`${prefix}-${value}/50`);
        }
    }
    sweptClasses = classes.length;
    for (let start = 0; start < classes.length; start += SWEEP_TOKENS_PER_FILE) {
        // One element per class: a class that fails to parse must not take
        // its neighbours' answers with it, and one element per file would
        // spend the whole run in the parser.
        const source = `${classes
            .slice(start, start + SWEEP_TOKENS_PER_FILE)
            .map((token, index) => `export const S${index} = () => <div className="${token}" />;`)
            .join('\n')}\n`;
        if (
            check({
                index: `sweep:${start}`,
                filename: `sweep/case-${start}.tsx`,
                source,
                options: {},
            })
        ) {
            return;
        }
    }
}

/** Generate random whole files and check each through both engines. */
function runRandom() {
    for (let index = 0; index < options.files; index += 1) {
        const generated = buildCase(index);
        if (options.only !== undefined && index !== options.only) continue;
        if (options.dump > 0 && index < options.dump) {
            console.log(
                `--- case ${index} (${JSON.stringify(generated.options)})\n${generated.source}`,
            );
        }
        if (check(generated)) return;
    }
}

/**
 * Run one case through both engines and record what differs.
 *
 * @param {object} generated - The case.
 * @returns {boolean} Whether the run should stop.
 */
function check(generated) {
    checked += 1;
    const ts = generated.isHtml
        ? transformHtmlSourceSimple(generated.source, generated.options)
        : transformSource(generated.source, generated.filename, generated.options);
    const rust = generated.isHtml
        ? migrateRustHtml(generated.source, generated.options)
        : migrateRustBatch(
              [{ filename: generated.filename, source: generated.source }],
              generated.options,
          )[0];
    if (ts.changed) changed += 1;

    const prefix = generated.isHtml ? 'Parse error: ' : `Parse error in ${generated.filename}: `;
    const difference = diff(ts, rust, prefix);
    if (!difference) return false;
    failures.push({ ...generated, difference });
    return failures.length >= options.maxFailures;
}

/**
 * The first field of two results that differs; a parse failure counts as one
 * fact, because the two parsers word it differently.
 *
 * @param {object} ts - The TypeScript engine's result.
 * @param {object} rust - The native engine's result.
 * @param {string} prefix - The parse-failure prefix for this file.
 * @returns {object|null} The differing field with both values.
 */
function diff(ts, rust, prefix) {
    const parsed = result => result.warnings.length === 1 && result.warnings[0].startsWith(prefix);
    const left = parsed(ts) ? { ...ts, warnings: [prefix] } : ts;
    const right = parsed(rust) ? { ...rust, warnings: [prefix] } : rust;
    for (const field of ['code', 'changed', 'warnings', 'stats', 'potentiallyUnusedImports']) {
        if (JSON.stringify(left[field]) !== JSON.stringify(right[field])) {
            return { field, ts: JSON.stringify(left[field]), rust: JSON.stringify(right[field]) };
        }
    }
    return null;
}

/**
 * One random case: its source, the options it is migrated under, and what it is.
 *
 * @param {number} index - The case number, for the failure message.
 * @returns {object} The case.
 */
function buildCase(index) {
    const eol = chance(0.15) ? '\r\n' : '\n';
    if (chance(0.12)) {
        return {
            isHtml: true,
            index,
            source: htmlSource(eol),
            options: pick([{}, { braces: true }, { injectRuntime: 'cdn' }, { injectFouc: false }]),
        };
    }
    return {
        isHtml: false,
        index,
        filename: `fuzz/case-${index}.tsx`,
        source: jsxSource(eol),
        options: pick([{}, { injectTodos: true }, { keysOnly: true }, { injectTodos: true }]),
    };
}

/** One Tailwind class token: an optional variant chain and a base class. */
function classToken() {
    const variants = [];
    for (let depth = random(0, 2); depth > 0; depth -= 1) variants.push(pick(VARIANTS));
    // Half the tokens come from the prefixes that decide something, or the
    // interesting ones are drowned out by 268 uniform prefixes.
    const prefix = chance(0.5) ? pick(ambiguousPrefixes) : pick(prefixes);
    const base = chance(0.25)
        ? pick(BARE_CLASSES)
        : `${chance(0.08) ? '-' : ''}${prefix}-${pick(VALUES)}${pick(MODIFIERS)}`;
    return [...variants, `${base}${chance(0.06) ? '!' : ''}`].join(':');
}

/** A class attribute's worth of tokens. */
function classString() {
    return Array.from({ length: random(1, 6) }, classToken).join(' ');
}

/** A JSX className attribute in one of the shapes migrate handles. */
function classAttribute() {
    const shape = random(0, 7);
    if (shape === 0) return `className="${classString()}"`;
    if (shape === 1) return `className={"${classString()}"}`;
    if (shape === 2) return `className={clsx("${classString()}", on && "${classString()}")}`;
    if (shape === 3) return `className={on ? "${classString()}" : "${classString()}"}`;
    if (shape === 4) return `className={on && "${classString()}"}`;
    if (shape === 5) return `className={\`${classString()} \${on ? "${classString()}" : ""}\`}`;
    if (shape === 6) return `className={${pick(['cls', 'props.className', 'styles.root'])}}`;
    return `className="${classString()}" data-i="${random(0, 99)}"`;
}

/** A static sz attribute, sometimes with the legacy keys the normaliser rewrites. */
function szAttribute() {
    const legacy = pick([
        'padding: 4',
        "fontWeight: 'bold'",
        'flex: true',
        "font: 'bold'",
        'margin: 2',
        'p: 4',
        "display: 'flex'",
    ]);
    return `sz={{ ${legacy}${chance(0.4) ? `, hover: { ${pick(['padding: 2', 'm: 1'])} }` : ''} }}`;
}

/** One JSX element, sometimes a component, sometimes carrying both attributes. */
function element(depth) {
    const tag = chance(0.15) ? pick(['Card', 'ui.Panel']) : pick(['div', 'span', 'section', 'a']);
    const attributes = [];
    if (chance(0.25)) attributes.push(szAttribute());
    if (chance(0.85)) attributes.push(classAttribute());
    if (chance(0.1)) attributes.push('{...rest}');
    const open = `<${tag}${attributes.length > 0 ? ` ${attributes.join(' ')}` : ''}`;
    if (depth > 0 && chance(0.35)) return `${open}>${element(depth - 1)}</${tag}>`;
    return `${open} />`;
}

/** A whole module: the imports the walk reads, then components. */
function jsxSource(eol) {
    const lines = [];
    if (chance(0.4)) lines.push(`import clsx from '${pick(['clsx', 'clsx/lite', 'classnames'])}';`);
    if (chance(0.12)) lines.push("import { cva } from 'class-variance-authority';");
    if (chance(0.1)) lines.push("import { cn } from '@/lib/utils';");
    for (let index = random(1, 5); index > 0; index -= 1) {
        lines.push(`export const C${index} = ({ on, ...rest }) => (${element(random(0, 2))});`);
    }
    return `${lines.join(eol)}${eol}`;
}

/** A whole HTML page, with the head and body the injectors look for. */
function htmlSource(eol) {
    const body = Array.from(
        { length: random(1, 4) },
        () => `  <div class="${classString()}">x</div>`,
    ).join(eol);
    const head = chance(0.8) ? `<head><title>x</title></head>${eol}` : '';
    const open = chance(0.8) ? `<body>${eol}` : '';
    const close = open ? `${eol}</body>` : '';
    return `<html>${eol}${head}${open}${body}${close}${eol}</html>${eol}`;
}

/** A number in `[min, max]`, from the seeded stream. */
function random(min, max) {
    // xorshift32: small, deterministic, and enough spread for a generator.
    state ^= state << 13;
    state ^= state >>> 17;
    state ^= state << 5;
    state >>>= 0;
    return min + (state % (max - min + 1));
}

/** One member of a list. */
function pick(list) {
    return list[random(0, list.length - 1)];
}

/** True with the given probability. */
function chance(probability) {
    return random(0, 999) < probability * 1000;
}

/**
 * Read the flags.
 *
 * @param {string[]} args - Command-line arguments.
 * @returns {object} The options.
 */
function parseArgs(args) {
    const parsed = {
        files: 500,
        seed: 1,
        only: undefined,
        maxFailures: 5,
        dump: 0,
        sweepOnly: args.includes('--sweep-only'),
    };
    for (let index = 0; index < args.length; index += 1) {
        const value = Number(args[index + 1]);
        if (args[index] === '--files') parsed.files = Math.max(1, value);
        else if (args[index] === '--seed') parsed.seed = value;
        else if (args[index] === '--only') parsed.only = value;
        else if (args[index] === '--max-failures') parsed.maxFailures = Math.max(1, value);
        else if (args[index] === '--dump') parsed.dump = Math.max(1, value);
    }
    return parsed;
}

/** Print what the two passes found. */
function report() {
    console.log(
        `[migrate-parity] swept ${sweptClasses} class(es) over ${ambiguousPrefixes.length} ` +
            `value-dependent prefix(es)` +
            `${options.sweepOnly ? '' : `, then ${options.files} random file(s) at seed ${options.seed}`}. ` +
            `${checked} file(s) checked, ${changed} that migrate changes.`,
    );
    if (failures.length === 0) {
        console.log('[migrate-parity] both engines answered identically.');
        return;
    }
    console.error(`[migrate-parity] ${failures.length} difference(s):`);
    for (const failure of failures) {
        const replay = String(failure.index).startsWith('sweep:')
            ? '--sweep-only'
            : `--seed ${options.seed} --only ${failure.index}`;
        console.error(`\n  case ${failure.index} — replay with ${replay}`);
        console.error(`  options: ${JSON.stringify(failure.options)}`);
        console.error(`  source:\n${failure.source.replace(/^/gm, '    ').slice(0, 1200)}`);
        console.error(`  ${failure.difference.field}:`);
        console.error(`      ts   = ${failure.difference.ts.slice(0, 600)}`);
        console.error(`      rust = ${failure.difference.rust.slice(0, 600)}`);
    }
}
