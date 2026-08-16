/**
 * Guard for the `@napi-rs/cli` pin in `packages/core/package.json`.
 *
 * 3.8.0 added a filesystem-transaction layer that makes every native build
 * abort on a Docker Desktop bind mount, and the smoke script deletes the addon
 * in a `finally`, so one failed build leaves the tree with no native engine.
 * CI runners use ordinary filesystems and stay green, so nothing else in the
 * pipeline objects when a bump proposes 3.8.x again. This test is that
 * objection. Full reasoning: `packages/core/scripts/build-native.mjs`.
 */
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import test from 'node:test';

const MANIFEST = path.resolve(import.meta.dirname, '../packages/core/package.json');
const pinned = JSON.parse(readFileSync(MANIFEST, 'utf8')).devDependencies['@napi-rs/cli'];

const WHY = [
    'Every native build then aborts with "Filesystem transaction replacement',
    'changed while it was prepared" on a Docker Desktop bind mount, and the',
    'smoke script deletes the addon in a finally, so one failed build leaves no',
    'native engine and no way to rebuild it. CI CANNOT DETECT THIS -- runners',
    'use ordinary filesystems and go green, so a green Dependabot PR is not',
    'evidence. Measured 2026-08-16 by running each version: 3.7.4 ok, 3.8.0',
    'fail, 3.8.1 fail, 3.8.2 fail, 3.8.6 fail. No CLI flag or env var disables',
    'the layer; upstream napi-rs#3444 is open and unanswered. Before raising',
    'the pin, re-bisect and actually run a native build on each candidate.',
    'Full reasoning: packages/core/scripts/build-native.mjs.',
].join('\n');

test('@napi-rs/cli is pinned to an exact version', () => {
    assert.match(
        pinned,
        /^\d+\.\d+\.\d+$/,
        `@napi-rs/cli must be an exact pin, got "${pinned}". A range lets 3.8.x back in silently.\n${WHY}`,
    );
});

test('@napi-rs/cli is pinned below the broken 3.8.0 line', () => {
    const [major, minor] = pinned.replace(/^\D+/, '').split('.').map(Number);
    assert.ok(
        major < 3 || (major === 3 && minor < 8),
        `@napi-rs/cli is pinned to "${pinned}", which is in the broken 3.8.x line.\n${WHY}`,
    );
});
