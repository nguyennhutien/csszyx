/**
 * CLI command: generate-types
 *
 * Scans tailwind.config.js and generates strict TypeScript types
 * for the csszyx sz prop.
 *
 * @module commands/generate-types
 */

import { resolve } from 'node:path';

import { type GeneratorOptions, generateAndWriteTypes } from '../generator/type-generator.js';
import { resolveTailwindV3 } from '../scanner/tailwind-availability.js';
import { findConfigFile, scanTailwindConfig } from '../scanner/tailwind-scanner.js';

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
 */
export async function generateTypes(options: GenerateTypesOptions = {}): Promise<void> {
    const cwd = options.cwd || process.cwd();
    const { log, error } = commandOutput(options.silent);
    // First, before a line of progress: Tailwind v3 is an optional peer, and
    // no package manager warns when one is missing, so this is where a user
    // learns which of the three install states they are in. Half a progress
    // log followed by a resolver error is the thing this ordering prevents.
    await requireTailwindV3(error);
    const configPath = resolveConfigPath(options.config, cwd, log, error);

    log(`📖 Reading config from: ${configPath}`);
    const scanResult = await loadTailwindConfig(configPath, error);
    log('✅ Config loaded successfully');
    logCustomThemeParts(scanResult, log);

    // Generate types
    const outputPath = options.output || './csszyx.d.ts';
    const generatorOptions: GeneratorOptions = {
        output: resolve(cwd, outputPath),
        includeComments: true,
    };

    log('\n📝 Generating TypeScript declarations...');
    await writeDeclarations(scanResult, generatorOptions, log, error);
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
 * @param error - The error-output logger.
 * @returns The absolute Tailwind config path.
 */
function resolveConfigPath(
    config: string | undefined,
    cwd: string,
    log: CommandLogger,
    error: CommandLogger,
): string {
    if (config) {
        return resolve(cwd, config);
    }

    log('🔍 Searching for tailwind.config...');
    const foundConfig = findConfigFile(cwd);
    if (foundConfig) {
        return foundConfig;
    }

    error('❌ Could not find tailwind.config.js in current directory');
    error('   Please specify the path with --config flag');
    process.exit(1);
}

/**
 * Stop with the availability message when Tailwind v3 is not there to call.
 * @param error - The error-output logger.
 */
async function requireTailwindV3(error: CommandLogger): Promise<void> {
    try {
        await resolveTailwindV3();
    } catch (cause) {
        error(`❌ ${errorMessage(cause)}`);
        process.exit(1);
    }
}

/**
 * Loads and normalizes a Tailwind config, reporting a CLI-friendly failure.
 * @param configPath - The absolute Tailwind config path.
 * @param error - The error-output logger.
 * @returns The normalized Tailwind scan result.
 */
async function loadTailwindConfig(
    configPath: string,
    error: CommandLogger,
): Promise<TailwindScanResult> {
    try {
        return await scanTailwindConfig(configPath);
    } catch (cause) {
        error(`❌ Failed to read Tailwind config: ${errorMessage(cause)}`);
        process.exit(1);
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
 * @param log - The normal-output logger.
 * @param error - The error-output logger.
 */
async function writeDeclarations(
    scanResult: TailwindScanResult,
    generatorOptions: GeneratorOptions,
    log: CommandLogger,
    error: CommandLogger,
): Promise<void> {
    try {
        const writtenPath = await generateAndWriteTypes(scanResult.theme, generatorOptions);
        log('\n✨ Types generated successfully!');
        log(`   Output: ${writtenPath}`);
        log('\n💡 Add this to your tsconfig.json "include" array:');
        log('   "include": ["src", "csszyx.d.ts"]');
    } catch (cause) {
        error(`❌ Failed to generate types: ${errorMessage(cause)}`);
        process.exit(1);
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
