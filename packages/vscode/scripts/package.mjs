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

import { rmSync, mkdtempSync, cpSync, readdirSync, readFileSync, writeFileSync } from 'node:fs';
import { execFileSync } from 'node:child_process';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

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
const stagedPkgPath = path.join(outDir, 'package.json');
const stagedPkg = JSON.parse(readFileSync(stagedPkgPath, 'utf8'));
stagedPkg.name = 'csszyx';
delete stagedPkg.private;
writeFileSync(stagedPkgPath, `${JSON.stringify(stagedPkg, null, 4)}\n`);

const args = process.argv.slice(2);
const publishIdx = args.indexOf('--publish');
const isPublish = publishIdx !== -1;
const forwardArgs = isPublish ? args.filter((_, i) => i !== publishIdx) : args;

const subcommand = isPublish ? 'publish' : 'package';
// execFileSync with an argv array does not invoke a shell, which keeps
// any future --publish-passthrough args from being reinterpreted as
// shell metacharacters even when sourced from process.argv.
const cmdArgs = ['@vscode/vsce', subcommand, '--no-dependencies', ...forwardArgs];

try {
    execFileSync('npx', cmdArgs, { cwd: outDir, stdio: 'inherit' });
    if (!isPublish) {
        const { version } = JSON.parse(readFileSync(path.join(pkgDir, 'package.json'), 'utf8'));
        const vsixName = readdirSync(outDir).find(f => f.endsWith('.vsix')) ?? `csszyx-${version}.vsix`;
        cpSync(path.join(outDir, vsixName), path.join(pkgDir, vsixName));
        console.log(`\nVSIX copied to: packages/vscode/${vsixName}`);
    }
} finally {
    rmSync(outDir, { recursive: true, force: true });
}
