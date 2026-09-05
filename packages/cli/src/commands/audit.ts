/**
 * csszyx audit - Performance analysis and statistics.
 */

import path from 'node:path';

import fs from 'fs-extra';

import { colors, printBar, printHeader, printInfo, printSection } from '../utils/terminal-ui.js';

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
    totalClasses: number;
    tierDistribution: Record<number, number>;
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

    // Mangle Statistics
    printSection('📊 Mangle Statistics');
    if (stats.totalClasses === 0) {
        console.log('  Tier distribution not yet available.');
        console.log('  The build leaves no mangle map on disk for this report to read.');
    } else {
        console.log(`  Total Classes:       ${stats.totalClasses}`);
        console.log();
        console.log('  Tier Distribution:');

        const tierNames = [
            'Tier 1 (a-Z)',
            'Tier 2 (a0-Z9)',
            'Tier 3 (aa-ZZ)',
            'Tier 4 (a00-Z99)',
            'Tier 5 (aaa+)',
        ];

        for (let i = 1; i <= 5; i++) {
            const count = stats.tierDistribution[i] || 0;
            const percent = stats.totalClasses ? Math.round((count / stats.totalClasses) * 100) : 0;
            const bar = printBar([count], stats.totalClasses, 20);

            console.log(
                `  • ${tierNames[i - 1].padEnd(18)} ${String(count).padStart(3)} (${String(percent).padStart(2)}%)  ${colors.dim(bar)}`,
            );
        }
    }

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
        totalClasses: 0,
        tierDistribution: {},
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

    // Tier distribution stays empty: the mangle map reaches the bundle through a
    // virtual module and is substituted into the assets while they are emitted, so
    // no build writes a map the CLI could read back out of dist/.

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
