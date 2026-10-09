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
import { afterEach, describe, expect, it, vi } from 'vitest';

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

    it('prints them once a burst is over, on a timer that does not hold the process', () => {
        vi.useFakeTimers();
        try {
            const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
            const flush = createCapFlush(overflowing(), 50);
            flush.schedule();
            flush.schedule();
            expect(warn).not.toHaveBeenCalled();
            vi.advanceTimersByTime(50);
            expect(warn.mock.calls).toEqual([[capOverflowMessage('a', 1)]]);
        } finally {
            vi.useRealTimers();
        }
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
