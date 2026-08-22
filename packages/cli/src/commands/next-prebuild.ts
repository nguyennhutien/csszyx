/**
 * csszyx next-prebuild - Run a one-shot Next.js Turbopack csszyx prebuild.
 *
 * Walks an explicit file list (or a glob, resolved by fast-glob), invokes the
 * @csszyx/unplugin prebuild core, and prints a summary so CI gates and Vercel
 * build scripts can call this command before `next build --turbo`. The
 * command is dev-mode safe: pass `--mode development` to seed shards without
 * gating production manifest readiness.
 */

import path from 'node:path';

import { runNextPrebuild } from '@csszyx/unplugin/next-prebuild';
import fg from 'fast-glob';
import { withPosixSeparators } from '../utils/posix-path.js';
import { colors, icons } from '../utils/terminal-ui.js';
import { DEFAULT_NEXT_SOURCE_IGNORE, DEFAULT_NEXT_SOURCE_PATTERN } from './next-patterns.js';

/** Options accepted by the `next-prebuild` CLI command. */
export interface NextPrebuildCommandOptions {
    cwd?: string;
    root?: string;
    mode?: 'development' | 'production';
    parserMode?: 'rust' | 'wasm';
    outputFile?: string;
    cacheDir?: string;
    pattern?: string;
    extraIgnore?: readonly string[];
    importedStaticSz?: boolean;
    json?: boolean;
}

/**
 * Run the Next.js Turbopack csszyx prebuild from CLI arguments.
 *
 * @param options Parsed command-line options.
 * @returns Exit code (0 on success, 1 on failure).
 */
export async function nextPrebuild(options: NextPrebuildCommandOptions = {}): Promise<number> {
    const cwd = path.resolve(options.cwd ?? process.cwd());
    const root = path.resolve(options.root ?? cwd);
    const pattern = withPosixSeparators(options.pattern ?? DEFAULT_NEXT_SOURCE_PATTERN);

    try {
        const mode = normalizeMode(options.mode);
        const parserMode = normalizeParserMode(options.parserMode);
        const matches = await fg(pattern, {
            cwd: root,
            absolute: true,
            ignore: [...DEFAULT_NEXT_SOURCE_IGNORE, ...(options.extraIgnore ?? [])],
            dot: false,
            onlyFiles: true,
        });

        if (matches.length === 0) {
            reportNoFilesMatched(options.json, root, pattern, mode);
            return 1;
        }

        const result = runNextPrebuild({
            files: matches,
            explicitRoot: root,
            cwd,
            mode,
            parserMode,
            safelistOutputFile: options.outputFile,
            cacheDir: options.cacheDir,
            importedStaticSz: options.importedStaticSz,
            config: { mangleVars: false },
            // Versions intentionally omitted: runNextPrebuild's package.json
            // fallback reads the real installed @csszyx/unplugin and
            // @csszyx/compiler versions so the manifest's generation identity
            // tracks the engine that actually runs the transform.
        });

        reportPrebuildSuccess(options.json, root, mode, result);
        return 0;
    } catch (error) {
        const message = error instanceof Error ? error.message : String(error);
        reportPrebuildFailure(options.json, message);
        return 1;
    }
}

/**
 * Report that the configured source pattern matched no files.
 * @param json - Whether to emit structured JSON.
 * @param root - Absolute scan root.
 * @param pattern - Source glob pattern.
 * @param mode - Prebuild mode.
 */
function reportNoFilesMatched(
    json: boolean | undefined,
    root: string,
    pattern: string,
    mode: 'development' | 'production',
): void {
    if (json) {
        console.log(
            JSON.stringify({ ok: false, reason: 'no-files-matched', root, pattern, mode }, null, 2),
        );
        return;
    }
    console.error(
        `${colors.error(icons.error)} No source files matched pattern \`${pattern}\` under ${root}.`,
    );
}

/**
 * Report a successful prebuild in human-readable or JSON form.
 * @param json - Whether to emit structured JSON.
 * @param root - Absolute scan root.
 * @param mode - Prebuild mode.
 * @param result - Completed prebuild metrics and output paths.
 */
function reportPrebuildSuccess(
    json: boolean | undefined,
    root: string,
    mode: 'development' | 'production',
    result: ReturnType<typeof runNextPrebuild>,
): void {
    if (json) {
        console.log(
            JSON.stringify(
                {
                    ok: true,
                    root,
                    mode,
                    scannedCount: result.scannedCount,
                    transformedCount: result.transformedCount,
                    skippedMissingCount: result.skippedMissingCount,
                    sourceCount: result.sourceCount,
                    classCount: result.classCount,
                    manifestPath: result.manifestPath,
                    safelistOutputPath: result.safelistOutputPath,
                },
                null,
                2,
            ),
        );
        return;
    }
    console.log(`${colors.success(icons.success)} csszyx next prebuild done`);
    console.log(`  root:        ${root}`);
    console.log(`  mode:        ${mode}`);
    console.log(`  scanned:     ${result.scannedCount}`);
    console.log(`  transformed: ${result.transformedCount}`);
    console.log(`  skipped:     ${result.skippedMissingCount}`);
    console.log(`  sources:     ${result.sourceCount}`);
    console.log(`  classes:     ${result.classCount}`);
    console.log(`  safelist:    ${result.safelistOutputPath}`);
    console.log(`  manifest:    ${result.manifestPath}`);
}

/**
 * Report a failed prebuild in human-readable or JSON form.
 * @param json - Whether to emit structured JSON.
 * @param message - Failure reason.
 */
function reportPrebuildFailure(json: boolean | undefined, message: string): void {
    if (json) console.log(JSON.stringify({ ok: false, reason: message }, null, 2));
    else console.error(`${colors.error(icons.error)} ${message}`);
}

function normalizeMode(mode: NextPrebuildCommandOptions['mode']): 'development' | 'production' {
    if (mode === undefined) {
        return 'production';
    }
    if (mode === 'development' || mode === 'production') {
        return mode;
    }
    throw new Error(`Invalid --mode "${mode}". Expected "development" or "production".`);
}

function normalizeParserMode(
    parserMode: NextPrebuildCommandOptions['parserMode'],
): 'rust' | 'wasm' | undefined {
    if (parserMode === undefined) {
        return undefined;
    }
    if (parserMode === 'rust' || parserMode === 'wasm') {
        return parserMode;
    }
    throw new Error(`Invalid --parser-mode "${parserMode}". Expected "rust" or "wasm".`);
}
