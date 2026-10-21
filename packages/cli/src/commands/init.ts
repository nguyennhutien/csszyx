/**
 * csszyx init - Setup wizard for new projects.
 */

import path from 'node:path';

import {
    csszyxConfigFileNameFor,
    findCsszyxConfigFile,
    isLegacyInitTemplate,
} from '@csszyx/unplugin/diagnostics';
import { execa } from 'execa';
import fs from 'fs-extra';
import prompts from 'prompts';

import {
    type Framework,
    getFrameworkName,
    getProjectInfo,
    type ProjectInfo,
} from '../utils/framework-detector.js';
import { registryMessage } from '../utils/registry-words.js';
import {
    printError,
    printHeader,
    printInfo,
    printSuccess,
    printWarn,
    spinner,
} from '../utils/terminal-ui.js';

/** Options for the `init` command. */
export interface InitOptions {
    /**
     * The framework to set up instead of the detected one: a {@link Framework}
     * other than `unknown`. Any other value stops init before it asks or
     * installs anything.
     */
    framework?: string;
    yes?: boolean;
    cwd?: string;
}

const VITE_FRAMEWORKS = new Set<Framework>(['vite-react', 'vite-vue', 'vite-svelte']);

/**
 * Frameworks that build through Vite in a config init does not edit: it
 * prints the plugin lines instead, for the file each one keeps them in.
 * Tailwind's own guide for each adds `@tailwindcss/vite`, so that is the
 * integration init installs for them, and the one the lines import.
 */
const PRINTED_VITE_CONFIGS: Partial<Record<Framework, PrintedViteConfig>> = {
    nuxt: { file: 'nuxt.config.ts', lines: nuxtConfigLines },
    sveltekit: {
        file: 'vite.config.ts',
        lines: svelteKitConfigLines,
        stylesheetStep: stylesheet =>
            `Import \`${stylesheet}\` in \`src/routes/+layout.svelte\`: \`import '${importFrom('src/routes', stylesheet)}';\` in its \`<script>\`.`,
    },
    astro: {
        file: 'astro.config.mjs',
        lines: astroConfigLines,
        stylesheetStep: stylesheet =>
            `Import \`${stylesheet}\` in your root layout, for example \`import '${importFrom('src/layouts', stylesheet)}';\` in the frontmatter of \`src/layouts/Layout.astro\`.`,
    },
};

/** Where a framework keeps its Vite plugins, for the lines init prints. */
interface PrintedViteConfig {
    /** The config file the lines go in. */
    file: string;
    /**
     * The lines to add to {@link file}.
     *
     * @param stylesheet - The stylesheet init created or edited, from the
     *   project root, or `null` when init touched none.
     */
    lines: (stylesheet: string | null) => string;
    /**
     * The step that makes the framework serve a stylesheet init created or
     * edited, for a framework whose config does not list stylesheets.
     */
    stylesheetStep?: (stylesheet: string) => string;
}

/**
 * The specifier that imports a stylesheet from a file in another directory.
 *
 * @param fromDir - The importing file's directory, from the project root.
 * @param stylesheet - The stylesheet, from the project root.
 * @returns A relative specifier such as `../index.css`.
 */
function importFrom(fromDir: string, stylesheet: string): string {
    // Every stylesheet init writes sits outside these directories, so the
    // path starts with `..` and needs no `./`.
    return path.posix.relative(fromDir, stylesheet);
}

/** Every value `--framework` takes: a framework init knows how to set up. */
const FRAMEWORKS: ReadonlySet<string> = new Set<Framework>([
    'vite-react',
    'vite-vue',
    'vite-svelte',
    'nextjs-app',
    'nextjs-pages',
    'nuxt',
    'sveltekit',
    'astro',
]);

/**
 * Whether a value is one `--framework` takes.
 *
 * @param value - The value given.
 * @returns True for a framework init sets up.
 */
function isFramework(value: string): value is Exclude<Framework, 'unknown'> {
    return FRAMEWORKS.has(value);
}

/**
 * Read a file as utf8 if it exists, otherwise return null.
 *
 * Avoids the existsSync + readFile TOCTOU race by performing a single
 * open and handling ENOENT, which keeps init resilient when other
 * tooling races to create or remove the same paths.
 *
 * @param filePath - Absolute or cwd-relative path to read.
 * @returns File contents, or null when the file does not exist.
 */
async function readFileOrNull(filePath: string): Promise<string | null> {
    try {
        return await fs.readFile(filePath, 'utf8');
    } catch (err) {
        if ((err as NodeJS.ErrnoException)?.code === 'ENOENT') {
            return null;
        }
        throw err;
    }
}

/**
 * Ask every candidate at once and answer for the first, in the order given,
 * that has an answer: what a loop stopping at the first hit returns, without
 * waiting on each miss before asking the next. A probe that fails surfaces
 * only when no earlier candidate answered, as it would in that loop.
 *
 * @param candidates - What to ask, in order of preference.
 * @param probe - The answer for one candidate, or null for none.
 * @returns The first answer in candidate order, or null when none has one.
 */
async function firstInOrder<T, U>(
    candidates: readonly T[],
    probe: (candidate: T) => Promise<U | null>,
): Promise<U | null> {
    const outcomes = await Promise.allSettled(candidates.map(probe));
    for (const outcome of outcomes) {
        if (outcome.status === 'rejected') throw outcome.reason;
        if (outcome.value !== null) return outcome.value;
    }
    return null;
}

/**
 * Read the first of several files that exists.
 *
 * @param filePaths - Absolute paths, in order of preference.
 * @returns The path and contents of the first that exists, or null.
 */
function readFirstExisting(
    filePaths: readonly string[],
): Promise<{ path: string; content: string } | null> {
    return firstInOrder(filePaths, async filePath => {
        const content = await readFileOrNull(filePath);
        return content === null ? null : { path: filePath, content };
    });
}
const NEXTJS_FRAMEWORKS = new Set<Framework>(['nextjs-app', 'nextjs-pages']);

/** The PostCSS plugin entry a Next.js project needs, as it appears in the config. */
const CSSZYX_POSTCSS_PLUGIN_LINE = "'@csszyx/unplugin/postcss': {},";

/**
 * Every file Next reads a PostCSS config from, in its own search order
 * (`next/dist/lib/find-config`); a `postcss` key in package.json comes first
 * and is checked separately. `postcss.config.ts` is not on Next's list but
 * is kept so a project that has one is not handed a second config.
 */
const POSTCSS_CONFIG_FILES = [
    '.postcssrc.json',
    'postcss.config.json',
    '.postcssrc.js',
    'postcss.config.js',
    'postcss.config.mjs',
    'postcss.config.cjs',
    'postcss.config.ts',
];

/**
 * @param cwd - Project root directory.
 * @param name - Package name.
 * @returns Whether package.json lists it as a dependency of any kind;
 *   false when there is no package.json.
 */
async function hasDependency(cwd: string, name: string): Promise<boolean> {
    // `--framework` sets a project up without detection, which is what read
    // package.json, so there may be none: it then lists nothing.
    const text = await readFileOrNull(path.join(cwd, 'package.json'));
    if (text === null) return false;
    const packageJson = JSON.parse(text) as {
        dependencies?: Record<string, string>;
        devDependencies?: Record<string, string>;
    };
    return name in { ...packageJson.dependencies, ...packageJson.devDependencies };
}

/**
 * @param cwd - Project root directory.
 * @returns Whether Next would already find a PostCSS config here.
 */
async function hasPostcssConfig(cwd: string): Promise<boolean> {
    // A framework init does not know may have no package.json at all; when
    // there is one, installing into the project has already parsed it.
    const text = await readFileOrNull(path.join(cwd, 'package.json'));
    if (text !== null && 'postcss' in (JSON.parse(text) as object)) return true;
    return (
        (await readFirstExisting(POSTCSS_CONFIG_FILES.map(name => path.join(cwd, name)))) !== null
    );
}

/**
 * Common locations for the main CSS entry file.
 */
const CSS_ENTRY_CANDIDATES = [
    'src/index.css',
    'src/app.css',
    'src/globals.css',
    'app/globals.css',
    'src/styles/index.css',
    'styles/globals.css',
];

/** Setup choices gathered from defaults or prompts. */
interface InitConfig {
    installTailwind: boolean;
    setupGitignore: boolean;
    setupTsconfig: boolean;
}

/**
 * @param options - Command line options
 */
export async function init(options: InitOptions = {}): Promise<void> {
    // Before anything is asked or installed: a value no framework has would
    // otherwise run the whole setup for the detected one.
    if (options.framework !== undefined && !isFramework(options.framework)) {
        printError(
            registryMessage({
                code: 'cli-option-invalid',
                args: { form: 'framework', value: options.framework },
            }),
        );
        process.exitCode = 1;
        return;
    }
    const cwd = options.cwd || process.cwd();
    const detected = getProjectInfo(cwd);
    const projectInfo: ProjectInfo = {
        ...detected,
        framework: options.framework ?? detected.framework,
    };

    printHeader('csszyx Setup Wizard');

    if (options.framework !== undefined) {
        printSuccess(
            `Framework: ${getFrameworkName(projectInfo.framework)} (from \`--framework\`)`,
        );
        printInfo(`Package Manager: ${projectInfo.packageManager}`);
    } else if (projectInfo.framework !== 'unknown') {
        printSuccess(`Detected: ${getFrameworkName(projectInfo.framework)}`);
        printInfo(`Package Manager: ${projectInfo.packageManager}`);
    }

    const config = await resolveInitConfig(projectInfo, options.yes);
    if (!(await installInitPackages(cwd, projectInfo, config))) return;
    if (!(await createInitFiles(cwd, projectInfo, config))) return;

    console.log();
    printSuccess('🎉 All done!');
    console.log();
    printInfo('Next steps:');
    console.log(`  • Run '${projectInfo.packageManager} run dev' to start`);
    if (projectInfo.hasTypeScript) {
        console.log('  • The `sz` prop is typed via csszyx-env.d.ts');
    }
    if (NEXTJS_FRAMEWORKS.has(projectInfo.framework)) {
        console.log('  • Using Turbopack? Production builds fail-closed until the safelist');
        console.log('    is seeded — wire the build script as:');
        console.log('      "build": "csszyx next prebuild \'app/**/*.tsx\' && next build"');
        console.log('    and run `csszyx next watch` alongside `next dev`.');
        console.log('    Setup guide: https://csszyx.com/docs/installation#nextjs-turbopack-setup');
    }
    console.log('  • Check the docs at https://csszyx.com');
}

/**
 * Resolve setup defaults and optional interactive overrides.
 * @param projectInfo - Detected project metadata.
 * @param acceptDefaults - Whether to skip prompts.
 * @returns Final setup configuration.
 */
async function resolveInitConfig(
    projectInfo: ProjectInfo,
    acceptDefaults = false,
): Promise<InitConfig> {
    const defaults: InitConfig = {
        installTailwind: !projectInfo.hasTailwind,
        setupGitignore: true,
        setupTsconfig: projectInfo.hasTypeScript,
    };
    if (acceptDefaults) return defaults;
    const answers = await prompts([
        {
            type: projectInfo.hasTailwind ? null : 'confirm',
            name: 'installTailwind',
            message: 'Install Tailwind CSS v4?',
            initial: true,
        },
        {
            type: 'confirm',
            name: 'setupGitignore',
            message: 'Add .csszyx to .gitignore?',
            initial: true,
        },
        {
            type: projectInfo.hasTypeScript ? 'confirm' : null,
            name: 'setupTsconfig',
            message: 'Add .csszyx/theme.d.ts to tsconfig.json (Theme Auto-Scan)?',
            initial: true,
        },
    ]);
    return { ...defaults, ...answers };
}

/**
 * Install runtime, type, and optional Tailwind packages.
 * @param cwd - Project directory.
 * @param projectInfo - Detected project metadata.
 * @param config - Final setup configuration.
 * @returns Whether installation succeeded.
 */
async function installInitPackages(
    cwd: string,
    projectInfo: ProjectInfo,
    config: InitConfig,
): Promise<boolean> {
    const spin = spinner.start('Installing csszyx...');
    try {
        // A Next.js project names `@csszyx/unplugin/...` in next.config and
        // postcss.config by package, as do the PostCSS lines init prints for a
        // framework it does not know, and a strict package manager (pnpm, Yarn
        // PnP) resolves only what the project lists, not what `csszyx` depends
        // on; the other frameworks import through `csszyx/vite` and friends.
        const packages =
            NEXTJS_FRAMEWORKS.has(projectInfo.framework) || projectInfo.framework === 'unknown'
                ? ['csszyx', '@csszyx/runtime', '@csszyx/unplugin']
                : ['csszyx', '@csszyx/runtime'];
        await execa(projectInfo.packageManager, ['add', ...packages], { cwd });
        if (projectInfo.hasTypeScript) {
            await execa(projectInfo.packageManager, ['add', '-D', '@csszyx/types'], { cwd });
        }
        if (config.installTailwind) {
            const integration =
                VITE_FRAMEWORKS.has(projectInfo.framework) ||
                PRINTED_VITE_CONFIGS[projectInfo.framework] !== undefined
                    ? '@tailwindcss/vite'
                    : '@tailwindcss/postcss';
            await execa(projectInfo.packageManager, ['add', '-D', 'tailwindcss', integration], {
                cwd,
            });
        }
        spinner.succeed(spin, 'Installed csszyx');
        return true;
    } catch (error) {
        spinner.fail(spin, 'Failed to install packages');
        printError(String(error));
        return false;
    }
}

/**
 * Create and update all selected integration files.
 * @param cwd - Project directory.
 * @param projectInfo - Detected project metadata.
 * @param config - Final setup configuration.
 * @returns Whether file setup succeeded.
 */
async function createInitFiles(
    cwd: string,
    projectInfo: ProjectInfo,
    config: InitConfig,
): Promise<boolean> {
    const spin = spinner.start('Creating config files...');
    try {
        await writeCsszyxConfig(cwd, projectInfo.hasTypeScript);
        const stylesheet = config.installTailwind ? await setupTailwindCss(cwd) : null;
        if (NEXTJS_FRAMEWORKS.has(projectInfo.framework)) {
            await setupNextPostcss(cwd, projectInfo, config.installTailwind);
        }
        await injectPlugin(cwd, projectInfo, {
            stylesheet,
            tailwindJustInstalled: config.installTailwind,
        });
        if (config.setupGitignore) await setupGitignore(cwd);
        if (config.setupTsconfig) await setupTsconfig(cwd);
        if (projectInfo.hasTypeScript) await setupSzTypes(cwd);
        spinner.succeed(spin, 'Created configuration files');
        return true;
    } catch (error) {
        spinner.fail(spin, 'Failed to create config files');
        printError(String(error));
        return false;
    }
}

/**
 * Write `csszyx.config`, unless the project already has one.
 *
 * The file `csszyx init` 0.17 wrote holds plugin options nothing read, and it
 * would be read before a new file beside it, so it is replaced. Any other
 * config is the project's own and is kept: a second file would not be read.
 *
 * @param cwd - Project directory.
 * @param typescript - Whether the project uses TypeScript.
 */
async function writeCsszyxConfig(cwd: string, typescript: boolean): Promise<void> {
    // `.mts`/`.mjs` outside a `"type": "module"` package, where Node would
    // read `.ts`/`.js` as CommonJS and the `export default` below with it.
    const name = csszyxConfigFileNameFor(cwd, { typescript });
    const found = findCsszyxConfigFile(cwd);
    if (found === null) {
        await fs.writeFile(path.join(cwd, name), generateConfigFile());
        return;
    }
    const existing = path.basename(found.file);
    if (!isLegacyInitTemplate(await fs.readFile(found.file, 'utf8'))) {
        printInfo(`Kept ${existing}; init writes a csszyx config only where there is none.`);
        return;
    }
    await fs.remove(found.file);
    await fs.writeFile(path.join(cwd, name), generateConfigFile());
    printInfo(`Replaced ${existing}, the file csszyx init 0.17 wrote, with ${name}.`);
}

/**
 * Add the generated theme directory to gitignore.
 * @param cwd - Project directory.
 */
async function setupGitignore(cwd: string): Promise<void> {
    const gitignorePath = path.join(cwd, '.gitignore');
    const existing = await readFileOrNull(gitignorePath);
    if (existing === null) {
        await fs.writeFile(gitignorePath, 'node_modules\n.csszyx\n');
    } else if (!existing.includes('.csszyx')) {
        await fs.appendFile(gitignorePath, '\n# csszyx generated theme types\n.csszyx\n');
    }
}

/**
 * Walk up from `cwd` (excluding `cwd` itself) for a workspace root —
 * `pnpm-workspace.yaml`, a `package.json` with a `workspaces` field, or an
 * nx/lerna marker. When found, `cwd` is a package INSIDE a monorepo, where
 * Tailwind v4's automatic content detection would otherwise climb to the
 * workspace root and scan sibling packages + docs.
 * @param cwd - Project root directory being initialized.
 * @returns True when an ancestor directory is a workspace root.
 */
export async function isInsideWorkspace(cwd: string): Promise<boolean> {
    const ancestors: string[] = [];
    let dir = path.dirname(path.resolve(cwd));
    const { root } = path.parse(dir);
    while (dir !== root) {
        ancestors.push(dir);
        dir = path.dirname(dir);
    }
    const found = await firstInOrder(ancestors, async ancestor =>
        (await isWorkspaceRoot(ancestor)) ? ancestor : null,
    );
    return found !== null;
}

/** Files whose presence alone marks a workspace root. */
const WORKSPACE_MARKERS = ['pnpm-workspace.yaml', 'nx.json', 'lerna.json'];

/**
 * Whether one directory is a workspace root.
 *
 * @param dir - The directory.
 * @returns True for a workspace marker file or a `workspaces` field.
 */
async function isWorkspaceRoot(dir: string): Promise<boolean> {
    const markers = await Promise.all(
        WORKSPACE_MARKERS.map(name => fs.pathExists(path.join(dir, name))),
    );
    if (markers.includes(true)) return true;
    const pkg = await readFileOrNull(path.join(dir, 'package.json'));
    if (!pkg) return false;
    try {
        return 'workspaces' in (JSON.parse(pkg) as object);
    } catch {
        // Malformed package.json — ignore and keep walking up.
        return false;
    }
}

/**
 * The Tailwind v4 import block for a CSS entry. Inside a monorepo, scope content
 * detection to this package — `source(none)` disables the climb-to-workspace-root
 * scan and an explicit `@source` adds back only this package (csszyx auto-injects
 * its own `@source` for generated classes). Outside a monorepo the bare import is
 * correct. `source(none)` is used rather than a narrowing `source("..")` because
 * automatic detection can still escape a narrowed base in some bundler pipelines.
 * @param cssDir - Directory containing the CSS entry file.
 * @param cwd - Project root directory.
 * @param monorepo - Whether this package sits inside a workspace.
 * @returns CSS text to write at the top of the entry file.
 */
export function tailwindImportBlock(cssDir: string, cwd: string, monorepo: boolean): string {
    if (!monorepo) return '@import "tailwindcss";\n';
    const rel = path.relative(path.resolve(cssDir), path.resolve(cwd)) || '.';
    const src = rel.split(path.sep).join('/');
    return (
        "/* Monorepo: scope Tailwind's content detection to this package. Its\n" +
        '   automatic detection otherwise climbs to the workspace root and scans\n' +
        '   sibling packages + docs (.md/.mdx/.txt are NOT ignored), generating\n' +
        '   phantom or broken url() classes. csszyx auto-injects @source for its\n' +
        '   generated classes; this @source covers your own templates. See\n' +
        '   https://csszyx.com/docs/monorepo-content-scope/ */\n' +
        '@import "tailwindcss" source(none);\n' +
        `@source "${src}";\n`
    );
}

/**
 * Inject Tailwind v4 @import into the main CSS entry file.
 * If no CSS entry file is found, creates src/index.css.
 * @param cwd - Project root directory.
 * @returns The stylesheet init created or edited, from `cwd` with `/`
 *   separators, or `null` when it already imported Tailwind.
 */
async function setupTailwindCss(cwd: string): Promise<string | null> {
    const monorepo = await isInsideWorkspace(cwd);
    const found = await readFirstExisting(
        CSS_ENTRY_CANDIDATES.map(candidate => path.join(cwd, candidate)),
    );
    let cssPath = found?.path;
    const content = found?.content ?? null;

    if (!cssPath || content === null) {
        // Create src/index.css as the entry CSS file
        cssPath = path.join(cwd, 'src/index.css');
        await fs.ensureDir(path.dirname(cssPath));
        await fs.writeFile(cssPath, tailwindImportBlock(path.dirname(cssPath), cwd, monorepo));
        printInfo(`Created ${path.relative(cwd, cssPath)} with Tailwind v4 import`);
        return toPosix(path.relative(cwd, cssPath));
    }

    if (!content.includes('@import "tailwindcss"') && !content.includes("@import 'tailwindcss'")) {
        await fs.writeFile(
            cssPath,
            `${tailwindImportBlock(path.dirname(cssPath), cwd, monorepo)}\n${content}`,
        );
        printInfo(`Added Tailwind v4 import to ${path.relative(cwd, cssPath)}`);
        return toPosix(path.relative(cwd, cssPath));
    }
    return null;
}

/**
 * @param relative - A path from the project root.
 * @returns The same path with `/` separators, as config files write it.
 */
function toPosix(relative: string): string {
    return relative.split(path.sep).join('/');
}

/**
 * Give a Next.js project the PostCSS config Tailwind v4 needs there, with
 * csszyx's plugin in front of Tailwind so the generated safelist is read.
 *
 * Runs whether or not a CSS entry was found: the config is about how Next
 * runs Tailwind, not about any one stylesheet.
 * @param cwd - Project root directory.
 * @param projectInfo - Detected project metadata, for the package manager.
 * @param tailwindJustInstalled - Whether this run already installed Tailwind
 *   and its PostCSS adapter.
 */
async function setupNextPostcss(
    cwd: string,
    projectInfo: ProjectInfo,
    tailwindJustInstalled: boolean,
): Promise<void> {
    if (!(await hasPostcssConfig(cwd))) {
        // The config names `@tailwindcss/postcss`; a project that already had
        // `tailwindcss` but no PostCSS config does not have the adapter, and a
        // config naming a package the project lacks fails the first `next dev`.
        if (!tailwindJustInstalled && !(await hasDependency(cwd, '@tailwindcss/postcss'))) {
            await execa(projectInfo.packageManager, ['add', '-D', '@tailwindcss/postcss'], { cwd });
        }
        await fs.writeFile(path.join(cwd, 'postcss.config.mjs'), generatePostcssConfig());
        printInfo('Created postcss.config.mjs for Tailwind v4 and the csszyx safelist');
        return;
    }
    printPostcssPluginLines();
}

/**
 * Say what to add to the PostCSS config a project already has.
 *
 * Rewriting someone's PostCSS config is too risky, so init prints the two
 * plugin entries in the order they have to run.
 */
function printPostcssPluginLines(): void {
    printInfo('Keeping your PostCSS config. Add csszyx BEFORE Tailwind in its plugins:');
    console.log(`    ${CSSZYX_POSTCSS_PLUGIN_LINE}`);
    console.log("    '@tailwindcss/postcss': {},");
}

/**
 * Print the setup for a framework init does not know: Tailwind through
 * PostCSS, which is the integration init installs for it, with csszyx's
 * PostCSS plugin first, and the Vite lines for a project that builds with
 * Vite after all.
 *
 * @param cwd - Project root directory.
 * @param projectInfo - Detected project metadata, for the package manager.
 * @param setup - What the earlier steps did, as {@link injectPlugin} takes it.
 * @param setup.stylesheet - The stylesheet init created or edited, or `null`.
 * @param setup.tailwindJustInstalled - Whether this run installed Tailwind
 *   and `@tailwindcss/postcss`.
 */
async function printPostcssSetup(
    cwd: string,
    projectInfo: ProjectInfo,
    setup: { stylesheet: string | null; tailwindJustInstalled: boolean },
): Promise<void> {
    if (await hasPostcssConfig(cwd)) {
        printPostcssPluginLines();
    } else {
        printInfo('Create `postcss.config.mjs` so PostCSS runs csszyx before Tailwind:');
        console.log(`\n${generatePostcssConfig().replace(/^(?=.)/gm, '  ')}`);
    }
    await printTailwindAdapterStep(cwd, projectInfo, {
        subject: 'The config above names',
        adapter: '@tailwindcss/postcss',
        installed: setup.tailwindJustInstalled,
    });
    if (setup.stylesheet !== null) {
        printInfo(
            `Import \`${setup.stylesheet}\` from your app's entry file, so your bundler runs it through PostCSS.`,
        );
    }
    printInfo(
        "Add csszyx to your bundler too. For webpack, put `csszyxWebpack()` first in `plugins`, with `import csszyxWebpack from 'csszyx/webpack';`.",
    );
    printInfo(
        'Building with Vite? Use these lines in `vite.config.ts` instead of the PostCSS lines above:',
    );
    console.log(viteConfigLines());
    // Init installed the PostCSS adapter, not this one.
    await printTailwindAdapterStep(cwd, projectInfo, {
        subject: 'The lines above import',
        adapter: '@tailwindcss/vite',
        installed: false,
    });
}

/**
 * Inject csszyx plugin into vite.config.ts/js or next.config.js/ts.
 * Falls back to printing manual instructions if injection fails, and prints
 * the PostCSS setup for a framework init does not know.
 * @param cwd - Project root directory.
 * @param projectInfo - Detected project metadata, with the framework to set up.
 * @param setup - What the earlier steps did.
 * @param setup.stylesheet - The stylesheet init created or edited, or `null`.
 * @param setup.tailwindJustInstalled - Whether this run installed Tailwind
 *   and the integration the framework gets: `@tailwindcss/vite`, or
 *   `@tailwindcss/postcss` for Next.js and a framework init does not know.
 */
async function injectPlugin(
    cwd: string,
    projectInfo: ProjectInfo,
    setup: { stylesheet: string | null; tailwindJustInstalled: boolean },
): Promise<void> {
    const { framework } = projectInfo;
    if (VITE_FRAMEWORKS.has(framework)) {
        await setupViteConfig(cwd, projectInfo, setup.tailwindJustInstalled);
    } else if (NEXTJS_FRAMEWORKS.has(framework)) {
        const injected = await injectNextPlugin(cwd);
        if (!injected) {
            printWarn('Could not auto-inject csszyx plugin. Add manually to next.config.js:');
            console.log(generateNextPluginInstructions());
        }
    } else if (PRINTED_VITE_CONFIGS[framework] !== undefined) {
        await printFrameworkViteLines(cwd, projectInfo, PRINTED_VITE_CONFIGS[framework], setup);
    } else {
        await printPostcssSetup(cwd, projectInfo, setup);
    }
}

/**
 * Add csszyx to the project's `vite.config`, or print the lines when init
 * cannot, and say how to add `@tailwindcss/vite` when what init wrote or
 * printed imports it and the project does not list it.
 *
 * @param cwd - Project root directory.
 * @param projectInfo - Detected project metadata, for the package manager.
 * @param tailwindJustInstalled - Whether this run installed Tailwind and
 *   `@tailwindcss/vite`.
 */
async function setupViteConfig(
    cwd: string,
    projectInfo: ProjectInfo,
    tailwindJustInstalled: boolean,
): Promise<void> {
    const injected = await injectVitePlugin(cwd);
    if (injected === null) {
        printWarn('Could not auto-inject csszyx plugin. Add manually to vite.config.ts:');
        console.log(viteConfigLines());
        await printTailwindAdapterStep(cwd, projectInfo, {
            subject: 'The lines above import',
            adapter: '@tailwindcss/vite',
            installed: tailwindJustInstalled,
        });
    } else if (injected.addedTailwindImport) {
        await printTailwindAdapterStep(cwd, projectInfo, {
            subject: `\`${injected.file}\` now imports`,
            adapter: '@tailwindcss/vite',
            installed: tailwindJustInstalled,
        });
    }
}

/**
 * Say how to add a Tailwind integration, `@tailwindcss/vite` or
 * `@tailwindcss/postcss`, when the project does not list it.
 *
 * A project already on Tailwind through another integration does not have
 * this one, and init installs one only alongside Tailwind itself.
 *
 * @param cwd - Project root directory.
 * @param projectInfo - Detected project metadata, for the package manager.
 * @param step - What names the integration, and whether init installed it.
 * @param step.subject - What names it, as the sentence begins: the lines
 *   init printed, or the file it edited.
 * @param step.adapter - The integration's package name.
 * @param step.installed - Whether this run installed it.
 */
async function printTailwindAdapterStep(
    cwd: string,
    projectInfo: ProjectInfo,
    step: { subject: string; adapter: string; installed: boolean },
): Promise<void> {
    if (step.installed || (await hasDependency(cwd, step.adapter))) return;
    printInfo(
        `${step.subject} \`${step.adapter}\`, which this project does not list: run \`${projectInfo.packageManager} add -D ${step.adapter}\`.`,
    );
}

/**
 * Print the Vite plugin lines for a framework init does not edit the config
 * of, and the steps the lines alone leave out.
 *
 * @param cwd - Project root directory.
 * @param projectInfo - Detected project metadata, for the package manager.
 * @param printed - Where the framework keeps its Vite plugins.
 * @param setup - What the earlier steps did, as {@link injectPlugin} takes it.
 * @param setup.stylesheet - The stylesheet init created or edited, or `null`.
 * @param setup.tailwindJustInstalled - Whether this run installed Tailwind.
 */
async function printFrameworkViteLines(
    cwd: string,
    projectInfo: ProjectInfo,
    printed: PrintedViteConfig,
    setup: { stylesheet: string | null; tailwindJustInstalled: boolean },
): Promise<void> {
    printInfo(`Add csszyx to \`${printed.file}\`:`);
    console.log(printed.lines(setup.stylesheet));
    if (setup.stylesheet !== null && printed.stylesheetStep !== undefined) {
        printInfo(printed.stylesheetStep(setup.stylesheet));
    }
    await printTailwindAdapterStep(cwd, projectInfo, {
        subject: 'The lines above import',
        adapter: '@tailwindcss/vite',
        installed: setup.tailwindJustInstalled,
    });
}

/**
 * Inject csszyx + tailwindcss into vite.config.ts / vite.config.js.
 * @param cwd - Project root directory.
 * @returns The config's file name and whether init added the
 *   `@tailwindcss/vite` import to it, or null when injection failed.
 */
async function injectVitePlugin(
    cwd: string,
): Promise<{ file: string; addedTailwindImport: boolean } | null> {
    const candidates = [
        path.join(cwd, 'vite.config.ts'),
        path.join(cwd, 'vite.config.js'),
        path.join(cwd, 'vite.config.mts'),
        path.join(cwd, 'vite.config.mjs'),
    ];

    const found = await readFirstExisting(candidates);
    const configPath = found?.path;
    let content = found?.content ?? null;

    if (!configPath || content === null) {
        return null;
    }
    const file = path.basename(configPath);

    // Skip if already has csszyx import
    if (content.includes('csszyx')) {
        return { file, addedTailwindImport: false };
    }

    // Inject import statements after the last existing import line
    const addedTailwindImport = !content.includes('@tailwindcss/vite');
    const importBlock = [
        "import csszyx from 'csszyx/vite';",
        addedTailwindImport ? "import tailwindcss from '@tailwindcss/vite';" : null,
    ]
        .filter(Boolean)
        .join('\n');

    const lastImportMatch = [...content.matchAll(/^import .+$/gm)].pop();
    if (lastImportMatch?.index === undefined) {
        return null;
    }

    const insertAt = lastImportMatch.index + lastImportMatch[0].length;
    content = `${content.slice(0, insertAt)}\n${importBlock}${content.slice(insertAt)}`;

    // Inject ...csszyx() as first plugin, before tailwindcss() if present
    const pluginsMatch = /plugins\s*:\s*\[/.exec(content);
    if (pluginsMatch?.index === undefined) {
        return null;
    }

    const pluginsInsertAt = pluginsMatch.index + pluginsMatch[0].length;
    const twEntry = content.includes('tailwindcss()') ? '' : '\n    tailwindcss(),';
    content =
        content.slice(0, pluginsInsertAt) +
        `\n    ...csszyx(),      // csszyx MUST come before tailwindcss${twEntry}` +
        content.slice(pluginsInsertAt);

    await fs.writeFile(configPath, content);
    printInfo(`Injected csszyx plugin into ${file}`);
    return { file, addedTailwindImport };
}

/**
 * Inject csszyx webpack plugin into next.config.js / next.config.ts.
 * Returns true if injection succeeded.
 * @param cwd - Project root directory.
 * @returns True if injection succeeded.
 */
export async function injectNextPlugin(cwd: string): Promise<boolean> {
    const candidates = [
        path.join(cwd, 'next.config.ts'),
        path.join(cwd, 'next.config.mjs'),
        path.join(cwd, 'next.config.js'),
    ];

    const found = await readFirstExisting(candidates);
    let configPath = found?.path;
    const content = found?.content ?? null;

    if (!configPath) {
        // Create next.config.js
        configPath = path.join(cwd, 'next.config.js');
        await fs.writeFile(configPath, generateNextConfig());
        printInfo('Created next.config.js with csszyx plugin');
        return true;
    }

    // next.config already exists but doesn't have csszyx — too risky to auto-modify
    return content?.includes('csszyx') ?? false;
}

/**
 * Inject .csszyx/theme.d.ts into tsconfig.json include array.
 * @param cwd - Project root directory.
 */
async function setupTsconfig(cwd: string): Promise<void> {
    const primary = path.join(cwd, 'tsconfig.json');
    const viteTsConfig = path.join(cwd, 'tsconfig.app.json');
    let tsconfigPath = primary;
    let content = await readFileOrNull(tsconfigPath);
    if (content === null) {
        tsconfigPath = viteTsConfig;
        content = await readFileOrNull(tsconfigPath);
    }
    if (content === null) {
        return;
    }
    if (content.includes('.csszyx')) {
        return;
    }

    const includeMatch = /"include"\s*:\s*\[/.exec(content);
    if (includeMatch?.index !== undefined) {
        const insertPos = includeMatch.index + includeMatch[0].length;
        content =
            content.slice(0, insertPos) +
            '\n    "./.csszyx/theme.d.ts",\n    "./.csszyx",' +
            content.slice(insertPos);
        await fs.writeFile(tsconfigPath, content);
    }
}

/**
 * Create csszyx-env.d.ts (the `sz` JSX type augmentation reference) and make
 * sure TypeScript picks it up. Without it the `sz` prop errors with
 * "Property 'sz' does not exist on type 'DetailedHTMLProps<...>'", especially
 * under pnpm or when `csszyx` is never imported directly.
 * @param cwd - Project root directory.
 */
export async function setupSzTypes(cwd: string): Promise<void> {
    const envPath = path.join(cwd, 'csszyx-env.d.ts');
    const reference = '/// <reference types="@csszyx/types/jsx" />';
    const existing = await readFileOrNull(envPath);
    if (existing === null) {
        await fs.writeFile(
            envPath,
            `// Generated by csszyx. Enables the \`sz\` JSX prop types.\n${reference}\n`,
        );
        printInfo('Created csszyx-env.d.ts (sz prop types)');
    } else if (!existing.includes('@csszyx/types/jsx')) {
        await fs.writeFile(envPath, `${existing.trimEnd()}\n${reference}\n`);
        printInfo('Added the sz type reference to csszyx-env.d.ts');
    }
    await ensureTsconfigInclude(cwd, 'csszyx-env.d.ts');
}

/**
 * Add an entry to the `include` array of the project's tsconfig when missing.
 * Best-effort: returns silently when there is no tsconfig or no include array
 * (a root `.d.ts` is usually covered by the default include already).
 * @param cwd - Project root directory.
 * @param entry - The include path to add.
 */
async function ensureTsconfigInclude(cwd: string, entry: string): Promise<void> {
    const found = await readFirstExisting(
        ['tsconfig.json', 'tsconfig.app.json'].map(name => path.join(cwd, name)),
    );
    if (found === null || found.content.includes(entry)) {
        return;
    }
    const { path: tsconfigPath, content } = found;
    const includeMatch = /"include"\s*:\s*\[/.exec(content);
    if (includeMatch?.index !== undefined) {
        const insertPos = includeMatch.index + includeMatch[0].length;
        await fs.writeFile(
            tsconfigPath,
            `${content.slice(0, insertPos)}\n    "${entry}",${content.slice(insertPos)}`,
        );
    }
}

/**
 * Generate the `csszyx.config` content for a new project.
 *
 * Every plugin, `csszyx check` and the Next commands read this file, for its
 * `diagnostics` section. It goes through `defineConfig`, whose argument is
 * all optional: the file used to declare `const config: CsszyxConfig`, which
 * requires every section, so a fresh project failed `tsc --strict` (TS2741).
 * The same text loads as `.js`: there is no type annotation in it.
 *
 * @returns The config file content as a string.
 */
export function generateConfigFile(): string {
    return `import { defineConfig } from 'csszyx';

export default defineConfig({
  diagnostics: {
    // 'recommended' fails \`csszyx check\` on mistakes only; 'atomic' also
    // reports every site where csszyx changed what was written.
    preset: 'recommended',
  },
});
`;
}

/**
 * Generate postcss.config.mjs content for Tailwind v4 / Next.js.
 * @returns The PostCSS config file content.
 */
function generatePostcssConfig(): string {
    return `export default {
  plugins: {
    // Points Tailwind at the safelist csszyx writes; must run before Tailwind.
    ${CSSZYX_POSTCSS_PLUGIN_LINE}
    '@tailwindcss/postcss': {},
  },
};
`;
}

/**
 * Generate a minimal next.config.js with csszyx webpack plugin.
 * @returns The next.config.js content.
 */
function generateNextConfig(): string {
    return `const csszyxWebpack = require('@csszyx/unplugin/webpack').default;

/** @type {import('next').NextConfig} */
const nextConfig = {
  webpack(config) {
    config.plugins.unshift(...csszyxWebpack());
    return config;
  },
};

module.exports = nextConfig;
`;
}

/**
 * The lines for a `vite.config.ts` that loads as pasted: `defineConfig` is
 * imported, and csszyx comes before Tailwind.
 *
 * @param framework - The framework's own plugin, which goes after both; a
 *   placeholder for the project's other plugins when there is none.
 * @param framework.importLine - The line that imports it.
 * @param framework.plugin - The call that adds it.
 * @returns Instruction snippet for vite.config.ts.
 */
function viteConfigLines(framework?: { importLine: string; plugin: string }): string {
    const frameworkImport = framework === undefined ? '' : `  ${framework.importLine}\n`;
    const lastPlugin =
        framework === undefined ? '// ...your other plugins' : `${framework.plugin},`;
    return `
${frameworkImport}  import { defineConfig } from 'vite';
  import csszyx from 'csszyx/vite';
  import tailwindcss from '@tailwindcss/vite';

  export default defineConfig({
    plugins: [
      ...csszyx(),      // csszyx MUST come before tailwindcss
      tailwindcss(),
      ${lastPlugin}
    ],
  });
`;
}

/** The plugin list a framework config holds under its `vite` key. */
const NESTED_VITE_PLUGINS = `    vite: {
      plugins: [
        ...csszyx(),      // csszyx MUST come before tailwindcss
        tailwindcss(),
      ],
    },
  });
`;

/**
 * The lines for `nuxt.config.ts`. Nuxt auto-imports `defineNuxtConfig`, and
 * loads a global stylesheet only from its `css` option or an import.
 *
 * @param stylesheet - The stylesheet init created or edited, or `null`.
 * @returns Instruction snippet for that file.
 */
function nuxtConfigLines(stylesheet: string | null): string {
    // `~~` is the project root in every Nuxt version; `~` is `app/` in Nuxt 4.
    const css = stylesheet === null ? '' : `    css: ['~~/${stylesheet}'],\n`;
    return `
  import csszyx from 'csszyx/vite';
  import tailwindcss from '@tailwindcss/vite';

  export default defineNuxtConfig({
    // ...your existing options
${css}${NESTED_VITE_PLUGINS}`;
}

/**
 * The lines for `astro.config.mjs`, as Tailwind's Astro guide writes it.
 *
 * @returns Instruction snippet for that file.
 */
function astroConfigLines(): string {
    return `
  // @ts-check
  import { defineConfig } from 'astro/config';
  import csszyx from 'csszyx/vite';
  import tailwindcss from '@tailwindcss/vite';

  export default defineConfig({
    // ...your existing options
${NESTED_VITE_PLUGINS}`;
}

/**
 * The lines for a SvelteKit `vite.config.ts`, in the plugin order Tailwind's
 * SvelteKit guide uses.
 *
 * @returns Instruction snippet for that file.
 */
function svelteKitConfigLines(): string {
    return viteConfigLines({
        importLine: "import { sveltekit } from '@sveltejs/kit/vite';",
        plugin: 'sveltekit()',
    });
}

/**
 * Generate manual Next.js plugin installation instructions as a string.
 * @returns Instruction snippet for next.config.js.
 */
function generateNextPluginInstructions(): string {
    return `
  const csszyxWebpack = require('@csszyx/unplugin/webpack').default;

  module.exports = {
    webpack(config) {
      config.plugins.unshift(...csszyxWebpack());
      return config;
    },
  };
`;
}
