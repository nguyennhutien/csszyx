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
    assert.match(workspace, /^allowBuilds: \{\}$/m);
});
