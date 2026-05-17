/**
 * Tests for the React integration layer (@csszyx/dynamic/react).
 *
 * React hooks cannot run outside a React render tree, so we mock the `react`
 * module to capture the effect callbacks passed to useEffect/useCallback/useContext.
 * This lets us invoke those callbacks directly and verify side-effects without
 * React Testing Library or a DOM environment.
 *
 * Coverage:
 * - sz export is the dynamic() alias
 * - useSz() returns { sz: fn } with a stable reference
 * - useSz() calls preloadManifest on mount
 * - useSz() schedules deferred cleanup (injectorCleanup + resetManifest) on unmount
 * - useSz() cancels pending cleanup when remounted (StrictMode resilience)
 * - CsszyxProvider calls setManifestUrl + preloadManifest on mount
 */

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

// ── Captured hook state ───────────────────────────────────────────────────────

/**
 *
 */
type EffectFn = () => (() => void) | undefined;

let capturedEffects: EffectFn[] = [];
let capturedCallback: ((...args: unknown[]) => unknown) | null = null;
let contextValue = { manifestUrl: '/csszyx-manifest.json' };

// ── Mock react ────────────────────────────────────────────────────────────────

vi.mock('react', () => ({
    createContext: vi.fn((defaultValue: unknown) => ({
        _default: defaultValue,
        Provider: 'CsszyxContext.Provider',
    })),
    createElement: vi.fn(
        (type: unknown, props: Record<string, unknown> | null, ...children: unknown[]) => ({
            type,
            props,
            children,
        }),
    ),
    useCallback: vi.fn((fn: (...args: unknown[]) => unknown) => {
        capturedCallback = fn;
        return fn;
    }),
    useContext: vi.fn(() => contextValue),
    useEffect: vi.fn((fn: EffectFn) => {
        capturedEffects.push(fn);
    }),
}));

// ── Mock internal modules ─────────────────────────────────────────────────────

const mockDynamic = vi.fn((props: Record<string, unknown>) => `class-${JSON.stringify(props)}`);
vi.mock('../src/index.js', () => ({ dynamic: mockDynamic }));

const mockInjectorCleanup = vi.fn();
vi.mock('../src/injector.js', () => ({ cleanup: mockInjectorCleanup }));

const mockPreloadManifest = vi.fn();
const mockResetManifest = vi.fn();
const mockSetManifestUrl = vi.fn();
vi.mock('../src/manifest.js', () => ({
    preloadManifest: mockPreloadManifest,
    resetManifest: mockResetManifest,
    setManifestUrl: mockSetManifestUrl,
}));

// ── Import subject under test (after mocks) ───────────────────────────────────

const { sz, useSz, CsszyxProvider } = await import('../src/react.js');

// ── Helpers ───────────────────────────────────────────────────────────────────

/**
 * Runs all captured effects and returns their cleanup functions.
 * @returns array of cleanup functions returned by each effect (undefined entries filtered)
 */
function runCapturedEffects(): Array<() => void> {
    return capturedEffects.map(fn => fn()).filter((r): r is () => void => typeof r === 'function');
}

// ── Tests ─────────────────────────────────────────────────────────────────────

describe('sz export', () => {
    it('is the dynamic() alias', () => {
        expect(sz).toBe(mockDynamic);
    });

    it('passes props through to dynamic()', () => {
        sz({ p: 4, bg: 'blue-500' } as never);
        expect(mockDynamic).toHaveBeenCalledWith({ p: 4, bg: 'blue-500' });
    });
});

describe('useSz()', () => {
    beforeEach(() => {
        capturedEffects = [];
        capturedCallback = null;
        contextValue = { manifestUrl: '/csszyx-manifest.json' };
        vi.useFakeTimers();
    });

    afterEach(() => {
        vi.useRealTimers();
        vi.clearAllMocks();
    });

    it('returns an object with a sz function', () => {
        const result = useSz();
        expect(result).toHaveProperty('sz');
        expect(typeof result.sz).toBe('function');
    });

    it('sz function delegates to dynamic()', () => {
        const { sz: hookSz } = useSz();
        hookSz({ m: 2 } as never);
        expect(mockDynamic).toHaveBeenCalledWith({ m: 2 });
    });

    it('sz reference is stable (useCallback wraps it)', () => {
        const { sz: hookSz } = useSz();
        // capturedCallback is what useCallback returned — same as hookSz
        expect(hookSz).toBe(capturedCallback);
    });

    it('reads manifestUrl from context', () => {
        contextValue = { manifestUrl: '/custom/path.json' };
        useSz();
        runCapturedEffects();
        expect(mockPreloadManifest).toHaveBeenCalledWith('/custom/path.json');
    });

    it('calls preloadManifest with default URL on mount', () => {
        useSz();
        runCapturedEffects();
        expect(mockPreloadManifest).toHaveBeenCalledWith('/csszyx-manifest.json');
    });

    it('schedules deferred cleanup on unmount', () => {
        useSz();
        const cleanups = runCapturedEffects();
        // Run all cleanup functions (simulate unmount)
        cleanups.forEach(fn => {
            fn();
        });
        // Cleanup should NOT have fired yet (timer pending)
        expect(mockInjectorCleanup).not.toHaveBeenCalled();
        expect(mockResetManifest).not.toHaveBeenCalled();
        // After timer fires, cleanup runs
        vi.runAllTimers();
        expect(mockInjectorCleanup).toHaveBeenCalledOnce();
        expect(mockResetManifest).toHaveBeenCalledOnce();
    });

    it('cancels pending cleanup when remounted (StrictMode resilience)', () => {
        // First mount
        useSz();
        const firstCleanups = runCapturedEffects();

        // StrictMode unmount — schedules cleanup timer
        firstCleanups.forEach(fn => {
            fn();
        });
        expect(mockInjectorCleanup).not.toHaveBeenCalled();

        // StrictMode remount — second useSz() call, effect runs again, cancels timer
        capturedEffects = [];
        useSz();
        runCapturedEffects();

        // Timer fires — should have been cancelled by the second mount
        vi.runAllTimers();
        expect(mockInjectorCleanup).not.toHaveBeenCalled();
        expect(mockResetManifest).not.toHaveBeenCalled();
    });

    it('runs cleanup after true unmount (no remount)', () => {
        useSz();
        const cleanups = runCapturedEffects();
        cleanups.forEach(fn => {
            fn();
        });
        // No remount — timer fires
        vi.runAllTimers();
        expect(mockInjectorCleanup).toHaveBeenCalledOnce();
        expect(mockResetManifest).toHaveBeenCalledOnce();
    });
});

describe('CsszyxProvider', () => {
    beforeEach(() => {
        capturedEffects = [];
        vi.clearAllMocks();
    });

    it('calls setManifestUrl with the manifest prop', () => {
        CsszyxProvider({ manifest: '/api/manifest.json', children: null });
        runCapturedEffects();
        expect(mockSetManifestUrl).toHaveBeenCalledWith('/api/manifest.json');
    });

    it('calls preloadManifest with the manifest prop', () => {
        CsszyxProvider({ manifest: '/api/manifest.json', children: null });
        runCapturedEffects();
        expect(mockPreloadManifest).toHaveBeenCalledWith('/api/manifest.json');
    });

    it('re-runs effect when manifest URL changes', () => {
        CsszyxProvider({ manifest: '/v1/manifest.json', children: null });
        CsszyxProvider({ manifest: '/v2/manifest.json', children: null });
        runCapturedEffects();
        expect(mockSetManifestUrl).toHaveBeenCalledWith('/v1/manifest.json');
        expect(mockSetManifestUrl).toHaveBeenCalledWith('/v2/manifest.json');
        expect(mockPreloadManifest).toHaveBeenCalledWith('/v2/manifest.json');
    });

    it('renders children via createElement', async () => {
        const { createElement } = await import('react');
        const children = 'child-content';
        CsszyxProvider({ manifest: '/manifest.json', children });
        expect(createElement).toHaveBeenCalledWith(
            expect.anything(),
            expect.objectContaining({ value: { manifestUrl: '/manifest.json' } }),
            children,
        );
    });
});
