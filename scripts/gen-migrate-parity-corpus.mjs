#!/usr/bin/env node

// Record what migrate's TypeScript answers for every class the project already
// knows about, so the Rust port can be held to the same answers.
//
// Inputs, in order: every probe class of the migrate golden, every reverse
// case of the sz-key matrix, every class of the pinned corpora, and the edge
// cases below that none of those contain. Each class is recorded twice: as
// `parseClass` sees it, and as `classNameToSzObject` converts it — the second
// keeps its key order as text, because the sz object is what migrate writes.
//
// Usage:
//   node --import tsx/esm scripts/gen-migrate-parity-corpus.mjs           # write
//   node --import tsx/esm scripts/gen-migrate-parity-corpus.mjs --check   # CI: fail if stale

import { readdirSync, readFileSync, writeFileSync } from 'node:fs';
import path from 'node:path';

import { parseClass } from '../packages/cli/src/migrate/class-parser.ts';
import {
    generateSzHtmlValue,
    generateSzObjectLiteral,
} from '../packages/cli/src/migrate/sz-codegen.ts';
import { classNameToSzObject } from '../packages/cli/src/migrate/variant-parser.ts';

const repoRoot = path.resolve(import.meta.dirname, '..');
const outPath = path.join(repoRoot, 'packages/core/tests/fixtures/migrate-parity-corpus.json');
const check = process.argv.includes('--check');

/**
 * Shapes the goldens and corpora do not contain. Each one is here because it
 * exercises a branch the others leave dark: modifiers, opacity forms, the
 * gradient grammar, custom properties, JavaScript's Number() edge cases, and
 * text outside the Basic Multilingual Plane, which the two languages index
 * differently.
 */
const EDGE_CASES = [
    // ── values a prefix must REJECT ──
    // Every class above is one Tailwind would emit, so the corpus only ever
    // asked whether a valid value is read correctly. These ask the opposite:
    // that a value of the wrong shape falls through to the rule beneath it.
    // Mutation testing found the gap — breaking each shape test below changed
    // no answer, because nothing had ever handed it something to refuse.
    'from-abc%', // a percentage position needs digits before the sign
    'from-1.x%', // ...on both sides of the point
    'from-x.1%',
    'w-1/x', // a fraction needs digits either side of the slash
    'w-x/2',
    'text-[px]', // an arbitrary length needs a magnitude, not just a unit
    'text-[abcpx]', // ...and the magnitude has to be numeric
    'w-px', // the two bare words a size accepts, which a fraction check
    'w-full', // ...must not swallow on the way past
    '-ring-2', // a signed number keeps its sign through the emit step
    '-inset-ring-4',
    '!p-4',
    'p-4!',
    '-mt-4',
    '-inset-ring-2',
    '-ring-2',
    '-m-auto',
    'w-[100px]!',
    '[--x:1px]!',
    'block!',
    'grow!',
    'p-4!',
    'text-sm/6',
    'text-[14px]/6',
    'text-sm/[1.4]',
    'text-sm/(--lh)',
    'text-lg/7!',
    'bg-red-500/50',
    'bg-red-500/[50%]',
    'bg-red-500/(--op)',
    'bg-red-500/[0.5]',
    'bg-red-500/foo',
    'shadow-sm/12.5',
    'shadow-(--s)/50',
    'shadow-(color:--c)',
    'shadow-(--s)',
    'shadow-[0_1px_2px_red]',
    'text-shadow-(color:--c)',
    'text-shadow-sm',
    'text-shadow-red-500',
    'drop-shadow-[0_1px_2px_rgba(0,0,0,0.5)]',
    'drop-shadow-xl',
    'inset-shadow-[0_1px_2px_red]',
    '-mt',
    '-inset',
    '-grow',
    '-shrink',
    'outline-2/50',
    'ring-2/50',
    'font-700/50',
    'text-sm/foo',
    'text-sm/-6',
    "content-[']",
    'content-["]',
    'bg-[',
    'w-]',
    '[',
    ']',
    '(',
    ')',
    'drop-shadow-(color:--c)',
    'drop-shadow-(--v)',
    'text-shadow-(--v)',
    'inset-shadow-(--v)',
    'inset-shadow-sm',
    'inset-shadow-(color:--c)',
    'inset-shadow-red-500',
    'bg-linear-to-r',
    'bg-linear-45',
    '-bg-linear-45',
    'bg-linear-to-r/hsl',
    'bg-linear-[45deg]',
    'bg-linear-(--a)',
    'bg-radial',
    'bg-radial-[at_50%_75%]',
    'bg-radial/oklab',
    'bg-conic',
    'bg-conic-90/oklch',
    'bg-conic-(--angle)',
    'bg-linear-[in_oklch,_red,_blue]/srgb',
    'from-4%',
    'from-12.5%',
    'from-[300px]',
    'via-10',
    'to-red-500/20',
    'to-(--c)',
    '[--x:1px]',
    '[--gap:theme(spacing.4)]',
    '[color:red]',
    '[--a:b:c]',
    '[x]',
    '[]',
    '@container',
    '@container/sidebar',
    'group/item',
    'peer/form',
    'group',
    'peer',
    'bg-[center_top_1rem]',
    'bg-[url(/a.png)]',
    'bg-[top]',
    'bg-none',
    'bg-(--brand)',
    'bg-[#fff]',
    'font-stretch-(--s)',
    'font-stretch-condensed',
    'font-700',
    'font-[Inter]',
    'font-bold',
    'font-sans',
    'font-condensed',
    "content-['x']",
    'content-["y"]',
    'content-(--c)',
    'content-none',
    'content-[attr(x)]',
    'content-center',
    'break-words',
    'break-all',
    'wrap-anywhere',
    'flex-row-reverse',
    'flex-wrap-reverse',
    'flex-1',
    'flex-[2_2_0%]',
    'divide-x',
    'divide-y-2',
    'divide-red-500',
    'border',
    'border-t',
    'border-x-2',
    'border-[1.5px]',
    'border-bs-2',
    'border-px',
    'border-dashed',
    'border-red-500',
    'border-4',
    'outline-2',
    'outline-[3px]',
    'outline-dashed',
    'outline-red-500',
    'ring',
    'ring-[3px]',
    'ring-2',
    'ring-red-500',
    'ring-offset-2',
    'ring-offset-red-500',
    'inset-ring-1',
    'inset-ring-[2px]',
    'inset-ring-blue-500',
    'snap-x',
    'snap-foo',
    'table-auto',
    'table-foo',
    'list-inside',
    'list-[square]',
    'list-disc',
    'ease-in-out',
    'ease-[cubic-bezier(0,0,1,1)]',
    'ease-(--e)',
    'w-1/2',
    '-translate-x-1/2',
    'translate-x-1/3',
    'p-[calc(100%-1rem)]',
    'grow',
    'grow-0',
    'text-[😀]',
    'content-[😀_x]',
    'w-[ä]',
    'bg-[🎨]/50',
    '[--emoji:😀]',
    'text-[😀]/6',
    'm-auto',
    'p-foo',
    'gap-x-px',
    'text-2xl',
    'text-[0.8rem]',
    'text-red-500',
    'text-center',
    'text-balance',
    'text-ellipsis',
    'text-[#333]',
    'transition-colors',
    'transition-[width]',
    'rotate-x-45',
    'rotate-[17deg]',
    '-rotate-45',
    'stroke-2',
    'stroke-[0.5rem]',
    'stroke-red-500',
    'object-cover',
    'object-[25%_75%]',
    'object-top',
    'decoration-wavy',
    'decoration-2',
    'decoration-(--t)',
    'decoration-[3px]',
    'decoration-red-500',
    'antialiased',
    'block',
    'hidden',
    'truncate',
    'leading-6',
    'leading-[1.4]',
    'max-w-prose',
    'min-h-screen',
    'h-dvh',
    'w-screen',
    'w-full',
    '-w-full',
    'w-px',
    '-w-px',
    'w-0x10',
    'w-1e3',
    'w-Infinity',
    'w-.5',
    'w-5.',
    'w-+5',
    'p-1_000',
    'w-[]',
    'bg-()',
    'w-',
    '-',
    '!',
    '',
    ' ',
    'hover:bg-red-500',
    'md:p-4',
    'p-4 m-2',
    'bg-[]',
    'outline-2.5',
    'ring-1.5',
    'stroke-1.5',
    'ring-offset-1.5',
    'inset-ring-0.5',
    'font-1000',
    'font-99',
    'opacity-50',
    'z-10',
    '-z-10',
    'order-first',
    'col-span-2',
    'grid-cols-[1fr_2fr]',
    'aspect-video',
    'aspect-[4/3]',
    'inset-x-0',
    'start-2',
    'end-[3px]',
    'bg-size-[50%]',
    'prose-lg',
    'mask-repeat-x',
    'mask-repeat',
    'sr-only',
    'container',
    'text-sm/6!',
    'bg-red-500/50!',
    'shadow-sm/50!',
    'bg-linear-to-r!',
    '[--x:1px]!',
    'text-[14px]/[1.5]',
    'text-[14px]/(--lh)',
    'underline',
    'no-underline',
    'italic',
    'uppercase',
    'snap-mandatory',
    'whitespace-nowrap',
    'select-none',
    'pointer-events-none',
    'will-change-transform',
    'backdrop-blur-sm',
    'blur',
    'blur-sm',
    'grayscale',
    'invert-0',
    'scale-x-50',
    '-scale-x-50',
    'skew-y-3',
    'origin-top-left',
    'perspective-[1000px]',
    'animate-spin',
    'duration-300',
    'delay-[1s]',
    'accent-red-500',
    'caret-(--c)',
    'fill-none',
    'forced-color-adjust-none',
    'scheme-dark',
    'field-sizing-content',
    'columns-3xs',
    // Whole class strings: conflicts in one variant scope, nesting, JavaScript's
    // integer-key ordering, and every variant spelling mapVariant documents.
    'block flex',
    'block flex inline',
    'block block',
    'hover:block hover:flex block',
    'md:hover:p-4 md:hover:m-2',
    'text-sm/6 md:text-lg/7',
    'group/item group-hover:p-4',
    'p-4 hover:p-6 p-8',
    'data-[x]:p-4 data-[0]:m-2 data-[10]:w-1 data-[2]:h-1',
    'data-[x]:p-4 data-[00]:m-2 data-[-1]:w-1 data-[4294967295]:h-1 data-[4294967294]:g-1',
    '[&>*]:p-4',
    'hover:[&>*]:p-4',
    'group-hover/sidebar:md:text-white',
    'peer-checked/draft:block',
    'group-[.is-published]:block',
    'group-has-[a]:p-4',
    'has-[img]:p-4',
    'has-[:checked]:p-4',
    'has-checked:p-4',
    'not-hover:p-4',
    'not-supports-[display:grid]:p-4',
    'not-supports-[]:p-4',
    'data-[active]:p-4',
    'data-active:p-4',
    'aria-checked:p-4',
    'aria-[current=page]:p-4',
    'supports-[display:grid]:p-4',
    'supports-grid:p-4',
    'min-[320px]:p-4',
    'min-md:p-4',
    'max-lg:p-4',
    'max-[1024px]:p-4',
    '@md:p-4',
    '@md/sidebar:p-4',
    '@min-[475px]:p-4',
    '@max-[475px]:p-4',
    '@min-[]:p-4',
    '@min-[a]b]:p-4',
    '@container:p-4',
    '@container/main:p-4',
    '@sm/a/b:p-4',
    'focus-within:p-4',
    'first-of-type:p-4',
    'pointer-fine:p-4',
    'group-data-[x]:p-4',
    'group-aria-[y]:p-4',
    'peer-has-[z]:p-4',
    'group-has-z:p-4',
    'group-data-z:p-4',
    'group-(--x):p-4',
    'group-[/x]:p-4',
    'group-hover/:p-4',
    'group-/name:p-4',
    'group-[:p-4',
    'peer-(:p-4',
    'a:b:c:p-4',
    'hover::p-4',
    ':p-4',
    'p-4:',
    'hover:p-4:',
    '[:p-4',
    'hover:[p-4',
    'hover:(p-4',
    'antialiased subpixel-antialiased',
    'underline no-underline line-through',
    'hover:underline hover:no-underline',
    '  p-4   m-2  ',
    '\u00a0p-4\u3000m-2',
    '\u0085p-4',
    'italic not-italic italic',
    'uppercase lowercase normal-case',
    'block hidden',
    'visible invisible collapse',
    'static fixed absolute',
    'group/item group-hover:p-4 group/x',
    'hover:p-4 hover',
    'p-4 p',
    'hover:bg-red-500 hover:bg-red-500/50',
    'text-sm/6 text-lg',
    'md:text-sm/6 md:leading-8',
    'flex md:flex hover:flex',
    // A marker token replaces the variant object a conflict later tries to
    // clean up, so the removal finds a string where it expects an object.
    'group-hover:block group/item group-hover:flex',
    'hover:block hover hover:flex',
    'group-hover:block group/item group-hover:p-4',
];

/**
 * A migration-resolution map exercising every entry kind the file format
 * allows: an sz object, a Tailwind string that converts fully, partly or not
 * at all, the three directives, and the values that count as unresolved.
 */
const CUSTOM_MAP = {
    'legacy-card': { p: 4, rounded: 'lg', hover: { shadow: 'md' } },
    'legacy-text': 'text-sm text-gray-700',
    'legacy-mixed': 'p-2 not-a-class',
    'legacy-none': 'not-a-class-either',
    'legacy-keep': 'sz:keep',
    'legacy-remove': 'sz:remove',
    'legacy-todo': 'sz:todo',
    'legacy-null': null,
    'legacy-false': false,
    'legacy-array': [1, 2],
    'legacy-number': 3,
    'legacy-true': true,
    'legacy-empty': '',
    'legacy-nested': { hover: { p: 4 }, 0: 'x', b: [1, { c: null }], n: 1.5, t: true },
    'legacy-flat': { hover: 'flat' },
    'p-4': { padding: 'custom' },
    // Every shape the codegen spells differently: keys that need quoting,
    // strings that need escaping, deep objects, arrays, a colour with a
    // non-numeric opacity, gradients, null, false, numbers JavaScript prints
    // with an exponent.
    'legacy-codegen': {
        '@md': { p: 4 },
        'data-x': 1,
        0: 'first',
        s: "it's \\ new\nline\rreturn",
        deep: { a: { b: { c: 1 } } },
        arr: [{ p: 4 }, { color: 'r', op: 1 }, null, false, [1, 'x']],
        c: { color: 'r', op: true },
        c2: { color: [1, 2], op: { a: 1 } },
        g: { gradient: 'linear', dir: 45, in: 'hsl' },
        g2: { gradient: 'radial', dir: null },
        g3: { gradient: "it's", in: 5 },
        z: null,
        f: false,
        n: 1.5,
        big: 1e21,
        tiny: 1e-7,
        é: 3,
        ab_$1: 2,
    },
    'legacy-pair': { a: 1, b: { color: 'r', op: 2 } },
    'legacy-pair-deep': { a: 1, b: { hover: { p: 4 } } },
    'legacy-pair-array': { a: 1, b: [1] },
    'legacy-pair-gradient': { a: 1, b: { gradient: 'conic' } },
};

/** Class strings converted against CUSTOM_MAP. */
const CUSTOM_MAP_CLASSES = [
    'legacy-card',
    'legacy-card hover:m-2',
    'legacy-text',
    'legacy-mixed',
    'legacy-none',
    'legacy-keep',
    'legacy-remove',
    'legacy-todo',
    'legacy-null',
    'legacy-false',
    'legacy-array',
    'legacy-number',
    'legacy-true',
    'legacy-empty',
    'p-4',
    'm-2 p-4 legacy-card',
    'legacy-nested',
    'legacy-nested hover:m-2',
    'legacy-nested hover:p-8',
    'block legacy-keep flex',
    'hover:legacy-card',
    'legacy-card legacy-card',
    'legacy-card p-8',
    'p-8 legacy-card',
    'legacy-mixed legacy-none',
    'hover:m-2 legacy-nested',
    'legacy-nested b:p-4',
    'legacy-nested 0:p-4',
    'legacy-nested n:p-4',
    'toString',
    'constructor',
    'hasOwnProperty',
    '__proto__',
    'valueOf p-4',
    'legacy-card toString',
    'legacy-nested hover:m-2 hover:p-8',
    'hover:block legacy-flat hover:flex',
    'hover:block legacy-flat hover:p-4',
    'legacy-flat hover:p-4',
    'legacy-codegen',
    'legacy-pair',
    'legacy-pair-deep',
    'legacy-pair-array',
    'legacy-pair-gradient',
    'legacy-pair legacy-pair-deep',
    'legacy-codegen p-8',
];

const corpus = buildCorpus();
const generated = `${JSON.stringify(corpus, null, 1)}\n`;
const relative = path.relative(repoRoot, outPath);

if (check) {
    let current = '';
    try {
        current = readFileSync(outPath, 'utf8');
    } catch {
        fail(`${relative} is missing. Run pnpm gen:migrate-parity-corpus.`);
    }
    if (current !== generated) {
        fail(
            `${relative} is stale. Run pnpm gen:migrate-parity-corpus.\n` +
                "This usually means migrate's TypeScript changed what it answers for a class.",
        );
    }
    console.log('[gen-migrate-parity-corpus] up to date.');
    process.exit(0);
}

writeFileSync(outPath, generated);
console.log(`[gen-migrate-parity-corpus] Wrote ${relative} with ${corpus.count} classes.`);

/**
 * Collect every input class and record both answers for each.
 *
 * @returns {{ $comment: string, sources: Record<string, number>, count: number, entries: object[] }}
 */
function buildCorpus() {
    const golden = JSON.parse(
        readFileSync(
            path.join(repoRoot, 'packages/cli/tests/generated/migrate-sz-golden.json'),
            'utf8',
        ),
    );
    const keyCases = JSON.parse(
        readFileSync(path.join(repoRoot, 'packages/cli/tests/generated/sz-key-cases.json'), 'utf8'),
    );
    const corpusDir = path.join(repoRoot, 'scripts/corpus');

    const goldenClasses = Object.values(golden.prefixes).flatMap(cases =>
        cases.map(entry => entry.class),
    );
    const reverseClasses = Object.values(keyCases.keys).flatMap(entry => entry.reverse);
    const corpusClasses = readdirSync(corpusDir)
        .filter(file => file.endsWith('.txt'))
        .sort()
        .flatMap(file =>
            readFileSync(path.join(corpusDir, file), 'utf8')
                .split('\n')
                .map(line => line.trim())
                .filter(line => line && !line.startsWith('#')),
        );

    const seen = new Set();
    const entries = [];
    for (const className of [
        ...goldenClasses,
        ...reverseClasses,
        ...corpusClasses,
        ...EDGE_CASES,
    ]) {
        if (seen.has(className)) continue;
        seen.add(className);
        entries.push({
            c: className,
            p: parseClass(className) ?? null,
            o: recordConversion(classNameToSzObject(className)),
        });
    }

    const customMapCases = CUSTOM_MAP_CLASSES.map(className => {
        return { c: className, o: recordConversion(classNameToSzObject(className, CUSTOM_MAP)) };
    });

    return {
        $comment:
            'GENERATED by scripts/gen-migrate-parity-corpus.mjs. Do not edit by hand. ' +
            'Run pnpm gen:migrate-parity-corpus.',
        sources: {
            golden: goldenClasses.length,
            keyCases: reverseClasses.length,
            corpus: corpusClasses.length,
            edgeCases: EDGE_CASES.length,
        },
        count: entries.length,
        entries,
        customMap: CUSTOM_MAP,
        customMapCases,
    };
}

/**
 * One conversion as the corpus records it: the sz object, its JSON text with
 * the keys in order, what stayed in className, and the source text the
 * codegen writes for it as an object literal and as an HTML attribute value.
 *
 * @param {ReturnType<typeof classNameToSzObject>} converted - The TypeScript's answer.
 * @returns {object} The recorded shape.
 */
function recordConversion(converted) {
    return {
        sz: converted.szObject,
        szText: JSON.stringify(converted.szObject),
        u: converted.unrecognized,
        k: converted.keepInClassName,
        g: generateSzObjectLiteral(converted.szObject),
        h: generateSzHtmlValue(converted.szObject),
    };
}

/**
 * Report a generator failure and stop.
 *
 * @param {string} message - What went wrong.
 */
function fail(message) {
    console.error(`[gen-migrate-parity-corpus] ${message}`);
    process.exit(1);
}
