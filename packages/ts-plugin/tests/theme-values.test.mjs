import assert from 'node:assert';
import { createRequire } from 'node:module';
import test from 'node:test';

const require = createRequire(import.meta.url);
const ts = require('typescript');
const {
    EMPTY_THEME_SNAPSHOT,
    themeSnapshotForProgram,
    themeValuesForProperty,
} = require('../dist/theme-values.js');

const source = (fileName, text) =>
    ts.createSourceFile(fileName, text, ts.ScriptTarget.Latest, true, ts.ScriptKind.TS);
const program = (...files) => ({
    getSourceFile: fileName => files.find(file => file.fileName === fileName),
});
const declaration = ({ colors = "'brand'", breakpoints = "'tablet'" } = {}) => `
declare module '@csszyx/compiler' {
    interface CustomTheme {
        colors: ${colors};
        spacings: 'gutter';
        fonts: 'display';
        textSizes: 'hero';
        fontWeights: 'book';
        radii: 'panel';
        shadows: 'float';
    }
    interface VariantModifiers {
        ${breakpoints}?: SzPropsBase;
    }
}
export {};
`;

test('reads only the nearest generated theme declaration and maps every category', () => {
    const parent = source('/repo/.csszyx/theme.d.ts', declaration({ colors: "'parent'" }));
    const nested = source('/repo/apps/web/.csszyx/theme.d.ts', declaration());
    const unrelated = source('/other/.csszyx/theme.d.ts', declaration({ colors: "'other'" }));
    const snapshot = themeSnapshotForProgram({
        tsMod: ts,
        program: program(parent, nested, unrelated),
        projectRoot: '/repo/apps/web',
    });

    assert.deepStrictEqual(snapshot.colors, ['brand']);
    assert.deepStrictEqual(snapshot.spacings, ['gutter']);
    assert.deepStrictEqual(snapshot.fonts, ['display']);
    assert.deepStrictEqual(snapshot.textSizes, ['hero']);
    assert.deepStrictEqual(snapshot.fontWeights, ['book']);
    assert.deepStrictEqual(snapshot.radii, ['panel']);
    assert.deepStrictEqual(snapshot.shadows, ['float']);
    assert.deepStrictEqual(snapshot.breakpoints, ['tablet']);
    assert.deepStrictEqual(themeValuesForProperty(snapshot, 'bg'), ['brand']);
    assert.deepStrictEqual(themeValuesForProperty(snapshot, 'borderTColor'), ['brand']);
    assert.deepStrictEqual(themeValuesForProperty(snapshot, 'insetRingColor'), ['brand']);
    assert.deepStrictEqual(themeValuesForProperty(snapshot, 'p'), ['gutter']);
    assert.deepStrictEqual(themeValuesForProperty(snapshot, 'fontFamily'), ['display']);
    assert.deepStrictEqual(themeValuesForProperty(snapshot, 'weight'), ['book']);
    assert.deepStrictEqual(themeValuesForProperty(snapshot, 'text'), ['hero']);
    assert.deepStrictEqual(themeValuesForProperty(snapshot, 'rounded'), ['panel']);
    assert.deepStrictEqual(themeValuesForProperty(snapshot, 'shadow'), ['float']);
    assert.deepStrictEqual(themeValuesForProperty(snapshot, 'display'), []);
});

test('fails open for malformed, foreign, oversized, cancelled, and unsafe tokens', () => {
    const foreign = source(
        '/repo/.csszyx/theme.d.ts',
        declaration().replace("'@csszyx/compiler'", "'not-csszyx'"),
    );
    assert.strictEqual(
        themeSnapshotForProgram({ tsMod: ts, program: program(foreign), projectRoot: '/repo' }),
        EMPTY_THEME_SNAPSHOT,
    );

    const malformed = source(
        '/repo/.csszyx/theme.d.ts',
        declaration({ colors: "'ok' | string | 'also-ok'" }).replace(
            "interface CustomTheme {",
            "interface CustomTheme { [computed]: 'ignored';",
        ),
    );
    assert.deepStrictEqual(
        themeSnapshotForProgram({ tsMod: ts, program: program(malformed), projectRoot: '/repo' })
            .colors,
        [],
    );

    const tooLong = 'x'.repeat(129);
    const unsafe = source(
        '/repo/.csszyx/theme.d.ts',
        declaration({ colors: `'safe' | '${tooLong}' | 'Bad' | 'with space' | 'after'` }),
    );
    assert.deepStrictEqual(
        themeSnapshotForProgram({ tsMod: ts, program: program(unsafe), projectRoot: '/repo' })
            .colors,
        ['after', 'safe'],
    );

    const oversized = source('/repo/.csszyx/theme.d.ts', `// ${'x'.repeat(128 * 1024)}`);
    assert.strictEqual(
        themeSnapshotForProgram({ tsMod: ts, program: program(oversized), projectRoot: '/repo' }),
        EMPTY_THEME_SNAPSHOT,
    );
    assert.strictEqual(
        themeSnapshotForProgram({
            tsMod: ts,
            program: { getSourceFile: () => { throw new Error('host lookup failed'); } },
            projectRoot: '/repo',
        }),
        EMPTY_THEME_SNAPSHOT,
    );

    const tooMany = Array.from({ length: 2_001 }, (_, index) => `'token-${index}'`).join(
        ' | ',
    );
    const capped = source('/repo/.csszyx/theme.d.ts', declaration({ colors: tooMany }));
    assert.strictEqual(
        themeSnapshotForProgram({ tsMod: ts, program: program(capped), projectRoot: '/repo' }),
        EMPTY_THEME_SNAPSHOT,
    );
    assert.strictEqual(
        themeSnapshotForProgram({
            tsMod: ts,
            program: program(source('/repo/.csszyx/theme.d.ts', declaration())),
            projectRoot: '/repo',
            shouldStop: () => true,
        }),
        EMPTY_THEME_SNAPSHOT,
    );
});

test('delegates path casing and canonicalization to the host Program', () => {
    const insensitiveTs = Object.create(ts);
    Object.defineProperty(insensitiveTs, 'sys', {
        value: { ...ts.sys, useCaseSensitiveFileNames: false },
    });
    const canonical = source('/real/repo/.csszyx/theme.d.ts', declaration());
    let requested;
    const canonicalizingProgram = {
        getSourceFile: fileName => {
            requested = fileName;
            return fileName === '/repo/.csszyx/theme.d.ts' ? canonical : undefined;
        },
    };
    const snapshot = themeSnapshotForProgram({
        tsMod: insensitiveTs,
        program: canonicalizingProgram,
        projectRoot: '/REPO',
    });
    assert.strictEqual(requested, '/repo/.csszyx/theme.d.ts');
    assert.deepStrictEqual(snapshot.colors, ['brand']);
});

test('prefers the Program config directory over a workspace-level root', () => {
    const nested = source('/repo/apps/web/.csszyx/theme.d.ts', declaration());
    const nestedProgram = {
        getCompilerOptions: () => ({ configFilePath: '/repo/apps/web/tsconfig.json' }),
        getSourceFile: fileName =>
            fileName === '/repo/apps/web/.csszyx/theme.d.ts' ? nested : undefined,
    };
    assert.deepStrictEqual(
        themeSnapshotForProgram({
            tsMod: ts,
            program: nestedProgram,
            projectRoot: '/repo',
        }).colors,
        ['brand'],
    );
});

test('caches by program and source identity without leaking between projects', () => {
    const firstSource = source('/one/.csszyx/theme.d.ts', declaration({ colors: "'one'" }));
    const firstProgram = program(firstSource);
    const first = themeSnapshotForProgram({ tsMod: ts, program: firstProgram, projectRoot: '/one' });
    assert.strictEqual(
        themeSnapshotForProgram({ tsMod: ts, program: firstProgram, projectRoot: '/one' }),
        first,
    );

    const second = themeSnapshotForProgram({
        tsMod: ts,
        program: program(source('/two/.csszyx/theme.d.ts', declaration({ colors: "'two'" }))),
        projectRoot: '/two',
    });
    assert.deepStrictEqual(first.colors, ['one']);
    assert.deepStrictEqual(second.colors, ['two']);
});
