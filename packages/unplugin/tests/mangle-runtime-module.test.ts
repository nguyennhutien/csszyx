/**
 * Unit net for the self-installing runtime mangle-map module.
 *
 * The module is generated source that executes in the app bundle, so these
 * tests run the generated code in a sandboxed context and assert the install
 * contract: install only when absent, mirror the HTML script's object shape,
 * and stay inert without a `window`.
 */
import { runInNewContext } from 'node:vm';
import { describe, expect, it } from 'vitest';
import {
    CHECKSUM_PLACEHOLDER,
    createMangleRuntimeModule,
    isVirtualModule,
    MANGLE_MAP_PLACEHOLDER,
    MANGLE_RUNTIME_VIRTUAL_ID,
    RESOLVED_MANGLE_RUNTIME_VIRTUAL_ID,
    resolveVirtualModule,
    VAR_MANGLE_MAP_PLACEHOLDER,
} from '../src/virtual-modules.js';

interface InstalledRuntime {
    mangleMap: Record<string, string>;
    varMangleMap: Record<string, string | string[]>;
    checksum: string;
    decode: (token: string) => string | undefined;
    encode: (cls: string) => string | undefined;
    decodeVar: (token: string) => string[];
    encodeVar: (name: string) => string | string[] | undefined;
    decodeGlobalVar: (token: string) => string | undefined;
    decodeAll: (el: { className: string }) => string[];
}

const MAP = { 'flex-col': 'm7', 'mx-0': 'z' };
const VAR_MAP = { '--_sz-a': ['v1', 'v2'], '--_sz-b': 'v3' };

/**
 * Substitute the placeholders the way output processing does, then execute the
 * generated module body against a fake `window`.
 * @param prefix - Global CSS variable alias prefix baked into the module.
 * @param window - Fake window object; omit to simulate SSR (no window global).
 * @param window.__csszyx - Pre-existing runtime object, when present.
 * @param checksum - Value substituted for the checksum placeholder.
 * @returns The installed runtime object, when the module installed one.
 */
function runModule(
    prefix: string,
    window?: { __csszyx?: unknown },
    checksum = 'sum-1',
): InstalledRuntime | undefined {
    const source = createMangleRuntimeModule(prefix)
        .split(MANGLE_MAP_PLACEHOLDER)
        .join(JSON.stringify(MAP))
        .split(VAR_MANGLE_MAP_PLACEHOLDER)
        .join(JSON.stringify(VAR_MAP))
        .split(CHECKSUM_PLACEHOLDER)
        .join(checksum);
    const context: Record<string, unknown> = window === undefined ? {} : { window };
    // The generated source is an ES module whose only statement besides consts
    // is the guarded install; strip the export so `vm` can run it as a script.
    runInNewContext(source.replace('export {};', ''), context);
    return (window as { __csszyx?: InstalledRuntime } | undefined)?.__csszyx;
}

describe('createMangleRuntimeModule', () => {
    it('installs the full runtime object when no window object exists', () => {
        const window: { __csszyx?: unknown } = {};
        const runtime = runModule('--app-', window);

        expect(runtime).toBeDefined();
        expect(runtime?.mangleMap).toEqual(MAP);
        expect(runtime?.checksum).toBe('sum-1');
        expect(runtime?.encode('flex-col')).toBe('m7');
        expect(runtime?.decode('m7')).toBe('flex-col');
        expect(runtime?.decode('unknown')).toBeUndefined();
        expect(runtime?.decodeVar('v1')).toEqual(['--_sz-a']);
        expect(runtime?.decodeVar('v3')).toEqual(['--_sz-b']);
        expect(runtime?.encodeVar('--_sz-b')).toBe('v3');
        expect(runtime?.decodeAll({ className: 'm7 z keep' })).toEqual([
            'flex-col',
            'mx-0',
            'keep',
        ]);
    });

    it('never replaces an existing runtime object', () => {
        const existing = { checksum: 'html-script' };
        const window: { __csszyx?: unknown } = { __csszyx: existing };
        runModule('--app-', window, 'sum-2');

        expect(window.__csszyx).toBe(existing);
    });

    it('is inert without a window (SSR)', () => {
        expect(() => runModule('--app-', undefined, 'sum-3')).not.toThrow();
    });

    it('resolves through the virtual module registry', () => {
        expect(isVirtualModule(MANGLE_RUNTIME_VIRTUAL_ID)).toBe(true);
        expect(resolveVirtualModule(MANGLE_RUNTIME_VIRTUAL_ID)).toBe(
            RESOLVED_MANGLE_RUNTIME_VIRTUAL_ID,
        );
    });
});
