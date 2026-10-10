/**
 * Every bundler lane prints an engine diagnostic at the level the project's
 * `csszyx.config` gives it.
 *
 * The router used to sort diagnostics by their wording — a spread by
 * `'unresolvable sz spread'`, a budget skip by `'AST budget exceeded'`, an
 * advisory by the compiler's wording table — so a level set in the config had
 * nowhere to apply, and a reworded message moved between channels without a
 * test noticing. These pin that the engine's code decides, that a level from
 * the policy decides the channel, and that the lines a long log would repeat
 * are deduplicated and capped.
 */
import { spawnSync } from 'node:child_process';
import { fileURLToPath, pathToFileURL } from 'node:url';

import { afterEach, describe, expect, it, vi } from 'vitest';

import {
    deadClassMessage,
    findDeadSzClasses,
    reportDeadSzClasses,
    szClassSites,
} from '../src/dead-class.js';
import {
    capOverflowMessage,
    createCapFlush,
    createDiagnosticLimiter,
    DIAGNOSTIC_LINE_CAP,
} from '../src/diagnostic-limiter.js';
import { createDiagnosticPolicy } from '../src/diagnostic-policy.js';
import {
    channelOfLevel,
    routeTransformDiagnostics,
    type TransformDiagnosticsInput,
} from '../src/transform-diagnostics.js';

afterEach(() => {
    vi.restoreAllMocks();
});

const UNKNOWN_KEY =
    '[csszyx] Unknown property "workBreak" in sz prop at src/A.tsx:3. The class is still emitted, so it styles nothing unless Tailwind serves that utility.';
const PRECEDENCE =
    '[csszyx] "sz" takes precedence over the runtime "className" on this element at src/A.tsx:4, whatever order the attributes are written.';
const SPREAD = '[csszyx] unresolvable sz spread at 5:9: sz={{ ...x }} cannot be resolved.';

/**
 * Route one module's diagnostics with the defaults a dev build has.
 *
 * @param input - What differs from a development run of `src/A.tsx`.
 * @returns The routed lines.
 */
function route(input: Partial<TransformDiagnosticsInput>) {
    return routeTransformDiagnostics({
        diagnostics: [],
        id: '/p/src/A.tsx',
        file: 'src/A.tsx',
        quiet: 'off',
        holdInfo: false,
        ...input,
    });
}

describe('the engine code decides the channel, not the wording', () => {
    it('lists a diagnostic whose code is unknown-key even when its text reads like a spread', () => {
        const message = '[csszyx] unresolvable sz spread lookalike written by a key note';
        const routed = route({
            diagnostics: [message],
            issues: [{ code: 'unknown-key', line: 3, column: 7 }],
        });
        expect(routed.spread).toEqual([]);
        expect(routed.immediate).toEqual([`[csszyx] /p/src/A.tsx:3:7\n  ${message}`]);
    });

    it('sends the unresolvable-spread code to the spread channel whatever it says', () => {
        const routed = route({
            diagnostics: ['[csszyx] reworded spread note'],
            issues: [{ code: 'unresolvable-spread', line: 5, column: 9 }],
        });
        expect(routed.spread).toEqual(['/p/src/A.tsx:5:9\n  [csszyx] reworded spread note']);
        expect(routed.immediate).toEqual([]);
    });

    it('treats a budget skip as an error by its code', () => {
        const routed = route({
            diagnostics: ['[csszyx] reworded budget note'],
            issues: [{ code: 'ast-budget', line: 1, column: 1 }],
            holdInfo: true,
        });
        expect(routed.immediate).toHaveLength(1);
    });

    it('holds an info-level code in production and counts it', () => {
        const routed = route({
            diagnostics: [PRECEDENCE],
            issues: [{ code: 'class-precedence', line: 4, column: 2 }],
            holdInfo: true,
        });
        expect(routed.advisories).toEqual([]);
        expect(routed.immediate).toEqual([]);
        expect(routed.heldAdvisories).toBe(1);
    });

    it('lists an info-level code on a dev build, on the advisory channel', () => {
        const routed = route({
            diagnostics: [PRECEDENCE],
            issues: [{ code: 'class-precedence', line: 4, column: 2 }],
        });
        expect(routed.advisories).toEqual([`[csszyx] /p/src/A.tsx:4:2\n  ${PRECEDENCE}`]);
    });

    it('reads the wording only for a line that carries no code', () => {
        const routed = route({ diagnostics: [UNKNOWN_KEY], holdInfo: true });
        expect(routed.immediate).toEqual([
            `[csszyx] /p/src/A.tsx\n  ${UNKNOWN_KEY}\n  Did you mean "break"?`,
        ]);
    });
});

describe('the level the config sets', () => {
    it('drops a finding set to off', () => {
        const routed = route({
            diagnostics: [UNKNOWN_KEY],
            issues: [{ code: 'unknown-key', line: 3, column: 7 }],
            policy: createDiagnosticPolicy({ rules: { 'unknown-key': 'off' } }),
        });
        expect(routed).toEqual({ spread: [], immediate: [], advisories: [], heldAdvisories: 0 });
    });

    it('lists an info finding raised to warn, in production too', () => {
        const routed = route({
            diagnostics: [PRECEDENCE],
            issues: [{ code: 'class-precedence', line: 4, column: 2 }],
            holdInfo: true,
            policy: createDiagnosticPolicy({ preset: 'atomic' }),
        });
        expect(routed.immediate).toEqual([`[csszyx] /p/src/A.tsx:4:2\n  ${PRECEDENCE}`]);
        expect(routed.heldAdvisories).toBe(0);
    });

    it('applies an override to the files it names only', () => {
        const policy = createDiagnosticPolicy({
            overrides: [{ files: 'src/legacy/**', rules: { 'sz-diagnostic': 'off' } }],
        });
        const issues = [{ code: 'unknown-key' as const, line: 3, column: 7 }];
        expect(
            route({ diagnostics: [UNKNOWN_KEY], issues, policy, file: 'src/legacy/A.tsx' })
                .immediate,
        ).toEqual([]);
        expect(route({ diagnostics: [UNKNOWN_KEY], issues, policy }).immediate).toHaveLength(1);
    });

    it('drops everything under quiet: true', () => {
        const routed = route({
            diagnostics: [UNKNOWN_KEY, SPREAD, PRECEDENCE],
            issues: [
                { code: 'unknown-key', line: 3, column: 7 },
                { code: 'unresolvable-spread', line: 5, column: 9 },
                { code: 'class-precedence', line: 4, column: 2 },
            ],
            quiet: 'all',
            holdInfo: true,
        });
        expect(routed).toEqual({ spread: [], immediate: [], advisories: [], heldAdvisories: 0 });
    });

    it('keeps missing output and holds a nudge under quiet: nudges', () => {
        const routed = route({
            diagnostics: ['[csszyx] szr fallback note', '[csszyx] sz fallback note'],
            issues: [
                { code: 'fallback-missing-css', line: 1, column: 1 },
                { code: 'fallback-nudge', line: 2, column: 1 },
            ],
            quiet: 'nudges',
            holdInfo: true,
        });
        expect(routed.immediate).toEqual([
            '[csszyx] /p/src/A.tsx:1:1\n  [csszyx] szr fallback note',
        ]);
        expect(routed.heldAdvisories).toBe(1);
    });

    it('maps each level to its channel', () => {
        expect(channelOfLevel('off', 'off', false)).toBe('drop');
        expect(channelOfLevel('info', 'off', false)).toBe('list');
        expect(channelOfLevel('info', 'off', true)).toBe('held');
        expect(channelOfLevel('warn', 'off', true)).toBe('list');
        expect(channelOfLevel('error', 'nudges', true)).toBe('list');
        expect(channelOfLevel('error', 'all', false)).toBe('drop');
    });
});

describe('dedupe and the cap', () => {
    it('lists one site once per process while the file is unchanged', () => {
        const limiter = createDiagnosticLimiter();
        const input = {
            diagnostics: [UNKNOWN_KEY],
            issues: [{ code: 'unknown-key' as const, line: 3, column: 7 }],
            limiter,
        };
        limiter.version('src/A.tsx', 'one');
        expect(route(input).immediate).toHaveLength(1);
        limiter.version('src/A.tsx', 'one');
        expect(route(input).immediate).toEqual([]);
        // An edit is a new version of the file: its findings print again.
        limiter.version('src/A.tsx', 'two');
        expect(route(input).immediate).toHaveLength(1);
    });

    it('lists ten lines per id, then says how many more and where to see them', () => {
        const limiter = createDiagnosticLimiter();
        const diagnostics = Array.from(
            { length: DIAGNOSTIC_LINE_CAP + 3 },
            (_, index) => `${UNKNOWN_KEY} #${index}`,
        );
        const issues = diagnostics.map((_, index) => ({
            code: 'unknown-key' as const,
            line: index + 1,
            column: 1,
        }));
        expect(route({ diagnostics, issues, limiter }).immediate).toHaveLength(DIAGNOSTIC_LINE_CAP);
        expect(limiter.pending).toBe(true);
        expect(limiter.flush()).toEqual([capOverflowMessage('unknown-key', 3)]);
        expect(capOverflowMessage('unknown-key', 3)).toBe(
            '[csszyx] +3 more unknown-key — help: `csszyx check --rule unknown-key` lists every one.',
        );
        // The cap is per start or build: a flush opens the next one.
        expect(limiter.pending).toBe(false);
        expect(limiter.flush()).toEqual([]);
        const later = route({
            diagnostics: ['[csszyx] another'],
            issues: [{ code: 'unknown-key', line: 99, column: 1 }],
            limiter,
        });
        expect(later.immediate).toHaveLength(1);
    });

    it('caps each id on its own', () => {
        const limiter = createDiagnosticLimiter(1);
        expect(limiter.admit({ id: 'a', file: 'f', key: '1' })).toBe(true);
        expect(limiter.admit({ id: 'b', file: 'f', key: '1' })).toBe(true);
        expect(limiter.admit({ id: 'a', file: 'f', key: '2' })).toBe(false);
        expect(limiter.flush()).toEqual([capOverflowMessage('a', 1)]);
    });

    it('tells two findings on one line apart by their column', () => {
        const limiter = createDiagnosticLimiter();
        const routed = route({
            diagnostics: [UNKNOWN_KEY, UNKNOWN_KEY],
            issues: [
                { code: 'unknown-key', line: 3, column: 7 },
                { code: 'unknown-key', line: 3, column: 30 },
            ],
            limiter,
        });
        expect(routed.immediate).toHaveLength(2);
    });

    it('counts a held finding once however often it is reported', () => {
        // A module compiled for two layers, or a table settled twice, reports
        // the same held finding again; the closing line counts findings.
        const limiter = createDiagnosticLimiter(0);
        limiter.admit({ id: 'a', file: 'f', key: '1' });
        limiter.admit({ id: 'a', file: 'f', key: '1' });
        limiter.admit({ id: 'a', file: 'g', key: '1' });
        expect(limiter.flush()).toEqual([capOverflowMessage('a', 2)]);
    });

    it('forgets what the cap held for a file once the file changes', () => {
        // Within one burst `c` is edited: its two held findings are fixed and
        // one new one appears, so one more is held, not three.
        const limiter = createDiagnosticLimiter(2);
        for (const [file, line] of [
            ['a', 1],
            ['b', 1],
            ['c', 1],
            ['c', 2],
        ] as const) {
            limiter.version(file, 'v1');
            limiter.admit({ id: 'x', file, line, key: 'k' });
        }
        limiter.version('c', 'v2');
        expect(limiter.admit({ id: 'x', file: 'c', line: 3, key: 'k' })).toBe(false);
        expect(limiter.flush()).toEqual([capOverflowMessage('x', 1)]);
    });

    it('has nothing pending once the only held finding is gone with its file version', () => {
        const limiter = createDiagnosticLimiter(0);
        limiter.version('c', 'v1');
        limiter.admit({ id: 'x', file: 'c', line: 1, key: 'k' });
        limiter.version('c', 'v2');
        expect(limiter.pending).toBe(false);
        expect(limiter.flush()).toEqual([]);
    });

    it('forgets a held dead class that is no longer reported', () => {
        const limiter = createDiagnosticLimiter(0);
        limiter.admit({ id: 'dead-class', file: 'f', key: 'one' });
        limiter.admit({ id: 'dead-class', file: 'f', key: 'two' });
        limiter.admit({ id: 'other', file: 'f', key: 'one' });
        limiter.retain('dead-class', [{ id: 'dead-class', file: 'f', key: 'two' }]);
        expect(limiter.flush()).toEqual([
            capOverflowMessage('dead-class', 1),
            capOverflowMessage('other', 1),
        ]);
    });

    it('lists a capped finding again once the cap opens, since it was never shown', () => {
        const limiter = createDiagnosticLimiter(1);
        limiter.admit({ id: 'a', file: 'f', key: '1' });
        expect(limiter.admit({ id: 'a', file: 'f', key: '2' })).toBe(false);
        limiter.flush();
        expect(limiter.admit({ id: 'a', file: 'f', key: '2' })).toBe(true);
    });
});

describe('when the capped counts print', () => {
    /**
     * A limiter that has held one finding of `a` back.
     *
     * @returns The limiter.
     */
    function overflowing() {
        const limiter = createDiagnosticLimiter(0);
        limiter.admit({ id: 'a', file: 'f', key: '1' });
        return limiter;
    }

    it('prints them once a burst has paused, not while it goes on', () => {
        vi.useFakeTimers();
        try {
            const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
            const limiter = createDiagnosticLimiter(0);
            const flush = createCapFlush(limiter, 50);
            limiter.admit({ id: 'a', file: 'f', key: '1' });
            flush.schedule();
            vi.advanceTimersByTime(40);
            // Still the same burst: the count waits for it to pause.
            limiter.admit({ id: 'a', file: 'f', key: '2' });
            flush.schedule();
            vi.advanceTimersByTime(40);
            expect(warn).not.toHaveBeenCalled();
            vi.advanceTimersByTime(10);
            expect(warn.mock.calls).toEqual([[capOverflowMessage('a', 2)]]);
        } finally {
            vi.useRealTimers();
        }
    });

    it('opens a new cap once a dev burst is over, even when nothing was held', () => {
        // An hour into a dev session, the eleventh new finding of an id is
        // listed with its location, not folded into a bare count.
        vi.useFakeTimers();
        try {
            const limiter = createDiagnosticLimiter(1);
            const flush = createCapFlush(limiter, 50);
            expect(limiter.admit({ id: 'a', file: 'f', key: '1' })).toBe(true);
            flush.schedule();
            vi.advanceTimersByTime(50);
            expect(limiter.admit({ id: 'a', file: 'g', key: '1' })).toBe(true);
        } finally {
            vi.useRealTimers();
        }
    });

    it('hands every waiting flush to one exit listener, which prints and clears them', async () => {
        vi.resetModules();
        const fresh = await import('../src/diagnostic-limiter.js');
        const once = vi.spyOn(process, 'once').mockImplementation(() => process);
        const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
        const first = fresh.createDiagnosticLimiter(0);
        const second = fresh.createDiagnosticLimiter(0);
        first.admit({ id: 'a', file: 'f', key: '1' });
        second.admit({ id: 'b', file: 'f', key: '1' });
        const flushes = [
            fresh.createCapFlush(first, 600_000),
            fresh.createCapFlush(second, 600_000),
        ];
        for (const flush of flushes) flush.schedule();
        expect(once.mock.calls.map(([event]) => event)).toEqual(['exit']);
        const atExit = once.mock.calls[0]?.[1] as () => void;
        atExit();
        expect(warn.mock.calls).toEqual([
            [fresh.capOverflowMessage('a', 1)],
            [fresh.capOverflowMessage('b', 1)],
        ]);
        // Printed once: the timers were dropped with them.
        atExit();
        expect(warn).toHaveBeenCalledTimes(2);
    });

    it('prints them when the process ends before the timer, which never holds it open', () => {
        // jest workers and Next loader processes end on their own schedule; a
        // count left on an unreferenced timer would never be printed.
        const limiterModule = pathToFileURL(
            fileURLToPath(new URL('../src/diagnostic-limiter.ts', import.meta.url)),
        ).href;
        const script = [
            `import { createCapFlush, createDiagnosticLimiter } from ${JSON.stringify(limiterModule)};`,
            'const limiter = createDiagnosticLimiter(0);',
            "limiter.admit({ id: 'a', file: 'f', key: '1' });",
            'createCapFlush(limiter, 600000).schedule();',
        ].join('\n');
        // Node strips types by default from 22.18; the root `engines` floor
        // (22.13) needs the flag, which a later Node still accepts.
        const stripTypes = process.features.typescript ? [] : ['--experimental-strip-types'];
        const child = spawnSync(
            process.execPath,
            [...stripTypes, '--input-type=module', '-e', script],
            {
                encoding: 'utf8',
                timeout: 30_000,
            },
        );
        // A ten-minute timer that held the process would hit the timeout.
        expect(child.status).toBe(0);
        expect(child.stderr).toContain(capOverflowMessage('a', 1));
    });

    it('prints them at once at a build end, and drops the pending timer', () => {
        vi.useFakeTimers();
        try {
            const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
            const flush = createCapFlush(overflowing(), 50);
            flush.schedule();
            flush.now();
            vi.advanceTimersByTime(50);
            expect(warn.mock.calls).toEqual([[capOverflowMessage('a', 1)]]);
        } finally {
            vi.useRealTimers();
        }
    });

    it('schedules nothing when nothing was held back', () => {
        vi.useFakeTimers();
        try {
            const flush = createCapFlush(createDiagnosticLimiter(), 50);
            flush.schedule();
            expect(vi.getTimerCount()).toBe(0);
        } finally {
            vi.useRealTimers();
        }
    });
});

describe('the dead-class report', () => {
    const findings = [{ className: 'break-bogus', file: 'src/A.tsx' }];

    it('counts an info-level dead class on a production build instead of listing it', () => {
        const report = reportDeadSzClasses(findings, {
            policy: createDiagnosticPolicy({ rules: { 'dead-class': 'info' } }),
            quiet: 'off',
            holdInfo: true,
            limiter: createDiagnosticLimiter(),
        });
        expect(report).toEqual({ lines: [], held: 1 });
    });

    it('lists one class once per process', () => {
        const input = {
            policy: createDiagnosticPolicy(),
            quiet: 'off' as const,
            holdInfo: true,
            limiter: createDiagnosticLimiter(),
        };
        expect(reportDeadSzClasses(findings, input).lines).toHaveLength(1);
        expect(reportDeadSzClasses(findings, input).lines).toEqual([]);
    });

    it('lists a class again once a build stopped emitting it and a later one brought it back', () => {
        // `vite build --watch`: remove the class, then undo the edit.
        const input = {
            policy: createDiagnosticPolicy(),
            quiet: 'off' as const,
            holdInfo: true,
            limiter: createDiagnosticLimiter(),
        };
        expect(reportDeadSzClasses(findings, input).lines).toHaveLength(1);
        expect(reportDeadSzClasses([], input).lines).toEqual([]);
        expect(reportDeadSzClasses(findings, input).lines).toHaveLength(1);
    });

    it('names the first file whose level reports the class', () => {
        const report = reportDeadSzClasses(
            [
                {
                    className: 'break-bogus',
                    file: 'src/legacy/A.tsx',
                    others: [{ file: 'src/B.tsx', line: 2, column: 5, key: 'break' }],
                },
            ],
            {
                policy: createDiagnosticPolicy({
                    overrides: [{ files: ['src/legacy/**'], rules: { 'dead-class': 'off' } }],
                }),
                quiet: 'off',
                holdInfo: true,
                limiter: createDiagnosticLimiter(),
            },
        );
        expect(report.lines).toEqual([
            deadClassMessage('break-bogus', 'src/B.tsx', { line: 2, column: 5, key: 'break' }),
        ]);
    });

    it('names a later file an override raises when the first file holds the class at info', () => {
        // Path order put the held `info` site first; the `error` site an
        // override set must still be listed, and the class is not also counted.
        const report = reportDeadSzClasses(
            [
                {
                    className: 'break-bogus',
                    file: 'src/a.tsx',
                    others: [{ file: 'src/new/b.tsx', line: 2, column: 5, key: 'break' }],
                },
            ],
            {
                policy: createDiagnosticPolicy({
                    rules: { 'dead-class': 'info' },
                    overrides: [{ files: ['src/new/**'], rules: { 'dead-class': 'error' } }],
                }),
                quiet: 'off',
                holdInfo: true,
                limiter: createDiagnosticLimiter(),
            },
        );
        expect(report).toEqual({
            lines: [
                deadClassMessage('break-bogus', 'src/new/b.tsx', {
                    line: 2,
                    column: 5,
                    key: 'break',
                }),
            ],
            held: 0,
        });
    });

    it('counts a class once when every file that emits it holds it at info', () => {
        const report = reportDeadSzClasses(
            [{ className: 'break-bogus', file: 'src/a.tsx', others: [{ file: 'src/b.tsx' }] }],
            {
                policy: createDiagnosticPolicy({ rules: { 'dead-class': 'info' } }),
                quiet: 'off',
                holdInfo: true,
                limiter: createDiagnosticLimiter(),
            },
        );
        expect(report).toEqual({ lines: [], held: 1 });
    });

    it('says nothing for a class every emitting file turns off', () => {
        const report = reportDeadSzClasses(
            [{ className: 'break-bogus', file: 'src/legacy/A.tsx' }],
            {
                policy: createDiagnosticPolicy({
                    overrides: [{ files: ['src/legacy/**'], rules: { 'dead-class': 'off' } }],
                }),
                quiet: 'off',
                holdInfo: true,
                limiter: createDiagnosticLimiter(),
            },
        );
        expect(report).toEqual({ lines: [], held: 0 });
    });

    it('names the line and the key the engine placed the class at', () => {
        expect(
            deadClassMessage('break-bogus', 'src/A.tsx', { line: 3, column: 9, key: 'break' }),
        ).toBe(
            "[csszyx] src/A.tsx:3:9: `break-bogus` (sz key `break`) is emitted by an sz prop and produces no CSS under this project's Tailwind (dead-class).\n" +
                "  help: fix the sz key or value, or define the class with Tailwind's @utility; `csszyx check --rule dead-class` lists every one.",
        );
    });
});

describe('asking the design system about emitted classes', () => {
    it('asks it about each class once per style model', () => {
        const unserved = vi.fn((classes: readonly string[]) =>
            classes.filter(name => name.startsWith('bogus')),
        );
        const model = { facts: {} as never, unserved };
        const first = findDeadSzClasses(
            model,
            new Map([
                ['p-4', 'src/A.tsx'],
                ['bogus-1', 'src/A.tsx'],
            ]),
        );
        // An HMR of one file: one new class, the rest already answered.
        const second = findDeadSzClasses(
            model,
            new Map([
                ['p-4', 'src/A.tsx'],
                ['bogus-1', 'src/A.tsx'],
                ['bogus-2', 'src/B.tsx'],
            ]),
        );
        expect(first.map(finding => finding.className)).toEqual(['bogus-1']);
        expect(second.map(finding => finding.className)).toEqual(['bogus-1', 'bogus-2']);
        expect(unserved.mock.calls).toEqual([[['bogus-1', 'p-4']], [['bogus-2']]]);
        // A new model is a new design system: every class is asked again.
        findDeadSzClasses({ facts: {} as never, unserved }, new Map([['p-4', 'src/A.tsx']]));
        expect(unserved.mock.calls.at(-1)).toEqual([['p-4']]);
    });

    it('carries every file that emits a class, with the site of each', () => {
        const model = {
            facts: {} as never,
            unserved: (classes: readonly string[]) => [...classes],
        };
        expect(
            findDeadSzClasses(
                model,
                new Map([
                    [
                        'break-bogus',
                        [
                            { file: 'src/A.tsx', line: 1, column: 3, key: 'break' },
                            { file: 'src/B.tsx' },
                        ],
                    ],
                ]),
            ),
        ).toEqual([
            {
                className: 'break-bogus',
                file: 'src/A.tsx',
                line: 1,
                column: 3,
                key: 'break',
                others: [{ file: 'src/B.tsx' }],
            },
        ]);
    });
});

describe('where a file emits each class', () => {
    it('places a class at the key of the first object that emits it', () => {
        const group = (keys: string[], classes: string[], line: number) => ({
            keys,
            classes,
            positions: keys.map((_, index) => ({ line, column: index + 1 })),
        });
        const sites = szClassSites(
            'src/A.tsx',
            ['break-bogus', 'p-4', 'only-one'],
            [
                group(['break', 'p'], ['break-bogus', 'p-4'], 2),
                group(['break'], ['break-bogus'], 9),
            ],
        );
        expect([...sites]).toEqual([
            ['break-bogus', { file: 'src/A.tsx', line: 2, column: 1, key: 'break' }],
            ['p-4', { file: 'src/A.tsx', line: 2, column: 2, key: 'p' }],
            ['only-one', { file: 'src/A.tsx' }],
        ]);
    });

    it('names the file alone for a result an older cache entry wrote without groups', () => {
        expect([...szClassSites('src/A.tsx', ['p-4'], undefined)]).toEqual([
            ['p-4', { file: 'src/A.tsx' }],
        ]);
    });
});
