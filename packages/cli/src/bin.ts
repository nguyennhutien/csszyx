#!/usr/bin/env node
/**
 * csszyx CLI executable entry.
 *
 * Lives apart from `index.ts` (the library entry) so that importing
 * `@csszyx/cli` for its programmatic exports never parses `process.argv`
 * or prints help. Consumers such as `@csszyx/mcp-server` import the
 * library entry inside a stdio JSON-RPC process where any stray stdout
 * corrupts the protocol stream.
 *
 * Available commands:
 * - init: Setup wizard for new projects
 * - doctor: Diagnose mangling issues
 * - audit: Performance analysis
 * - generate-types: Generate TypeScript declarations
 * - migrate: Convert Tailwind className to sz prop
 * - next watch: Maintain Next.js Turbopack safelist state
 *
 * @module @csszyx/cli/bin
 */

import { readFileSync } from 'node:fs';

import cac from 'cac';

import { audit } from './commands/audit.js';
import { doctor } from './commands/doctor.js';
import { generateTypes } from './commands/generate-types.js';
import { init } from './commands/init.js';
import { migrate } from './commands/migrate.js';
import { nextPrebuild } from './commands/next-prebuild.js';
import { nextWatch } from './commands/next-watch.js';

const cli = cac('csszyx');
normalizeNextCommandAlias(process.argv);

/**
 * Reads the CLI version from the installed package manifest at runtime.
 *
 * The bundle ships no build-time string replacement, so a hardcoded constant
 * would publish as `0.0.0`. Resolving `package.json` relative to the emitted
 * entry keeps `--version` and the help banner truthful for installed users.
 *
 * @returns The package version, or `0.0.0` when the manifest cannot be read.
 */
function readCliVersion(): string {
    try {
        const manifest = JSON.parse(
            readFileSync(new URL('../package.json', import.meta.url), 'utf8'),
        ) as { version?: unknown };
        return typeof manifest.version === 'string' ? manifest.version : '0.0.0';
    } catch {
        return '0.0.0';
    }
}

const VERSION = readCliVersion();

interface CacNextPrebuildOptions {
    cwd?: string;
    root?: string;
    mode?: 'development' | 'production';
    parserMode?: 'rust' | 'oxc' | 'babel';
    outputFile?: string;
    cacheDir?: string;
    ignore?: string;
    json?: boolean;
}

interface CacNextWatchOptions {
    cwd?: string;
    root?: string;
    parserMode?: 'rust' | 'oxc' | 'babel';
    outputFile?: string;
    cacheDir?: string;
    ignore?: string;
    debounceMs?: number | string;
}

async function runNextPrebuildCommand(
    pattern: string | undefined,
    options: CacNextPrebuildOptions,
): Promise<void> {
    const code = await nextPrebuild({
        cwd: options.cwd,
        root: options.root,
        mode: options.mode,
        parserMode: options.parserMode,
        outputFile: options.outputFile,
        cacheDir: options.cacheDir,
        pattern,
        extraIgnore: options.ignore ? String(options.ignore).split(',') : undefined,
        json: options.json,
    });
    if (code !== 0) {
        process.exit(code);
    }
}

async function runNextWatchCommand(
    pattern: string | undefined,
    options: CacNextWatchOptions,
): Promise<void> {
    const code = await nextWatch({
        cwd: options.cwd,
        root: options.root,
        parserMode: options.parserMode,
        outputFile: options.outputFile,
        cacheDir: options.cacheDir,
        pattern,
        extraIgnore: options.ignore ? String(options.ignore).split(',') : undefined,
        debounceMs: options.debounceMs,
    });
    process.exitCode = code;
}

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

// next-prebuild command
cli.command(
    'next-prebuild [pattern]',
    'Seed the Next.js Turbopack csszyx safelist and generation manifest',
)
    .option('--root <dir>', 'Next app root (defaults to cwd)')
    .option('--cwd <dir>', 'Current working directory')
    .option('--mode <mode>', 'development | production (default: production)')
    .option('--parser-mode <mode>', 'rust | oxc | babel (default: rust)')
    .option(
        '--output-file <path>',
        'Tailwind @source safelist output (default: csszyx-classes.html)',
    )
    .option('--cache-dir <dir>', 'Cache directory relative to root (default: .csszyx/cache)')
    .option('--ignore <patterns>', 'Extra glob patterns to ignore (comma-separated)')
    .option('--json', 'Emit a single JSON result instead of formatted text')
    .action(runNextPrebuildCommand);

// next-watch command
cli.command('next-watch [pattern]', 'Maintain the Next.js Turbopack csszyx safelist')
    .option('--root <dir>', 'Next app root (defaults to cwd)')
    .option('--cwd <dir>', 'Current working directory')
    .option('--parser-mode <mode>', 'rust | oxc | babel (default: rust)')
    .option(
        '--output-file <path>',
        'Tailwind @source safelist output (default: csszyx-classes.html)',
    )
    .option('--cache-dir <dir>', 'Cache directory relative to root (default: .csszyx/cache)')
    .option('--ignore <patterns>', 'Extra glob patterns to ignore (comma-separated)')
    .option('--debounce-ms <ms>', 'Safelist materialization debounce (default: 50)')
    .action(runNextWatchCommand);

// Default command (show help)
cli.command('').action(() => {
    cli.outputHelp();
});

// Global options
cli.help();
cli.version(VERSION);

// Parse CLI arguments
cli.parse();

function normalizeNextCommandAlias(argv: string[]): void {
    if (argv[2] === 'next' && (argv[3] === 'prebuild' || argv[3] === 'watch')) {
        argv.splice(2, 2, `next-${argv[3]}`);
    }
}
