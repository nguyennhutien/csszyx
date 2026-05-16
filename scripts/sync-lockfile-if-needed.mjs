#!/usr/bin/env node
import { execFileSync } from 'node:child_process';

const dependencyKeys = [
    'dependencies',
    'devDependencies',
    'peerDependencies',
    'optionalDependencies',
];

const stagedFiles = execFileSync('git', ['diff', '--cached', '--name-only', '--diff-filter=ACMR'], {
    encoding: 'utf8',
})
    .split('\n')
    .filter(file => file.endsWith('package.json'));

if (!stagedFiles.some(hasDependencyFieldChange)) {
    process.exit(0);
}

try {
    execFileSync('pnpm', ['install', '--frozen-lockfile', '--silent'], { stdio: 'inherit' });
} catch {
    console.log('Lockfile out of sync - auto-updating...');
    execFileSync('pnpm', ['install', '--lockfile-only'], { stdio: 'inherit' });
    execFileSync('git', ['add', 'pnpm-lock.yaml'], { stdio: 'inherit' });
}

function hasDependencyFieldChange(file) {
    try {
        const staged = readStagedJson(file);
        const head = readHeadJson(file);

        return dependencyKeys.some(
            key => JSON.stringify(staged[key]) !== JSON.stringify(head[key]),
        );
    } catch {
        return false;
    }
}

function readStagedJson(file) {
    return JSON.parse(execFileSync('git', ['show', `:${file}`], { encoding: 'utf8' }));
}

function readHeadJson(file) {
    try {
        return JSON.parse(execFileSync('git', ['show', `HEAD:${file}`], { encoding: 'utf8' }));
    } catch {
        return {};
    }
}
