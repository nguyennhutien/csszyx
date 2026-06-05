import { readFileSync } from 'node:fs';

/**
 * Read a `version` string from a package.json relative to a caller's URL.
 *
 * Callers MUST pass their own `import.meta.url` as `fromUrl` because the
 * helper is bundled into a shared chunk one directory deeper than the
 * entry files; resolving `../package.json` against the helper's own URL
 * would land in the wrong directory and silently return `'0.0.0'`.
 *
 * Both the Next Turbopack loader and the prebuild core use this fallback
 * so callers (`next.config.ts`, the CLI, Vercel build scripts) can omit
 * version fields and let the actual engine that runs the transform write
 * its real identity into the generation manifest. Hardcoded version
 * strings would drift after any package bump and silently validate stale
 * state as fresh.
 *
 * @param relativePackageJson Path relative to the caller's module URL.
 * @param fromUrl The caller's `import.meta.url`.
 * @returns The package version, or `'0.0.0'` on any failure.
 */
export function readPackageVersion(relativePackageJson: string, fromUrl: string): string {
    try {
        const packageJson = JSON.parse(
            readFileSync(new URL(relativePackageJson, fromUrl), 'utf8'),
        ) as { version?: unknown };
        return typeof packageJson.version === 'string' ? packageJson.version : '0.0.0';
    } catch {
        return '0.0.0';
    }
}
