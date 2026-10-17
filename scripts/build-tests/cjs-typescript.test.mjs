/**
 * A CommonJS TypeScript project type-checks against the runtime under
 * `module: node16`.
 *
 * `@csszyx/runtime` and `@csszyx/types` ship CommonJS declarations that import
 * types from the `@csszyx/compiler` root, which is an ES module. TypeScript
 * refuses that import from a CommonJS file (TS1479) unless the root offers
 * declarations under `require`, so the compiler ships a one-line
 * `dist/index.d.cts` that re-exports its ES declarations with the resolution
 * mode they need. This checks a project that imports both, with library
 * checking on, as a user's `tsc` would see it.
 *
 * Reads the built packages and FAILS when they are not built.
 */
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { existsSync, mkdirSync, mkdtempSync, rmSync, symlinkSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import test from 'node:test';

const ROOT = path.resolve(import.meta.dirname, '../..');

test('a CommonJS project imports the runtime and the types under module node16', () => {
    for (const name of ['compiler', 'runtime', 'types']) {
        assert.ok(
            existsSync(path.join(ROOT, 'packages', name, 'dist')),
            `build packages/${name} first`,
        );
    }
    const project = mkdtempSync(path.join(tmpdir(), 'csszyx-cjs-ts-'));
    try {
        mkdirSync(path.join(project, 'node_modules/@csszyx'), { recursive: true });
        for (const name of ['compiler', 'runtime', 'types']) {
            symlinkSync(
                path.join(ROOT, 'packages', name),
                path.join(project, 'node_modules/@csszyx', name),
                'dir',
            );
        }
        writeFileSync(path.join(project, 'package.json'), '{"name":"app","private":true}');
        writeFileSync(
            path.join(project, 'index.ts'),
            [
                "import { szcn } from '@csszyx/runtime';",
                "import type { SzProps } from '@csszyx/types';",
                'export const merged: string = szcn("p-2", "p-4");',
                'export type Props = SzProps;',
                '',
            ].join('\n'),
        );
        const { status, stdout, stderr } = spawnSync(
            process.execPath,
            [
                path.join(ROOT, 'node_modules/typescript/bin/tsc'),
                '--ignoreConfig',
                '--noEmit',
                '--strict',
                '--skipLibCheck',
                'false',
                '--module',
                'node16',
                '--moduleResolution',
                'node16',
                path.join(project, 'index.ts'),
            ],
            { cwd: project, encoding: 'utf8' },
        );
        assert.equal(status, 0, stdout + stderr);
    } finally {
        rmSync(project, { recursive: true, force: true });
    }
});
