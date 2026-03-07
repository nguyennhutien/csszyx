#!/usr/bin/env node
// Wraps `changeset version` and removes per-package CHANGELOG files.
// Only packages/csszyx/CHANGELOG.md is the user-facing release log.
import { execSync } from 'node:child_process';
import { rmSync, readdirSync, statSync } from 'node:fs';
import { join } from 'node:path';

execSync('pnpm changeset version', { stdio: 'inherit' });

for (const pkg of readdirSync('packages')) {
    if (pkg === 'csszyx') continue;
    const pkgPath = join('packages', pkg);
    if (!statSync(pkgPath).isDirectory()) continue;
    rmSync(join(pkgPath, 'CHANGELOG.md'), { force: true });
}

// Also clean CHANGELOG files from apps/ (internal, not published)
for (const app of readdirSync('apps')) {
    const appPath = join('apps', app);
    if (!statSync(appPath).isDirectory()) continue;
    rmSync(join(appPath, 'CHANGELOG.md'), { force: true });
}
