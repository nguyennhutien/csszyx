/**
 * CLI command: generate-types
 *
 * Scans tailwind.config.js and generates strict TypeScript types
 * for the csszyx sz prop.
 *
 * @module commands/generate-types
 */

import { dirname, join, relative, resolve } from 'node:path';

import { isCsszyxError } from '@csszyx/compiler/errors';

import { type GeneratorOptions, generateAndWriteTypes } from '../generator/type-generator.js';
import { resolveTailwindV3, tailwindLoaderFor } from '../scanner/tailwind-availability.js';
import { findConfigFile, scanTailwindConfig } from '../scanner/tailwind-scanner.js';
import { registryMessage } from '../utils/registry-words.js';

/**
 * Command options for generate-types.
 */
export interface GenerateTypesOptions {
    /** Path to tailwind.config.js (auto-detect if not specified) */
    config?: string;
    /** Output file path (default: ./csszyx.d.ts) */
    output?: string;
    /** Current working directory */
    cwd?: string;
    /** Silent mode (no output) */
    silent?: boolean;
}

type CommandLogger = (message: string) => void;
type TailwindScanResult = Awaited<ReturnType<typeof scanTailwindConfig>>;

interface CommandOutput {
    log: CommandLogger;
    error: CommandLogger;
}

/**
 * Execute the generate-types command.
 *
 * @param {GenerateTypesOptions} options - Command options
 * @returns {Promise<void>}
 *
 * @example
 * ```typescript
 * await generateTypes({ config: './tailwind.config.js', output: './src/csszyx.d.ts' });
 * ```
 * @internal Used by csszyx's own packages; not a stable API.
 */
export async function generateTypes(options: GenerateTypesOptions = {}): Promise<void> {
    const cwd = options.cwd || process.cwd();
    const { log, error } = commandOutput(options.silent);
    const configPath = resolveConfigPath(options.config, cwd, log);
    // Before reading the config, and before saying none was found: Tailwind v3
    // is an optional peer, and no package manager warns when one is missing, so
    // this is where a user learns which install state the project is in. A v4
    // project has no `tailwind.config.js` by design, and "could not find" sends
    // its author hunting for a file that cannot exist — the availability
    // message says the command has no job there at all.
    await requireTailwindV3(configPath ? dirname(configPath) : cwd, cwd, error);
    if (!configPath) {
        error(
            `✖ ${registryMessage({ code: 'tailwind-config-missing', args: { form: 'not-found', root: cwd } })}`,
        );
        process.exit(1);
    }

    log(`📖 Reading config from: ${configPath}`);
    const scanResult = await loadTailwindConfig(configPath, cwd, error);
    log('✅ Config loaded successfully');
    logCustomThemeParts(scanResult, log);

    // Generate types
    const outputPath = options.output || './csszyx.d.ts';
    const generatorOptions = {
        output: resolve(cwd, outputPath),
        includeComments: true,
    } satisfies GeneratorOptions;

    log('\n📝 Generating TypeScript declarations...');
    await writeDeclarations(scanResult, generatorOptions, { cwd, log, error });
}

/**
 * Creates the command's visible or silent output functions.
 * @param silent - Whether command output should be suppressed.
 * @returns The log and error functions for this invocation.
 */
function commandOutput(silent = false): CommandOutput {
    if (silent) {
        const noop: CommandLogger = () => {};
        return { log: noop, error: noop };
    }
    return { log: console.log, error: console.error };
}

/**
 * Resolves an explicit config or discovers the default config in the working directory.
 * @param config - The optional config path supplied by the user.
 * @param cwd - The command working directory.
 * @param log - The normal-output logger.
 * @returns The absolute Tailwind config path, or undefined when discovery
 * found none — reporting that is the caller's, so the install state is
 * answered first.
 */
function resolveConfigPath(
    config: string | undefined,
    cwd: string,
    log: CommandLogger,
): string | undefined {
    if (config) {
        return resolve(cwd, config);
    }

    log('🔍 Searching for tailwind.config...');
    return findConfigFile(cwd) ?? undefined;
}

/**
 * Stop with the availability message when Tailwind v3 is not there to call.
 * @param projectDir - Project directory, whose own Tailwind is the one asked about.
 * @param cwd - The command working directory, which the message names the project from.
 * @param error - The error-output logger.
 */
async function requireTailwindV3(
    projectDir: string,
    cwd: string,
    error: CommandLogger,
): Promise<void> {
    try {
        await resolveTailwindV3(tailwindLoaderFor(projectDir));
    } catch (cause) {
        // The lookup resolves from the project's package.json.
        const manifest = relative(cwd, join(projectDir, 'package.json'));
        stop(error, cause, `Could not look up Tailwind from \`${manifest}\``);
    }
}

/**
 * Print a failure in the shared `✖` form and exit.
 *
 * @param error - The error-output logger.
 * @param cause - What was thrown.
 * @param context - What failed, naming the file, for a failure the registry
 *   has no words for; a csszyx error says what failed in its own.
 */
function stop(error: CommandLogger, cause: unknown, context: string): never {
    const reason = isCsszyxError(cause) ? cause.message : `${context}: ${errorMessage(cause)}`;
    error(`✖ ${reason}`);
    process.exit(1);
}

/**
 * Loads and normalizes a Tailwind config, reporting a CLI-friendly failure.
 * @param configPath - The absolute Tailwind config path.
 * @param cwd - The command working directory, which the message names the config from.
 * @param error - The error-output logger.
 * @returns The normalized Tailwind scan result.
 */
async function loadTailwindConfig(
    configPath: string,
    cwd: string,
    error: CommandLogger,
): Promise<TailwindScanResult> {
    try {
        return await scanTailwindConfig(configPath);
    } catch (cause) {
        return stop(error, cause, `Could not read \`${relative(cwd, configPath)}\``);
    }
}

/**
 * Reports the custom theme sections discovered by the scanner.
 * @param scanResult - The normalized Tailwind scan result.
 * @param log - The normal-output logger.
 */
function logCustomThemeParts(scanResult: TailwindScanResult, log: CommandLogger): void {
    if (scanResult.hasCustomColors) {
        log('   • Custom colors detected');
    }
    if (scanResult.hasCustomSpacing) {
        log('   • Custom spacing detected');
    }
}

/**
 * Generates the declarations and prints the successful command summary.
 * @param scanResult - The normalized Tailwind scan result.
 * @param generatorOptions - The declaration generator options.
 * @param output - Where the command runs and prints.
 * @param output.cwd - The command working directory, which the message names the output from.
 * @param output.log - The normal-output logger.
 * @param output.error - The error-output logger.
 */
async function writeDeclarations(
    scanResult: TailwindScanResult,
    generatorOptions: GeneratorOptions & { output: string },
    { cwd, log, error }: CommandOutput & { cwd: string },
): Promise<void> {
    try {
        const writtenPath = await generateAndWriteTypes(scanResult.theme, generatorOptions);
        log('\n✨ Types generated successfully!');
        log(`   Output: ${writtenPath}`);
        log('\n💡 Add this to your tsconfig.json "include" array:');
        log('   "include": ["src", "csszyx.d.ts"]');
    } catch (cause) {
        stop(error, cause, `Could not write \`${relative(cwd, generatorOptions.output)}\``);
    }
}

/**
 * Converts an unknown thrown value to its CLI display form.
 * @param cause - The thrown value.
 * @returns A human-readable error message.
 */
function errorMessage(cause: unknown): string {
    return cause instanceof Error ? cause.message : String(cause);
}
