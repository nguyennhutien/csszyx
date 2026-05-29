/**
 * csszyx init - Setup wizard for new projects.
 */

import path from 'node:path';

import { execa } from 'execa';
import fs from 'fs-extra';
import prompts from 'prompts';

import { type Framework, getFrameworkName, getProjectInfo } from '../utils/framework-detector.js';
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

    let config = {
        enableSSR: true,
        enableRecovery: true,
        installTailwind: !projectInfo.hasTailwind,
        setupGitignore: true,
        setupTsconfig: !!projectInfo.hasTypeScript,
    };

    if (!options.yes) {
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

        config = { ...config, ...answers };
    }

    // Install packages
    const spin = spinner.start('Installing csszyx...');
    try {
        await execa(projectInfo.packageManager, ['add', 'csszyx'], { cwd });
        if (config.installTailwind) {
            // Tailwind v4: install the appropriate integration package
            const twPackage = VITE_FRAMEWORKS.has(projectInfo.framework)
                ? '@tailwindcss/vite'
                : '@tailwindcss/postcss';
            await execa(projectInfo.packageManager, ['add', '-D', 'tailwindcss', twPackage], {
                cwd,
            });
        }
        spinner.succeed(spin, 'Installed csszyx');
    } catch (error) {
        spinner.fail(spin, 'Failed to install packages');
        printError(String(error));
        return;
    }

    // Create/update config files
    const spin2 = spinner.start('Creating config files...');
    try {
        // csszyx.config.ts / csszyx.config.js
        const configContent = generateConfigFile(config);
        const configPath = path.join(
            cwd,
            projectInfo.hasTypeScript ? 'csszyx.config.ts' : 'csszyx.config.js',
        );
        await fs.writeFile(configPath, configContent);

        // Tailwind v4 CSS setup (no tailwind.config.js)
        if (config.installTailwind) {
            await setupTailwindCss(cwd, projectInfo.framework);
        }

        // Plugin injection into vite.config / next.config
        await injectPlugin(cwd, projectInfo.framework);

        // .gitignore
        if (config.setupGitignore) {
            const gitignorePath = path.join(cwd, '.gitignore');
            const ignoreEntry = '\n# csszyx generated theme types\n.csszyx\n';
            const existing = await readFileOrNull(gitignorePath);
            if (existing !== null) {
                if (!existing.includes('.csszyx')) {
                    await fs.appendFile(gitignorePath, ignoreEntry);
                }
            } else {
                await fs.writeFile(gitignorePath, 'node_modules\n.csszyx\n');
            }
        }

        // tsconfig.json
        if (config.setupTsconfig) {
            await setupTsconfig(cwd);
        }

        spinner.succeed(spin2, 'Created configuration files');
    } catch (error) {
        spinner.fail(spin2, 'Failed to create config files');
        printError(String(error));
        return;
    }

    console.log();
    printSuccess('🎉 All done!');
    console.log();
    printInfo('Next steps:');
    console.log(`  • Run '${projectInfo.packageManager} run dev' to start`);
    console.log('  • Check the docs at https://csszyx.dev');
}

/**
 * Inject Tailwind v4 @import into the main CSS entry file.
 * If no CSS entry file is found, creates src/index.css.
 * @param cwd - Project root directory.
 * @param framework - Detected or specified framework.
 */
async function setupTailwindCss(cwd: string, framework: Framework): Promise<void> {
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
        await fs.writeFile(cssPath, '@import "tailwindcss";\n');
        printInfo(`Created ${path.relative(cwd, cssPath)} with Tailwind v4 import`);
        return;
    }

    if (!content.includes('@import "tailwindcss"') && !content.includes("@import 'tailwindcss'")) {
        await fs.writeFile(cssPath, `@import "tailwindcss";\n\n${content}`);
        printInfo(`Added Tailwind v4 import to ${path.relative(cwd, cssPath)}`);
    }

    // Next.js also needs postcss.config.mjs
    if (NEXTJS_FRAMEWORKS.has(framework)) {
        const postcssMjs = path.join(cwd, 'postcss.config.mjs');
        const postcssJs = path.join(cwd, 'postcss.config.js');
        const postcssTs = path.join(cwd, 'postcss.config.ts');
        const hasExisting =
            (await readFileOrNull(postcssMjs)) !== null ||
            (await readFileOrNull(postcssJs)) !== null ||
            (await readFileOrNull(postcssTs)) !== null;
        if (!hasExisting) {
            await fs.writeFile(postcssMjs, generatePostcssConfig());
            printInfo('Created postcss.config.mjs for Tailwind v4');
        }
    }
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
    for (const c of candidates) {
        if (fs.existsSync(c)) {
            configPath = c;
            break;
        }
    }

    if (!configPath) {
        return false;
    }

    let content = await fs.readFile(configPath, 'utf8');

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
    if (!lastImportMatch || lastImportMatch.index === undefined) {
        return false;
    }

    const insertAt = lastImportMatch.index + lastImportMatch[0].length;
    content = `${content.slice(0, insertAt)}\n${importBlock}${content.slice(insertAt)}`;

    // Inject ...csszyx() as first plugin, before tailwindcss() if present
    const pluginsMatch = content.match(/plugins\s*:\s*\[/);
    if (!pluginsMatch || pluginsMatch.index === undefined) {
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
async function injectNextPlugin(cwd: string): Promise<boolean> {
    const candidates = [
        path.join(cwd, 'next.config.ts'),
        path.join(cwd, 'next.config.mjs'),
        path.join(cwd, 'next.config.js'),
    ];

    let configPath: string | undefined;
    for (const c of candidates) {
        if (fs.existsSync(c)) {
            configPath = c;
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

    const content = await fs.readFile(configPath, 'utf8');
    if (content.includes('csszyx')) {
        return true;
    }

    // next.config already exists but doesn't have csszyx — too risky to auto-modify
    return false;
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

    const includeMatch = content.match(/"include"\s*:\s*\[/);
    if (includeMatch && includeMatch.index !== undefined) {
        const insertPos = includeMatch.index + includeMatch[0].length;
        content =
            content.slice(0, insertPos) +
            '\n    "./.csszyx/theme.d.ts",\n    "./.csszyx",' +
            content.slice(insertPos);
        await fs.writeFile(tsconfigPath, content);
    }
}

/**
 * Generate csszyx.config.ts content for a new project.
 * @param config - Configuration flags selected during init.
 * @param config.enableSSR - Whether to enable SSR checksum injection.
 * @param config.enableRecovery - Whether to enable CSS recovery mode.
 * @returns The config file content as a string.
 */
function generateConfigFile(config: { enableSSR: boolean; enableRecovery: boolean }): string {
    return `import type { CsszyxConfig } from 'csszyx';

const config: CsszyxConfig = {
  development: {
    debug: true,
  },
  production: {
    injectChecksum: ${config.enableSSR},
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
