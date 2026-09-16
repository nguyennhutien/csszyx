/**
 * The stylesheet walk skips directories that hold build output, not sources.
 *
 * The walk feeds the Tailwind prefix check, which stops the build when two
 * entries disagree. A Rust `target/`, a coverage report or a built Storybook
 * carries a copy of the app's stylesheet from some earlier build, possibly with
 * an older prefix, and none of them is a stylesheet the app loads.
 */
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join, relative } from 'node:path';

import { afterEach, describe, expect, it } from 'vitest';

import { discoverProjectTheme } from '../src/theme-discovery.js';

const roots: string[] = [];

afterEach(() => {
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
});
