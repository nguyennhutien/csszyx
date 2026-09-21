/**
 * The stylesheet walk skips directories that hold build output, not sources.
 *
 * The walk feeds the Tailwind prefix check, which stops the build when two
 * entries disagree. A Rust `target/`, a coverage report or a built Storybook
 * carries a copy of the app's stylesheet from some earlier build, possibly with
 * an older prefix, and none of them is a stylesheet the app loads.
 */
import fs, { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join, relative } from 'node:path';

import { afterEach, describe, expect, it, vi } from 'vitest';

import { discoverProjectTheme } from '../src/theme-discovery.js';

const roots: string[] = [];

afterEach(() => {
    vi.restoreAllMocks();
    for (const root of roots.splice(0)) rmSync(root, { recursive: true, force: true });
});

describe('discoverProjectTheme walk', () => {
    it('skips build output directories that hold stylesheet copies', () => {
        const root = mkdtempSync(join(tmpdir(), 'csszyx-walk-ignore-'));
        roots.push(root);
        for (const file of [
            'src/index.css',
            'target/debug/build/index.css',
            'coverage/lcov-report/base.css',
            'storybook-static/main.css',
        ]) {
            mkdirSync(dirname(join(root, file)), { recursive: true });
            writeFileSync(join(root, file), '@import "tailwindcss" prefix(old);\n');
        }

        const scanned = discoverProjectTheme(root).scanned.map(file => relative(root, file));

        expect(scanned).toEqual(['src/index.css']);
    });

    it('never opens a directory the patterns cover', () => {
        // The point of ignoring another app is not to pay for it: a walk that
        // reads everything and filters afterwards costs as much as no ignore.
        const root = mkdtempSync(join(tmpdir(), 'csszyx-walk-prune-'));
        roots.push(root);
        for (const file of ['src/index.css', 'legacy/a.css', 'legacy/deep/b.css']) {
            mkdirSync(dirname(join(root, file)), { recursive: true });
            writeFileSync(join(root, file), '@theme { --color-brand: #123456; }\n');
        }
        const readdir = vi.spyOn(fs, 'readdirSync');

        const found = discoverProjectTheme(root, [], ['legacy']);

        const opened = readdir.mock.calls.map(call => relative(root, String(call[0])));
        expect(found.scanned.map(file => relative(root, file))).toEqual(['src/index.css']);
        expect(opened.filter(directory => directory.startsWith('legacy'))).toEqual([]);
    });
});
