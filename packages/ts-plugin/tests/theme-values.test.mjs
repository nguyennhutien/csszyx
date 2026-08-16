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

test('gives up wherever cancellation lands, not only before it starts', () => {
    // The reader checks `shouldStop` at four depths — per top-level statement,
    // per interface member in each of the two augmentations, and per nested
    // statement. Cancelling only at the entry point leaves the other three
    // untaken, so each is driven here by letting the check pass a set number of
    // times before it trips. Every one of them must yield the empty snapshot
    // rather than a half-read theme, because a partial snapshot would offer
    // completions for some tokens and silently omit the rest.
    const text = declaration({ colors: "'a' | 'b' | 'c'" }).replace(
        'interface VariantModifiers {',
        "interface VariantModifiers { tablet: true; desktop: true;",
    );
    for (let budget = 0; budget < 8; budget++) {
        let seen = 0;
        const snapshot = themeSnapshotForProgram({
            tsMod: ts,
            program: program(source('/repo/.csszyx/theme.d.ts', text)),
            projectRoot: '/repo',
            shouldStop: () => seen++ >= budget,
        });
        assert.strictEqual(snapshot, EMPTY_THEME_SNAPSHOT, `budget ${budget}`);
    }
});

test('stops reading once the token cap is passed', () => {
    // The cap is what keeps a generated declaration from turning into an
    // unbounded completion list inside the editor process.
    const many = Array.from({ length: 2100 }, (_, index) => `'c${index}'`).join(' | ');
    const snapshot = themeSnapshotForProgram({
        tsMod: ts,
        program: program(source('/repo/.csszyx/theme.d.ts', declaration({ colors: many }))),
        projectRoot: '/repo',
    });

    assert.strictEqual(snapshot, EMPTY_THEME_SNAPSHOT);
});

test('passes over interface members that are not typed properties', () => {
    // A method signature and an untyped property both reach the member reader,
    // and neither carries a string-literal union to collect. Skipping them is
    // what lets an unrelated augmentation coexist with the generated one.
    const text = declaration().replace(
        'interface CustomTheme {',
        'interface CustomTheme { method(): void; bare;',
    );
    const snapshot = themeSnapshotForProgram({
        tsMod: ts,
        program: program(source('/repo/.csszyx/theme.d.ts', text)),
        projectRoot: '/repo',
    });

    assert.deepStrictEqual(snapshot.colors, ['brand']);
});

test('ignores module forms and members that carry no augmentation', () => {
    // A namespace named by an identifier has no string module name; a module
    // declared without a body has no block to walk; a non-interface statement
    // inside the block is not an augmentation. All three sit in the same walk
    // as the real declaration and must be stepped over rather than read.
    const text = [
        "declare namespace Local { const x: number; }",
        "declare module 'no-body';",
        "declare module '@csszyx/compiler' {",
        '    type Unrelated = string;',
        "    interface CustomTheme { colors: 'brand'; }",
        '}',
        'export {};',
    ].join('\n');
    const snapshot = themeSnapshotForProgram({
        tsMod: ts,
        program: program(source('/repo/.csszyx/theme.d.ts', text)),
        projectRoot: '/repo',
    });

    assert.deepStrictEqual(snapshot.colors, ['brand']);
});

test('reads the breakpoint augmentation on its own terms', () => {
    // `VariantModifiers` has its own member loop, its own cancellation check
    // and its own cap check, none of which the `CustomTheme` tests reach. An
    // interface that is neither is stepped over rather than guessed at.
    const withOther = [
        "declare module '@csszyx/compiler' {",
        "    interface Unrelated { colors: 'ignored'; }",
        // The method signature is not a property and carries no breakpoint;
        // it reaches the member reader through a different augmentation than
        // the CustomTheme tests use.
        "    interface VariantModifiers { tablet: true; desktop: true; helper(): void; }",
        '}',
        'export {};',
    ].join('\n');
    assert.deepStrictEqual(
        themeSnapshotForProgram({
            tsMod: ts,
            program: program(source('/repo/.csszyx/theme.d.ts', withOther)),
            projectRoot: '/repo',
        }).breakpoints,
        ['desktop', 'tablet'],
    );

    for (let budget = 0; budget < 6; budget++) {
        let seen = 0;
        assert.strictEqual(
            themeSnapshotForProgram({
                tsMod: ts,
                program: program(source('/repo/.csszyx/theme.d.ts', withOther)),
                projectRoot: '/repo',
                shouldStop: () => seen++ >= budget,
            }),
            EMPTY_THEME_SNAPSHOT,
            `budget ${budget}`,
        );
    }

    const many = Array.from({ length: 2100 }, (_, index) => `    bp${index}: true;`).join('\n');
    assert.strictEqual(
        themeSnapshotForProgram({
            tsMod: ts,
            program: program(
                source(
                    '/repo/.csszyx/theme.d.ts',
                    `declare module '@csszyx/compiler' {\n    interface VariantModifiers {\n${many}\n    }\n}\nexport {};`,
                ),
            ),
            projectRoot: '/repo',
        }),
        EMPTY_THEME_SNAPSHOT,
    );
});

test('treats a property with no declared type as carrying no tokens', () => {
    // `colors;` parses as a property signature whose type is absent. The union
    // reader has to answer "nothing" for it rather than dereference the type.
    const untyped = [
        "declare module '@csszyx/compiler' {",
        '    interface CustomTheme { colors; spacings: \'gutter\'; }',
        '}',
        'export {};',
    ].join('\n');
    const snapshot = themeSnapshotForProgram({
        tsMod: ts,
        program: program(source('/repo/.csszyx/theme.d.ts', untyped)),
        projectRoot: '/repo',
    });

    assert.deepStrictEqual(snapshot.colors, []);
    assert.deepStrictEqual(snapshot.spacings, ['gutter']);
});
