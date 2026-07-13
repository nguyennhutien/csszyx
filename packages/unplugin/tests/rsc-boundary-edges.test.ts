/**
 * Branch-level edge cases for the RSC boundary detector: directive-prologue
 * lexing (BOM, escaped/unterminated strings, unterminated comments), the
 * App-Router entry filename guard, the import scanner's malformed-input paths,
 * graph-walk cycle/diamond/dangling-edge handling, and record deletion across
 * path spellings. These reach the defensive branches the happy-path suite skips.
 */
import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';

import { afterEach, describe, expect, it } from 'vitest';

import {
    createRSCModuleRecord,
    deleteRSCModuleRecord,
    findRSCBoundaryViolation,
    findRSCGraphViolation,
    hasUseClientDirective,
    hasUseServerDirective,
    isRSCServerModule,
    type RSCModuleRecord,
} from '../src/rsc-boundary.js';

const tempDirs: string[] = [];
afterEach(() => {
    for (const dir of tempDirs.splice(0)) fs.rmSync(dir, { recursive: true, force: true });
});

function tempDir(prefix = 'csszyx-rsc-edge-'): string {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), prefix));
    tempDirs.push(dir);
    return dir;
}

describe('directive prologue lexing', () => {
    it('detects a use client directive behind a UTF-8 BOM', () => {
        expect(hasUseClientDirective('﻿"use client";\nexport const X = 1;')).toBe(true);
    });

    it('keeps reading directives after an escaped-string prologue literal', () => {
        // The first literal contains a backslash escape; the lexer must consume
        // the escape and still find the real directive that follows.
        const code = '"a\\"b";\n"use server";\nexport const X = 1;';
        expect(hasUseServerDirective(code)).toBe(true);
    });

    it('returns false for an unterminated prologue string', () => {
        expect(hasUseServerDirective('"use server')).toBe(false);
    });

    it('returns false for an unterminated line comment before any directive', () => {
        expect(hasUseClientDirective('// no newline and no directive')).toBe(false);
    });

    it('returns false for an unterminated block comment before any directive', () => {
        expect(hasUseClientDirective('/* never closed use client')).toBe(false);
    });
});

describe('Next App Router entry detection', () => {
    it('does not treat an extensionless app file as a server module', () => {
        // basename has no dot → not a recognised route entry.
        expect(isRSCServerModule('export const x = 1;', '/repo/app/page')).toBe(false);
    });

    it('does not treat a non-route app filename as a server module', () => {
        expect(isRSCServerModule('export const x = 1;', '/repo/app/helper.ts')).toBe(false);
    });

    it('treats app/page.tsx as a server module by default', () => {
        expect(isRSCServerModule('export const x = 1;', '/repo/app/page.tsx')).toBe(true);
    });
});

describe('runtime import scanner malformed inputs', () => {
    it('ignores a side-effect import of a non-whole-forbidden runtime module', () => {
        // `import 'csszyx'` is a runtime source but not a whole-module-forbidden
        // client entry, so the side-effect form contributes no symbols.
        const code = "'use server';\nimport 'csszyx';\nexport const x = 1;";
        expect(findRSCBoundaryViolation(code, '/repo/app/x.ts')).toBeNull();
    });

    it('is not fooled by "import" appearing inside an identifier', () => {
        const code = "'use server';\nconst reimportx = 1;\nimport { _sz } from '@csszyx/runtime';";
        const violation = findRSCBoundaryViolation(code, '/repo/app/x.ts');
        expect(violation?.symbol).toBe('_sz');
    });

    it('recovers from a malformed import with no from clause before a real one', () => {
        const code = "'use server';\nimport foo;\nimport { _szMerge } from '@csszyx/runtime';";
        const violation = findRSCBoundaryViolation(code, '/repo/app/x.ts');
        expect(violation?.symbol).toBe('_szMerge');
    });

    it('ignores a from clause pointing at an unquoted specifier', () => {
        const record = createRSCModuleRecord('import x from bareword;\n', '/repo/app/x.ts');
        expect(record.imports).toEqual([]);
        expect(record.runtimeImports).toEqual([]);
    });

    it('tolerates escaped and unterminated quotes in import specifiers', () => {
        const code = "import { a } from 'weird\\name';\nimport y from 'trailing\\";
        const record = createRSCModuleRecord(code, '/repo/app/x.ts');
        // No runtime helper source resolves out of these, so nothing is flagged.
        expect(record.runtimeImports).toEqual([]);
    });

    it('flags a forbidden default import whose name contains a digit', () => {
        // `_sz2` exercises the digit branch of the ASCII identifier scanner.
        const code = "'use server';\nimport _sz2 from '@csszyx/runtime';";
        const violation = findRSCBoundaryViolation(code, '/repo/app/x.ts');
        expect(violation?.symbol).toBe('_sz2');
    });

    it('returns null for an import specifier broken across a newline', () => {
        // The quoted specifier is never closed on its line; the scanner bails
        // instead of treating the newline as part of the string.
        const record = createRSCModuleRecord(
            'import y from "unterminated\nfrom \'./a\'";\n',
            '/repo/app/x.ts',
        );
        expect(record.runtimeImports).toEqual([]);
    });

    it('flags a type-prefixed named specifier is skipped but real ones counted', () => {
        // `type _sz2` inside the clause is a type-only member and must be
        // ignored, while a plain forbidden member in the same clause counts.
        const code = "'use server';\nimport { type _sz2, _sz } from '@csszyx/runtime';";
        const violation = findRSCBoundaryViolation(code, '/repo/app/x.ts');
        expect(violation?.symbol).toBe('_sz');
    });
});

describe('RSC graph walk', () => {
    function serverRecord(id: string, overrides: Partial<RSCModuleRecord> = {}): RSCModuleRecord {
        return {
            id,
            isServer: true,
            isClient: false,
            imports: [],
            runtimeImports: [],
            ...overrides,
        };
    }

    it('returns null for a diamond graph with no forbidden helpers', () => {
        // A imports B and C; both import D. Walking A must skip D the second
        // time (already seen) and find no violation.
        const records = new Map<string, RSCModuleRecord>([
            ['/A', serverRecord('/A', { imports: ['/B', '/C'] })],
            ['/B', serverRecord('/B', { isServer: false, imports: ['/D'] })],
            ['/C', serverRecord('/C', { isServer: false, imports: ['/D'] })],
            ['/D', serverRecord('/D', { isServer: false })],
        ]);
        expect(findRSCGraphViolation(records)).toBeNull();
    });

    it('skips import edges that point at modules absent from the graph', () => {
        const records = new Map<string, RSCModuleRecord>([
            ['/A', serverRecord('/A', { imports: ['/missing-node'] })],
        ]);
        expect(findRSCGraphViolation(records)).toBeNull();
    });

    it('ignores non-server roots while scanning the graph', () => {
        const records = new Map<string, RSCModuleRecord>([
            [
                '/client',
                serverRecord('/client', {
                    isServer: false,
                    isClient: true,
                    runtimeImports: [{ source: '@csszyx/runtime', symbols: ['_sz'] }],
                }),
            ],
        ]);
        expect(findRSCGraphViolation(records)).toBeNull();
    });

    it('reports a forbidden helper reachable through a server import chain', () => {
        const records = new Map<string, RSCModuleRecord>([
            ['/A', serverRecord('/A', { imports: ['/B'] })],
            [
                '/B',
                serverRecord('/B', {
                    isServer: false,
                    runtimeImports: [{ source: '@csszyx/runtime', symbols: ['_szMerge'] }],
                }),
            ],
        ]);
        const violation = findRSCGraphViolation(records);
        expect(violation?.symbol).toBe('_szMerge');
        expect(violation?.importChain).toEqual(['/A', '/B', '@csszyx/runtime']);
    });
});

describe('module record deletion across path spellings', () => {
    it('deletes a record stored under a relative (raw) spelling', () => {
        const records = new Map<string, RSCModuleRecord>();
        const raw = 'src/App.tsx';
        records.set(raw, {
            id: raw,
            isServer: false,
            isClient: false,
            imports: [],
            runtimeImports: [],
        });
        // The watcher reports the raw spelling with a query suffix; the deleter
        // tries the normalized, resolved, and clean spellings.
        expect(deleteRSCModuleRecord(records, `${raw}?v=1`)).toBe(true);
        expect(records.size).toBe(0);
    });

    it('deletes a record stored under the realpath when a symlinked id is reported', () => {
        const real = tempDir();
        fs.writeFileSync(path.join(real, 'mod.tsx'), 'export const x = 1;');
        const linkParent = tempDir();
        const link = path.join(linkParent, 'linked');
        fs.symlinkSync(real, link);

        const linkedId = path.join(link, 'mod.tsx');
        const realId = fs.realpathSync(path.join(real, 'mod.tsx')).replace(/\\/g, '/');
        const records = new Map<string, RSCModuleRecord>();
        records.set(realId, {
            id: realId,
            isServer: false,
            isClient: false,
            imports: [],
            runtimeImports: [],
        });
        // The normalized (realpath) spelling differs from resolve(linkedId), so
        // the deleter must fall through to the resolved-key delete branch.
        expect(deleteRSCModuleRecord(records, linkedId)).toBe(true);
        expect(records.size).toBe(0);
    });

    it('returns false when no spelling matches an existing record', () => {
        const records = new Map<string, RSCModuleRecord>();
        expect(deleteRSCModuleRecord(records, '/repo/app/never.tsx')).toBe(false);
    });

    it('deletes via the normalized spelling even when the raw spelling is absent', () => {
        // The record is keyed by the resolved absolute path; the watcher reports
        // a relative id with a query, so the normalized delete succeeds and the
        // later raw-spelling delete is a no-op that must not flip the result.
        const abs = path.resolve('rel-only.tsx').replace(/\\/g, '/');
        const records = new Map<string, RSCModuleRecord>();
        records.set(abs, {
            id: abs,
            isServer: false,
            isClient: false,
            imports: [],
            runtimeImports: [],
        });
        expect(deleteRSCModuleRecord(records, 'rel-only.tsx?v=2')).toBe(true);
        expect(records.size).toBe(0);
    });
});

describe('local import resolution against a real tree', () => {
    it('resolves a directory-style import to its index file and skips directories', () => {
        const root = tempDir();
        fs.mkdirSync(path.join(root, 'lib'), { recursive: true });
        fs.writeFileSync(path.join(root, 'lib/index.ts'), 'export const y = 1;');
        const importer = path.join(root, 'app/page.tsx');
        fs.mkdirSync(path.join(root, 'app'), { recursive: true });
        fs.writeFileSync(importer, "import { y } from '../lib';\n");

        const record = createRSCModuleRecord("import { y } from '../lib';\n", importer);
        const resolved = fs.realpathSync(path.join(root, 'lib/index.ts')).replace(/\\/g, '/');
        expect(record.imports).toContain(resolved);
    });

    it('resolves an absolute local import specifier', () => {
        const root = tempDir();
        fs.writeFileSync(path.join(root, 'shared.ts'), 'export const z = 1;');
        const abs = path.join(root, 'shared').replace(/\\/g, '/');
        const importer = path.join(root, 'app', 'page.tsx');
        fs.mkdirSync(path.join(root, 'app'), { recursive: true });

        const record = createRSCModuleRecord(`import { z } from '${abs}';\n`, importer);
        const resolved = fs.realpathSync(path.join(root, 'shared.ts')).replace(/\\/g, '/');
        expect(record.imports).toContain(resolved);
    });
});
