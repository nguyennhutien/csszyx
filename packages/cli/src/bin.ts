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
 * - init: Set up csszyx in a project
 * - doctor: Check the config, Tailwind, package versions and build output
 * - audit: Size of the built HTML and CSS
 * - generate-types: Generate TypeScript declarations
 * - migrate: Convert Tailwind className to sz prop
 * - next watch: Maintain Next.js Turbopack safelist state
 *
 * @module @csszyx/cli/bin
 */

import { readFileSync } from 'node:fs';

import cac, { type Command } from 'cac';

import { splitGlobList } from './glob-list.js';

/**
 * Normalize a repeatable CLI option to its array representation.
 *
 * @param value Raw option supplied by cac.
 * @returns Zero or more option values.
 */
function repeatableOption(value: string | string[] | undefined): string[] | undefined {
    if (value === undefined) return undefined;
    return Array.isArray(value) ? value : [value];
}

/**
 * Normalize the migration runtime-injection flag.
 *
 * @param value Raw option supplied by cac.
 * @returns Supported injection mode, or false when disabled.
 */
function runtimeInjection(value: unknown): 'local' | 'cdn' | false {
    if (value === 'local') return 'local';
    if (value === 'cdn') return 'cdn';
    return false;
}

// Commands load on demand. Every one of them was imported here, so `csszyx
// check` in a pre-commit hook paid to load the watcher, the process spawner
// and the prompt library it never calls — measured at 130ms of a 280ms run.
// It also meant one command's dependency failing to load took down the whole
// binary, including commands that do not use it.
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
    parserMode?: 'rust' | 'wasm';
    outputFile?: string;
    cacheDir?: string;
    /** One text, or one per occurrence when the flag is repeated. */
    ignore?: string | string[];
    importedStaticSz?: boolean;
    tailwindStylesheet?: string;
    json?: boolean;
}

interface CacNextWatchOptions {
    cwd?: string;
    root?: string;
    parserMode?: 'rust' | 'wasm';
    outputFile?: string;
    cacheDir?: string;
    /** One text, or one per occurrence when the flag is repeated. */
    ignore?: string | string[];
    importedStaticSz?: boolean;
    tailwindStylesheet?: string;
    debounceMs?: number | string;
}

/**
 * A comma-separated option as a list.
 *
 * @param value - The option as given, if at all.
 * @returns The entries, or undefined when the option was not given.
 */
function splitList(value: string | undefined): string[] | undefined {
    if (!value) return undefined;
    return String(value)
        .split(',')
        .map(entry => entry.trim())
        .filter(entry => entry !== '');
}

async function runNextPrebuildCommand(
    pattern: string | undefined,
    options: CacNextPrebuildOptions,
): Promise<void> {
    const code = await (await import('./commands/next-prebuild.js')).nextPrebuild({
        cwd: options.cwd,
        root: options.root,
        mode: options.mode,
        parserMode: options.parserMode,
        outputFile: options.outputFile,
        cacheDir: options.cacheDir,
        pattern,
        extraIgnore: splitGlobList(options.ignore),
        importedStaticSz: options.importedStaticSz,
        tailwindStylesheet: splitList(options.tailwindStylesheet),
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
    const code = await (await import('./commands/next-watch.js')).nextWatch({
        cwd: options.cwd,
        root: options.root,
        parserMode: options.parserMode,
        outputFile: options.outputFile,
        cacheDir: options.cacheDir,
        pattern,
        extraIgnore: splitGlobList(options.ignore),
        importedStaticSz: options.importedStaticSz,
        tailwindStylesheet: splitList(options.tailwindStylesheet),
        debounceMs: options.debounceMs,
    });
    process.exitCode = code;
}

// init command
cli.command('init', 'Set up csszyx in this project')
    .option(
        '--framework <name>',
        'Framework to set up instead of the detected one: vite-react, vite-vue, vite-svelte, nextjs-app, nextjs-pages, nuxt, sveltekit or astro',
    )
    .option('--yes', 'Skip prompts (use defaults)')
    .option('--cwd <dir>', 'Directory to run in (default: the current one)')
    .action(async options => {
        await (await import('./commands/init.js')).init({
            framework: options.framework,
            yes: options.yes,
            cwd: options.cwd,
        });
    });

// doctor command
cli.command('doctor', 'Check the csszyx config, Tailwind, package versions and build output')
    .option('--verbose', 'Show detailed output')
    .option('--cwd <dir>', 'Directory to run in (default: the current one)')
    .action(async options => {
        await (await import('./commands/doctor.js')).doctor({
            verbose: options.verbose,
            cwd: options.cwd,
        });
    });

// check command
cli.command(
    'check [dir]',
    'Report sz diagnostics and classes that produce no CSS, for CI and git hooks',
)
    .option('--pattern <glob>', 'Glob of source files to scan, relative to [dir]')
    .option('--ignore <glob>', 'Extra ignore glob (repeatable)')
    .option('--cwd <dir>', 'Directory to run in (default: the current one)')
    .option('--allow <class>', 'Accept an emitted class that produces no CSS (repeatable)')
    .option(
        '--allow-token <name>',
        'Accept a theme token that shadows a built-in utility (repeatable)',
    )
    .option('--files <path>', 'Check exactly these files, for a git hook (repeatable)')
    .option('--json', 'Print one JSON document instead of the text report')
    .option('--rule <id>', 'Report only this diagnostic id or check pass (repeatable)')
    .option('--ignore-rule <id>', 'Leave out this diagnostic id or check pass (repeatable)')
    .option(
        '--fail-on <level>',
        'Fail on findings at this level or louder: info, warn or error (default: error)',
    )
    .action(async (dir, options) => {
        await (await import('./commands/check.js')).check({
            cwd: options.cwd,
            dir,
            pattern: options.pattern,
            ignore: repeatableOption(options.ignore),
            allow: repeatableOption(options.allow),
            allowToken: repeatableOption(options.allowToken),
            files: repeatableOption(options.files),
            json: options.json,
            rule: repeatableOption(options.rule),
            ignoreRule: repeatableOption(options.ignoreRule),
            failOn: options.failOn,
        });
    });

// scan-collisions command
cli.command(
    'scan-collisions',
    'Find class names that could collide with a mangled token (for production.mangleExclude)',
)
    .option('--pattern <glob>', 'Glob of stylesheet files to scan')
    .option('--ignore <glob>', 'Extra ignore glob (repeatable)')
    .option('--cwd <dir>', 'Directory to run in (default: the current one)')
    .action(async options => {
        await (await import('./commands/scan-collisions.js')).scanCollisions({
            cwd: options.cwd,
            pattern: options.pattern,
            ignore: repeatableOption(options.ignore),
        });
    });

// explain command
cli.command('explain <sz>', 'Print the Tailwind className an sz object compiles to').action(
    async (sz: string) => {
        (await import('./commands/explain.js')).explain(sz);
    },
);

// audit command
cli.command('audit', 'Print the size of the built HTML and CSS under dist/')
    .option('--json', 'Print one JSON document instead of the text report')
    .option('--cwd <dir>', 'Directory to run in (default: the current one)')
    .action(async options => {
        (await import('./commands/audit.js')).audit({
            json: options.json,
            cwd: options.cwd,
        });
    });

// generate-types command
cli.command(
    'generate-types',
    'Generate TypeScript declarations from a Tailwind v3 config (tailwind.config.js)',
)
    .option('-c, --config <path>', 'Path to tailwind.config.js')
    .option('-o, --output <path>', 'Output file path (default: ./csszyx.d.ts)')
    .option('--cwd <dir>', 'Directory to run in (default: the current one)')
    .option('--silent', 'Print nothing')
    .action(async options => {
        await (await import('./commands/generate-types.js')).generateTypes({
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
    .option('--cwd <dir>', 'Directory to run in (default: the current one)')
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
    .option('--resolve-todos <file>', 'Path to a JSON file mapping custom classes to sz keys')
    .option(
        '--keys-only',
        'Only rewrite old sz keys to their canonical names, and leave className untouched (0.9.10 → 0.10.0 upgrade)',
    )
    .action(async (dir, options) => {
        await (await import('./commands/migrate.js')).migrate({
            dryRun: options.dryRun,
            ignore: splitGlobList(options.ignore),
            pattern: options.pattern,
            cwd: dir || options.cwd,
            braces: options.braces,
            injectFouc: options.fouc !== false,
            injectRuntime: runtimeInjection(options.injectRuntime),
            cdnUrl: options.cdnUrl,
            localPath: options.localPath,
            audit: options.audit,
            injectTodos: options.injectTodos,
            resolveTodos: options.resolveTodos,
            keysOnly: options.keysOnly,
        });
    });

// next-prebuild command
/**
 * Options `next-prebuild` and `next-watch` share: where the Next app is, how
 * its sources are parsed, and where the safelist and cache go. One table,
 * so the two commands cannot drift apart on a flag or its wording.
 */
const NEXT_SAFELIST_OPTIONS: ReadonlyArray<readonly [flag: string, description: string]> = [
    ['--root <dir>', 'Next.js app root (default: --cwd)'],
    ['--cwd <dir>', 'Directory to run in (default: the current one)'],
    ['--parser-mode <mode>', 'Engine to parse with: rust (native engine) or wasm (default: rust)'],
    ['--output-file <path>', 'Where to write the safelist (default: .csszyx/csszyx-classes.txt)'],
    ['--cache-dir <dir>', 'Cache directory relative to root (default: .csszyx/cache)'],
    [
        '--tailwind-stylesheet <paths>',
        'Tailwind stylesheets this app loads, relative to --root and comma-separated, when the project holds others',
    ],
    [
        '--ignore <patterns>',
        'Glob patterns to leave out of the source files and of the Tailwind stylesheets read for the prefix (comma-separated, repeatable)',
    ],
    [
        '--imported-static-sz',
        'Compile a plain exported sz object into the modules that import it (default)',
    ],
    [
        '--no-imported-static-sz',
        'Leave imported sz objects to the runtime; set importedStaticSz: false in csszyxTurbopack to match',
    ],
];

/**
 * @param command - A Next safelist command.
 * @returns The same command with the shared options registered.
 */
function withNextSafelistOptions(command: Command): Command {
    for (const [flag, description] of NEXT_SAFELIST_OPTIONS) command.option(flag, description);
    return command;
}

withNextSafelistOptions(
    cli.command(
        'next-prebuild [pattern]',
        'Write the safelist for a Next.js Turbopack build once; also runs as csszyx next prebuild (pattern default: {app,pages,src}/**/*.{ts,tsx,js,jsx,mjs,cjs})',
    ),
)
    .option('--mode <mode>', 'development | production (default: production)')
    .option('--json', 'Print one JSON document instead of the text report')
    .action(runNextPrebuildCommand);

// next-watch command
withNextSafelistOptions(
    cli.command(
        'next-watch [pattern]',
        'Keep the safelist of a Next.js Turbopack build up to date while files change; also runs as csszyx next watch (pattern default: {app,pages,src}/**/*.{ts,tsx,js,jsx,mjs,cjs})',
    ),
)
    .option(
        '--debounce-ms <ms>',
        'Milliseconds to wait after a change before writing the safelist (default: 50)',
    )
    .action(runNextWatchCommand);

// Default command (show help)
cli.command('').action(() => {
    cli.outputHelp();
});

// Global options
cli.help();
cli.version(VERSION);

// Parse CLI arguments. cac 7 throws a CACError for unknown commands and
// unused/missing args (cac 6 silently fell through to help) — surface it as
// a one-line message plus help instead of a stack trace.
try {
    cli.parse();
} catch (error) {
    if (error instanceof Error && error.name === 'CACError') {
        console.error(`csszyx: ${error.message}\n`);
        cli.outputHelp();
        process.exitCode = 1;
    } else {
        throw error;
    }
}

function normalizeNextCommandAlias(argv: string[]): void {
    if (argv[2] === 'next' && (argv[3] === 'prebuild' || argv[3] === 'watch')) {
        argv.splice(2, 2, `next-${argv[3]}`);
    }
}
