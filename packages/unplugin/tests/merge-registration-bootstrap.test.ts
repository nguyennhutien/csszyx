import { existsSync, mkdirSync, readFileSync, statSync, symlinkSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { ensureMergeRegistration, mergeRegistrationPath } from '../src/merge-registration.js';
import { createUnservedRuntimeModule } from '../src/virtual-modules.js';
import { removeTailwindProjects, tailwindProject } from './tailwind-project.js';

vi.mock('node:fs', async importOriginal => {
    const actual = await importOriginal<typeof import('node:fs')>();
    return { ...actual, existsSync: vi.fn(actual.existsSync) };
});

afterEach(() => {
    vi.mocked(existsSync).mockReset();
    removeTailwindProjects();
});

describe('merge registration bootstrap', () => {
    it('creates a missing registration despite a stale positive existence probe', () => {
        const root = tailwindProject('csszyx-bootstrap-stale-', {});
        // An existence probe can observe a file that another process removes
        // before bootstrap uses it. Creation must decide at the write itself.
        vi.mocked(existsSync).mockReturnValue(true);
        ensureMergeRegistration(root);
        const read = () => readFileSync(mergeRegistrationPath(root), 'utf8');
        expect(read).not.toThrow();
        expect(read()).toBe(createUnservedRuntimeModule([], [{}, []], 'esm'));
    });

    it.each([1, 16, 256])('leaves a settled registration untouched across %i attempts', count => {
        const root = tailwindProject('csszyx-bootstrap-existing-', {
            '.csszyx/merge-registration.mjs': 'settled by prebuild',
        });
        vi.mocked(existsSync).mockReturnValue(false);
        const target = mergeRegistrationPath(root);
        const before = statSync(target);
        for (let attempt = 0; attempt < count; attempt += 1) ensureMergeRegistration(root);
        expect(readFileSync(target, 'utf8')).toBe('settled by prebuild');
        expect(statSync(target).mtimeMs).toBe(before.mtimeMs);
        expect(statSync(target).ino).toBe(before.ino);
    });

    it('does not follow a registration symlink to overwrite its destination', () => {
        const root = tailwindProject('csszyx-bootstrap-link-', { 'other.mjs': 'keep me' });
        mkdirSync(join(root, '.csszyx'));
        symlinkSync(join(root, 'other.mjs'), mergeRegistrationPath(root));
        vi.mocked(existsSync).mockReturnValue(false);
        ensureMergeRegistration(root);
        expect(readFileSync(join(root, 'other.mjs'), 'utf8')).toBe('keep me');
    });

    it('keeps the loader usable when the cache directory cannot be created', () => {
        const root = tailwindProject('csszyx-bootstrap-blocked-', {});
        writeFileSync(join(root, '.csszyx'), 'not a directory');
        vi.mocked(existsSync).mockReturnValue(false);
        expect(() => ensureMergeRegistration(root)).not.toThrow();
        expect(readFileSync(join(root, '.csszyx'), 'utf8')).toBe('not a directory');
    });
});
