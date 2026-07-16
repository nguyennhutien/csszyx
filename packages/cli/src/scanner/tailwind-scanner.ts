/**
 * Tailwind CSS configuration scanner.
 *
 * Scans and resolves tailwind.config.js to extract theme values
 * for TypeScript type generation.
 *
 * @module scanner/tailwind-scanner
 */

import { existsSync } from 'node:fs';
import { resolve } from 'node:path';
import { pathToFileURL } from 'node:url';

// `tailwindcss` is pinned to v3 in this package's package.json (`^3.4.1`)
// on purpose — these two imports are v3-only API:
//   - `Config` type
//   - `tailwindcss/resolveConfig.js` entry
// Tailwind v4 dropped JS config (`tailwind.config.{ts,js,cjs,mjs}`) in
// favour of CSS-first `@theme {…}` blocks, and the `resolveConfig` helper
// no longer exists. This scanner exists specifically to read v3-style
// configs from existing user projects during `csszyx migrate`, so the v3
// dep is the contract — do NOT bump to v4 without rewriting the scanner.
// New v4 projects bootstrap through `csszyx init`, which writes
// `@import "tailwindcss"` and never touches this scanner.
import { sortStrings } from '@csszyx/compiler';
import type { Config } from 'tailwindcss';
import resolveConfig from 'tailwindcss/resolveConfig.js';

/**
 * Resolved Tailwind theme structure.
 */
export interface ResolvedTheme {
    colors: Record<string, string | Record<string, string>>;
    spacing: Record<string, string>;
    screens: Record<string, string>;
    fontFamily: Record<string, string[]>;
    fontSize: Record<string, string | [string, Record<string, string>]>;
    fontWeight: Record<string, string>;
    borderRadius: Record<string, string>;
    boxShadow: Record<string, string>;
    opacity: Record<string, string>;
    zIndex: Record<string, string>;
    // Add more as needed
    [key: string]: unknown;
}

/**
 * Scanner result containing resolved theme and metadata.
 */
export interface ScanResult {
    theme: ResolvedTheme;
    configPath: string;
    hasCustomColors: boolean;
    hasCustomSpacing: boolean;
}

/**
 * Supported config file names in order of priority.
 */
const CONFIG_FILES = [
    'tailwind.config.ts',
    'tailwind.config.js',
    'tailwind.config.cjs',
    'tailwind.config.mjs',
];

/**
 * Find the Tailwind config file in the given directory.
 *
 * @param {string} cwd - Current working directory
 * @returns {string | null} Path to config file or null if not found
 */
export function findConfigFile(cwd: string): string | null {
    for (const fileName of CONFIG_FILES) {
        const configPath = resolve(cwd, fileName);
        if (existsSync(configPath)) {
            return configPath;
        }
    }
    return null;
}

/**
 * Load and resolve Tailwind configuration.
 *
 * @param {string} configPath - Path to tailwind.config.js/ts
 * @returns {Promise<ScanResult>} Resolved theme and metadata
 *
 * @example
 * ```typescript
 * const result = await scanTailwindConfig('./tailwind.config.js');
 * console.log(result.theme.colors);
 * ```
 */
export async function scanTailwindConfig(configPath: string): Promise<ScanResult> {
    // Convert to absolute path
    const absolutePath = resolve(configPath);

    if (!existsSync(absolutePath)) {
        throw new Error(`Tailwind config not found: ${absolutePath}`);
    }

    // For TypeScript configs, we need to use tsx or esbuild-register
    // For now, we'll use dynamic import which works for ESM configs
    let userConfig: Config;

    try {
        // Use file URL for cross-platform compatibility
        const fileUrl = pathToFileURL(absolutePath).href;
        const module = await import(fileUrl);
        userConfig = module.default || module;
    } catch (error) {
        throw new Error(
            `Failed to load Tailwind config: ${error instanceof Error ? error.message : String(error)}`,
        );
    }

    // Resolve the full config with Tailwind's defaults
    const resolvedConfig = resolveConfig(userConfig);
    const theme = resolvedConfig.theme as unknown as ResolvedTheme;

    // Check for customizations
    const hasCustomColors = Boolean(userConfig.theme?.colors || userConfig.theme?.extend?.colors);
    const hasCustomSpacing = Boolean(
        userConfig.theme?.spacing || userConfig.theme?.extend?.spacing,
    );

    return {
        theme,
        configPath: absolutePath,
        hasCustomColors,
        hasCustomSpacing,
    };
}

/**
 * Extract flat color names from nested color object.
 *
 * @param {Record<string, unknown>} colors - Tailwind colors object
 * @returns {string[]} Flat array of color class names (e.g., 'red-500', 'blue-100')
 *
 * @example
 * ```typescript
 * const colors = { red: { 500: '#f00', 600: '#c00' }, white: '#fff' };
 * flattenColors(colors); // ['red-500', 'red-600', 'white']
 * ```
 */
export function flattenColors(colors: Record<string, string | Record<string, string>>): string[] {
    const result: string[] = [];

    for (const [key, value] of Object.entries(colors)) {
        // Skip special keys
        if (key === 'inherit' || key === 'current' || key === 'transparent') {
            result.push(key);
            continue;
        }

        if (typeof value === 'string') {
            // Simple color: { white: '#fff' }
            result.push(key);
        } else if (typeof value === 'object' && value !== null) {
            // Nested color: { red: { 500: '#f00' } }
            for (const shade of Object.keys(value)) {
                // Handle DEFAULT key
                if (shade === 'DEFAULT') {
                    result.push(key);
                } else {
                    result.push(`${key}-${shade}`);
                }
            }
        }
    }

    return sortStrings(result);
}

/**
 * Extract spacing values as strings.
 *
 * @param {Record<string, string>} spacing - Tailwind spacing object
 * @returns {string[]} Array of spacing keys (e.g., '0', '1', '2', 'px')
 */
export function extractSpacingKeys(spacing: Record<string, string>): string[] {
    return Object.keys(spacing).sort((a, b) => {
        // Sort numbers first, then strings
        const aNum = Number.parseFloat(a);
        const bNum = Number.parseFloat(b);

        if (!Number.isNaN(aNum) && !Number.isNaN(bNum)) {
            return aNum - bNum;
        }
        if (!Number.isNaN(aNum)) {
            return -1;
        }
        if (!Number.isNaN(bNum)) {
            return 1;
        }
        return a.localeCompare(b);
    });
}

/**
 * Extract screen breakpoint names.
 *
 * @param {Record<string, string>} screens - Tailwind screens object
 * @returns {string[]} Array of screen names (e.g., 'sm', 'md', 'lg')
 */
export function extractScreenKeys(screens: Record<string, string>): string[] {
    return Object.keys(screens);
}
