/**
 * Framework detection utilities.
 */

import path from 'node:path';

import fs from 'fs-extra';

/**
 *
 */
export type Framework =
    | 'vite-react'
    | 'vite-vue'
    | 'vite-svelte'
    | 'nextjs-app'
    | 'nextjs-pages'
    | 'nuxt'
    | 'sveltekit'
    | 'astro'
    | 'unknown';

/**
 *
 */
export type PackageManager = 'pnpm' | 'npm' | 'yarn' | 'bun';

/**
 *
 */
export interface ProjectInfo {
    framework: Framework;
    packageManager: PackageManager;
    hasTailwind: boolean;
    hasTypeScript: boolean;
    rootDir: string;
}

/**
 * Detect the framework used in the project.
 * @param cwd - Current working directory path
 * @returns The detected framework identifier
 */
export function detectFramework(cwd: string): Framework {
    try {
        const pkgPath = path.join(cwd, 'package.json');
        if (!fs.existsSync(pkgPath)) {
            return 'unknown';
        }

        const pkg = fs.readJSONSync(pkgPath);
        const deps = { ...pkg.dependencies, ...pkg.devDependencies };

        // Next.js detection
        if (deps.next) {
            // Check for app directory
            const hasAppDir = fs.existsSync(path.join(cwd, 'app'));
            return hasAppDir ? 'nextjs-app' : 'nextjs-pages';
        }

        // Nuxt detection
        if (deps.nuxt) {
            return 'nuxt';
        }

        // SvelteKit detection
        if (deps['@sveltejs/kit']) {
            return 'sveltekit';
        }

        // Astro detection
        if (deps.astro) {
            return 'astro';
        }

        // Vite detection
        if (deps.vite) {
            if (deps.react || deps['react-dom']) {
                return 'vite-react';
            }
            if (deps.vue) {
                return 'vite-vue';
            }
            if (deps.svelte) {
                return 'vite-svelte';
            }
        }

        return 'unknown';
    } catch {
        return 'unknown';
    }
}

/**
 * Detect package manager.
 * @param cwd - Current working directory path
 * @returns The detected package manager name
 */
export function detectPackageManager(cwd: string): PackageManager {
    if (fs.existsSync(path.join(cwd, 'pnpm-lock.yaml'))) {
        return 'pnpm';
    }
    if (fs.existsSync(path.join(cwd, 'yarn.lock'))) {
        return 'yarn';
    }
    if (fs.existsSync(path.join(cwd, 'bun.lockb'))) {
        return 'bun';
    }
    return 'npm';
}

/**
 * Check if Tailwind CSS is installed.
 * @param cwd - Current working directory path
 * @returns True if Tailwind CSS is found in the project dependencies
 */
export function hasTailwindInstalled(cwd: string): boolean {
    try {
        const pkgPath = path.join(cwd, 'package.json');
        if (!fs.existsSync(pkgPath)) {
            return false;
        }

        const pkg = fs.readJSONSync(pkgPath);
        const deps = { ...pkg.dependencies, ...pkg.devDependencies };

        return !!deps.tailwindcss;
    } catch {
        return false;
    }
}

/**
 * Check if TypeScript is configured.
 * @param cwd - Current working directory path
 * @returns True if a tsconfig.json or jsconfig.json file is present
 */
export function hasTypeScript(cwd: string): boolean {
    return (
        fs.existsSync(path.join(cwd, 'tsconfig.json')) ||
        fs.existsSync(path.join(cwd, 'jsconfig.json'))
    );
}

/**
 * Get complete project information.
 * @param cwd - Current working directory path
 * @returns A ProjectInfo object containing framework, package manager, and configuration details
 */
export function getProjectInfo(cwd: string = process.cwd()): ProjectInfo {
    return {
        framework: detectFramework(cwd),
        packageManager: detectPackageManager(cwd),
        hasTailwind: hasTailwindInstalled(cwd),
        hasTypeScript: hasTypeScript(cwd),
        rootDir: cwd,
    };
}

/**
 * Get framework display name.
 * @param framework - Detected framework name
 * @returns The human-readable display name for the given framework
 */
export function getFrameworkName(framework: Framework): string {
    const names: Record<Framework, string> = {
        'vite-react': 'Vite + React',
        'vite-vue': 'Vite + Vue',
        'vite-svelte': 'Vite + Svelte',
        'nextjs-app': 'Next.js (App Router)',
        'nextjs-pages': 'Next.js (Pages Router)',
        nuxt: 'Nuxt 3',
        sveltekit: 'SvelteKit',
        astro: 'Astro',
        unknown: 'Unknown',
    };

    return names[framework];
}
