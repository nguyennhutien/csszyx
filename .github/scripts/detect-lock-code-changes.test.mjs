import assert from 'node:assert/strict';
import { test } from 'node:test';
import {
    changedLockfilePackages,
    collectDirectDeps,
    lockChangeIsCodeRelevant,
} from './detect-lock-code-changes.mjs';

test('collectDirectDeps unions every dependency field across package.json texts', () => {
    const root = JSON.stringify({ devDependencies: { vite: '^6', typescript: '^5' } });
    const pkg = JSON.stringify({
        dependencies: { '@csszyx/compiler': 'workspace:*' },
        peerDependencies: { react: '>=17' },
        optionalDependencies: { fsevents: '^2' },
    });
    const deps = collectDirectDeps([root, pkg]);
    for (const name of ['vite', 'typescript', '@csszyx/compiler', 'react', 'fsevents']) {
        assert.ok(deps.has(name), `${name} should be a direct dep`);
    }
    assert.ok(!deps.has('undici'), 'a transitive package is not direct');
});

test('collectDirectDeps skips an unparseable package.json', () => {
    const deps = collectDirectDeps(['{ not json', JSON.stringify({ dependencies: { a: '^1' } })]);
    assert.deepEqual([...deps], ['a']);
});

test('changedLockfilePackages extracts scoped + unscoped names from changed lines only', () => {
    const diff = [
        '--- a/pnpm-lock.yaml',
        '+++ b/pnpm-lock.yaml',
        '-  undici@7.24.8:',
        '+  undici@7.28.0:',
        "-  '@types/node@20.19.40':",
        "+  '@types/node@20.19.41':",
        '   vite@6.4.3:',
    ].join('\n');
    const changed = changedLockfilePackages(diff);
    assert.ok(changed.has('undici'));
    assert.ok(changed.has('@types/node'));
    assert.ok(!changed.has('vite'), 'context (unchanged) lines are ignored');
});

test('changedLockfilePackages handles peer-suffixed snapshot keys', () => {
    const changed = changedLockfilePackages('+  vite@6.4.3(@types/node@20.19.41):');
    assert.ok(changed.has('vite'));
    assert.ok(changed.has('@types/node'));
});

test('lockChangeIsCodeRelevant is true only when a direct dep changed', () => {
    const direct = new Set(['vite', '@csszyx/compiler']);
    assert.equal(lockChangeIsCodeRelevant(new Set(['undici', 'form-data']), direct), false);
    assert.equal(lockChangeIsCodeRelevant(new Set(['undici', 'vite']), direct), true);
    assert.equal(lockChangeIsCodeRelevant(new Set(), direct), false);
});

test('a pure transitive bump skips; a direct-dep bump runs', () => {
    const direct = collectDirectDeps([JSON.stringify({ devDependencies: { vite: '^6' } })]);
    const transitive = changedLockfilePackages('-  undici@7.24.8:\n+  undici@7.28.0:');
    assert.equal(lockChangeIsCodeRelevant(transitive, direct), false);
    const directBump = changedLockfilePackages('-  vite@6.4.2:\n+  vite@6.4.3:');
    assert.equal(lockChangeIsCodeRelevant(directBump, direct), true);
});
