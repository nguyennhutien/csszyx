/**
 * The runtime mangle registry — the ONE place runtime helpers read the
 * production class map from.
 *
 * Until now the map reached `lowerSz`/`szcn` only through `window.__csszyx`,
 * a debug object an inline HTML script installed. That coupled correctness
 * to an executable inline script (refused by strict CSP, field-reported) and
 * to a debug surface. The registry is installed from inside the bundle and
 * exposes the debug global only when asked.
 */
import { afterEach, describe, expect, it } from 'vitest';
import { _szMerge, szcn, szr } from '../src/index.js';
import {
    clearMangleRegistry,
    getMangleRegistry,
    installMangleRuntime,
} from '../src/mangle-registry.js';

type DebugWindow = Window & { __csszyx?: unknown };

const MAP = { 'p-4': 'z', 'mx-0': 'y', 'mx-4': 'x' };
const VAR_MAP = { '--_sz-a': ['v1', 'v2'], '--_sz-b': 'v3', '--brand': '---gz' };

afterEach(() => {
    clearMangleRegistry();
    delete (window as DebugWindow).__csszyx;
    delete (globalThis as { __csszyx_ssr_mangle_map?: unknown }).__csszyx_ssr_mangle_map;
});

describe('installMangleRuntime', () => {
    it('installs a registry with the historical helper shape', () => {
        const registry = installMangleRuntime({
            mangleMap: MAP,
            varMangleMap: VAR_MAP,
            checksum: 'sum-1',
            globalVarAliasPrefix: '---g',
        });
        expect(getMangleRegistry()).toBe(registry);
        expect(registry.mangleMap).toEqual(MAP);
        expect(registry.varMangleMap).toEqual(VAR_MAP);
        expect(registry.checksum).toBe('sum-1');
        expect(registry.encode('p-4')).toBe('z');
        expect(registry.encode('unknown')).toBeUndefined();
        expect(registry.decode('z')).toBe('p-4');
        expect(registry.decode('unknown')).toBeUndefined();
        expect(registry.decodeVar('v1')).toEqual(['--_sz-a']);
        expect(registry.decodeVar('v3')).toEqual(['--_sz-b']);
        expect(registry.decodeVar('nope')).toEqual([]);
        expect(registry.encodeVar('--_sz-a')).toEqual(['v1', 'v2']);
        expect(registry.decodeGlobalVar('---gz')).toBe('--brand');
        expect(registry.decodeGlobalVar('v3')).toBeUndefined();
        expect(registry.decodeAll({ className: 'z y keep' } as Element)).toEqual([
            'p-4',
            'mx-0',
            'keep',
        ]);
    });

    it('defaults the optional inputs', () => {
        const registry = installMangleRuntime({ mangleMap: MAP });
        expect(registry.varMangleMap).toEqual({});
        expect(registry.checksum).toBe('');
        expect(registry.decodeVar('anything')).toEqual([]);
        // No alias prefix means no global aliases were planned for the build.
        expect(registry.decodeGlobalVar('---gz')).toBeUndefined();
        expect(registry.decodeAll({} as Element)).toEqual([]);
    });

    it('ignores inherited keys on a var map that carries a prototype', () => {
        const varMangleMap = Object.create({ '--inherited': 'nope' }) as Record<string, string>;
        varMangleMap['--own'] = 'v1';
        const registry = installMangleRuntime({ mangleMap: MAP, varMangleMap });
        expect(registry.decodeVar('v1')).toEqual(['--own']);
        expect(registry.decodeVar('nope')).toEqual([]);
    });

    it('treats two checksum-less installs as the same build', () => {
        const first = installMangleRuntime({ mangleMap: MAP });
        expect(installMangleRuntime({ mangleMap: { other: 'q' } })).toBe(first);
    });

    it('is idempotent for the same checksum: the first install wins', () => {
        const first = installMangleRuntime({ mangleMap: MAP, checksum: 'sum-1' });
        const second = installMangleRuntime({ mangleMap: { other: 'q' }, checksum: 'sum-1' });
        expect(second).toBe(first);
        expect(getMangleRegistry()?.encode('p-4')).toBe('z');
    });

    it('replaces the registry when a different build installs', () => {
        installMangleRuntime({ mangleMap: MAP, checksum: 'sum-1' });
        const next = installMangleRuntime({ mangleMap: { other: 'q' }, checksum: 'sum-2' });
        expect(getMangleRegistry()).toBe(next);
        expect(getMangleRegistry()?.encode('other')).toBe('q');
    });

    it('leaves window.__csszyx alone unless asked', () => {
        installMangleRuntime({ mangleMap: MAP, checksum: 'sum-1' });
        expect((window as DebugWindow).__csszyx).toBeUndefined();
    });

    it('exposes the registry as window.__csszyx when asked', () => {
        const registry = installMangleRuntime({
            mangleMap: MAP,
            checksum: 'sum-1',
            exposeDebugGlobal: true,
        });
        expect((window as DebugWindow).__csszyx).toBe(registry);
    });

    it('exposes an already-installed registry on a later opt-in call', () => {
        const registry = installMangleRuntime({ mangleMap: MAP, checksum: 'sum-1' });
        installMangleRuntime({ mangleMap: MAP, checksum: 'sum-1', exposeDebugGlobal: true });
        expect((window as DebugWindow).__csszyx).toBe(registry);
    });

    it('mirrors the registry on globalThis for a second module instance', () => {
        const registry = installMangleRuntime({ mangleMap: MAP, checksum: 'sum-1' });
        expect(
            (globalThis as { __csszyx_mangle_registry?: unknown }).__csszyx_mangle_registry,
        ).toBe(registry);
        clearMangleRegistry();
        expect(
            (globalThis as { __csszyx_mangle_registry?: unknown }).__csszyx_mangle_registry,
        ).toBeUndefined();
        expect(getMangleRegistry()).toBeNull();
    });

    it('reads a registry another instance mirrored onto globalThis', () => {
        const foreign = { mangleMap: MAP, decode: (c: string) => (c === 'z' ? 'p-4' : undefined) };
        (globalThis as { __csszyx_mangle_registry?: unknown }).__csszyx_mangle_registry = foreign;
        expect(getMangleRegistry()).toBe(foreign);
    });

    it('never resolves a prototype-chain property as a token', () => {
        const registry = installMangleRuntime({ mangleMap: MAP, checksum: 'sum-1' });
        expect(registry.encode('constructor')).toBeUndefined();
        expect(registry.decode('hasOwnProperty')).toBeUndefined();
        expect(registry.decodeVar('toString')).toEqual([]);
    });
});

describe('runtime helpers read the registry', () => {
    it('lowerSz mangles through the registry without any window.__csszyx', () => {
        installMangleRuntime({ mangleMap: MAP, checksum: 'sum-1' });
        expect(szr({ p: 4 })).toBe('z');
        expect(_szMerge([{ mx: 0 }, { mx: 4 }])).toBe('x');
    });

    it('the SSR global still takes precedence over the registry', () => {
        installMangleRuntime({ mangleMap: MAP, checksum: 'sum-1' });
        (globalThis as { __csszyx_ssr_mangle_map?: unknown }).__csszyx_ssr_mangle_map = {
            'p-4': 'ssr',
        };
        expect(szr({ p: 4 })).toBe('ssr');
    });

    it('szcn decodes mangled tokens through the registry', () => {
        installMangleRuntime({ mangleMap: MAP, checksum: 'sum-1' });
        // Same utility (mx), later wins, output stays mangled.
        expect(szcn('y', 'x')).toBe('x');
        expect(szcn('x', 'y')).toBe('y');
        // An original censused name encodes to its token on the way out.
        expect(szcn('mx-0')).toBe('y');
    });

    it('falls back to the legacy window.__csszyx bridge when no registry exists', () => {
        (window as DebugWindow).__csszyx = {
            mangleMap: MAP,
            decode: (c: string) => Object.entries(MAP).find(([, t]) => t === c)?.[0],
        };
        expect(szr({ p: 4 })).toBe('z');
        expect(szcn('y', 'x')).toBe('x');
    });
});
