/**
 * The migrate command wrapper end-to-end over a temp project: dry-run, real
 * write, and audit mode — the paths the parser/codegen unit suites never run.
 */
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { afterEach, describe, expect, it, vi } from 'vitest';

import { migrate } from '../src/commands/migrate.js';

const tempDirs: string[] = [];
function fixture(): string {
    const cwd = mkdtempSync(join(tmpdir(), 'csszyx-migrate-'));
    tempDirs.push(cwd);
    mkdirSync(join(cwd, 'src'));
    writeFileSync(
        join(cwd, 'src/App.tsx'),
        'export const App = () => <div className="p-4 bg-blue-500">hi</div>;\n',
    );
    return cwd;
}

afterEach(() => {
    for (const dir of tempDirs.splice(0)) rmSync(dir, { recursive: true, force: true });
    vi.restoreAllMocks();
});

function mute(): string[] {
    const logs: string[] = [];
    vi.spyOn(console, 'log').mockImplementation((...parts: unknown[]) => {
        logs.push(parts.join(' '));
    });
    return logs;
}

describe('migrate command', () => {
    it('dry-run reports the conversion without touching the file', async () => {
        const logs = mute();
        const cwd = fixture();
        const before = readFileSync(join(cwd, 'src/App.tsx'), 'utf8');
        await migrate({ cwd, dryRun: true });
        expect(readFileSync(join(cwd, 'src/App.tsx'), 'utf8')).toBe(before);
        expect(logs.join('\n').length).toBeGreaterThan(0);
    });

    it('rewrites className into an sz prop on a real run', async () => {
        mute();
        const cwd = fixture();
        await migrate({ cwd });
        const after = readFileSync(join(cwd, 'src/App.tsx'), 'utf8');
        expect(after).toContain('sz={{');
        expect(after).toContain("bg: 'blue-500'");
        expect(after).not.toContain('className="p-4');
    });

    it('audit mode forces dry-run and writes the todo map for unknown classes', async () => {
        mute();
        const cwd = fixture();
        writeFileSync(
            join(cwd, 'src/Custom.tsx'),
            'export const C = () => <div className="p-4 btn-custom">x</div>;\n',
        );
        const before = readFileSync(join(cwd, 'src/Custom.tsx'), 'utf8');
        await migrate({ cwd, audit: true });
        expect(readFileSync(join(cwd, 'src/Custom.tsx'), 'utf8')).toBe(before);
    });
});

describe('migrate todo workflow', () => {
    it('audits unknown classes, then resolves them from the todo map', async () => {
        mute();
        vi.spyOn(console, 'info').mockImplementation(() => {});
        const cwd = fixture();
        const file = join(cwd, 'src/Custom.tsx');
        writeFileSync(file, 'export const C = () => <div className="p-4 btn-custom">x</div>;\n');
        await migrate({ cwd, audit: true });

        // The user fills the audited map, then resolves against the pristine file.
        writeFileSync(join(cwd, '.csszyx-todo.json'), JSON.stringify({ 'btn-custom': { p: 8 } }));
        await migrate({ cwd, resolveTodos: '.csszyx-todo.json' });
        const resolved = readFileSync(file, 'utf8');
        expect(resolved).toContain('sz={{ p: 8 }}');
        expect(resolved).not.toContain('btn-custom');
    });

    it('warns and stops when the resolve map is missing or invalid', async () => {
        const logs = mute();
        const cwd = fixture();
        await migrate({ cwd, resolveTodos: 'missing.json' });
        expect(logs.join('\n')).toContain('Could not load resolve map');
    });
});

describe('migrate dynamic patterns and HTML', () => {
    it('migrates template-literal classNames with embedded expressions', async () => {
        mute();
        vi.spyOn(console, 'info').mockImplementation(() => {});
        const cwd = fixture();
        writeFileSync(
            join(cwd, 'src/Dyn.tsx'),
            [
                'export const D = ({ active, tone }) => (',
                '  <div className={`p-4 ${"m-2"} ${active ? "bg-blue-500" : "bg-red-500"} ${active && "underline"}`}>x</div>',
                ');',
            ].join('\n'),
        );
        await migrate({ cwd });
        const out = readFileSync(join(cwd, 'src/Dyn.tsx'), 'utf8');
        expect(out).toContain('sz={[');
        expect(out).toContain('p: 4');
        expect(out).toContain('active');
    });

    it('migrates an HTML file, injecting the FOUC guard and runtime script', async () => {
        mute();
        vi.spyOn(console, 'info').mockImplementation(() => {});
        const cwd = fixture();
        writeFileSync(
            join(cwd, 'src/page.html'),
            '<html><head></head><body><div class="p-4 bg-blue-500">x</div></body></html>',
        );
        await migrate({ cwd, pattern: 'src/**/*.html' });
        const out = readFileSync(join(cwd, 'src/page.html'), 'utf8');
        expect(out).toContain('sz="');
        expect(out).toContain('csszyx');
    });
});

describe('migrate clsx and comment-strip edges', () => {
    it('converts clsx calls and reports the now-unused import', async () => {
        const logs = mute();
        vi.spyOn(console, 'info').mockImplementation(() => {});
        const cwd = fixture();
        writeFileSync(
            join(cwd, 'src/Clsx.tsx'),
            [
                "import clsx from 'clsx';",
                'export const B = ({ on }) => (',
                '  <div className={clsx("p-4", on && "bg-blue-500")}>x</div>',
                ');',
            ].join('\n'),
        );
        await migrate({ cwd });
        const out = readFileSync(join(cwd, 'src/Clsx.tsx'), 'utf8');
        expect(out).toContain('sz={');
        expect(logs.join('\n')).toContain('unused imports');
    });

    it('strip pass keeps ordinary JSX comments and malformed todo comments', async () => {
        mute();
        vi.spyOn(console, 'info').mockImplementation(() => {});
        const cwd = fixture();
        const file = join(cwd, 'src/Comments.tsx');
        writeFileSync(
            file,
            [
                'export const K = () => (<div>',
                '{/* keep me */}',
                '{/* @sz-todo: broken',
                'still-broken */}',
                '{/*   */}',
                '<span className="p-4 mystery-class">x</span>',
                '</div>);',
            ].join('\n'),
        );
        await migrate({ cwd, audit: true });
        writeFileSync(
            join(cwd, '.csszyx-todo.json'),
            JSON.stringify({ 'mystery-class': { m: 1 } }),
        );
        await migrate({ cwd, resolveTodos: '.csszyx-todo.json' });
        const out = readFileSync(file, 'utf8');
        expect(out).toContain('keep me');
        expect(out).toContain('m: 1');
    });
});

describe('migrate resolve loop on an already-migrated file', () => {
    it('merges the map into the sz prop the first pass wrote and clears its marker', async () => {
        mute();
        vi.spyOn(console, 'info').mockImplementation(() => {});
        const cwd = fixture();
        const file = join(cwd, 'src/Loop.tsx');
        writeFileSync(file, 'export const L = () => <div className="p-4 mystery-class">x</div>;\n');
        // First pass: p-4 migrates, mystery-class stays marked.
        await migrate({ cwd, injectTodos: true });
        const first = readFileSync(file, 'utf8');
        expect(first).toContain('sz={{ p: 4 }}');
        expect(first).toContain('className="mystery-class"');
        expect(first).toContain('@sz-todo: mystery-class');
        // The documented loop: audit, decide, resolve.
        await migrate({ cwd, audit: true });
        writeFileSync(
            join(cwd, '.csszyx-todo.json'),
            JSON.stringify({ 'mystery-class': { m: 1 } }),
        );
        await migrate({ cwd, resolveTodos: '.csszyx-todo.json' });
        const resolved = readFileSync(file, 'utf8');
        expect(resolved).toContain('sz={{ p: 4, m: 1 }}');
        expect(resolved).not.toContain('className=');
        expect(resolved).not.toContain('@sz-todo');
    });
});

describe('migrate reporting overflow paths', () => {
    it('reports still-unresolved todos and overflows past five warnings', async () => {
        const logs = mute();
        vi.spyOn(console, 'info').mockImplementation(() => {});
        const cwd = fixture();
        // Seven files with unknown classes → more than 5 per-file warnings.
        for (let i = 0; i < 7; i++) {
            writeFileSync(
                join(cwd, `src/Many.tsx`),
                `export const M = () => <i className="p-1 unk-">x</i>;`,
            );
        }
        await migrate({ cwd, audit: true });
        // Resolve map that leaves everything explicitly unresolved.
        const map = Object.fromEntries(
            Array.from({ length: 7 }, (_, i) => [`unk-${i}`, 'sz:todo']),
        );
        writeFileSync(join(cwd, '.csszyx-todo.json'), JSON.stringify(map));
        await migrate({ cwd, resolveTodos: '.csszyx-todo.json' });
        const all = logs.join('\n');
        expect(all.toLowerCase()).toContain('unresolved');
    });
});

describe('migrate clsx argument space', () => {
    it('handles ternary/empty-branch args and skips unmigratable expressions', async () => {
        mute();
        vi.spyOn(console, 'info').mockImplementation(() => {});
        const cwd = fixture();
        writeFileSync(
            join(cwd, 'src/Mix.tsx'),
            [
                "import clsx from 'clsx';",
                'export const T = ({ big, on }) => (<div>',
                '  <i className={clsx(big ? "text-2xl" : "text-sm")}>a</i>',
                '  <b className={clsx(on ? "underline" : "")}>b</b>',
                '  <u className={clsx(on ? "" : "line-through")}>c</u>',
                '  <s className={clsx(someFn())}>d</s>',
                '</div>);',
            ].join('\n'),
        );
        await migrate({ cwd });
        const out = readFileSync(join(cwd, 'src/Mix.tsx'), 'utf8');
        // Ternaries with a string or empty branch convert; the call arg stays.
        expect(out).toContain("big ? { text: '2xl' }");
        expect(out).toContain('someFn()');
    });
});

describe('migrate template edge space', () => {
    it('skips templates with unmigratable inner expressions but keeps static strings merged', async () => {
        mute();
        vi.spyOn(console, 'info').mockImplementation(() => {});
        const cwd = fixture();
        writeFileSync(
            join(cwd, 'src/Tmpl.tsx'),
            [
                'export const T = ({ a, b }) => (<div>',
                '  <i className={`p-4 ${"m-1"} ${a ? doIt() : "x-1"}`}>bad-ternary</i>',
                '  <b className={`p-4 ${b && call()}`}>bad-and</b>',
                '  <u className={`p-4 ${fnCall()}`}>bad-expr</u>',
                '</div>);',
            ].join('\n'),
        );
        const before = readFileSync(join(cwd, 'src/Tmpl.tsx'), 'utf8');
        await migrate({ cwd });
        const out = readFileSync(join(cwd, 'src/Tmpl.tsx'), 'utf8');
        // Unmigratable templates stay as className (skip), file unchanged there.
        expect(out).toContain('fnCall()');
        expect(out).toContain('doIt()');
        expect(before).toContain('call()');
    });
});

describe('migrate scan failures and warning overflow', () => {
    it('prints the warning overflow marker past five files with unknowns', async () => {
        const logs = mute();
        vi.spyOn(console, 'info').mockImplementation(() => {});
        const cwd = fixture();
        for (let i = 0; i < 7; i++) {
            writeFileSync(
                join(cwd, `src/W${i}.tsx`),
                'export const W' + i + ' = () => <i className={`p-1 ${fn' + i + '()}`}>x</i>;',
            );
        }
        await migrate({ cwd, dryRun: true });
        expect(logs.join('\n')).toContain('more warnings');
    });

    it('fails soft when the glob scan itself throws', async () => {
        const logs = mute();
        vi.spyOn(console, 'info').mockImplementation(() => {});
        const cwd = fixture();
        // fast-glob rejects a non-string pattern shape at scan time.
        await migrate({ cwd, pattern: 123 as never });
        expect(logs.join('\n')).toContain('Could not scan files');
    });
});

describe('dynamic-pattern rejection soup', () => {
    it('keeps every unmigratable clsx/logical/ternary shape as-is', async () => {
        mute();
        vi.spyOn(console, 'info').mockImplementation(() => {});
        const cwd = fixture();
        writeFileSync(
            join(cwd, 'src/Soup.tsx'),
            [
                "import clsx from 'clsx';",
                'export const S = ({ a, b }) => (<div>',
                '  <i className={clsx("p-4 total-mystery")}>u1</i>',
                '  <b className={clsx(a && fn1())}>u2</b>',
                '  <u className={clsx(a ? fn2() : fn3())}>u3</u>',
                '  <s className={a || "p-4"}>u4</s>',
                '  <em className={a ? "" : ""}>u5</em>',
                '  <q className={a ? "mystery-a" : "p-4"}>u6</q>',
                '  <area className={a && 4} />',
                '  <p className={(a || b) ? "p-4" : "m-2"}>u7</p>',
                '</div>);',
            ].join('\n'),
        );
        await migrate({ cwd });
        const out = readFileSync(join(cwd, 'src/Soup.tsx'), 'utf8');
        expect(out).toContain('fn1()');
        expect(out).toContain('fn2()');
        expect(out).toContain('u7');
    });
});
