import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { test } from 'node:test';
import { fileURLToPath } from 'node:url';

import { ESLint } from 'eslint';
import ts from 'typescript';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');

function runNode(script) {
    return spawnSync(process.execPath, [script, '--version'], {
        cwd: root,
        encoding: 'utf8',
    });
}

test('ESLint 10 loads the flat config and JSDoc 63 rules', async () => {
    const eslint = new ESLint({ cwd: root });
    const [result] = await eslint.lintText('function undocumented(): void {}\n', {
        filePath: path.join(root, 'packages/runtime/src/index.ts'),
    });

    assert.ok(result);
    assert.ok(
        result.messages.some(message => message.ruleId === 'jsdoc/require-jsdoc'),
        JSON.stringify(result.messages),
    );
});

test('TypeScript 7 owns the project compiler CLI', () => {
    const result = runNode('node_modules/@typescript/native/lib/tsc.js');

    assert.equal(result.status, 0, result.stderr);
    assert.match(result.stdout, /^Version 7\./);
});

test('TypeScript 6 remains available for programmatic API consumers', () => {
    assert.match(ts.version, /^6\./);
    const source = ts.createSourceFile(
        'fixture.ts',
        'export const answer: number = 42;',
        ts.ScriptTarget.Latest,
    );

    assert.equal(source.statements.length, 1);
});

test('docs tooling pins the programmatic TypeScript 6 API', () => {
    const docsPackage = JSON.parse(readFileSync(path.join(root, 'apps/docs/package.json'), 'utf8'));

    assert.match(docsPackage.devDependencies.typescript, /^\^6\./);
});

test('pnpm 11 pins stay synchronized and workspace config uses the v11 location', () => {
    const packageJson = JSON.parse(readFileSync(path.join(root, 'package.json'), 'utf8'));
    const mise = readFileSync(path.join(root, '.mise.toml'), 'utf8');
    const workspace = readFileSync(path.join(root, 'pnpm-workspace.yaml'), 'utf8');
    const packageManagerVersion = packageJson.packageManager.match(/^pnpm@(\d+\.\d+\.\d+)$/)?.[1];

    assert.equal(packageManagerVersion, '11.13.0');
    assert.match(packageJson.engines.pnpm, /^>=11\./);
    assert.match(mise, new RegExp(`^pnpm = "${packageManagerVersion}"$`, 'm'));
    assert.equal(packageJson.pnpm, undefined);
    assert.match(workspace, /^overrides:/m);
    assert.match(workspace, /^supportedArchitectures:/m);
    assert.match(workspace, /^strictDepBuilds: false$/m);
    // allowBuilds records an explicit review decision per build-script dependency.
    // Every known package is denied (`false`) — same deny-all posture as the empty
    // map, but pnpm 11 stops rewriting the file into a "set this to true or false"
    // placeholder on every install once each entry is an explicit decision.
    assert.match(workspace, /^allowBuilds:$/m);
    assert.doesNotMatch(workspace, /set this to true or false/);
    assert.match(workspace, /^ {2}'esbuild': false$/m);
    assert.match(workspace, /^ {2}'lefthook': false$/m);
    // Behavior settings pnpm 11 no longer reads from .npmrc must live here.
    assert.match(workspace, /^shamefullyHoist: true$/m);
    assert.match(workspace, /^strictPeerDependencies: false$/m);
    assert.match(workspace, /^autoInstallPeers: true$/m);
    assert.match(workspace, /^verifyDepsBeforeRun: false$/m);
    assert.match(workspace, /^managePackageManagerVersions: false$/m);
    // .npmrc must not keep the moved pnpm keys (pnpm 11 reads only auth/registry there).
    const npmrc = readFileSync(path.join(root, '.npmrc'), 'utf8');
    assert.doesNotMatch(npmrc, /^shamefully-hoist/m);
});

test('node version pins stay synchronized and clear the pnpm 11 floor', () => {
    const mise = readFileSync(path.join(root, '.mise.toml'), 'utf8');
    const toolVersions = readFileSync(path.join(root, '.tool-versions'), 'utf8');

    // .mise.toml is the single source of truth for the node version. .tool-versions
    // exists only because Cloudflare Pages' asdf build image reads it (it does not
    // read .mise.toml), so the two must agree — a drift here silently broke the CF
    // docs deploy once (.tool-versions lagged at 22.12.0 while .mise.toml was
    // 22.22.1). This guard fails fast instead of surfacing at deploy time.
    const miseNode = mise.match(/^node = "(\d+)\.(\d+)\.(\d+)"$/m);
    const toolNode = toolVersions.match(/^nodejs (\d+)\.(\d+)\.(\d+)$/m);
    assert.ok(miseNode, '.mise.toml must pin an exact node version');
    assert.ok(toolNode, '.tool-versions must pin an exact nodejs version');
    assert.equal(
        toolNode[0].replace('nodejs ', ''),
        `${miseNode[1]}.${miseNode[2]}.${miseNode[3]}`,
    );

    // pnpm 11.13.0 requires Node >= 22.13; anything below that cannot activate it
    // via corepack (the exact CF Pages failure). Guard the floor explicitly.
    const [major, minor] = [Number(miseNode[1]), Number(miseNode[2])];
    assert.ok(
        major > 22 || (major === 22 && minor >= 13),
        `node ${miseNode[0]} is below the pnpm 11 floor (>= 22.13)`,
    );
});
