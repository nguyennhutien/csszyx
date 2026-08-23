#!/usr/bin/env node

// Record what migrate's TypeScript source transformer writes for a set of
// files, so the Rust port can be held to the same output byte for byte.
//
// The class-level corpus proves the two sides agree on what a className
// means. This one proves they agree on everything around it: which
// attributes are touched, what is left alone and why, where the markers
// land, how a clsx call or a ternary is rewritten, what the stats and
// warnings say, and the same again for HTML. Sources are hand-written
// snippets that reach every branch, synthetic files in the shapes the
// benchmark uses, and the real components under apps/docs.
//
// Usage:
//   node --import tsx/esm scripts/gen-migrate-source-parity-corpus.mjs           # write
//   node --import tsx/esm scripts/gen-migrate-source-parity-corpus.mjs --check   # CI: fail if stale

import { readdirSync, readFileSync, statSync, writeFileSync } from 'node:fs';
import path from 'node:path';

import {
    transformHtmlSourceSimple,
    transformSource,
} from '../packages/cli/src/migrate/ast-transformer.ts';

const repoRoot = path.resolve(import.meta.dirname, '..');
const outPath = path.join(
    repoRoot,
    'packages/core/tests/fixtures/migrate-source-parity-corpus.json',
);
const check = process.argv.includes('--check');

/** The resolution map the map-aware cases run with. */
const CUSTOM_MAP = {
    mystery: { p: 4 },
    legacy: 'p-4 bg-blue-500 hover:underline',
    'legacy-mixed': 'p-2 not-a-class',
    keepme: 'sz:keep',
    gone: 'sz:remove',
    pending: 'sz:todo',
    'p-4': { padding: 'custom' },
};

const DEFAULT = {};
const TODOS = { injectTodos: true };
const KEYS = { keysOnly: true };
const MAP = { customMap: CUSTOM_MAP };
const MAP_TODOS = { customMap: CUSTOM_MAP, injectTodos: true };

/**
 * Hand-written sources. Each is `[name, source, options...]`; the options
 * list says which option sets the source is recorded under.
 */
const SNIPPETS = [
    // ── static className ──
    ['static-basic', '<div className="p-4 bg-blue-500" />', DEFAULT, TODOS, KEYS],
    ['static-unrecognized', '<div className="p-4 mystery" />', DEFAULT, TODOS, MAP, MAP_TODOS],
    ['static-all-unrecognized', '<div className="mystery other" />', DEFAULT, TODOS, MAP],
    ['static-empty', '<div className="" /><span className="   " />', DEFAULT],
    ['static-expression-string', '<div className={"p-4 m-2"} />', DEFAULT],
    ['static-single-quotes', "<div className='p-4' />", DEFAULT],
    ['static-unicode-escape', '<div className="p-\\u0034 m-2" />', DEFAULT],
    [
        'static-non-bmp-before',
        'const s = "😀😀"; export const A = () => <div className="p-4" />;',
        DEFAULT,
    ],
    ['static-non-bmp-inside', '<div className="p-4 text-[😀]">😀</div>', DEFAULT, TODOS],
    [
        'static-many',
        '<div className="flex items-center gap-3 rounded-lg border p-4 hover:bg-gray-50 md:px-6" />',
        DEFAULT,
    ],
    ['static-conflict', '<div className="block flex p-4" />', DEFAULT, TODOS],
    ['static-important', '<div className="!p-4 m-2!" />', DEFAULT],
    ['static-multiline-attr', '<div\n  className="p-4"\n  id="x"\n/>', DEFAULT],
    [
        'static-nested',
        '<ul className="p-4"><li className="m-2"><a className="underline">x</a></li></ul>',
        DEFAULT,
    ],
    ['static-fragment', '<><div className="p-4" /><span className="m-2" /></>', DEFAULT],
    ['static-with-spread', '<div {...props} className="p-4" />', DEFAULT],
    ['component-capitalized', '<Card className="p-4" />', DEFAULT],
    ['component-member', '<ui.Card className="p-4" />', DEFAULT],
    ['component-and-host', '<Card className="p-4"><div className="m-2" /></Card>', DEFAULT],
    ['sibling-sz-static', '<div sz={{ p: 4 }} className="m-2" />', DEFAULT, TODOS, MAP],
    ['sibling-sz-dynamic', '<div sz={styles} className="p-4" />', DEFAULT, MAP],
    ['sibling-sz-merge', '<div sz={{ m: 1 }} className="mystery" />', MAP, MAP_TODOS],
    ['sibling-sz-merge-empty', '<div sz={{}} className="mystery" />', MAP],
    ['sibling-sz-merge-keep', '<div sz={{ m: 1 }} className="mystery keepme other" />', MAP_TODOS],
    ['sibling-sz-merge-string', '<div sz={{ m: 1 }} className="legacy gone" />', MAP],
    ['sibling-sz-merge-clash', '<div sz={{ p: 2 }} className="mystery" />', MAP, MAP_TODOS],
    ['sibling-sz-merge-undecided', '<div sz={{ m: 1 }} className="other" />', MAP_TODOS],
    ['sibling-sz-merge-remove-only', '<div sz={{ m: 1 }} className="gone" />', MAP],
    ['sibling-sz-merge-pending', '<div sz={{ m: 1 }} className="pending" />', MAP_TODOS],
    ['sibling-sz-merge-trailing-comma', '<div sz={{ m: 1, }} className="mystery" />', MAP],
    ['sibling-sz-merge-spread', '<div sz={{ ...base, m: 1 }} className="mystery" />', MAP],
    ['sibling-sz-merge-no-space', '<div sz={{ m: 1 }}className="mystery" />', MAP],
    ['sibling-sz-merge-computed', '<div sz={{ [k]: 1 }} className="mystery" />', MAP],
    ['sibling-sz-merge-quoted-key', '<div sz={{ \'p\': 2 }} className="mystery" />', MAP],
    ['sibling-sz-merge-dynamic-class', '<div sz={{ m: 1 }} className={clsx("mystery")} />', MAP],
    ['sibling-sz-merge-multi', '<div sz={{ m: 1 }} className="legacy" />', MAP],
    ['sibling-sz-merge-mixed', '<div sz={{ m: 1 }} className="legacy-mixed" />', MAP_TODOS],
    ['sibling-sz-merge-p4', '<div sz={{ m: 1 }} className="p-4" />', MAP],
    // ── className expressions ──
    ['expr-identifier', '<div className={cls} />', DEFAULT],
    ['expr-empty', '<div className={} />', DEFAULT],
    ['expr-undefined', '<div className={undefined} />', DEFAULT],
    ['expr-or', '<div className={a || "p-4"} />', DEFAULT],
    ['expr-nullish', '<div className={a ?? "p-4"} />', DEFAULT],
    ['expr-call-other', '<div className={styles("p-4")} />', DEFAULT],
    ['expr-member-call', '<div className={lib.clsx("p-4")} />', DEFAULT],
    ['expr-template-static', '<div className={`p-4 m-2`} />', DEFAULT],
    ['expr-template-empty', '<div className={``} />', DEFAULT],
    ['expr-template-ternary', '<div className={`p-4 ${cond ? "bg-blue" : "bg-red"}`} />', DEFAULT],
    ['expr-template-ternary-empty', '<div className={`p-4 ${cond ? "m-2" : ""}`} />', DEFAULT],
    ['expr-template-and', '<div className={`p-4 ${open && "m-2"}`} />', DEFAULT],
    ['expr-template-string-expr', '<div className={`p-4 ${"m-2"}`} />', DEFAULT],
    [
        'expr-template-string-expr-unrecognized',
        '<div className={`p-4 ${"mystery"}`} />',
        DEFAULT,
        TODOS,
    ],
    ['expr-template-unsupported', '<div className={`p-4 ${fn()}`} />', DEFAULT],
    ['expr-template-as', '<div className={`p-4 ${x as string}`} />', DEFAULT],
    ['expr-template-only-dynamic', '<div className={`${cond ? "p-4" : "m-2"}`} />', DEFAULT],
    ['expr-template-whitespace', '<div className={`  p-4\n   m-2  ${cond && "x-1"}`} />', DEFAULT],
    [
        'expr-template-unrecognized-static',
        '<div className={`mystery ${cond && "p-4"}`} />',
        DEFAULT,
        TODOS,
    ],
    [
        'expr-template-unrecognized-dynamic',
        '<div className={`p-4 ${cond && "mystery"}`} />',
        DEFAULT,
    ],
    ['expr-template-all-unrecognized', '<div className={`mystery`} />', DEFAULT],
    ['expr-template-escape', '<div className={`p-4 \\u0031`} />', DEFAULT],
    ['expr-template-nested', '<div className={`p-4 ${cond ? `m-2` : "m-4"}`} />', DEFAULT],
    ['clsx-single', '<div className={clsx("p-4")} />', DEFAULT],
    ['clsx-single-unrecognized', '<div className={clsx("mystery")} />', DEFAULT, TODOS, MAP],
    ['clsx-partial-unrecognized', '<div className={clsx("p-4 mystery")} />', DEFAULT, TODOS],
    ['clsx-and', '<div className={clsx("p-4", cond && "m-2")} />', DEFAULT],
    ['clsx-and-unrecognized', '<div className={clsx("p-4", cond && "mystery")} />', DEFAULT],
    ['clsx-and-non-string', '<div className={clsx("p-4", cond && foo)} />', DEFAULT],
    ['clsx-ternary', '<div className={clsx(cond ? "p-4" : "m-2")} />', DEFAULT],
    ['clsx-ternary-empty-alt', '<div className={clsx(cond ? "p-4" : "")} />', DEFAULT],
    ['clsx-ternary-empty-con', '<div className={clsx(cond ? "" : "m-2")} />', DEFAULT],
    ['clsx-ternary-both-empty', '<div className={clsx(cond ? "" : "")} />', DEFAULT],
    ['clsx-ternary-unrecognized', '<div className={clsx(cond ? "mystery" : "m-2")} />', DEFAULT],
    ['clsx-ternary-non-string', '<div className={clsx(cond ? a : "m-2")} />', DEFAULT],
    ['clsx-spread', '<div className={clsx("p-4", ...rest)} />', DEFAULT],
    ['clsx-object-arg', '<div className={clsx({ "p-4": true })} />', DEFAULT],
    ['clsx-identifier-arg', '<div className={clsx(base, "p-4")} />', DEFAULT],
    ['clsx-empty', '<div className={clsx()} />', DEFAULT],
    [
        'clsx-multi',
        '<div className={clsx("p-4", "m-2", cond && "x-1", a ? "y-1" : "z-1")} />',
        DEFAULT,
    ],
    [
        'clsx-names',
        '<div className={cn("p-4")} /><div className={cx("p-4")} /><div className={twMerge("p-4")} /><div className={classNames("p-4")} /><div className={classnames("p-4")} />',
        DEFAULT,
    ],
    ['clsx-only-and', '<div className={clsx(cond && "p-4")} />', DEFAULT],
    ['clsx-only-ternary', '<div className={clsx(cond ? "p-4" : "m-2")} />', DEFAULT],
    [
        'clsx-compound-cond',
        '<div className={clsx(a && b ? "p-4" : "", c || d ? "" : "m-2")} />',
        DEFAULT,
    ],
    ['ternary-basic', '<div className={cond ? "p-4" : "m-2"} />', DEFAULT],
    ['ternary-empty-alt', '<div className={cond ? "p-4" : ""} />', DEFAULT],
    ['ternary-empty-con', '<div className={cond ? "" : "m-2"} />', DEFAULT],
    ['ternary-both-empty', '<div className={cond ? "" : ""} />', DEFAULT],
    ['ternary-spaces', '<div className={cond ? "  p-4 " : " m-2  "} />', DEFAULT],
    ['ternary-non-string', '<div className={cond ? a : "m-2"} />', DEFAULT],
    ['ternary-unrecognized', '<div className={cond ? "mystery" : "m-2"} />', DEFAULT, TODOS],
    ['ternary-compound', '<div className={a && b ? "p-4" : "m-2"} />', DEFAULT],
    ['ternary-negated-empty-con', '<div className={!x ? "" : "p-4"} />', DEFAULT],
    ['ternary-compound-empty-con', '<div className={a || b ? "" : "p-4"} />', DEFAULT],
    ['ternary-call-cond', '<div className={isOpen() ? "p-4" : ""} />', DEFAULT],
    ['ternary-nested', '<div className={a ? (b ? "p-4" : "m-2") : "x-1"} />', DEFAULT],
    ['and-basic', '<div className={cond && "p-4"} />', DEFAULT],
    ['and-non-string', '<div className={cond && foo} />', DEFAULT],
    ['and-unrecognized', '<div className={cond && "mystery"} />', DEFAULT, TODOS],
    ['and-empty', '<div className={cond && ""} />', DEFAULT],
    ['and-chain', '<div className={a && b && "p-4"} />', DEFAULT],
    ['and-partial-unrecognized', '<div className={cond && "p-4 mystery"} />', DEFAULT, TODOS],
    ['ternary-partial-unrecognized', '<div className={cond ? "p-4 mystery" : "m-2"} />', DEFAULT],
    ['ternary-partial-alt-empty', '<div className={cond ? "p-4 mystery" : ""} />', DEFAULT],
    ['ternary-partial-con-empty', '<div className={cond ? "" : "p-4 mystery"} />', DEFAULT],
    ['clsx-and-partial', '<div className={clsx("p-4", cond && "p-4 mystery")} />', DEFAULT],
    ['or-basic', '<div className={cond || "p-4"} />', DEFAULT],
    // ── imports ──
    [
        'import-clsx-unused',
        'import clsx from "clsx";\nexport const A = () => <div className={clsx("p-4")} />;',
        DEFAULT,
    ],
    [
        'import-clsx-used-elsewhere',
        'import clsx from "clsx";\nconst x = clsx("a");\nexport const A = () => <div className={clsx("p-4")} />;',
        DEFAULT,
    ],
    [
        'import-clsx-no-change',
        'import clsx from "clsx";\nexport const A = () => <div className={clsx(foo)} />;',
        DEFAULT,
    ],
    [
        'import-cn-local',
        'import { cn } from "@/lib/utils";\nexport const A = () => <div className={cn("p-4")} />;',
        DEFAULT,
    ],
    [
        'import-clsx-lite',
        'import clsx from "clsx/lite";\nexport const A = () => <div className={clsx("p-4")} />;',
        DEFAULT,
    ],
    [
        'import-classnames',
        'import classNames from "classnames";\nexport const A = () => <div className={classNames("p-4")} />;',
        DEFAULT,
    ],
    [
        'import-twmerge-renamed',
        'import { twMerge as merge } from "tailwind-merge";\nexport const A = () => <div className={merge("p-4")} />;',
        DEFAULT,
    ],
    [
        'import-namespace',
        'import * as clsx from "clsx";\nexport const A = () => <div className="p-4" />;',
        DEFAULT,
    ],
    [
        'import-cva',
        'import { cva } from "class-variance-authority";\nexport const A = () => <div className="p-4" />;',
        DEFAULT,
    ],
    [
        'import-cva-pkg',
        'import { cva } from "cva";\nexport const A = () => <div className="p-4" />;',
        DEFAULT,
    ],
    ['import-cva-only', 'import { cva } from "cva";\nconst b = cva("p-4");', DEFAULT],
    [
        'import-cva-sub',
        'import x from "cva/react";\nexport const A = () => <div className="p-4" />;',
        DEFAULT,
    ],
    [
        'import-clsx-used-in-attr-and-out',
        'import clsx from "clsx";\nexport const A = () => <div title={clsx("a")} className={clsx("p-4")} />;',
        DEFAULT,
    ],
    [
        'import-clsx-two-calls-one-migrated',
        'import clsx from "clsx";\nexport const A = () => <><div className={clsx("p-4")} /><div className={clsx(foo)} /></>;',
        DEFAULT,
    ],
    [
        'import-clsx-word-inside',
        'import clsx from "clsx";\nconst myclsx = 1;\nexport const A = () => <div className={clsx("p-4")} />;',
        DEFAULT,
    ],
    [
        'import-clsx-regex-name',
        'import clsx from "clsx";\nexport const A = () => <div className={clsx("p-4")} data-x="clsx (" />;',
        DEFAULT,
    ],
    // ── sz normalisation ──
    ['sz-normalize-sugar', '<div sz={{ flex: true }} />', DEFAULT, KEYS],
    ['sz-normalize-rename', "<div sz={{ padding: 4, fontWeight: 'bold' }} />", DEFAULT, KEYS],
    ['sz-normalize-nested', "<div sz={{ hover: { backgroundColor: 'red' } }} />", DEFAULT],
    ['sz-normalize-canonical', "<div sz={{ p: 4, display: 'flex' }} />", DEFAULT, KEYS],
    ['sz-normalize-unknown', "<div sz={{ customThing: 1, flex: 'maybe' }} />", DEFAULT],
    ['sz-normalize-quoted-key', "<div sz={{ 'padding': 4 }} />", DEFAULT],
    ['sz-normalize-computed', '<div sz={{ [k]: 4, padding: 2 }} />', DEFAULT],
    ['sz-normalize-spread', '<div sz={{ ...base, padding: 2 }} />', DEFAULT],
    ['sz-normalize-font-weight', "<div sz={{ font: 'bold' }} />", DEFAULT],
    ['sz-normalize-font-number', '<div sz={{ font: 700 }} />', DEFAULT],
    ['sz-normalize-font-family', "<div sz={{ font: 'sans' }} />", DEFAULT],
    ['sz-normalize-font-dynamic', '<div sz={{ font: weight }} />', DEFAULT],
    ['sz-normalize-font-quoted', "<div sz={{ 'font': 'bold' }} />", DEFAULT],
    ['sz-normalize-font-stretch', "<div sz={{ font: 'stretch-condensed' }} />", DEFAULT, KEYS],
    ['sz-normalize-font-stretch-percent', "<div sz={{ font: 'stretch-75%' }} />", DEFAULT],
    ['sz-normalize-font-stretch-var', "<div sz={{ font: 'stretch-(--s)' }} />", DEFAULT],
    ['sz-normalize-font-stretch-bracket', "<div sz={{ font: 'stretch-[75%]' }} />", DEFAULT],
    ['sz-normalize-font-stretch-bare', "<div sz={{ font: 'stretch-' }} />", DEFAULT],
    ['sz-normalize-prose-target', "<div sz={{ scrollbarColor: 'x' }} />", DEFAULT],
    ['sz-normalize-sugar-false', '<div sz={{ flex: false }} />', DEFAULT],
    ['sz-normalize-dynamic', '<div sz={styles} />', DEFAULT, KEYS],
    ['sz-normalize-string', '<div sz="p: 4" />', DEFAULT, KEYS],
    ['sz-normalize-with-class', '<div sz={{ padding: 4 }} className="m-2" />', DEFAULT, KEYS],
    [
        'sz-normalize-deep',
        '<div sz={{ group: { data: { active: { flex: true, margin: 2 } } } }} />',
        DEFAULT,
    ],
    ['sz-normalize-shorthand-prop', '<div sz={{ padding }} />', DEFAULT],
    ['sz-normalize-method', '<div sz={{ padding() {} }} />', DEFAULT],
    ['sz-normalize-numeric-key', '<div sz={{ 1: 2, padding: 4 }} />', DEFAULT],
    ['sz-normalize-getter', '<div sz={{ get padding() { return 1; }, margin: 2 }} />', DEFAULT],
    // ── fast paths and parse errors ──
    ['fast-path-nothing', 'export const x = 1;\nconst y = "class";', DEFAULT, KEYS],
    ['fast-path-keys-only-no-sz', '<div className="p-4" />', KEYS],
    ['fast-path-cva-word', 'const cva = 1;', DEFAULT],
    ['fast-path-classname-in-comment', '// className\nexport const x = 1;', DEFAULT],
    ['parse-error-unclosed', '<div className="p-4"', DEFAULT],
    ['parse-error-garbage', 'const = ; className', DEFAULT],
    ['parse-error-bad-jsx', '<div className="p-4"></span>', DEFAULT],
    // ── typescript and syntax variety ──
    [
        'ts-generics',
        'export const A = <T,>(x: T) => <div className="p-4">{x as unknown as string}</div>;',
        DEFAULT,
    ],
    [
        'ts-satisfies',
        'const c = { a: 1 } satisfies Record<string, number>;\nexport const A = () => <div className="p-4" />;',
        DEFAULT,
    ],
    [
        'ts-enum-decorator',
        '@dec\nclass C { @dec m() {} }\nenum E { A }\nexport const A = () => <div className="p-4" />;',
        DEFAULT,
    ],
    [
        'ts-type-import',
        'import type { X } from "x";\nimport { type Y, z } from "y";\nexport const A = () => <div className="p-4" />;',
        DEFAULT,
    ],
    [
        'ts-optional-chain',
        'export const A = () => <div className={props?.active ? "p-4" : ""} />;',
        DEFAULT,
    ],
    ['jsx-namespaced', '<svg:rect className="p-4" />', DEFAULT],
    ['jsx-namespaced-attr', '<a xlink:href="#" className="p-4" xml:lang="en" />', DEFAULT],
    ['jsx-text-braces', '<div className="p-4">{"{"}text{"}"}</div>', DEFAULT],
    ['jsx-comment-child', '<div>{/* note */}<span className="p-4" /></div>', DEFAULT, TODOS],
    ['jsx-attr-jsx-value', '<div className=<span /> />', DEFAULT],
    ['hash-bang', '#!/usr/bin/env node\nexport const A = () => <div className="p-4" />;', DEFAULT],
    ['bom', '﻿export const A = () => <div className="p-4" />;', DEFAULT],
    // ── line endings ──
    [
        'crlf-static',
        'export const A = () => (\r\n  <div className="p-4 mystery flex items-center gap-2" />\r\n);\r\n',
        DEFAULT,
        TODOS,
    ],
    [
        'crlf-many',
        'export const A = () => <div className="flex items-center gap-3 rounded-lg border p-4" />;\r\n',
        DEFAULT,
    ],
    ['crlf-sz-merge', '<div sz={{ m: 1 }} className="legacy" />\r\n', MAP_TODOS],
    ['cr-only', 'export const A = () => <div className="p-4 mystery" />;\r', TODOS],
    [
        'lf-then-crlf',
        'const a = 1;\nexport const A = () => <div className="p-4 mystery" />;\r\n',
        TODOS,
    ],
    [
        'crlf-first-line',
        'const a = 1;\r\nexport const A = () => <div className="p-4 mystery" />;\n',
        TODOS,
    ],
];

/** File names the snippets are recorded under, cycling through the parsers' views of a path. */
const SNIPPET_FILES = ['Snippet.tsx', 'snippet.jsx', 'snippet.js'];

/** Sources recorded under every file name, because the parser reads a `.js` and a `.tsx` differently. */
const FILE_SENSITIVE = new Set([
    'ts-generics',
    'ts-satisfies',
    'ts-enum-decorator',
    'ts-type-import',
    'expr-template-as',
    'static-basic',
    'parse-error-unclosed',
]);

/** HTML sources: `[name, source, options...]`. */
const HTML_SNIPPETS = [
    [
        'html-basic',
        '<html><head><title>x</title></head><body><div class="p-4 bg-blue-500">x</div></body></html>',
        {},
        { braces: true },
        { injectFouc: false },
        { injectRuntime: false },
        { injectRuntime: 'cdn' },
        { injectRuntime: 'local' },
        { injectRuntime: 'cdn', cdnUrl: 'https://example.test/rt.js' },
        { injectRuntime: 'local', localPath: 'assets/rt.js' },
    ],
    ['html-unrecognized', '<div class="p-4 mystery">x</div>', {}, { braces: true }],
    ['html-all-unrecognized', '<div class="mystery">x</div>', {}],
    ['html-empty-class', '<div class="">x</div><div class="  ">y</div>', {}],
    ['html-single-quotes', "<div class='p-4'>x</div><div class='p-4 mystery'>y</div>", {}],
    ['html-mixed-quotes', '<div class="p-4">x</div><div class=\'m-2\'>y</div>', {}],
    ['html-no-head', '<body><div class="p-4">x</div></body>', {}, { injectRuntime: 'cdn' }],
    ['html-no-body', '<head></head><div class="p-4">x</div>', { injectRuntime: 'cdn' }],
    [
        'html-already-fouc',
        '<head><style>/* csszyx: hide [sz] elements */</style></head><body><div class="p-4">x</div></body>',
        {},
    ],
    [
        'html-already-runtime',
        '<head></head><body><script src="https://cdn.csszyx.com/runtime.js"></script><div class="p-4">x</div></body>',
        { injectRuntime: 'cdn' },
    ],
    ['html-data-class', '<div data-class="p-4" class="m-2">x</div>', {}],
    ['html-subclass', '<div subclass="p-4" class="m-2" x_class="p-1" 9class="p-2">x</div>', {}],
    ['html-unterminated', '<div class="p-4>x</div><span class="m-2">y</span>', {}],
    ['html-unterminated-single', "<div class='p-4>x</div>", {}],
    ['html-upper', '<div CLASS="p-4" Class="m-2">x</div>', {}],
    ['html-classname-attr', '<div className="p-4">x</div>', {}],
    ['html-in-comment', '<!-- <div class="p-4"> --><div class="m-2">x</div>', {}],
    ['html-multiline-classes', '<div class="p-4\n  m-2\n  mystery">x</div>', {}],
    [
        'html-crlf',
        '<html><head></head><body>\r\n<div class="p-4 mystery flex items-center gap-3 rounded-lg border">x</div>\r\n</body></html>\r\n',
        {},
        { injectRuntime: 'cdn' },
    ],
    [
        'html-many-classes',
        '<div class="flex items-center gap-3 rounded-lg border p-4 hover:bg-gray-50">x</div>',
        {},
        { braces: true },
    ],
    ['html-no-class', '<div id="x">x</div>', {}],
    ['html-variants', '<div class="md:flex hover:bg-red-500 dark:text-white">x</div>', {}],
    ['html-duplicate-head-marker', '<head></head><head></head><div class="p-4">x</div>', {}],
    ['html-nonbmp', '<div class="p-4 😀 mystery">😀</div>', {}],
];

const corpus = buildCorpus();
const generated = `${JSON.stringify(corpus, null, 1)}\n`;
const relative = path.relative(repoRoot, outPath);

if (check) {
    let current = '';
    try {
        current = readFileSync(outPath, 'utf8');
    } catch {
        fail(`${relative} is missing. Run pnpm gen:migrate-source-corpus.`);
    }
    if (current !== generated) {
        fail(
            `${relative} is stale. Run pnpm gen:migrate-source-corpus.\n` +
                "This usually means migrate's TypeScript transformer changed what it writes.",
        );
    }
    console.log('[gen-migrate-source-parity-corpus] up to date.');
    process.exit(0);
}

writeFileSync(outPath, generated);
console.log(
    `[gen-migrate-source-parity-corpus] Wrote ${relative}: ${corpus.sources.length} sources, ` +
        `${corpus.cases.length} JSX cases, ${corpus.htmlCases.length} HTML cases.`,
);

/**
 * Synthetic files in the shapes `scripts/bench-cli-migrate.ts` benchmarks:
 * static, dynamic and nothing-to-do.
 *
 * @param {number} size - Components per file.
 * @returns {[string, string][]} Name and source pairs.
 */
function syntheticSources(size) {
    const templates = [
        'flex items-center gap-3 rounded-lg border border-gray-200 bg-white p-4 text-gray-900 shadow-sm hover:bg-gray-50 md:px-6',
        'grid grid-cols-2 gap-4 rounded-xl bg-blue-500 p-6 text-white md:grid-cols-4 dark:bg-blue-600',
        'relative overflow-hidden rounded-md border border-slate-200 bg-slate-50 px-4 py-3 text-sm font-medium',
        'inline-flex items-center justify-center rounded-full bg-emerald-500 px-3 py-1 text-xs font-semibold text-white',
    ];
    const repeated = Array.from(
        { length: size },
        (_, index) => templates[index % templates.length],
    );
    const unique = Array.from({ length: size }, (_, index) => {
        const color = ['red', 'blue', 'emerald', 'violet', 'amber'][index % 5];
        const shade = 100 + (index % 8) * 100;
        return [
            'flex',
            'items-center',
            `gap-${(index % 6) + 1}`,
            `p-${(index % 8) + 1}`,
            `bg-${color}-${shade}`,
            `hover:bg-${color}-${Math.min(shade + 100, 900)}`,
            `w-[${160 + index}px]`,
            `min-[${320 + (index % 12) * 10}px]:grid`,
        ].join(' ');
    });
    const staticLines = repeated.map(
        (className, index) =>
            `export const Static${index} = () => <div className="${className}" data-i="${index}" />;`,
    );
    const dynamicLines = repeated.map((className, index) => {
        const alternate = unique[index];
        if (index % 4 === 0) {
            return `export const Dynamic${index} = ({ active }) => <div className={clsx("${className}", active && "ring-2 ring-blue-500")} />;`;
        }
        if (index % 4 === 1) {
            return `export const Dynamic${index} = ({ active }) => <div className={active ? "${className}" : "${alternate}"} />;`;
        }
        if (index % 4 === 2) {
            return `export const Dynamic${index} = ({ open }) => <div className={open && "${className}"} />;`;
        }
        return `export const Dynamic${index} = ({ active }) => <div className={\`${className} \${active ? "opacity-100" : "opacity-50"}\`} />;`;
    });
    const skipLines = Array.from({ length: size }, (_, index) => {
        if (index % 3 === 0)
            return `export interface Type${index} { id: number; name: string; tags: string[]; }`;
        if (index % 3 === 1)
            return `export const helper${index} = (x: number): number => x * ${index} + ${(index % 7) + 1};`;
        return `export type Union${index} = "a" | "b" | "c" | "d-${index}";`;
    });
    return [
        ['synthetic/static.tsx', `${staticLines.join('\n')}\n`],
        ['synthetic/dynamic.tsx', `import clsx from 'clsx';\n${dynamicLines.join('\n')}\n`],
        ['synthetic/skip.ts', `${skipLines.join('\n')}\n`],
    ];
}

/**
 * The real components under apps/docs, smallest first.
 *
 * @returns {[string, string][]} Repo-relative path and source pairs.
 */
function repoSources() {
    const root = path.join(repoRoot, 'apps/docs/src/components');
    const files = [];
    (function walk(dir) {
        for (const entry of readdirSync(dir)) {
            const full = path.join(dir, entry);
            if (statSync(full).isDirectory()) walk(full);
            else if (entry.endsWith('.tsx')) files.push(full);
        }
    })(root);
    return files.sort().map(file => [path.relative(repoRoot, file), readFileSync(file, 'utf8')]);
}

/**
 * Run every source under its option sets and record the answers.
 *
 * @returns {object} The corpus.
 */
function buildCorpus() {
    const sources = [];
    const sourceIndex = new Map();
    const cases = [];
    const record = (file, source, options) => {
        const key = `${file}\0${source}`;
        let index = sourceIndex.get(key);
        if (index === undefined) {
            index = sources.length;
            sourceIndex.set(key, index);
            sources.push({ file, source });
        }
        const { customMap, ...rest } = options;
        cases.push({
            src: index,
            options: customMap ? { ...rest, customMap: true } : rest,
            result: transformSource(source, file, options),
        });
    };

    for (const [name, source, ...optionSets] of SNIPPETS) {
        const files = FILE_SENSITIVE.has(name) ? SNIPPET_FILES : [SNIPPET_FILES[0]];
        for (const file of files) {
            for (const options of optionSets) record(`${name}/${file}`, source, options);
        }
    }
    for (const [file, source] of syntheticSources(24)) {
        record(file, source, DEFAULT);
        record(file, source, TODOS);
    }
    for (const [file, source] of repoSources()) {
        for (const options of [DEFAULT, TODOS, KEYS]) record(file, source, options);
    }

    const htmlCases = [];
    for (const [name, source, ...optionSets] of HTML_SNIPPETS) {
        for (const options of optionSets) {
            htmlCases.push({
                name,
                source,
                options,
                result: transformHtmlSourceSimple(source, options),
            });
        }
    }

    return {
        $comment:
            'GENERATED by scripts/gen-migrate-source-parity-corpus.mjs. Do not edit by hand. ' +
            'Run pnpm gen:migrate-source-corpus.',
        customMap: CUSTOM_MAP,
        sources,
        cases,
        htmlCases,
    };
}

/**
 * Report a generator failure and stop.
 *
 * @param {string} message - What went wrong.
 */
function fail(message) {
    console.error(`[gen-migrate-source-parity-corpus] ${message}`);
    process.exit(1);
}
