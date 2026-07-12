#!/usr/bin/env node
// Package (or publish) the VS Code extension into a VSIX.
//
// Naming dance: the Marketplace extension ID must be `csszyx.csszyx`
// (publisher.name), but a workspace package named `csszyx` clashes with the
// umbrella npm package at `packages/csszyx` (turbo refuses duplicate names).
// So this package is named `@csszyx/vscode` in its checked-in package.json
// and rewritten to `csszyx` in the staged copy below.
//
// vsce also walks UP the directory tree looking for pnpm-workspace.yaml, so
// placing the staging dir inside the repo (even inside a gitignored folder)
// still triggers workspace detection. Stage under os.tmpdir() so vsce sees a
// lone package with no workspace ancestor. After packaging we copy the .vsix
// back into the repo so the user has it in a predictable path.
//
// Usage:
//   node scripts/package.mjs              # build VSIX at packages/vscode/csszyx-<v>.vsix
//   node scripts/package.mjs --publish    # publish to Marketplace (requires `vsce login` first)
//   node scripts/package.mjs --publish patch   # bump + publish

import {
    rmSync,
    mkdirSync,
    mkdtempSync,
    cpSync,
    existsSync,
    readdirSync,
    readFileSync,
    writeFileSync,
} from 'node:fs';
import { execFileSync } from 'node:child_process';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import { resolveVsceArguments } from './package-utils.mjs';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const pkgDir = path.resolve(__dirname, '..');
// mkdtempSync atomically creates a unique directory with random suffix,
// which avoids the predictable-path race that a static name would have
// when another process targets the same tmpdir entry.
const outDir = mkdtempSync(path.join(os.tmpdir(), 'csszyx-vsce-'));

const SHIP_FILES = [
    'dist',
    'syntaxes',
    'package.json',
    '.vscodeignore',
    'README.md',
    'LICENSE',
    'icon.png',
];

for (const item of SHIP_FILES) {
    cpSync(path.join(pkgDir, item), path.join(outDir, item), { recursive: true });
}

// Rewrite the staged package.json for vsce:
//   - name: `@csszyx/vscode` → `csszyx` (Marketplace ID `csszyx.csszyx`)
//   - drop `private: true` (an npm-registry guard we set in the checked-in
//     file so `changeset publish` can't accidentally push the extension to
//     npm; vsce itself doesn't care, but stripping it keeps the staged
//     manifest minimal and unambiguous).
// Only touches the temp copy under os.tmpdir(); the checked-in package.json
// stays on `@csszyx/vscode` + `private: true`.
// Ship @csszyx/ts-plugin inside the extension so the `typescriptServerPlugins`
// contribution resolves it by name from the extension's own node_modules. vsce
// only packs a node_modules folder when the package is a *production*
// dependency AND `.vscodeignore` un-ignores its path — the plugin is that lone
// runtime dependency; every other dependency is bundled into dist/extension.js.
// The `vsix` script builds the plugin first, so its bundle must exist here.
// `dist/plugin.js` is the self-contained esbuild bundle (package.json `main`);
// tsc's per-file `dist/index.js` is for the plugin's own tests, not for shipping.
const pluginBundle = path.resolve(pkgDir, '../ts-plugin/dist/plugin.js');
if (!existsSync(pluginBundle)) {
    throw new Error(
        'ts-plugin bundle missing: run `pnpm --filter @csszyx/ts-plugin build` before packaging.',
    );
}
const pluginManifest = JSON.parse(
    readFileSync(path.resolve(pkgDir, '../ts-plugin/package.json'), 'utf8'),
);

const stagedPkgPath = path.join(outDir, 'package.json');
const stagedPkg = JSON.parse(readFileSync(stagedPkgPath, 'utf8'));
stagedPkg.name = 'csszyx';
delete stagedPkg.private;
// devDependencies are build-time only and carry `workspace:*` specifiers that
// vsce's production-dependency walk cannot resolve; the runtime bundle needs
// none of them. Declare the plugin as the sole production dependency instead.
delete stagedPkg.devDependencies;
stagedPkg.dependencies = { '@csszyx/ts-plugin': pluginManifest.version };
writeFileSync(stagedPkgPath, `${JSON.stringify(stagedPkg, null, 4)}\n`);

// A minimal manifest (no `workspace:*` devDeps) beside the self-contained bundle.
const stagedPluginDir = path.join(outDir, 'node_modules/@csszyx/ts-plugin');
mkdirSync(path.join(stagedPluginDir, 'dist'), { recursive: true });
writeFileSync(
    path.join(stagedPluginDir, 'package.json'),
    `${JSON.stringify({ name: pluginManifest.name, version: pluginManifest.version, main: 'dist/index.js' }, null, 2)}\n`,
);
cpSync(pluginBundle, path.join(stagedPluginDir, 'dist/index.js'));

const { isPublish, commandArgs } = resolveVsceArguments(process.argv.slice(2));

// Publish with a Microsoft Entra ID token (from the CI azure/login session)
// instead of a PAT when VSCE_AZURE_CREDENTIAL is set. vsce reads the token via
// its Azure identity chain; nothing else about packaging changes.
if (isPublish && process.env.VSCE_AZURE_CREDENTIAL === 'true') {
    commandArgs.push('--azure-credential');
}

try {
    execFileSync('npx', commandArgs, { cwd: outDir, stdio: 'inherit' });
    if (!isPublish) {
        const { version } = JSON.parse(readFileSync(path.join(pkgDir, 'package.json'), 'utf8'));
        const vsixName = readdirSync(outDir).find(f => f.endsWith('.vsix')) ?? `csszyx-${version}.vsix`;
        cpSync(path.join(outDir, vsixName), path.join(pkgDir, vsixName));
        console.log(`\nVSIX copied to: packages/vscode/${vsixName}`);
    }
} finally {
    rmSync(outDir, { recursive: true, force: true });
}
