// The capability table decides what both engines write, so the parts of its
// generator that are decisions — what counts as the bracket setting a key's own
// property, and which key on a shared prefix owns a column — are pinned here on
// hand-written CSS, without a Tailwind install.
import assert from 'node:assert/strict';
import test from 'node:test';

import {
    attributeColumns,
    bracketSetsOwnProperty,
    constantName,
    declarationsOf,
    renderTypeScript,
    tailwindColumns,
} from './gen-sz-capabilities.mjs';

test('reads declarations through the one CSS analyzer, custom properties left out', () => {
    const css = [
        '.x {',
        '  --tw-blur: blur(inherit);',
        '  filter: var(--tw-blur,);',
        '}',
        '@property --tw-blur {',
        '  syntax: "*";',
        '  inherits: false;',
        '}',
        // A regex over lines read these as the class's own declarations.
        '@keyframes spin { to { transform: rotate(360deg); } }',
        '.y { color: red; }',
    ].join('\n');

    assert.deepEqual(
        [...declarationsOf('x', css).values()],
        ['var(--tw-blur,)'],
        'only the declaration the class itself sets',
    );
    assert.equal(declarationsOf('x', '').size, 0);
    assert.equal(declarationsOf('x', '.x { color: red').size, 0);
});

test('takes a bracket that sets the key’s own property to the keyword', () => {
    const own = new Map([['cursor', 'pointer']]);

    assert.equal(bracketSetsOwnProperty(new Map([['cursor', 'inherit']]), own), true);
    // Boilerplate beside the property is fine while it stays the same.
    assert.equal(
        bracketSetsOwnProperty(
            new Map([
                ['overflow', 'hidden'],
                ['-webkit-line-clamp', 'inherit'],
            ]),
            new Map([
                ['overflow', 'hidden'],
                ['-webkit-line-clamp', '3'],
            ]),
        ),
        true,
    );
});

test('refuses a bracket that is inert, invalid or another property', () => {
    const filter = new Map([['filter', 'var(--tw-blur,)']]);
    const margin = new Map([['margin-inline-start', 'calc(inherit * var(--r))']]);

    // `blur-[inherit]`: only the variable changed.
    assert.equal(bracketSetsOwnProperty(filter, filter), false);
    // `space-x-[inherit]`: the keyword inside an expression.
    assert.equal(
        bracketSetsOwnProperty(margin, new Map([['margin-inline-start', 'calc(1rem * var(--r))']])),
        false,
    );
    // `bg-[inherit]`: a colour where the key sets a position.
    assert.equal(
        bracketSetsOwnProperty(
            new Map([['background-color', 'inherit']]),
            new Map([['background-position', '4px']]),
        ),
        false,
    );
    assert.equal(bracketSetsOwnProperty(new Map(), new Map()), false);
    assert.equal(bracketSetsOwnProperty(new Map([['cursor', 'inherit']]), null), false);
});

test('asks Tailwind one class per column', () => {
    const css = {
        '-mt-2': '.a { margin-top: -0.5rem; }',
        'cursor-[inherit]': '.cursor-\\[inherit\\] {\n  cursor: inherit;\n}',
        'cursor-[4px]': '.cursor-\\[4px\\] {\n  cursor: 4px;\n}',
    };
    const served = tailwindColumns(classes => classes.map(name => css[name] ?? null));

    assert.deepEqual([...served('mt')], ['signNumber']);
    assert.deepEqual([...served('cursor')], ['cssWideBracket']);
});

test('gives a shared prefix’s column to the keys the table names', () => {
    const served = prefix => new Set(prefix === 'object' ? ['cssWideBracket'] : ['signNumber']);
    const rows = attributeColumns({ objectFit: 'object', objectPos: 'object', mt: 'mt' }, served, {
        object: { cssWideBracket: ['objectPos'] },
    });

    assert.deepEqual(
        [...rows],
        [
            ['objectFit', ''],
            ['objectPos', 'w'],
            ['mt', 'n'],
        ],
    );
});

test('reports instead of failing what another Tailwind serves differently', () => {
    // The pinned Tailwind is strict; an older one (4.0 has no `inset-s`) is
    // compared, so the attribution it cannot honour is a difference to report.
    const map = { objectFit: 'object', objectPos: 'object', mt: 'mt', mx: 'mx' };
    const reported = [];
    const rows = attributeColumns(
        map,
        prefix => new Set(prefix === 'object' ? [] : prefix === 'mx' ? [] : ['signNumber']),
        { object: { cssWideBracket: ['objectPos'] } },
        { tolerate: problem => reported.push(problem) },
    );

    assert.deepEqual(Object.fromEntries(rows), { objectFit: '', objectPos: '', mt: 'n', mx: '' });
    assert.deepEqual(reported, ['object: names cssWideBracket, which Tailwind does not serve']);
    // A served column nobody attributed is dropped and reported, too.
    const unnamed = [];
    attributeColumns(
        map,
        () => new Set(['cssWideBracket']),
        {},
        { tolerate: p => unnamed.push(p) },
    );
    assert.deepEqual(unnamed, [
        'object: serves cssWideBracket; name its keys among objectFit, objectPos',
    ]);
    // A fault in the table itself, not in Tailwind, still fails.
    assert.throws(
        () => attributeColumns(map, () => new Set(), { mt: {} }, { tolerate: () => {} }),
        /mt: listed as shared, but fewer than two keys use it/,
    );
});

test('fails on a shared prefix nobody attributed, or an attribution gone stale', () => {
    const map = { objectFit: 'object', objectPos: 'object', mt: 'mt' };
    const none = () => new Set();
    const both = () => new Set(['cssWideBracket']);

    assert.throws(() => attributeColumns(map, both, {}), /object: serves cssWideBracket/);
    assert.throws(
        () => attributeColumns(map, none, { object: { cssWideBracket: ['objectPos'] } }),
        /names cssWideBracket, which Tailwind does not serve/,
    );
    assert.throws(
        () => attributeColumns(map, both, { object: { cssWideBracket: ['objectX'] } }),
        /objectX is not a key on this prefix/,
    );
    assert.throws(
        () => attributeColumns(map, none, { mt: {} }),
        /mt: listed as shared, but fewer than two keys use it/,
    );
});

test('renders a row per key with a column, and names the rest', () => {
    const source = renderTypeScript(
        new Map([
            ['mt', 'n'],
            ['@container', ''],
        ]),
        '4.3.3',
    );

    assert.match(
        source,
        /generated by scripts\/gen-sz-capabilities\.mjs from tailwindcss 4\.3\.3, the/,
    );
    assert.match(source, /Tailwind this repo pins/);
    assert.match(source, /not a verdict about a project's Tailwind \(PROJECT-RULES §4\)/);
    assert.match(source, /export const SZ_CAPABILITY_FORMAT = 1;/);
    assert.match(source, /export const SZ_CAP_SIGN_NUMBER = 'n';/);
    assert.match(source, /\n {4}mt: 'n',\n {4}\/\/ No column:\n {4}\/\/ @container\.\n/);
    assert.equal(constantName('cssWideBracket'), 'CSS_WIDE_BRACKET');
});
