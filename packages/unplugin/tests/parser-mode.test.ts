import { describe, expect, it, vi } from 'vitest';

import {
    isParserMode,
    type ParserMode,
    type ResolveParserModeInput,
    resolveParserMode,
} from '../src/parser-mode.js';

/**
 * Build a resolveParserMode input with sensible defaults + a counting probe, so a
 * test only states the axis it cares about and can assert how often the native
 * probe ran (laziness / no-flaky-reprobe).
 *
 * @param overrides - per-test axis overrides; `rustAvailable` is shorthand for a
 *   counting probe that returns that value.
 * @returns the assembled input and the probe spy (to assert call count).
 */
function setup(overrides: Partial<ResolveParserModeInput> & { rustAvailable?: boolean } = {}): {
    input: ResolveParserModeInput;
    probe: ReturnType<typeof vi.fn>;
} {
    const { rustAvailable = true, isRustAvailable, ...rest } = overrides;
    const probe = vi.fn(() => rustAvailable);
    const input: ResolveParserModeInput = {
        configParser: undefined,
        envParser: undefined,
        defaultParser: 'rust',
        isRustAvailable: isRustAvailable ?? probe,
        // Default the wasm probe to "missing" so the pre-wasm degrade tests
        // keep exercising the oxc last-resort arm unchanged.
        isWasmAvailable: () => false,
        ...rest,
    };
    return { input, probe };
}

describe('isParserMode', () => {
    it.each(['rust', 'wasm'] as const)('accepts the valid mode %s', mode => {
        expect(isParserMode(mode)).toBe(true);
    });

    it.each([undefined, null, '', 'foo', 'RUST', 'Oxc', 0, false, {}, ['rust']])(
        'rejects the invalid value %p',
        value => {
            expect(isParserMode(value)).toBe(false);
        },
    );
});

describe('resolveParserMode — default-rust graceful degradation', () => {
    it('keeps default rust when the native binary IS available', () => {
        const { input, probe } = setup({ rustAvailable: true });
        expect(resolveParserMode(input)).toEqual({
            parser: 'rust',
            degraded: false,
            explicit: false,
        });
        expect(probe).toHaveBeenCalledTimes(1);
    });

    it('degrades default rust → wasm when the native binary is NOT available', () => {
        const { input, probe } = setup({ rustAvailable: false });
        input.isWasmAvailable = () => true;
        expect(resolveParserMode(input)).toEqual({
            parser: 'wasm',
            degraded: true,
            explicit: false,
        });
        expect(probe).toHaveBeenCalledTimes(1);
    });
});

describe('resolveParserMode — explicit rust keeps its loud-failure contract', () => {
    it('config rust is NEVER degraded, even when unavailable (probe not consulted)', () => {
        const { input, probe } = setup({ configParser: 'rust', rustAvailable: false });
        expect(resolveParserMode(input)).toEqual({
            parser: 'rust',
            degraded: false,
            explicit: true,
        });
        // The probe must NOT run — explicit rust must reach the loud-fail path,
        // not be silently swapped for oxc.
        expect(probe).not.toHaveBeenCalled();
    });

    it('config rust stays rust when available too', () => {
        const { input } = setup({ configParser: 'rust', rustAvailable: true });
        expect(resolveParserMode(input)).toMatchObject({ parser: 'rust', degraded: false });
    });

    it.each([true, false])(
        'env CSSZYX_PARSER=rust is explicit and never degrades (available=%s)',
        available => {
            const { input, probe } = setup({ envParser: 'rust', rustAvailable: available });
            expect(resolveParserMode(input)).toEqual({
                parser: 'rust',
                degraded: false,
                explicit: true,
            });
            expect(probe).not.toHaveBeenCalled();
        },
    );
});

describe('resolveParserMode — non-rust parsers never probe', () => {
    it.each(['wasm'] as const)('config %s resolves without consulting the native probe', mode => {
        const { input, probe } = setup({ configParser: mode, rustAvailable: false });
        expect(resolveParserMode(input)).toEqual({
            parser: mode,
            degraded: false,
            explicit: true,
        });
        expect(probe).not.toHaveBeenCalled();
    });

    it.each(['wasm'] as const)('env %s resolves without probing', mode => {
        const { input, probe } = setup({ envParser: mode, rustAvailable: false });
        expect(resolveParserMode(input)).toMatchObject({ parser: mode, explicit: true });
        expect(probe).not.toHaveBeenCalled();
    });
});

describe('resolveParserMode — precedence (env > config > default)', () => {
    it('env wasm overrides config rust', () => {
        const { input } = setup({ envParser: 'wasm', configParser: 'rust' });
        expect(resolveParserMode(input)).toMatchObject({ parser: 'wasm', explicit: true });
    });

    it('env rust overrides config wasm (and is explicit → no degrade even if unavailable)', () => {
        const { input, probe } = setup({
            envParser: 'rust',
            configParser: 'wasm',
            rustAvailable: false,
        });
        expect(resolveParserMode(input)).toEqual({
            parser: 'rust',
            degraded: false,
            explicit: true,
        });
        expect(probe).not.toHaveBeenCalled();
    });

    it('config wins over default when env is absent', () => {
        const { input } = setup({ configParser: 'wasm', defaultParser: 'rust' });
        expect(resolveParserMode(input)).toMatchObject({ parser: 'wasm' });
    });
});

describe('resolveParserMode — invalid / empty env is ignored (falls through)', () => {
    it.each(['foo', '', 'RUST', 'oxc ', ' rust', 'native'])(
        'invalid env %p falls back to config rust (explicit) — no degrade',
        bad => {
            const { input, probe } = setup({
                envParser: bad,
                configParser: 'rust',
                rustAvailable: false,
            });
            expect(resolveParserMode(input)).toEqual({
                parser: 'rust',
                degraded: false,
                explicit: true,
            });
            expect(probe).not.toHaveBeenCalled();
        },
    );

    it.each(['foo', '', 'RUST'])(
        'invalid env %p with no config → default rust, which DOES degrade when unavailable',
        bad => {
            const { input, probe } = setup({ envParser: bad, rustAvailable: false });
            expect(resolveParserMode(input)).toEqual({
                parser: 'rust',
                degraded: false,
                explicit: false,
            });
            expect(probe).toHaveBeenCalledTimes(1);
        },
    );

    it('empty-string env + default rust + available → rust (no degrade)', () => {
        const { input } = setup({ envParser: '', rustAvailable: true });
        expect(resolveParserMode(input)).toMatchObject({ parser: 'rust', degraded: false });
    });
});

describe('resolveParserMode — non-rust defaults', () => {
    it.each(['wasm'] as const)(
        'a %s default with no overrides resolves to itself and never probes',
        def => {
            const { input, probe } = setup({ defaultParser: def, rustAvailable: false });
            expect(resolveParserMode(input)).toEqual({
                parser: def,
                degraded: false,
                explicit: false,
            });
            expect(probe).not.toHaveBeenCalled();
        },
    );
});

describe('resolveParserMode — robustness / no hidden side effects', () => {
    it('does not mutate the input object', () => {
        const { input } = setup({ rustAvailable: false });
        const snapshot = { ...input };
        resolveParserMode(input);
        expect(input).toEqual(snapshot);
    });

    it('probes at most once per call (no double-probe flakiness)', () => {
        const { input, probe } = setup({ rustAvailable: false });
        resolveParserMode(input);
        expect(probe).toHaveBeenCalledTimes(1);
    });

    it('is deterministic — identical inputs yield identical results across repeats', () => {
        const make = () => setup({ configParser: undefined, rustAvailable: false }).input;
        const a = resolveParserMode(make());
        const b = resolveParserMode(make());
        expect(a).toEqual(b);
    });

    it('a probe that THROWS is not swallowed here (only the memoized compiler probe guards)', () => {
        // resolveParserMode trusts its injected probe; the non-throwing contract
        // lives in isRustTransformAvailable. Document that a throwing probe surfaces
        // so a future refactor cannot silently treat "threw" as "available".
        const throwing: ResolveParserModeInput = {
            configParser: undefined,
            envParser: undefined,
            defaultParser: 'rust',
            isRustAvailable: () => {
                throw new Error('addon load blew up');
            },
        };
        expect(() => resolveParserMode(throwing)).toThrow('addon load blew up');
    });

    it('matrix smoke — every (env, config, available) combo returns a valid ParserMode', () => {
        const envs = [undefined, '', 'foo', 'rust', 'wasm', 'wasm', 'auto'];
        const configs: Array<ParserMode | undefined> = [undefined, 'rust', 'wasm', 'auto'];
        for (const envParser of envs) {
            for (const configParser of configs) {
                for (const rustAvailable of [true, false]) {
                    const { input } = setup({ envParser, configParser, rustAvailable });
                    const out = resolveParserMode(input);
                    expect(isParserMode(out.parser)).toBe(true);
                    // degraded implies the resolved parser is oxc and it was not explicit
                    if (out.degraded) {
                        expect(out.parser).toBe('wasm');
                        expect(out.explicit).toBe(false);
                    }
                }
            }
        }
    });
});

describe('resolveParserMode — wasm degrade target', () => {
    /**
     * Assemble an input whose wasm probe is countable, on top of {@link setup}.
     *
     * @param rustAvailable - what the native probe reports.
     * @param wasmAvailable - what the wasm probe reports.
     * @returns input plus both probe spies.
     */
    function wasmSetup(rustAvailable: boolean, wasmAvailable: boolean) {
        const wasmProbe = vi.fn(() => wasmAvailable);
        const { input, probe } = setup({ rustAvailable });
        return { input: { ...input, isWasmAvailable: wasmProbe }, probe, wasmProbe };
    }

    it("accepts 'wasm' as a parser mode", () => {
        expect(isParserMode('wasm')).toBe(true);
    });

    it('degrades default rust to wasm — the same engine — when the binary is missing', () => {
        const { input, wasmProbe } = wasmSetup(false, true);
        expect(resolveParserMode(input)).toEqual({
            parser: 'wasm',
            degraded: true,
            explicit: false,
        });
        expect(wasmProbe).toHaveBeenCalledTimes(1);
    });

    it('stays on rust — fail loud downstream — when the wasm artifact is ALSO missing', () => {
        const { input } = wasmSetup(false, false);
        expect(resolveParserMode(input)).toEqual({
            parser: 'rust',
            degraded: false,
            explicit: false,
        });
    });

    it('never probes wasm when the native binary is available', () => {
        const { input, wasmProbe } = wasmSetup(true, true);
        expect(resolveParserMode(input).parser).toBe('rust');
        expect(wasmProbe).not.toHaveBeenCalled();
    });

    it("keeps an explicit 'wasm' choice without probing rust", () => {
        const { input, probe, wasmProbe } = wasmSetup(true, true);
        const result = resolveParserMode({ ...input, configParser: 'wasm' });
        expect(result).toEqual({ parser: 'wasm', degraded: false, explicit: true });
        expect(probe).not.toHaveBeenCalled();
        expect(wasmProbe).not.toHaveBeenCalled();
    });
});

describe('resolveParserMode — rust-only world (oxc/babel removed)', () => {
    it.each(['oxc', 'babel'] as const)('rejects the removed mode %s', mode => {
        expect(isParserMode(mode)).toBe(false);
    });

    it('stays on rust — fail loud — when the wasm artifact is missing too', () => {
        // With no JavaScript parser left there is nothing to degrade to: the
        // native error names the missing platform package, which is more
        // actionable than silently running a lane that cannot load either.
        const { input } = setup({ rustAvailable: false });
        expect(resolveParserMode({ ...input, isWasmAvailable: () => false })).toEqual({
            parser: 'rust',
            degraded: false,
            explicit: false,
        });
    });
});
