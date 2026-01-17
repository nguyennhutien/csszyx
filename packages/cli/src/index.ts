#!/usr/bin/env node
/**
 * @csszyx/cli - Command line tools for csszyx.
 *
 * Available commands:
 * - init: Setup wizard for new projects
 * - doctor: Diagnose mangling issues
 * - audit: Performance analysis
 * - generate-types: Generate TypeScript declarations
 * - migrate: Convert Tailwind className to sz prop
 *
 * @module @csszyx/cli
 */

import cac from 'cac';

import { audit } from './commands/audit.js';
import { doctor } from './commands/doctor.js';
import { generateTypes } from './commands/generate-types.js';
import { init } from './commands/init.js';
import { migrate } from './commands/migrate.js';

const cli = cac('csszyx');

/**
 * Package version (will be replaced by build process).
 */
const VERSION = '0.0.0';

// init command
cli
    .command('init', 'Setup csszyx in your project')
    .option('--framework <name>', 'Specify framework')
    .option('--yes', 'Skip prompts (use defaults)')
    .option('--cwd <dir>', 'Current working directory')
    .action(async (options) => {
        await init({
            framework: options.framework,
            yes: options.yes,
            cwd: options.cwd,
        });
    });

// doctor command
cli
    .command('doctor', 'Diagnose mangling issues')
    .option('--fix', 'Auto-fix common issues')
    .option('--verbose', 'Show detailed output')
    .option('--cwd <dir>', 'Current working directory')
    .action(async (options) => {
        await doctor({
            fix: options.fix,
            verbose: options.verbose,
            cwd: options.cwd,
        });
    });

// audit command
cli
    .command('audit', 'Analyze mangling performance')
    .option('--json', 'Output as JSON')
    .option('--watch', 'Live updates')
    .option('--compare <dir>', 'Compare with previous build')
    .option('--cwd <dir>', 'Current working directory')
    .action(async (options) => {
        await audit({
            json: options.json,
            watch: options.watch,
            compare: options.compare,
            cwd: options.cwd,
        });
    });

// generate-types command
cli
    .command(
        'generate-types',
        'Generate TypeScript declarations from tailwind.config.js',
    )
    .option('-c, --config <path>', 'Path to tailwind.config.js')
    .option('-o, --output <path>', 'Output file path (default: ./csszyx.d.ts)')
    .option('--cwd <dir>', 'Current working directory')
    .option('--silent', 'Silent mode (no output)')
    .action(async (options) => {
        await generateTypes({
            config: options.config,
            output: options.output,
            cwd: options.cwd,
            silent: options.silent,
        });
    });

// migrate command
cli
    .command('migrate [dir]', 'Convert Tailwind className to sz prop')
    .option('--dry-run', 'Show changes without modifying files')
    .option('--ignore <patterns>', 'Glob patterns to ignore (comma-separated)')
    .option('--pattern <glob>', 'Custom glob pattern for file discovery')
    .option('--cwd <dir>', 'Current working directory')
    .action(async (dir, options) => {
        await migrate({
            dryRun: options.dryRun,
            ignore: options.ignore ? options.ignore.split(',') : undefined,
            pattern: options.pattern,
            cwd: dir || options.cwd,
        });
    });

// Default command (show help)
cli.command('').action(() => {
    cli.outputHelp();
});

// Global options
cli.help();
cli.version(VERSION);

// Parse CLI arguments
cli.parse();

// Export for programmatic usage
export type { GenerateTypesOptions } from './commands/generate-types.js';
export { generateTypes } from './commands/generate-types.js';
export type { GeneratorOptions } from './generator/type-generator.js';
export {
    generateAndWriteTypes,
    generateTypeDeclarations,
    writeDeclarationFile,
} from './generator/type-generator.js';
export type { ResolvedTheme, ScanResult } from './scanner/tailwind-scanner.js';
export {
    extractScreenKeys,
    extractSpacingKeys,
    findConfigFile,
    flattenColors,
    scanTailwindConfig,
} from './scanner/tailwind-scanner.js';
