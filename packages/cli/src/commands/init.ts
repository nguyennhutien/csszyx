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
} from '../utils/framework-detector.js';
import {
    printError,
    printHeader,
    printInfo,
    printSuccess,
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

/**
 *
 * @param options - Command line options
 */
export async function init(options: InitOptions = {}): Promise<void> {
    const cwd = options.cwd || process.cwd();
    const projectInfo = getProjectInfo(cwd);

    printHeader('csszyx Setup Wizard');

    // Auto-detect framework
    if (projectInfo.framework !== 'unknown') {
        printSuccess(`Detected: ${getFrameworkName(projectInfo.framework)}`);
        printInfo(`Package Manager: ${projectInfo.packageManager}`);
    }

    // Interactive prompts (skip if --yes flag)
    let config = {
        enableSSR: true,
        enableRecovery: true,
        installTailwind: !projectInfo.hasTailwind,
    };

    if (!options.yes) {
        const answers = await prompts([
            {
                type: projectInfo.hasTailwind ? null : 'confirm',
                name: 'installTailwind',
                message: 'Install Tailwind CSS?',
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
        ]);

        config = { ...config, ...answers };
    }

    // Install csszyx package
    const spin = spinner.start('Installing csszyx...');
    try {
        await execa(projectInfo.packageManager, ['add', 'csszyx'], { cwd });
        if (config.installTailwind) {
            await execa(
                projectInfo.packageManager,
                ['add', '-D', 'tailwindcss', 'postcss', 'autoprefixer'],
                { cwd },
            );
        }
        spinner.succeed(spin, 'Installed csszyx');
    } catch (error) {
        spinner.fail(spin, 'Failed to install packages');
        printError(String(error));
        return;
    }

    // Create config file
    const spin2 = spinner.start('Creating config files...');
    try {
        const configContent = generateConfigFile(config, projectInfo.framework);
        const configPath = path.join(
            cwd,
            projectInfo.hasTypeScript ? 'csszyx.config.ts' : 'csszyx.config.js',
        );
        await fs.writeFile(configPath, configContent);

        // Create Tailwind config if needed
        if (config.installTailwind) {
            await fs.writeFile(
                path.join(cwd, 'tailwind.config.js'),
                generateTailwindConfig(),
            );
        }

        spinner.succeed(spin2, 'Created configuration files');
    } catch (error) {
        spinner.fail(spin2, 'Failed to create config files');
        printError(String(error));
        return;
    }

    // Success message
    console.log();
    printSuccess('🎉 All done!');
    console.log();
    printInfo('Next steps:');
    console.log(`  • Run '${projectInfo.packageManager} run dev' to start`);
    console.log('  • Open http://localhost:5174 for the dashboard');
    console.log('  • Check the docs at https://github.com/nguyennhutien/csszyx');
}

/**
 *
 * @param config - Configuration options for the generated file
 * @param config.enableSSR - Whether to enable SSR hydration guard
 * @param config.enableRecovery - Whether to enable development mode recovery
 * @param framework - The detected project framework
 * @returns The generated configuration file content as a string
 */
function generateConfigFile(
    config: { enableSSR: boolean; enableRecovery: boolean },
    framework: Framework,
): string {
    return `import type { CsszyxConfig } from 'csszyx';

const config: CsszyxConfig = {
  development: {
    debug: true,
    autoInjectRecovery: ${config.enableRecovery},
    allowCSRRecovery: ${config.enableRecovery},
  },
  production: {
    injectChecksum: ${config.enableSSR},
  },
};

export default config;
`;
}

/**
 *
 * @returns The generated Tailwind configuration file content as a string
 */
function generateTailwindConfig(): string {
    return `/** @type {import('tailwindcss').Config} */
export default {
  content: ['./index.html', './src/**/*.{js,ts,jsx,tsx,vue,svelte}'],
  theme: {
    extend: {},
  },
  plugins: [],
};
`;
}
