import assert from 'node:assert/strict';
import test from 'node:test';

import {
    findScannerHelpers,
    isScannedSource,
    judgeScannerHelpers,
    SHARED_SCANNER_MODULES,
} from './check-shared-scanners.mjs';

test('a function named like a text scanner is found, with its file and line', () => {
    const files = {
        'packages/a/src/x.ts':
            'const a = 1;\nfunction skipBlockComment(s, i) {}\nexport function quotedEnd() {}\n',
        'packages/a/src/y.ts':
            'function stripComments() {}\nfunction lexToken() {}\nfunction maskLine() {}\n',
        'packages/a/src/z.ts':
            'function lexicon() {}\nfunction masked() {}\nconst commentEnd = 1;\n',
    };
    assert.deepEqual(findScannerHelpers(files), [
        { file: 'packages/a/src/x.ts', name: 'skipBlockComment', line: 2 },
        { file: 'packages/a/src/x.ts', name: 'quotedEnd', line: 3 },
        { file: 'packages/a/src/y.ts', name: 'stripComments', line: 1 },
        { file: 'packages/a/src/y.ts', name: 'lexToken', line: 2 },
        { file: 'packages/a/src/y.ts', name: 'maskLine', line: 3 },
    ]);
});

test('an arrow function, a function expression or a method is found too', () => {
    const files = {
        'packages/a/src/x.ts': [
            'const skipBlockComment = (t, i) => 0;',
            'export const stripComments = function (t) {};',
            'let maskLine = async t => t;',
            'const quotedEnd: (t: string) => number = t => 0;',
            'class A {',
            '    skipComment(t: string): number {',
            '    private static lexToken<T>(t) {',
            '    }',
            '}',
            'const commentEnd = 1;',
            'while (skipComment(t)) {',
            'skipComment(t);',
        ].join('\n'),
    };
    assert.deepEqual(
        findScannerHelpers(files).map(({ name, line }) => `${line} ${name}`),
        [
            '1 skipBlockComment',
            '2 stripComments',
            '3 maskLine',
            '4 quotedEnd',
            '6 skipComment',
            '7 lexToken',
        ],
    );
});

test('the shared modules may hold any of them', () => {
    const shared = [...SHARED_SCANNER_MODULES][0];
    assert.deepEqual(findScannerHelpers({ [shared]: 'function quotedEnd() {}\n' }), []);
});

test('a helper outside the allowlist fails, and an allowlist entry that is gone fails too', () => {
    const found = [
        { file: 'packages/a/src/x.ts', name: 'quotedEnd', line: 3 },
        { file: 'packages/a/src/y.ts', name: 'lexToken', line: 2 },
    ];
    const allowlist = [
        { file: 'packages/a/src/y.ts', name: 'lexToken', reason: 'debt' },
        { file: 'packages/a/src/gone.ts', name: 'stripComments', reason: 'debt' },
    ];
    assert.deepEqual(judgeScannerHelpers(found, allowlist), {
        added: ['packages/a/src/x.ts:3 quotedEnd'],
        stale: ['packages/a/src/gone.ts stripComments'],
    });
    assert.deepEqual(judgeScannerHelpers(found.slice(1), allowlist.slice(0, 1)), {
        added: [],
        stale: [],
    });
});

test('an allowlist entry covers one helper, not a second of the same name in its file', () => {
    const found = [
        { file: 'packages/a/src/y.ts', name: 'lexToken', line: 2 },
        { file: 'packages/a/src/y.ts', name: 'lexToken', line: 9 },
    ];
    const allowlist = [{ file: 'packages/a/src/y.ts', name: 'lexToken', reason: 'debt' }];
    assert.deepEqual(judgeScannerHelpers(found, allowlist), {
        added: ['packages/a/src/y.ts:9 lexToken'],
        stale: [],
    });
});

test('the check reads the packages, the apps and the scripts', () => {
    for (const file of [
        'packages/a/src/x.ts',
        'apps/docs/src/x.tsx',
        'scripts/x.mjs',
        'scripts/lib/x.mjs',
    ]) {
        assert.equal(isScannedSource(file), true, file);
    }
    for (const file of ['packages/a/tests/x.ts', 'packages/a/src/x.d.ts', 'apps/docs/x.md']) {
        assert.equal(isScannedSource(file), false, file);
    }
});
