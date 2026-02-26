#!/usr/bin/env node
// Wraps `changeset version` and removes per-package CHANGELOG files.
// Only packages/csszyx/CHANGELOG.md is the user-facing release log.
import { execSync } from 'node:child_process';
import { rmSync, readdirSync } from 'node:fs';
import { join } from 'node:path';

execSync('pnpm changeset version', { stdio: 'inherit' });

for (const pkg of readdirSync('packages')) {
    if (pkg === 'csszyx') continue;
    rmSync(join('packages', pkg, 'CHANGELOG.md'), { force: true });
}
