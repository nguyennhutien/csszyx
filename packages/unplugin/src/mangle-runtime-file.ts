/**
 * Runtime mangle-map registration as a real file on disk.
 *
 * Vite and rollup take the registration through the
 * `virtual:csszyx/mangle-runtime` module the plugin resolves. Webpack cannot:
 * it reads the colon in `virtual:` as a URI scheme and fails the build with an
 * UnhandledSchemeError before any resolve plugin runs. That lane therefore
 * used to deliver the map through an executable inline `<script>` in the root
 * layout — the one csszyx-owned inline script that a strict
 * Content-Security-Policy still refused after every other lane went clean.
 *
 * The theme-groups registration already answered the same constraint the same
 * way (see `theme-groups-file.ts`): write a REAL module next to the other
 * generated csszyx files and hand back its path. The map data stays as
 * placeholders, exactly as in the virtual module, because the map is not final
 * until the mangle passes have run over the emitted assets — webpack's
 * `processAssets` substitutes them there.
 *
 * The path is stable for a given project, so it stays out of any loader's
 * cache identity: only the file's contents change between builds.
 *
 * @module
 */
import fs from 'node:fs';
import path from 'node:path';

import { createMangleRuntimeModule } from './virtual-modules.js';

/** File name inside the project's generated-output directory. */
const MANGLE_RUNTIME_FILE = 'mangle-runtime.mjs';

/**
 * Substring that identifies an already-injected file import.
 *
 * Re-entrant transforms must not stack a second registration, and the
 * specifier is relative so it cannot be matched by a fixed string.
 */
export const MANGLE_RUNTIME_FILE_MARKER: string = `.csszyx/${MANGLE_RUNTIME_FILE}`;

/**
 * Write the registration module, returning the path to import.
 *
 * @param outputDir - Directory generated csszyx files live in.
 * @param globalVarAliasPrefix - Prefix marking global CSS variable aliases.
 * @param exposeDebugGlobal - Whether the registry is also assigned to `window.__csszyx`.
 * @returns Absolute path to the module, or null when it could not be written.
 */
export function ensureMangleRuntimeFile(
    outputDir: string,
    globalVarAliasPrefix: string,
    exposeDebugGlobal: boolean,
): string | null {
    const target = path.join(outputDir, MANGLE_RUNTIME_FILE);
    try {
        fs.mkdirSync(outputDir, { recursive: true });
        fs.writeFileSync(
            target,
            createMangleRuntimeModule(globalVarAliasPrefix, exposeDebugGlobal),
            'utf8',
        );
        return target;
    } catch {
        // A read-only or unwritable output directory must not fail the build.
        // Without the file the runtime helpers fall back to original class
        // names — the same behaviour as a build with mangling off — which is
        // visible in the page rather than silently wrong at the byte level.
        return null;
    }
}

/**
 * Build the import specifier one module uses to reach the registration.
 *
 * Relative rather than absolute: a bundler resolves a relative specifier the
 * same way on every platform, while an absolute POSIX path is a Windows
 * hazard.
 *
 * @param fromFile - Module being transformed.
 * @param mangleRuntimeFile - Path returned by {@link ensureMangleRuntimeFile}.
 * @returns A specifier that resolves from `fromFile`.
 */
export function mangleRuntimeSpecifier(fromFile: string, mangleRuntimeFile: string): string {
    const relative = path.relative(path.dirname(fromFile), mangleRuntimeFile).replaceAll('\\', '/');
    // `startsWith('.')` is NOT the test: the generated file lives in a DOT
    // directory, so a sibling import reads `.csszyx/mangle-runtime.mjs`, which
    // a bundler resolves as a package name rather than a path.
    return relative.startsWith('./') || relative.startsWith('../') ? relative : `./${relative}`;
}
