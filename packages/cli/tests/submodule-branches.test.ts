/**
 * Branch coverage for migrate submodule edges reached through the public
 * transformers: HTML class attributes that are empty, fully unrecognized, or
 * partially recognized; the local runtime-script injection; and dynamic
 * className shapes (fully-unrecognized clsx string, empty ternary branches,
 * logical-&& with an unrecognized right side, base-less template literals).
 */
import { describe, expect, it } from 'vitest';

import { transformHtmlSourceSimple, transformSource } from '../src/migrate/ast-transformer.js';

describe('HTML class attribute branches', () => {
    it('skips a whitespace-only class attribute', () => {
        const out = transformHtmlSourceSimple('<div class="   ">x</div>', 'page.html');
        expect(out.code).toContain('class="   "');
        expect(out.stats.classNamesSkipped).toBe(1);
    });

    it('leaves a fully unrecognized class attribute in place and records it', () => {
        const out = transformHtmlSourceSimple('<div class="totally-unknownx">x</div>', 'page.html');
        expect(out.code).toContain('class="totally-unknownx"');
        expect(out.stats.classesUnrecognized).toContain('totally-unknownx');
        expect(out.changed).toBe(false);
    });

    it('splits a partially recognized class into a kept class plus an sz attribute', () => {
        const out = transformHtmlSourceSimple('<div class="p-4 keepmex">x</div>', 'page.html');
        expect(out.code).toContain('class="keepmex"');
        expect(out.code).toContain('sz="');
        expect(out.stats.classNamesTransformed).toBe(1);
    });

    it('injects the local runtime script before </body>', () => {
        const out = transformHtmlSourceSimple(
            '<html><head></head><body><div class="p-4">x</div></body></html>',
            'page.html',
            { injectRuntime: 'local', localPath: 'my-runtime.js', injectFouc: false },
        );
        expect(out.code).toContain('<script src="my-runtime.js"></script>');
        expect(out.changed).toBe(true);
    });

    it('reads a single-quoted class attribute', () => {
        const out = transformHtmlSourceSimple("<div class='p-4'>x</div>", 'page.html');
        expect(out.code).toContain('sz=');
    });
});

describe('dynamic className rejection branches', () => {
    it('skips a clsx call whose only string argument is fully unrecognized', () => {
        const src = 'const A = () => <div className={clsx("totally-unknownx")} />;';
        const out = transformSource(src, 'test.tsx');
        expect(out.changed).toBe(false);
        expect(out.code).toContain('clsx("totally-unknownx")');
    });

    it('converts a ternary with one empty branch and keeps unmigratable ones', () => {
        const src = [
            'const A = ({ on }) => (<div>',
            '  <i className={on ? "p-4" : ""} />',
            '  <b className={on ? "" : "m-2"} />',
            '</div>);',
        ].join('\n');
        const out = transformSource(src, 'test.tsx');
        expect(out.changed).toBe(true);
        expect(out.code).toContain('p: 4');
        expect(out.code).toContain('m: 2');
    });

    it('skips a ternary branch that carries an unrecognized class', () => {
        const src = 'const A = ({ on }) => <div className={on ? "totally-unknownx" : "m-2"} />;';
        const out = transformSource(src, 'test.tsx');
        // An unrecognized branch makes the whole ternary unmigratable → left as-is.
        expect(out.code).toContain('totally-unknownx');
    });

    it('skips a logical && whose right side is an unrecognized class', () => {
        const src = 'const A = ({ on }) => <div className={on && "totally-unknownx"} />;';
        const out = transformSource(src, 'test.tsx');
        expect(out.code).toContain('&& "totally-unknownx"');
    });

    it('skips a template literal that has no static base classes', () => {
        const src = 'const A = ({ x }) => <div className={`${x}`} />;';
        const out = transformSource(src, 'test.tsx');
        expect(out.changed).toBe(false);
    });
});
