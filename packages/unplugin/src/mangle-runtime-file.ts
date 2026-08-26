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
 * Where the two part ways is how the module is reached. Theme groups are
 * imported by the modules that use `szcn`; the mangle map is registered as a
 * GLOBAL webpack entry instead, because this lane has no HTML entry to fall
 * back on and a per-module import reaches only what the plugin transforms —
 * not a `require()` call, a dynamic import, or a pre-compiled package under
 * `node_modules`.
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

/** The generated module's path, relative to the project root. */
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
    // A write, then a rename. Next compiles the server and the client in
    // parallel — in separate processes when the build worker is on — over one
    // project directory, so a plain write would truncate the file while the
    // other compiler is reading it and hand that side an empty module. The
    // rename is atomic within a directory, and the process id keeps the two
    // temporaries apart.
    const staging = `${target}.${process.pid}.tmp`;
    try {
        fs.mkdirSync(outputDir, { recursive: true });
        fs.writeFileSync(
            staging,
            createMangleRuntimeModule(globalVarAliasPrefix, exposeDebugGlobal),
            'utf8',
        );
        fs.renameSync(staging, target);
        return target;
    } catch {
        // A failed rename leaves the staging file behind; a failed write may
        // too. Neither is worth failing a build over, but neither belongs in
        // the project either.
        try {
            fs.rmSync(staging, { force: true });
        } catch {
            // Nothing further to try.
        }
        // A read-only or unwritable output directory must not fail the build.
        // Without the file the runtime helpers fall back to original class
        // names — the same behaviour as a build with mangling off — which is
        // visible in the page rather than silently wrong at the byte level.
        return null;
    }
}

/** The part of a webpack compiler this module needs. */
export interface MangleEntryCompiler {
    /** webpack's own exports, so the plugin class comes from the build's copy. */
    webpack?: {
        EntryPlugin?: new (
            context: string,
            entry: string,
            options: { name: undefined },
        ) => { apply(compiler: unknown): void };
    };
}

/**
 * Prepend the registration module to every entrypoint of a webpack build.
 *
 * The plugin class is read off the compiler rather than imported: this
 * package declares webpack optional, and a second copy would not share
 * classes with the one running the build. A compiler that does not carry
 * one — anything webpack-shaped that is not webpack 5 — gets no entry rather
 * than a crash, which leaves the build with unmangled runtime class names
 * and the same degraded behaviour as an unwritable output directory.
 *
 * @param compiler - The compiler the plugin is applying to.
 * @param context - Directory the entry specifier resolves from.
 * @param file - Path returned by {@link ensureMangleRuntimeFile}.
 * @returns True when the entry was registered.
 */
export function applyMangleRuntimeEntry(
    compiler: MangleEntryCompiler,
    context: string,
    file: string,
): boolean {
    const EntryPlugin = compiler.webpack?.EntryPlugin;
    if (EntryPlugin === undefined) {
        return false;
    }
    // `name: undefined` is what makes it GLOBAL — prepended to every
    // entrypoint instead of becoming one of its own.
    new EntryPlugin(context, file, { name: undefined }).apply(compiler);
    return true;
}
