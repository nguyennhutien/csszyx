/**
 * csszyx doctor - Diagnostic tool for issues.
 */

import path from 'node:path';

import fs from 'fs-extra';

import { getProjectInfo } from '../utils/framework-detector.js';
import {
    printError,
    printHeader,
    printInfo,
    printSection,
    printSuccess,
    printWarn,
} from '../utils/terminal-ui.js';

/**
 *
 */
export interface DoctorOptions {
    verbose?: boolean;
    cwd?: string;
}

/**
 *
 * @param options - Command line options
 */
export async function doctor(options: DoctorOptions = {}): Promise<void> {
    const cwd = options.cwd || process.cwd();
    const projectInfo = getProjectInfo(cwd);

    printHeader('csszyx Doctor');

    checkConfiguration(cwd);
    let issueCount = checkTailwind(projectInfo.hasTailwind, options.verbose);
    issueCount += checkPackageInstallation(cwd);
    checkBuildOutput(cwd, options.verbose);
    await reportOptionalTooling(options.verbose);

    // Summary
    console.log();
    if (issueCount === 0) {
        printSuccess('✨ No issues found! Your setup looks good.');
    } else {
        printWarn(`Found ${issueCount} issue(s)`);
    }
}

/**
 * Report whether a csszyx configuration exists.
 * @param cwd - Project directory.
 */
function checkConfiguration(cwd: string): void {
    printSection('📋 Configuration Health');
    const found = ['csszyx.config.ts', 'csszyx.config.js'].some(file =>
        fs.existsSync(path.join(cwd, file)),
    );
    if (found) printSuccess('csszyx configuration found');
    else printWarn('No csszyx.config found - using defaults');
}

/**
 * Report Tailwind availability and return its issue contribution.
 * @param hasTailwind - Whether Tailwind was detected.
 * @param verbose - Whether to print remediation guidance.
 * @returns Zero when available, otherwise one.
 */
function checkTailwind(hasTailwind: boolean, verbose = false): number {
    if (hasTailwind) {
        printSuccess('Tailwind CSS installed');
        return 0;
    }
    printError('Tailwind CSS not found');
    if (verbose) console.log('  → Run: npm install -D tailwindcss');
    return 1;
}

/**
 * Say whether `generate-types` can run here, without counting it as an issue.
 *
 * Tailwind v3 is an optional peer that only that command needs, so its
 * absence is the designed state for most projects — a `doctor` run in CI
 * must not go red over it. `checkTailwind` above asks a different question
 * (does this project have a Tailwind to serve csszyx's classes) and keeps its
 * own answer.
 * @param verbose - Whether to print the install hint.
 */
async function reportOptionalTooling(verbose = false): Promise<void> {
    printSection('🧰 Optional tooling');
    const { resolveTailwindV3 } = await import('../scanner/tailwind-availability.js');
    try {
        const { version } = await resolveTailwindV3();
        printSuccess(`generate-types available (tailwindcss ${version})`);
    } catch (cause) {
        const message = cause instanceof Error ? cause.message : String(cause);
        if (message.includes('none installed')) {
            printInfo(
                'generate-types unavailable — tailwindcss v3 is an optional peer and is not ' +
                    'installed. Only needed to read a v3 tailwind.config.js.',
            );
            if (verbose) {
                console.log(
                    '  → npm install -D tailwindcss@3 (only if you need csszyx generate-types)',
                );
            }
        } else {
            const version = message.match(/this project has ([^.\s]+(?:\.[^.\s]+)*)/)?.[1];
            printInfo(
                `generate-types unavailable — tailwindcss ${version ?? '(unknown version)'} has no ` +
                    'JavaScript config to read. Not needed on v4.',
            );
        }
    }
}

/**
 * Report the installed csszyx version and return its issue contribution.
 * @param cwd - Project directory.
 * @returns Zero when installed, otherwise one.
 */
function checkPackageInstallation(cwd: string): number {
    printSection('📦 Package Versions');
    try {
        const pkg = fs.readJSONSync(path.join(cwd, 'package.json'));
        const version = { ...pkg.dependencies, ...pkg.devDependencies }.csszyx;
        if (version) {
            printSuccess(`csszyx: ${version}`);
            return 0;
        }
        printError('csszyx package not installed');
    } catch {
        printError('Failed to read package.json');
    }
    return 1;
}

/**
 * Report build output and checksum injection when output is present.
 * @param cwd - Project directory.
 * @param verbose - Whether to print remediation guidance.
 */
function checkBuildOutput(cwd: string, verbose = false): void {
    printSection('🔨 Build Output');
    const distDir = path.join(cwd, 'dist');
    if (!fs.existsSync(distDir)) {
        printWarn('No build output found - run build first');
        return;
    }
    const htmlFiles = fs
        .readdirSync(distDir, { recursive: true })
        .filter(file => String(file).endsWith('.html'));
    if (htmlFiles.length === 0) return;
    printSuccess(`Found ${htmlFiles.length} HTML file(s)`);
    const html = fs.readFileSync(path.join(distDir, String(htmlFiles[0])), 'utf-8');
    // The build shortens the attribute to `data-sz-cs` when production.minify
    // is on, which is the default, so doctor has to know both spellings.
    if (html.includes('data-sz-checksum') || html.includes('data-sz-cs')) {
        printSuccess('Checksum injection working');
        return;
    }
    printWarn('Checksum not found in HTML');
    if (verbose) console.log('  → Enable injectChecksum in production config');
}
