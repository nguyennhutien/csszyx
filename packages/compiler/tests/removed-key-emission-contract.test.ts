import { afterEach, describe, expect, it, vi } from 'vitest';

import { transform } from '../src/transform-core.js';
import { captureWarnings, ENGINES } from './engine-parity-harness.js';

afterEach(() => {
    vi.restoreAllMocks();
});

describe('removed sz key emission contract', () => {
    it.each([
        ['maskFrom', 'black'],
        ['maskVia', 'transparent'],
        ['maskTo', 'white'],
        ['maskShape', 'circle'],
    ])('runtime drops the removed migration key %s', (key, value) => {
        const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});

        expect(transform({ [key]: value }).className).toBe('');
        expect(warn.mock.calls.map(call => String(call[0])).join('\n')).toContain(
            `"${key}" was removed`,
        );
    });

    it('runtime drops canonical aliases while preserving custom utility fallthrough', () => {
        const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
        const result = transform({
            padding: 4,
            fontSize: 'lg',
            backgroundRepeat: 'repeat-x',
            listStyle: 'disc',
            maskFrom: 'black',
            customThing: 'active',
        });

        expect(result.className).toBe('custom-thing-active');
        expect(warn.mock.calls.map(call => String(call[0])).join('\n')).toContain(
            'canonical key "p"',
        );
        expect(warn.mock.calls.map(call => String(call[0])).join('\n')).toContain(
            'canonical key "bgRepeat"',
        );
    });

    it.each(ENGINES)(
        '%s drops static aliases and migration keys but keeps custom utilities',
        (_name, engine) => {
            const source = `
            export const App = () => (
                <div sz={{ padding: 4, fontSize: 'lg', maskFrom: 'black', customThing: 'active' }} />
            );
        `;
            const run = captureWarnings(engine, source);

            expect(run.className).toBe('custom-thing-active');
            expect(run.warnings.join('\n')).toContain('canonical key "p"');
            expect(run.warnings.join('\n')).toContain('"maskFrom" was removed');
            expect(run.warnings.join('\n')).toContain('Unknown property "customThing"');
        },
    );

    it.each(ENGINES)('%s drops dynamic aliases before CSS-variable lowering', (_name, engine) => {
        const source = `
            export const App = ({ pad, size }) => (
                <div sz={{ hover: { padding: pad }, fontSize: size, bg: 'red-500' }} />
            );
        `;
        const run = captureWarnings(engine, source);
        const code = run.result.code ?? '';

        expect(run.className).toBe('bg-red-500');
        expect(code).not.toContain('--_sz-hover-padding');
        expect(code).not.toContain('--_sz-font-size');
        expect(run.warnings.join('\n')).toContain('canonical key "p"');
        expect(run.warnings.join('\n')).toContain('canonical key "text"');
    });

    it.each(ENGINES)('%s keeps inactive removed keys silent', (_name, engine) => {
        const run = captureWarnings(
            engine,
            'export const App = () => <div sz={{ padding: false, fontSize: null, lineHeight: undefined }} />;',
        );

        expect(run.className ?? '').toBe('');
        expect(run.warnings.join('\n')).not.toContain('canonical key');
    });

    // Removed boolean sugar under a ternary or with a runtime value used to
    // lose its class with no word: the literal-`true` check was the only one.
    it.each(ENGINES)('%s reports removed sugar whatever shape its value has', (_name, engine) => {
        const source = `
            export const App = ({ c, v }) => (
                <div sz={{ absolute: c ? true : false, isolate: v, md: { flex: c ? true : undefined }, p: 4 }} />
            );
        `;
        const run = captureWarnings(engine, source);
        const code = run.result.code ?? '';
        const warnings = run.warnings.join('\n');

        expect(code).not.toContain('--_sz-isolate');
        expect(code).not.toContain('isolate-(');
        expect(warnings).toContain('"absolute" boolean sugar was removed');
        expect(warnings).toContain("Use { position: 'absolute' }");
        expect(warnings).toContain('"isolate" boolean sugar was removed');
        expect(warnings).toContain('"flex" boolean sugar was removed');
        expect(code).toContain('p-4');
    });

    it.each(ENGINES)('%s keeps `flex` a value key and inactive sugar silent', (_name, engine) => {
        const run = captureWarnings(
            engine,
            'export const App = ({ v }) => <div sz={{ flex: v, absolute: false }} />;',
        );

        expect(run.result.code ?? '').toContain('flex-(--_sz-flex)');
        expect(run.warnings.join('\n')).not.toContain('boolean sugar was removed');
    });

    it('does not mistake the canonical alignContent key for CSS content', () => {
        const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});

        expect(transform({ alignContent: 'between' }).className).toBe('content-between');
        expect(warn).not.toHaveBeenCalled();
    });
});
