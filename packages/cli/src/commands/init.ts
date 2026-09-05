/**
 * csszyx init - Setup wizard for new projects.
 */

import path from 'node:path';

import { execa } from 'execa';
import fs from 'fs-extra';
import prompts from 'prompts';

import {
    type Framework,
    getFrameworkName,
    getProjectInfo,
    type ProjectInfo,
} from '../utils/framework-detector.js';
import {
    printError,
    printHeader,
    printInfo,
    printSuccess,
    printWarn,
    spinner,
} from '../utils/terminal-ui.js';

/**
 *
 */
export interface InitOptions {
    framework?: Framework;
    yes?: boolean;
    cwd?: string;
}

const VITE_FRAMEWORKS = new Set<Framework>(['vite-react', 'vite-vue', 'vite-svelte']);

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
 * @returns Whether package.json lists it as a dependency of any kind.
 */
async function hasDependency(cwd: string, name: string): Promise<boolean> {
    const packageJson = JSON.parse(await fs.readFile(path.join(cwd, 'package.json'), 'utf8')) as {
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
    // Framework detection has already read and parsed this file, so it is
    // there and it is JSON by the time init reaches the PostCSS step.
    const packageJson = JSON.parse(
        await fs.readFile(path.join(cwd, 'package.json'), 'utf8'),
    ) as Record<string, unknown>;
    if ('postcss' in packageJson) return true;
    for (const name of POSTCSS_CONFIG_FILES) {
        if ((await readFileOrNull(path.join(cwd, name))) !== null) return true;
    }
    return false;
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
    enableSSR: boolean;
    enableRecovery: boolean;
    installTailwind: boolean;
    setupGitignore: boolean;
    setupTsconfig: boolean;
}

/**
 * @param options - Command line options
 */
export async function init(options: InitOptions = {}): Promise<void> {
    const cwd = options.cwd || process.cwd();
    const projectInfo = getProjectInfo(cwd);

    printHeader('csszyx Setup Wizard');

    if (projectInfo.framework !== 'unknown') {
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
        enableSSR: true,
        enableRecovery: true,
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
            name: 'enableSSR',
            message: 'Enable SSR Hydration Guard?',
            initial: true,
        },
        {
            type: 'confirm',
            name: 'enableRecovery',
            message: 'Enable development mode recovery?',
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
        // postcss.config by package, and a strict package manager (pnpm, Yarn
        // PnP) resolves only what the project lists, not what `csszyx` depends
        // on; the other frameworks import through `csszyx/vite` and friends.
        const packages = NEXTJS_FRAMEWORKS.has(projectInfo.framework)
            ? ['csszyx', '@csszyx/runtime', '@csszyx/unplugin']
            : ['csszyx', '@csszyx/runtime'];
        await execa(projectInfo.packageManager, ['add', ...packages], { cwd });
        if (projectInfo.hasTypeScript) {
            await execa(projectInfo.packageManager, ['add', '-D', '@csszyx/types'], { cwd });
        }
        if (config.installTailwind) {
            const integration = VITE_FRAMEWORKS.has(projectInfo.framework)
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
        const configPath = path.join(
            cwd,
            projectInfo.hasTypeScript ? 'csszyx.config.ts' : 'csszyx.config.js',
        );
        await fs.writeFile(configPath, generateConfigFile());
        if (config.installTailwind) await setupTailwindCss(cwd);
        if (NEXTJS_FRAMEWORKS.has(projectInfo.framework)) {
            await setupNextPostcss(cwd, projectInfo, config.installTailwind);
        }
        await injectPlugin(cwd, projectInfo.framework);
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
    let dir = path.dirname(path.resolve(cwd));
    const { root } = path.parse(dir);
    while (dir !== root) {
        if (
            (await fs.pathExists(path.join(dir, 'pnpm-workspace.yaml'))) ||
            (await fs.pathExists(path.join(dir, 'nx.json'))) ||
            (await fs.pathExists(path.join(dir, 'lerna.json')))
        ) {
            return true;
        }
        const pkg = await readFileOrNull(path.join(dir, 'package.json'));
        if (pkg) {
            try {
                if ('workspaces' in (JSON.parse(pkg) as object)) return true;
            } catch {
                // Malformed package.json — ignore and keep walking up.
            }
        }
        dir = path.dirname(dir);
    }
    return false;
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
 */
async function setupTailwindCss(cwd: string): Promise<void> {
    const monorepo = await isInsideWorkspace(cwd);
    let cssPath: string | undefined;
    let content: string | null = null;
    for (const candidate of CSS_ENTRY_CANDIDATES) {
        const full = path.join(cwd, candidate);
        const existing = await readFileOrNull(full);
        if (existing !== null) {
            cssPath = full;
            content = existing;
            break;
        }
    }

    if (!cssPath || content === null) {
        // Create src/index.css as the entry CSS file
        cssPath = path.join(cwd, 'src/index.css');
        await fs.ensureDir(path.dirname(cssPath));
        await fs.writeFile(cssPath, tailwindImportBlock(path.dirname(cssPath), cwd, monorepo));
        printInfo(`Created ${path.relative(cwd, cssPath)} with Tailwind v4 import`);
        return;
    }

    if (!content.includes('@import "tailwindcss"') && !content.includes("@import 'tailwindcss'")) {
        await fs.writeFile(
            cssPath,
            `${tailwindImportBlock(path.dirname(cssPath), cwd, monorepo)}\n${content}`,
        );
        printInfo(`Added Tailwind v4 import to ${path.relative(cwd, cssPath)}`);
    }
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
    // Rewriting someone's PostCSS config is too risky; say exactly what to add.
    printInfo('Keeping your PostCSS config. Add csszyx BEFORE Tailwind in its plugins:');
    console.log(`    ${CSSZYX_POSTCSS_PLUGIN_LINE}`);
    console.log("    '@tailwindcss/postcss': {},");
}

/**
 * Inject csszyx plugin into vite.config.ts/js or next.config.js/ts.
 * Falls back to printing manual instructions if injection fails.
 * @param cwd - Project root directory.
 * @param framework - Detected or specified framework.
 */
async function injectPlugin(cwd: string, framework: Framework): Promise<void> {
    if (VITE_FRAMEWORKS.has(framework)) {
        const injected = await injectVitePlugin(cwd);
        if (!injected) {
            printWarn('Could not auto-inject csszyx plugin. Add manually to vite.config.ts:');
            console.log(generateVitePluginInstructions());
        }
    } else if (NEXTJS_FRAMEWORKS.has(framework)) {
        const injected = await injectNextPlugin(cwd);
        if (!injected) {
            printWarn('Could not auto-inject csszyx plugin. Add manually to next.config.js:');
            console.log(generateNextPluginInstructions());
        }
    } else {
        // Unknown/other frameworks: print manual instructions
        printInfo('Add csszyx plugin to your bundler config:');
        console.log(generateVitePluginInstructions());
    }
}

/**
 * Inject csszyx + tailwindcss into vite.config.ts / vite.config.js.
 * Returns true if injection succeeded.
 * @param cwd - Project root directory.
 * @returns True if injection succeeded.
 */
async function injectVitePlugin(cwd: string): Promise<boolean> {
    const candidates = [
        path.join(cwd, 'vite.config.ts'),
        path.join(cwd, 'vite.config.js'),
        path.join(cwd, 'vite.config.mts'),
        path.join(cwd, 'vite.config.mjs'),
    ];

    let configPath: string | undefined;
    let content: string | null = null;
    for (const c of candidates) {
        const existing = await readFileOrNull(c);
        if (existing !== null) {
            configPath = c;
            content = existing;
            break;
        }
    }

    if (!configPath || content === null) {
        return false;
    }

    // Skip if already has csszyx import
    if (content.includes('csszyx')) {
        return true;
    }

    // Inject import statements after the last existing import line
    const importBlock = [
        "import csszyx from 'csszyx/vite';",
        content.includes('@tailwindcss/vite')
            ? null
            : "import tailwindcss from '@tailwindcss/vite';",
    ]
        .filter(Boolean)
        .join('\n');

    const lastImportMatch = [...content.matchAll(/^import .+$/gm)].pop();
    if (lastImportMatch?.index === undefined) {
        return false;
    }

    const insertAt = lastImportMatch.index + lastImportMatch[0].length;
    content = `${content.slice(0, insertAt)}\n${importBlock}${content.slice(insertAt)}`;

    // Inject ...csszyx() as first plugin, before tailwindcss() if present
    const pluginsMatch = /plugins\s*:\s*\[/.exec(content);
    if (pluginsMatch?.index === undefined) {
        return false;
    }

    const pluginsInsertAt = pluginsMatch.index + pluginsMatch[0].length;
    const twEntry = content.includes('tailwindcss()') ? '' : '\n    tailwindcss(),';
    content =
        content.slice(0, pluginsInsertAt) +
        `\n    ...csszyx(),      // csszyx MUST come before tailwindcss${twEntry}` +
        content.slice(pluginsInsertAt);

    await fs.writeFile(configPath, content);
    printInfo(`Injected csszyx plugin into ${path.basename(configPath)}`);
    return true;
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

    let configPath: string | undefined;
    let content: string | null = null;
    for (const c of candidates) {
        const existing = await readFileOrNull(c);
        if (existing !== null) {
            configPath = c;
            content = existing;
            break;
        }
    }

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
    for (const name of ['tsconfig.json', 'tsconfig.app.json']) {
        const tsconfigPath = path.join(cwd, name);
        const content = await readFileOrNull(tsconfigPath);
        if (content === null) {
            continue;
        }
        if (content.includes(entry)) {
            return;
        }
        const includeMatch = /"include"\s*:\s*\[/.exec(content);
        if (includeMatch?.index !== undefined) {
            const insertPos = includeMatch.index + includeMatch[0].length;
            await fs.writeFile(
                tsconfigPath,
                `${content.slice(0, insertPos)}\n    "${entry}",${content.slice(insertPos)}`,
            );
        }
        return;
    }
}

/**
 * Generate csszyx.config.ts content for a new project.
 *
 * It takes no answers any more. The one key the interactive flow used to write
 * here was `production.injectChecksum`, and nothing read it — so the questions
 * it was gathered from decided nothing about the file.
 *
 * @returns The config file content as a string.
 */
function generateConfigFile(): string {
    return `import type { CsszyxConfig } from 'csszyx';

const config: CsszyxConfig = {
  development: {
    debug: true,
  },
};

export default config;
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
 * Generate manual Vite plugin installation instructions as a string.
 * @returns Instruction snippet for vite.config.ts.
 */
function generateVitePluginInstructions(): string {
    return `
  import csszyx from 'csszyx/vite';
  import tailwindcss from '@tailwindcss/vite';

  export default defineConfig({
    plugins: [
      ...csszyx(),      // csszyx MUST come before tailwindcss
      tailwindcss(),
      // ...your other plugins
    ],
  });
`;
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
