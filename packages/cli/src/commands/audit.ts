/**
 * csszyx audit - reports what a build left in dist/.
 *
 * The report carries no mangle tier distribution. A token cannot be read back
 * for the tier that produced it: tiers 2 and 3 are both two characters, tiers
 * 4 and 5 both three (packages/core/src/encoder.rs), so counting lengths would
 * report every tier-3 class as tier 2 on any build past 52 classes. The counts
 * would have to come from the allocator that assigned the tokens, which means
 * the build emitting them rather than this command deriving them.
 */

import path from 'node:path';

import fs from 'fs-extra';

import { printHeader, printInfo, printSection } from '../utils/terminal-ui.js';

/**
 *
 */
export interface AuditOptions {
    json?: boolean;
    cwd?: string;
}

/**
 *
 */
interface AuditStats {
    /** Byte sizes of the first HTML and CSS asset in the build output, as built. */
    output: {
        html: { file: string; bytes: number } | null;
        css: { file: string; bytes: number } | null;
    };
}

/**
 *
 * @param options - Command line options
 */
export async function audit(options: AuditOptions = {}): Promise<void> {
    const cwd = options.cwd || process.cwd();

    const stats = await collectStats(cwd);

    if (options.json) {
        console.log(JSON.stringify(stats, null, 2));
        return;
    }

    printHeader('csszyx Audit Report');

    // Build output, as built. What mangling did to the payload is not
    // something a dist directory can answer after the fact: the build weighs
    // the CSS and the map before and after, gzipped, and prints the verdict.
    printSection('📦 Build Output');
    for (const asset of [stats.output.html, stats.output.css]) {
        if (asset) console.log(`  ${asset.file.padEnd(20)} ${formatBytes(asset.bytes)}`);
    }
    if (!stats.output.html && !stats.output.css) {
        console.log('  No built HTML or CSS found under dist/.');
    }
    console.log();
    printInfo(
        'Mangling hides class names; it does not shrink a gzip-served payload. The production ' +
            'build measures the trade and prints a `[csszyx] production.mangle …` line when the ' +
            'map outweighs the shorter names.',
    );
    printInfo(
        "Tip: `csszyx/lite` is the compiler-free runtime entry — import { _sz } from 'csszyx/lite'.",
    );
}

/**
 *
 * @param cwd - Current working directory
 * @returns The collected audit statistics
 */
async function collectStats(cwd: string): Promise<AuditStats> {
    // Initialize default stats
    const stats: AuditStats = {
        output: { html: null, css: null },
    };

    // Try to read from dist folder
    const distDir = path.join(cwd, 'dist');
    if (!fs.existsSync(distDir)) {
        return stats;
    }

    // Estimate from build output
    const htmlFiles = fs
        .readdirSync(distDir, { recursive: true })
        .filter(f => String(f).endsWith('.html'));
    const cssFiles = fs
        .readdirSync(distDir, { recursive: true })
        .filter(f => String(f).endsWith('.css'));

    if (htmlFiles.length > 0) {
        const file = String(htmlFiles[0]);
        stats.output.html = { file, bytes: fs.statSync(path.join(distDir, file)).size };
    }

    if (cssFiles.length > 0) {
        const file = String(cssFiles[0]);
        stats.output.css = { file, bytes: fs.statSync(path.join(distDir, file)).size };
    }

    return stats;
}

/**
 *
 * @param bytes - Number of bytes to format
 * @returns A human-readable string representation of the byte size
 */
function formatBytes(bytes: number): string {
    if (bytes === 0) {
        return '0 B';
    }
    if (bytes < 1024) {
        return `${bytes} B`;
    }
    if (bytes < 1024 * 1024) {
        return `${(bytes / 1024).toFixed(1)} KB`;
    }
    return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}
