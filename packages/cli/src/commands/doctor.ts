/**
 * csszyx doctor - Diagnostic tool for issues.
 */

import path from 'node:path';

import fs from 'fs-extra';

import { getProjectInfo } from '../utils/framework-detector.js';
import {
    printError,
    printHeader,
    printSection,
    printSuccess,
    printWarn,
} from '../utils/terminal-ui.js';

/**
 *
 */
export interface DoctorOptions {
    fix?: boolean;
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

    let issueCount = 0;

    // Check 1: Configuration Health
    printSection('📋 Configuration Health');
    const hasConfig =
        fs.existsSync(path.join(cwd, 'csszyx.config.ts')) ||
        fs.existsSync(path.join(cwd, 'csszyx.config.js'));

    if (hasConfig) {
        printSuccess('csszyx configuration found');
    } else {
        printWarn('No csszyx.config found - using defaults');
    }

    // Check 2: Tailwind Installation
    if (projectInfo.hasTailwind) {
        printSuccess('Tailwind CSS installed');
    } else {
        printError('Tailwind CSS not found');
        issueCount++;
        if (options.verbose) {
            console.log('  → Run: npm install -D tailwindcss');
        }
    }

    // Check 3: Package Installation
    printSection('📦 Package Versions');
    try {
        const pkgPath = path.join(cwd, 'package.json');
        const pkg = fs.readJSONSync(pkgPath);
        const deps = { ...pkg.dependencies, ...pkg.devDependencies };

        if (deps.csszyx) {
            printSuccess(`csszyx: ${deps.csszyx}`);
        } else {
            printError('csszyx package not installed');
            issueCount++;
        }
    } catch {
        printError('Failed to read package.json');
        issueCount++;
    }

    // Check 4: Build Output (if dist exists)
    printSection('🔨 Build Output');
    const distDir = path.join(cwd, 'dist');
    if (fs.existsSync(distDir)) {
        const htmlFiles = fs
            .readdirSync(distDir, { recursive: true })
            .filter((f) => String(f).endsWith('.html'));

        if (htmlFiles.length > 0) {
            printSuccess(`Found ${htmlFiles.length} HTML file(s)`);

            // Check for checksum attribute
            const htmlContent = fs.readFileSync(
                path.join(distDir, String(htmlFiles[0])),
                'utf-8',
            );
            if (htmlContent.includes('data-sz-checksum')) {
                printSuccess('Checksum injection working');
            } else {
                printWarn('Checksum not found in HTML');
                if (options.verbose) {
                    console.log('  → Enable injectChecksum in production config');
                }
            }
        }
    } else {
        printWarn('No build output found - run build first');
    }

    // Summary
    console.log();
    if (issueCount === 0) {
        printSuccess('✨ No issues found! Your setup looks good.');
    } else {
        printWarn(`Found ${issueCount} issue(s)`);
        console.log();
        console.log('Run `csszyx doctor --fix` to auto-fix common issues');
    }
}
