/**
 * Unit tests for the framework / package-manager detection utilities.
 *
 * Each detector reads marker files from a directory, so the tests materialize a
 * throwaway temp directory per case and assert the classification.
 */
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';

import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import {
    detectFramework,
    detectPackageManager,
    getFrameworkName,
    getProjectInfo,
    hasTailwindInstalled,
    hasTypeScript,
} from '../src/utils/framework-detector.js';

let dir: string;

beforeEach(() => {
    dir = mkdtempSync(path.join(tmpdir(), 'csszyx-fd-'));
});

afterEach(() => {
    rmSync(dir, { recursive: true, force: true });
});

/**
 * Write a package.json with the given dependency map (merged into devDependencies).
 * @param deps - dependency name → version map.
 */
function writePkg(deps: Record<string, string>): void {
    writeFileSync(path.join(dir, 'package.json'), JSON.stringify({ devDependencies: deps }));
}

/**
 * Create an empty marker file (lockfile, config) in the temp dir.
 * @param name - file name to create under the temp dir.
 */
function touch(name: string): void {
    writeFileSync(path.join(dir, name), '');
}

describe('detectFramework', () => {
    it('returns unknown when there is no package.json', () => {
        expect(detectFramework(dir)).toBe('unknown');
    });

    it('returns unknown for malformed package.json', () => {
        writeFileSync(path.join(dir, 'package.json'), '{ not valid json');
        expect(detectFramework(dir)).toBe('unknown');
    });

    it('detects Next.js pages router without an app directory', () => {
        writePkg({ next: '15.0.0' });
        expect(detectFramework(dir)).toBe('nextjs-pages');
    });

    it('detects Next.js app router when an app directory exists', () => {
        writePkg({ next: '15.0.0' });
        mkdirSync(path.join(dir, 'app'));
        expect(detectFramework(dir)).toBe('nextjs-app');
    });

    it('detects Nuxt', () => {
        writePkg({ nuxt: '3.0.0' });
        expect(detectFramework(dir)).toBe('nuxt');
    });

    it('detects SvelteKit', () => {
        writePkg({ '@sveltejs/kit': '2.0.0' });
        expect(detectFramework(dir)).toBe('sveltekit');
    });

    it('detects Astro', () => {
        writePkg({ astro: '4.0.0' });
        expect(detectFramework(dir)).toBe('astro');
    });

    it('detects Vite + React', () => {
        writePkg({ vite: '6.0.0', react: '19.0.0' });
        expect(detectFramework(dir)).toBe('vite-react');
    });

    it('detects Vite + React via react-dom only', () => {
        writePkg({ vite: '6.0.0', 'react-dom': '19.0.0' });
        expect(detectFramework(dir)).toBe('vite-react');
    });

    it('detects Vite + Vue', () => {
        writePkg({ vite: '6.0.0', vue: '3.0.0' });
        expect(detectFramework(dir)).toBe('vite-vue');
    });

    it('detects Vite + Svelte', () => {
        writePkg({ vite: '6.0.0', svelte: '5.0.0' });
        expect(detectFramework(dir)).toBe('vite-svelte');
    });

    it('returns unknown for Vite without a known UI library', () => {
        writePkg({ vite: '6.0.0' });
        expect(detectFramework(dir)).toBe('unknown');
    });

    it('returns unknown for an unrecognized stack', () => {
        writePkg({ express: '4.0.0' });
        expect(detectFramework(dir)).toBe('unknown');
    });
});

describe('detectPackageManager', () => {
    it('detects pnpm', () => {
        touch('pnpm-lock.yaml');
        expect(detectPackageManager(dir)).toBe('pnpm');
    });

    it('detects yarn', () => {
        touch('yarn.lock');
        expect(detectPackageManager(dir)).toBe('yarn');
    });

    it('detects bun', () => {
        touch('bun.lockb');
        expect(detectPackageManager(dir)).toBe('bun');
    });

    it('defaults to npm when no lockfile is present', () => {
        expect(detectPackageManager(dir)).toBe('npm');
    });

    it('prefers pnpm over yarn when both lockfiles exist', () => {
        touch('pnpm-lock.yaml');
        touch('yarn.lock');
        expect(detectPackageManager(dir)).toBe('pnpm');
    });
});

describe('hasTailwindInstalled', () => {
    it('is false without a package.json', () => {
        expect(hasTailwindInstalled(dir)).toBe(false);
    });

    it('is false for malformed package.json', () => {
        writeFileSync(path.join(dir, 'package.json'), 'not json');
        expect(hasTailwindInstalled(dir)).toBe(false);
    });

    it('is true when tailwindcss is a dependency', () => {
        writePkg({ tailwindcss: '4.0.0' });
        expect(hasTailwindInstalled(dir)).toBe(true);
    });

    it('is false when tailwindcss is absent', () => {
        writePkg({ vite: '6.0.0' });
        expect(hasTailwindInstalled(dir)).toBe(false);
    });
});

describe('hasTypeScript', () => {
    it('is true with a tsconfig.json', () => {
        touch('tsconfig.json');
        expect(hasTypeScript(dir)).toBe(true);
    });

    it('is true with a jsconfig.json', () => {
        touch('jsconfig.json');
        expect(hasTypeScript(dir)).toBe(true);
    });

    it('is false with neither', () => {
        expect(hasTypeScript(dir)).toBe(false);
    });
});

describe('getProjectInfo', () => {
    it('composes every detector into one record', () => {
        writePkg({ vite: '6.0.0', vue: '3.0.0', tailwindcss: '4.0.0' });
        touch('pnpm-lock.yaml');
        touch('tsconfig.json');
        expect(getProjectInfo(dir)).toEqual({
            framework: 'vite-vue',
            packageManager: 'pnpm',
            hasTailwind: true,
            hasTypeScript: true,
            rootDir: dir,
        });
    });
});

describe('getFrameworkName', () => {
    it.each([
        ['vite-react', 'Vite + React'],
        ['vite-vue', 'Vite + Vue'],
        ['vite-svelte', 'Vite + Svelte'],
        ['nextjs-app', 'Next.js (App Router)'],
        ['nextjs-pages', 'Next.js (Pages Router)'],
        ['nuxt', 'Nuxt 3'],
        ['sveltekit', 'SvelteKit'],
        ['astro', 'Astro'],
        ['unknown', 'Unknown'],
    ] as const)('maps %s to its display name', (framework, name) => {
        expect(getFrameworkName(framework)).toBe(name);
    });
});
