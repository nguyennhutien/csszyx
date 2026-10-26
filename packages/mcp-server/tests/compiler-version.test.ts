/**
 * The server answers with the compiler it was installed with. A project on
 * another version is told so, on every reply, rather than given advice its own
 * build contradicts (vui, 0.17.2: a 0.14.1 server ran against 0.17.0 for five
 * weeks without a signal).
 */
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';

import {
    compilerInstructions,
    installedCompilerVersion,
    withCompilerVersions,
} from '../src/compiler-version.js';

const roots: string[] = [];
afterEach(() => {
    for (const root of roots.splice(0)) rmSync(root, { recursive: true, force: true });
});

/**
 * @param version - The compiler version to install, or null for none.
 * @returns A project directory, with a nested source folder.
 */
function project(version: string | null): string {
    const root = mkdtempSync(join(tmpdir(), 'csszyx-mcp-version-'));
    roots.push(root);
    mkdirSync(join(root, 'src/deep'), { recursive: true });
    if (version !== null) {
        const dir = join(root, 'node_modules/@csszyx/compiler');
        mkdirSync(dir, { recursive: true });
        writeFileSync(join(dir, 'package.json'), JSON.stringify({ version }));
    }
    return root;
}

describe('installedCompilerVersion', () => {
    it('reads the compiler the nearest node_modules holds, walking up', () => {
        const root = project('0.16.0');
        expect(installedCompilerVersion(root)).toBe('0.16.0');
        expect(installedCompilerVersion(join(root, 'src/deep'))).toBe('0.16.0');
    });

    it('answers null for a project without one', () => {
        expect(installedCompilerVersion(project(null))).toBeNull();
    });

    // The server reads this at startup, from the directory it was launched
    // in and every one above it, so a manifest it cannot read must not stop it.
    it.each([
        ['is not JSON', '{'],
        ['has no version', '{}'],
        ['names a version that is not text', '{"version":18}'],
    ])('answers null when the manifest %s', (_label, text) => {
        const root = project('0.18.0');
        writeFileSync(join(root, 'node_modules/@csszyx/compiler/package.json'), text);
        expect(installedCompilerVersion(root)).toBeNull();
    });
});

describe('withCompilerVersions', () => {
    const reply = () => ({ content: [{ type: 'text' as const, text: '{"ok":true}' }] });

    it('names both versions on every reply', () => {
        expect(withCompilerVersions(reply(), { answering: '0.18.0', project: '0.18.0' })).toEqual({
            ...reply(),
            _meta: { compilerVersion: '0.18.0', projectCompilerVersion: '0.18.0' },
        });
    });

    it('says first, in the reply the assistant reads, when the project has another', () => {
        const result = withCompilerVersions(reply(), { answering: '0.18.0', project: '0.16.0' });
        expect(result.content).toEqual([
            {
                type: 'text',
                text: 'csszyx: these answers come from @csszyx/compiler 0.18.0, and this project has 0.16.0; install @csszyx/mcp-server@0.16.0 beside it so the two agree.',
            },
            ...reply().content,
        ]);
    });

    it('adds nothing to read when the project has no compiler', () => {
        expect(
            withCompilerVersions(reply(), { answering: '0.18.0', project: null }).content,
        ).toEqual(reply().content);
    });
});

describe('compilerInstructions', () => {
    it('names the compiler that answers, or the skew, or that it is unknown', () => {
        expect(compilerInstructions({ answering: '0.18.0', project: '0.18.0' })).toBe(
            'csszyx answers come from @csszyx/compiler 0.18.0.',
        );
        expect(compilerInstructions({ answering: '0.18.0', project: '0.16.0' })).toMatch(
            /this project has 0\.16\.0/,
        );
        expect(compilerInstructions({ answering: null, project: null })).toBe(
            'csszyx answers come from @csszyx/compiler unknown.',
        );
    });
});
