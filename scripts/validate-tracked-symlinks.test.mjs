import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { mkdirSync, mkdtempSync, rmSync, symlinkSync, writeFileSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';

import { readTrackedSymlinks, validateTrackedSymlinks } from './validate-tracked-symlinks.mjs';

const repositoryRoot = path.resolve('/workspace/project');
const existingPaths = new Set([
    path.join(repositoryRoot, 'packages/core/src'),
    path.join(repositoryRoot, 'packages/shared/config.json'),
]);
const pathExists = candidate => existingPaths.has(candidate);

test('accepts empty input and in-repository targets', () => {
    assert.deepEqual(validateTrackedSymlinks([], repositoryRoot, pathExists), []);
    assert.deepEqual(
        validateTrackedSymlinks(
            [
                { path: 'packages/core/current', target: './src' },
                { path: 'packages/core/config.json', target: '../shared/config.json' },
            ],
            repositoryRoot,
            pathExists,
        ),
        [],
    );
});

test('rejects missing targets', () => {
    const errors = validateTrackedSymlinks(
        [{ path: 'packages/core/missing', target: './not-built' }],
        repositoryRoot,
        pathExists,
    );

    assert.deepEqual(errors, [
        'Tracked symlink "packages/core/missing" has a missing target: "./not-built".',
    ]);
});

test('rejects relative targets that escape the repository', () => {
    const errors = validateTrackedSymlinks(
        [{ path: 'packages/core/core', target: '../../../../packages/core' }],
        repositoryRoot,
        pathExists,
    );

    assert.deepEqual(errors, [
        'Tracked symlink "packages/core/core" escapes the repository: "../../../../packages/core".',
    ]);
});

test('rejects POSIX and Windows absolute targets without probing the host', () => {
    let probes = 0;
    const errors = validateTrackedSymlinks(
        [
            { path: 'absolute-posix', target: '/opt/csszyx' },
            { path: 'absolute-windows', target: String.raw`C:\csszyx` },
        ],
        repositoryRoot,
        () => {
            probes += 1;
            return true;
        },
    );

    assert.equal(probes, 0);
    assert.deepEqual(errors, [
        'Tracked symlink "absolute-posix" uses an absolute target: "/opt/csszyx".',
        String.raw`Tracked symlink "absolute-windows" uses an absolute target: "C:\\csszyx".`,
    ]);
});

test('reads intact and broken symlinks from the Git index', t => {
    const temporaryRepository = mkdtempSync(path.join(os.tmpdir(), 'csszyx-symlink-'));
    t.after(() => rmSync(temporaryRepository, { recursive: true, force: true }));

    execFileSync('git', ['init', '--quiet'], { cwd: temporaryRepository });
    mkdirSync(path.join(temporaryRepository, 'links'));
    writeFileSync(path.join(temporaryRepository, 'target.txt'), 'tracked target\n');
    symlinkSync('../target.txt', path.join(temporaryRepository, 'links', 'intact link'));
    symlinkSync('../missing.txt', path.join(temporaryRepository, 'links', 'broken link'));
    execFileSync('git', ['add', '.'], { cwd: temporaryRepository });

    assert.deepEqual(readTrackedSymlinks(temporaryRepository), [
        { path: 'links/broken link', target: '../missing.txt' },
        { path: 'links/intact link', target: '../target.txt' },
    ]);
});
