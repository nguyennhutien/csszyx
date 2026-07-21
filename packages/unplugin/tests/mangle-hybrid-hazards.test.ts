import { describe, expect, it } from 'vitest';

import { collectAuthoredClassNames, findBalancedCodeEnd } from '../src/authored-class-scanner.js';
import {
    collectMangleHybridHazards,
    mangleEligibleClasses,
    mangleHybridHazardMessage,
} from '../src/unplugin.js';

describe('hybrid raw-class ownership', () => {
    it('collects mixed known and unknown tokens inside clsx expressions', () => {
        const source = `
            export const Panel = ({ className }) => (
                <div className={clsx('bg-bg text-text h-screen overflow-hidden', className)} />
            );
        `;

        expect([...collectAuthoredClassNames(source)].sort()).toEqual([
            'bg-bg',
            'h-screen',
            'overflow-hidden',
            'text-text',
        ]);
    });

    it('collects template quasis, interpolated branches, and nested templates', () => {
        const source = `
            const A = () => <div className={clsx(\`p-4 raw \${active ? 'm-2' : \`m-3 \${'gap-1'}\`}\`)} />;
        `;

        expect([...collectAuthoredClassNames(source)].sort()).toEqual([
            'gap-1',
            'm-2',
            'm-3',
            'p-4',
            'raw',
        ]);
    });

    it('ignores braces in strings, comments, regexes, and template text', () => {
        const source = `
            const A = () => <div className={clsx(get('}'), /* } */ /}/.test(x) && \`p-4 } raw\`)} />;
        `;

        expect([...collectAuthoredClassNames(source)].sort()).toEqual(['p-4', 'raw', '}']);
    });

    it('does not close class expressions on regex braces after prefix keywords', () => {
        const source = `
            const A = () => (
                <div className={factory(() => { return /[}]/.test(value); }, 'p-4 after-regex')} />
            );
        `;

        expect([...collectAuthoredClassNames(source)].sort()).toEqual(['after-regex', 'p-4']);
    });

    it('collects class expressions and object-property class sinks', () => {
        const source = `
            const A = () => <div class={clsx('p-4 raw')} />;
            const props = { className: clsx('m-2 object-raw') };
            const B = React.createElement('div', { className: 'gap-3 created-raw' });
            const C = <div {...{ 'className': 'px-2 quoted-key-raw' }} />;
            const D = <div {...{ class: condition ? 'py-2 object-class' : 'py-3' }} />;
        `;

        expect([...collectAuthoredClassNames(source)].sort()).toEqual([
            'created-raw',
            'gap-3',
            'm-2',
            'object-class',
            'object-raw',
            'p-4',
            'px-2',
            'py-2',
            'py-3',
            'quoted-key-raw',
            'raw',
        ]);
    });

    it('collects Vue bindings and comments between a sink and its operator', () => {
        const source = `
            <template><div :class="active ? 'p-4 vue-raw' : 'm-2'" /></template>
            const A = () => <div className /* retained by macros */ = {'gap-3 jsx-raw'} />;
        `;

        expect([...collectAuthoredClassNames(source)].sort()).toEqual([
            'gap-3',
            'jsx-raw',
            'm-2',
            'p-4',
            'vue-raw',
        ]);
    });

    it('collects Svelte class directives and Astro class:list values', () => {
        const source = `
            <div class:active={active} class:disabled />
            <section class:list={['m-2', active && 'astro-active']} />
        `;

        expect([...collectAuthoredClassNames(source)].sort()).toEqual([
            'active',
            'astro-active',
            'disabled',
            'm-2',
        ]);
    });

    it('collects quoted Astro class:list expressions', () => {
        const source = `<section class:list="m-2 astro-quoted" />`;

        expect([...collectAuthoredClassNames(source)].sort()).toEqual(['astro-quoted', 'm-2']);
    });

    it('bounds malformed expressions and retains completed authored literals', () => {
        const unterminatedBrace = '{factory(`unterminated template';
        expect(findBalancedCodeEnd(unterminatedBrace, 1)).toBe(unterminatedBrace.length);

        const source = [
            "const props = { className: clsx('tail-class')",
            'const A = () => <div className={' + '`escaped\\`tick p-4',
        ].join('\n');
        expect([...collectAuthoredClassNames(source)].sort()).toEqual([
            'escaped`tick',
            'p-4',
            'tail-class',
        ]);
        expect(collectAuthoredClassNames('<div class:list=dynamic className=dynamic />').size).toBe(
            0,
        );
    });

    it('decodes static concatenation, JavaScript whitespace escapes, and entities', () => {
        const source = String.raw`
            const A = () => <div className={'p-' + '4 raw\u0020m-2\u{20}gap-1'} />;
            const B = () => <div className="gap-3&#9;entity-raw&#xA;next-line" />;
        `;

        expect([...collectAuthoredClassNames(source)].sort()).toEqual([
            'entity-raw',
            'gap-1',
            'gap-3',
            'm-2',
            'next-line',
            'p-4',
            'raw',
        ]);
    });

    it('removes CRLF string continuations without splitting one class token', () => {
        const continuation = `\\${'\r\n'}`;
        const source = `<div className={'before-${continuation}after raw'} />`;

        expect([...collectAuthoredClassNames(source)].sort()).toEqual(['before-after', 'raw']);
    });

    it('falls back safely for malformed and out-of-range JavaScript escapes', () => {
        const source = String.raw`
            <div className={'valid\x20fixed \u{110000} \u{GG} \u{ broken \xG1 \x1 \q tail-\x'} />
        `;

        expect([...collectAuthoredClassNames(source)].sort()).toEqual([
            'broken',
            'fixed',
            'q',
            'tail-x',
            'u{',
            'u{110000}',
            'u{GG}',
            'valid',
            'x1',
            'xG1',
        ]);
    });

    it('removes LF string continuations without splitting one class token', () => {
        const continuation = `\\${'\n'}`;
        const source = `<div className={'before-${continuation}after raw'} />`;

        expect([...collectAuthoredClassNames(source)].sort()).toEqual(['before-after', 'raw']);
    });

    it('keeps shared raw/sz classes out of the mangle map', () => {
        const owned = new Set(['bg-bg', 'h-screen', 'overflow-hidden', 'p-4']);
        const authored = new Set(['bg-bg', 'text-text', 'h-screen', 'overflow-hidden']);

        expect(mangleEligibleClasses(owned, authored)).toEqual(['p-4']);
    });

    it('orders eligible classes independently of discovery order', () => {
        const authored = new Set(['p-4']);

        expect(mangleEligibleClasses(new Set(['z-1', 'p-4', 'a-1']), authored)).toEqual([
            'a-1',
            'z-1',
        ]);
        expect(mangleEligibleClasses(new Set(['a-1', 'p-4', 'z-1']), authored)).toEqual([
            'a-1',
            'z-1',
        ]);
    });

    it('collects direct class attributes without unrelated string assignments', () => {
        const source = `
            const label = 'h-screen';
            // <div className="comment-only" />
            target.className = 'assignment-only';
            const A = () => <div className="h-screen raw" title="overflow-hidden" />;
        `;

        expect([...collectAuthoredClassNames(source)].sort()).toEqual(['h-screen', 'raw']);
    });

    it('normalizes parser-valid escaped characters before ownership comparison', () => {
        const source = String.raw`<div className={'before:content-[\'\']'} />`;

        expect([...collectAuthoredClassNames(source)]).toEqual([`before:content-['']`]);
    });
});

describe('collectMangleHybridHazards', () => {
    it('flags tokens that collide with literal class names in external CSS', () => {
        // `w-full`→`y`, `top-0`→`x`; the app authors literal `.x`/`.y` resize
        // handles, so those classes show up as external (non-map) class names.
        const map = { 'w-full': 'y', 'top-0': 'x', 'p-4': 'a' };
        const mangledSources = new Set(['w-full', 'top-0', 'p-4']);
        const externalClasses = new Set(['x', 'y', 'draggable']);

        const { collisions, orphans } = collectMangleHybridHazards(
            map,
            mangledSources,
            externalClasses,
        );

        expect(collisions).toEqual(['x', 'y']);
        expect(orphans).toEqual([]);
    });

    it('flags map sources whose class never produced a CSS rule (orphans)', () => {
        const map = { 'p-4': 'a', 'bg-violet-a-100': 'f7', '4-0': 'g3' };
        // Only `p-4` actually appeared and was mangled in some asset.
        const mangledSources = new Set(['p-4']);
        const externalClasses = new Set<string>();

        const { collisions, orphans } = collectMangleHybridHazards(
            map,
            mangledSources,
            externalClasses,
        );

        expect(collisions).toEqual([]);
        expect(orphans).toEqual(['4-0', 'bg-violet-a-100']);
    });

    it('returns nothing to warn for a clean, csszyx-owned build', () => {
        const hazards = collectMangleHybridHazards(
            { 'p-4': 'a', flex: 'b' },
            new Set(['p-4', 'flex']),
            new Set(['some-app-class']), // external, but not a token value
        );
        expect(hazards.collisions).toEqual([]);
        expect(hazards.orphans).toEqual([]);
        expect(mangleHybridHazardMessage(hazards)).toBeNull();
    });

    it('guides hotfix-first, then rename (preferred) over exclude (libs only)', () => {
        const message = mangleHybridHazardMessage({
            collisions: ['x', 'y'],
            orphans: ['bg-violet-a-100'],
        });
        expect(message).toContain('collide');
        expect(message).toContain('no emitted CSS rule');
        // Hotfix to unblock prod comes first.
        expect(message).toContain('HOTFIX');
        expect(message).toContain('production: { mangle: false }');
        // Renaming is the preferred real fix; exclude is the library escape hatch.
        expect(message).toContain('rename');
        expect(message).toContain('third-party');
        expect(message).toContain('mangleExclude');
        // CLI to discover the offending names.
        expect(message).toContain('scan-collisions');
    });

    it('suggests disabling mangle when there are only orphans, no collisions', () => {
        const message = mangleHybridHazardMessage({ collisions: [], orphans: ['bg-violet-a-100'] });
        expect(message).toContain('production: { mangle: false }');
    });
});
