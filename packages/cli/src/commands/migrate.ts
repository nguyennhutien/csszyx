/**
 * csszyx migrate - Convert Tailwind className to sz prop.
 *
 * Phase 1: Static className="..." only.
 * Supports --dry-run, --ignore patterns.
 */

import fs from 'node:fs';
import path from 'node:path';

import fg from 'fast-glob';

import { transformHtmlSourceSimple, transformSourceSimple } from '../migrate/ast-transformer.js';
import {
    printHeader,
    printInfo,
    printSuccess,
    printWarn,
    spinner,
} from '../utils/terminal-ui.js';

/**
 *
 */
export interface MigrateOptions {
    dryRun?: boolean;
    ignore?: string[];
    cwd?: string;
    pattern?: string;
    /** Wrap HTML sz attribute values in outer { } braces (default: false). */
    braces?: boolean;
    /** Inject FOUC-prevention CSS into HTML files (default: true). */
    injectFouc?: boolean;
    /** Inject runtime script tag into HTML files: 'local' | 'cdn' | false. */
    injectRuntime?: 'local' | 'cdn' | false;
    /** CDN URL for --inject-runtime cdn. */
    cdnUrl?: string;
    /** Local script path for --inject-runtime local. */
    localPath?: string;
}

/**
 * Run the csszyx migration tool.
 * @param options - Migration configuration options
 */
export async function migrate(options: MigrateOptions = {}): Promise<void> {
    const cwd = options.cwd || process.cwd();
    const dryRun = options.dryRun || false;
    const ignorePatterns = options.ignore || [];

    printHeader('csszyx Migration Tool');

    if (dryRun) {
        printInfo('Dry run mode — no files will be modified');
    }

    // Find JSX/TSX/HTML files
    const patterns = options.pattern
        ? [options.pattern]
        : ['**/*.{jsx,tsx,html}'];

    const ignore = [
        '**/node_modules/**',
        '**/dist/**',
        '**/build/**',
        '**/.next/**',
        '**/.nuxt/**',
        ...ignorePatterns,
    ];

    const s = spinner.start('Scanning for files...');
    const files = await fg(patterns, { cwd, ignore, absolute: true });
    s.succeed(`Found ${files.length} files`);

    if (files.length === 0) {
        printWarn('No JSX/TSX files found');
        return;
    }

    let totalTransformed = 0;
    let totalSkipped = 0;
    let totalFiles = 0;
    const allUnrecognized: string[] = [];
    const allWarnings: string[] = [];

    const s2 = spinner.start('Migrating...');

    for (const filePath of files) {
        const source = fs.readFileSync(filePath, 'utf-8');
        const isHtml = filePath.endsWith('.html');

        // Skip files without relevant class attributes
        const hasRelevantAttr = isHtml ? source.includes('class=') : source.includes('className=');
        if (!hasRelevantAttr) {
            continue;
        }

        const result = isHtml
            ? transformHtmlSourceSimple(source, filePath, {
                braces: options.braces,
                injectFouc: options.injectFouc,
                injectRuntime: options.injectRuntime,
                cdnUrl: options.cdnUrl,
                localPath: options.localPath,
            })
            : transformSourceSimple(source, filePath);

        if (result.changed) {
            totalFiles++;
            totalTransformed += result.stats.classNamesTransformed;
            totalSkipped += result.stats.classNamesSkipped;
            allUnrecognized.push(...result.stats.classesUnrecognized);
            allWarnings.push(...result.warnings);

            if (!dryRun) {
                fs.writeFileSync(filePath, result.code, 'utf-8');
            }

            const rel = path.relative(cwd, filePath);
            if (dryRun) {
                printInfo(`  ${rel}: ${result.stats.classNamesTransformed} className(s) → sz`);
            }
        }
    }

    s2.succeed('Migration complete');

    // Summary
    console.info();
    printSuccess(`Files modified: ${totalFiles}`);
    printSuccess(`classNames converted: ${totalTransformed}`);
    if (totalSkipped > 0) {
        printWarn(`classNames skipped (dynamic): ${totalSkipped}`);
    }
    if (allUnrecognized.length > 0) {
        const unique = [...new Set(allUnrecognized)];
        printWarn(`Unrecognized classes (${unique.length}): ${unique.slice(0, 10).join(', ')}${unique.length > 10 ? '...' : ''}`);
    }
    if (allWarnings.length > 0) {
        console.info();
        for (const w of allWarnings.slice(0, 5)) {
            printWarn(w);
        }
        if (allWarnings.length > 5) {
            printWarn(`... and ${allWarnings.length - 5} more warnings`);
        }
    }
}
