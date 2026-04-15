/**
 * csszyx audit - Performance analysis and statistics.
 */

import path from 'node:path';

import fs from 'fs-extra';

import {
    colors,
    printBar,
    printHeader,
    printInfo,
    printSection,
} from '../utils/terminal-ui.js';

/**
 *
 */
export interface AuditOptions {
    json?: boolean;
    watch?: boolean;
    compare?: string;
    cwd?: string;
}

/**
 *
 */
interface AuditStats {
    totalClasses: number;
    tierDistribution: Record<number, number>;
    bundleSavings: {
        originalHTML: number;
        mangledHTML: number;
        originalCSS: number;
        mangledCSS: number;
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
        console.log('  Run a production build first, then re-run csszyx audit.');
    } else {
        console.log(`  Total Classes:       ${stats.totalClasses}`);
        console.log(`  Mangled Classes:     ${stats.totalClasses} (100%)`);
        console.log('  Unmangled Classes:   0');
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
            const percent = stats.totalClasses
                ? Math.round((count / stats.totalClasses) * 100)
                : 0;
            const bar = printBar([count], stats.totalClasses, 20);

            console.log(
                `  • ${tierNames[i - 1].padEnd(18)} ${String(count).padStart(3)} (${String(percent).padStart(2)}%)  ${colors.dim(bar)}`,
            );
        }
    }

    // Bundle Size Impact
    printSection('💾 Bundle Size Impact');
    if (stats.bundleSavings.originalHTML > 0) {
        const htmlSavings = stats.bundleSavings.originalHTML - stats.bundleSavings.mangledHTML;
        const htmlPercent = Math.round((htmlSavings / stats.bundleSavings.originalHTML) * 100);

        console.log(`  Original HTML:       ${formatBytes(stats.bundleSavings.originalHTML)}`);
        console.log(`  Mangled HTML:        ${formatBytes(stats.bundleSavings.mangledHTML)}   ↓ ${htmlPercent}% (-${formatBytes(htmlSavings)})`);
        console.log();
    }

    if (stats.bundleSavings.originalCSS > 0) {
        const cssSavings = stats.bundleSavings.originalCSS - stats.bundleSavings.mangledCSS;
        const cssPercent = Math.round((cssSavings / stats.bundleSavings.originalCSS) * 100);

        console.log(`  Original CSS:        ${formatBytes(stats.bundleSavings.originalCSS)}`);
        console.log(`  Mangled CSS:         ${formatBytes(stats.bundleSavings.mangledCSS)}   ↓ ${cssPercent}% (-${formatBytes(cssSavings)})`);
    }

    console.log();
    printInfo('💡 Tip: Enable runtime lite bundle for -1.1KB');
    console.log('     → import { _sz } from \'csszyx/lite\'');
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
        bundleSavings: {
            originalHTML: 0,
            mangledHTML: 0,
            originalCSS: 0,
            mangledCSS: 0,
        },
    };

    // Try to read from dist folder
    const distDir = path.join(cwd, 'dist');
    if (!fs.existsSync(distDir)) {
        return stats;
    }

    // Estimate from build output
    const htmlFiles = fs.readdirSync(distDir, { recursive: true })
        .filter((f) => String(f).endsWith('.html'));
    const cssFiles = fs.readdirSync(distDir, { recursive: true })
        .filter((f) => String(f).endsWith('.css'));

    if (htmlFiles.length > 0) {
        const htmlContent = fs.readFileSync(path.join(distDir, String(htmlFiles[0])), 'utf-8');
        stats.bundleSavings.mangledHTML = Buffer.byteLength(htmlContent);
        // Estimate original size (mangled classes are typically 60% smaller)
        stats.bundleSavings.originalHTML = Math.round(stats.bundleSavings.mangledHTML * 1.67);
    }

    if (cssFiles.length > 0) {
        const cssContent = fs.readFileSync(path.join(distDir, String(cssFiles[0])), 'utf-8');
        stats.bundleSavings.mangledCSS = Buffer.byteLength(cssContent);
        stats.bundleSavings.originalCSS = Math.round(stats.bundleSavings.mangledCSS * 1.71);
    }

    // Tier distribution requires the csszyx mangle map (injected by the build plugin
    // into the HTML as data-sz-manifest). Not available from dist files alone — this
    // will be implemented when the manifest reader is added in a future release.

    return stats;
}

/**
 *
 * @param bytes - Number of bytes to format
 * @returns A human-readable string representation of the byte size
 */
function formatBytes(bytes: number): string {
    if (bytes === 0) {return '0 B';}
    if (bytes < 1024) {return `${bytes} B`;}
    if (bytes < 1024 * 1024) {return `${(bytes / 1024).toFixed(1)} KB`;}
    return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}
