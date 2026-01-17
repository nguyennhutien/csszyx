/**
 * CLI command: generate-types
 *
 * Scans tailwind.config.js and generates strict TypeScript types
 * for the csszyx sz prop.
 *
 * @module commands/generate-types
 */

import { resolve } from 'node:path';

import {
    generateAndWriteTypes,
    type GeneratorOptions,
} from '../generator/type-generator.js';
import {
    findConfigFile,
    scanTailwindConfig,
} from '../scanner/tailwind-scanner.js';

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
export async function generateTypes(
    options: GenerateTypesOptions = {},
): Promise<void> {
    const cwd = options.cwd || process.cwd();
    const log = options.silent ? () => {} : console.log;
    const error = options.silent ? () => {} : console.error;

    // Find or use provided config path
    let configPath: string, scanResult;

    if (options.config) {
        configPath = resolve(cwd, options.config);
    } else {
        log('🔍 Searching for tailwind.config...');
        const foundConfig = findConfigFile(cwd);

        if (!foundConfig) {
            error('❌ Could not find tailwind.config.js in current directory');
            error('   Please specify the path with --config flag');
            process.exit(1);
        }

        configPath = foundConfig;
    }

    log(`📖 Reading config from: ${configPath}`);

    // Scan and resolve Tailwind config
    try {
        scanResult = await scanTailwindConfig(configPath);
    } catch (err) {
        error(
            `❌ Failed to read Tailwind config: ${err instanceof Error ? err.message : String(err)}`,
        );
        process.exit(1);
    }

    log('✅ Config loaded successfully');

    if (scanResult.hasCustomColors) {
        log('   • Custom colors detected');
    }
    if (scanResult.hasCustomSpacing) {
        log('   • Custom spacing detected');
    }

    // Generate types
    const outputPath = options.output || './csszyx.d.ts';
    const generatorOptions: GeneratorOptions = {
        output: resolve(cwd, outputPath),
        includeComments: true,
    };

    log('\n📝 Generating TypeScript declarations...');

    try {
        const writtenPath = await generateAndWriteTypes(
            scanResult.theme,
            generatorOptions,
        );
        log('\n✨ Types generated successfully!');
        log(`   Output: ${writtenPath}`);
        log('\n💡 Add this to your tsconfig.json "include" array:');
        log('   "include": ["src", "csszyx.d.ts"]');
    } catch (err) {
        error(
            `❌ Failed to generate types: ${err instanceof Error ? err.message : String(err)}`,
        );
        process.exit(1);
    }
}
