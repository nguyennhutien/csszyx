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
cli.command('init', 'Setup csszyx in your project')
    .option('--framework <name>', 'Specify framework')
    .option('--yes', 'Skip prompts (use defaults)')
    .option('--cwd <dir>', 'Current working directory')
    .action(async options => {
        await init({
            framework: options.framework,
            yes: options.yes,
            cwd: options.cwd,
        });
    });

// doctor command
cli.command('doctor', 'Diagnose mangling issues')
    .option('--verbose', 'Show detailed output')
    .option('--cwd <dir>', 'Current working directory')
    .action(async options => {
        await doctor({
            verbose: options.verbose,
            cwd: options.cwd,
        });
    });

// audit command
cli.command('audit', 'Analyze mangling performance')
    .option('--json', 'Output as JSON')
    .option('--watch', 'Live updates')
    .option('--compare <dir>', 'Compare with previous build')
    .option('--cwd <dir>', 'Current working directory')
    .action(async options => {
        await audit({
            json: options.json,
            watch: options.watch,
            compare: options.compare,
            cwd: options.cwd,
        });
    });

// generate-types command
cli.command('generate-types', 'Generate TypeScript declarations from tailwind.config.js')
    .option('-c, --config <path>', 'Path to tailwind.config.js')
    .option('-o, --output <path>', 'Output file path (default: ./csszyx.d.ts)')
    .option('--cwd <dir>', 'Current working directory')
    .option('--silent', 'Silent mode (no output)')
    .action(async options => {
        await generateTypes({
            config: options.config,
            output: options.output,
            cwd: options.cwd,
            silent: options.silent,
        });
    });

// migrate command
cli.command('migrate [dir]', 'Convert Tailwind className to sz prop')
    .option('--dry-run', 'Show changes without modifying files')
    .option('--ignore <patterns>', 'Glob patterns to ignore (comma-separated)')
    .option('--pattern <glob>', 'Custom glob pattern for file discovery')
    .option('--cwd <dir>', 'Current working directory')
    .option('--braces', 'Wrap HTML sz values in outer { } braces (default: bare)')
    .option('--no-fouc', 'Skip FOUC-prevention CSS injection into HTML files')
    .option('--inject-runtime <mode>', 'Inject runtime script into HTML: local | cdn')
    .option('--cdn-url <url>', 'Custom CDN URL for --inject-runtime cdn')
    .option(
        '--local-path <path>',
        'Local script path for --inject-runtime local (default: csszyx-runtime.js)',
    )
    .option('--audit', 'Scan without modifying files and output .csszyx-todo.json')
    .option('--inject-todos', 'Inject {/* @sz-todo */} comments above unrecognized classes')
    .option('--resolve-todos <file>', 'Path to a JSON file mapping custom classes to sz properties')
    .action(async (dir, options) => {
        await migrate({
            dryRun: options.dryRun,
            ignore: options.ignore ? options.ignore.split(',') : undefined,
            pattern: options.pattern,
            cwd: dir || options.cwd,
            braces: options.braces,
            injectFouc: options.fouc !== false,
            injectRuntime:
                options.injectRuntime === 'local'
                    ? 'local'
                    : options.injectRuntime === 'cdn'
                      ? 'cdn'
                      : false,
            cdnUrl: options.cdnUrl,
            localPath: options.localPath,
            audit: options.audit,
            injectTodos: options.injectTodos,
            resolveTodos: options.resolveTodos,
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
// Migrate utilities — used by @csszyx/mcp-server
export type { TransformResult as MigrateResult } from './migrate/ast-transformer.js';
export { transformSource as migrateSource } from './migrate/ast-transformer.js';
export type { CsszyxTodoEntry, CsszyxTodoMap } from './migrate/variant-parser.js';
export { classNameToSzObject } from './migrate/variant-parser.js';
export type { ResolvedTheme, ScanResult } from './scanner/tailwind-scanner.js';
export {
    extractScreenKeys,
    extractSpacingKeys,
    findConfigFile,
    flattenColors,
    scanTailwindConfig,
} from './scanner/tailwind-scanner.js';
