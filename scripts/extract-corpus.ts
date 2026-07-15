#!/usr/bin/env tsx
/**
 * Extract Tailwind class corpus from UI framework source repos.
 *
 * For each framework:
 *   1. Shallow-clone the repo into a temp directory
 *   2. Find all .tsx/.ts/.jsx/.js/.html/.svelte files
 *   3. Extract static className="..." attribute values (dynamic/template skipped)
 *   4. Deduplicate, write multi-class strings to scripts/corpus-combo/<name>.txt
 *      (one element className per line — tested as a single sz object)
 *   5. Also write individual classes to scripts/corpus/<name>.txt
 *      (for existing corpus-roundtrip test)
 *
 * Usage:
 *   pnpm corpus:extract              # all frameworks
 *   pnpm corpus:extract shadcn       # one framework
 *   pnpm corpus:extract --dry-run    # print counts without writing
 *
 * Re-run whenever a framework version is upgraded to refresh the snapshot.
 */

import { execFileSync } from 'node:child_process';
import { mkdirSync, readdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';

import { extractClassStrings } from './extract-corpus-classes.js';

const __dirname = fileURLToPath(new URL('.', import.meta.url));
const CORPUS_DIR = join(__dirname, 'corpus');
const COMBO_DIR = join(__dirname, 'corpus-combo');

/**
 *
 */
interface FrameworkConfig {
    name: string;
    repo: string;
    /** Subdirectories to search (relative to repo root). Empty = whole repo. */
    sourceDirs: string[];
    license: string;
    sourceUrl: string;
}

const FRAMEWORKS: FrameworkConfig[] = [
    {
        name: 'shadcn',
        repo: 'https://github.com/shadcn-ui/ui',
        sourceDirs: ['apps/v4/examples/base/ui', 'apps/v4/examples/radix/ui'],
        license: 'MIT',
        sourceUrl: 'https://github.com/shadcn-ui/ui',
    },
    {
        name: 'radix',
        repo: 'https://github.com/radix-ui/themes',
        sourceDirs: ['packages/radix-ui-themes/src/components'],
        license: 'MIT',
        sourceUrl: 'https://github.com/radix-ui/themes',
    },
    {
        name: 'tremor',
        repo: 'https://github.com/tremorlabs/tremor',
        sourceDirs: ['src/components', 'src'],
        license: 'Apache-2.0',
        sourceUrl: 'https://github.com/tremorlabs/tremor',
    },
    {
        name: 'flowbite',
        repo: 'https://github.com/themesberg/flowbite-react',
        sourceDirs: ['packages/ui/src/components', 'src/components'],
        license: 'MIT',
        sourceUrl: 'https://github.com/themesberg/flowbite-react',
    },
    {
        // Headless UI (Tailwind Labs) — open-source component primitives
        name: 'catalyst',
        repo: 'https://github.com/tailwindlabs/headlessui',
        sourceDirs: ['packages/@headlessui-react/src'],
        license: 'MIT',
        sourceUrl: 'https://github.com/tailwindlabs/headlessui',
    },
];

// Source file extensions to scan
const SOURCE_EXTS = new Set(['.tsx', '.ts', '.jsx', '.js', '.html', '.svelte', '.vue']);

/**
 * Recursively find all source files under a directory.
 * @param dir - Directory to search
 * @returns Array of absolute file paths with recognized source extensions
 */
function findSourceFiles(dir: string): string[] {
    const files: string[] = [];
    try {
        for (const entry of readdirSync(dir, { withFileTypes: true })) {
            if (entry.name.startsWith('.') || entry.name === 'node_modules') {
                continue;
            }
            const full = join(dir, entry.name);
            if (entry.isDirectory()) {
                files.push(...findSourceFiles(full));
            } else if (
                entry.isFile() &&
                SOURCE_EXTS.has(entry.name.slice(entry.name.lastIndexOf('.')))
            ) {
                files.push(full);
            }
        }
    } catch {
        /* dir not found — try next */
    }
    return files;
}

/**
 * Clone, scan, and write corpus files for a single framework.
 * @param config - Framework configuration (name, repo, source dirs)
 * @param tmpDir - Temporary directory for cloning
 * @param dryRun - If true, print stats without writing files
 */
function processFramework(config: FrameworkConfig, tmpDir: string, dryRun: boolean): void {
    const repoDir = join(tmpDir, config.name);

    console.log(`\n── ${config.name} ──────────────────────────────────`);
    console.log(`  Cloning ${config.repo}...`);
    execFileSync('git', ['clone', '--depth=1', '--quiet', config.repo, repoDir], {
        stdio: 'inherit',
    });

    // Scan configured source dirs (fall back to whole repo if none found)
    const allClassStrings: string[] = [];
    let scannedFiles = 0;

    const dirsToScan =
        config.sourceDirs.length > 0 ? config.sourceDirs.map(d => join(repoDir, d)) : [repoDir];

    for (const dir of dirsToScan) {
        const files = findSourceFiles(dir);
        scannedFiles += files.length;
        for (const file of files) {
            try {
                const content = readFileSync(file, 'utf-8');
                allClassStrings.push(...extractClassStrings(content));
            } catch {
                /* skip unreadable */
            }
        }
    }

    // Deduplicate, preserve order
    const seen = new Set<string>();
    const unique = allClassStrings.filter(s => {
        if (seen.has(s)) {
            return false;
        }
        seen.add(s);
        return true;
    });

    console.log(`  Scanned ${scannedFiles} files → ${unique.length} unique className strings`);

    if (dryRun) {
        console.log(
            `  [dry-run] Would write corpus-combo/${config.name}.txt and corpus/${config.name}.txt`,
        );
        return;
    }

    // ── Write corpus-combo/<name>.txt (multi-class strings for combo test) ───
    mkdirSync(COMBO_DIR, { recursive: true });
    const comboLines = [
        `# ${config.name} — auto-extracted combo corpus`,
        `# Source: ${config.sourceUrl} (${config.license})`,
        `# Generated: ${new Date().toISOString().slice(0, 10)} via scripts/extract-corpus.ts`,
        '# Format: each line = all TW classes on ONE DOM element → tested as a single sz object',
        `# Re-generate: pnpm corpus:extract ${config.name}`,
        '',
        ...unique,
        '',
    ];
    writeFileSync(join(COMBO_DIR, `${config.name}.txt`), comboLines.join('\n'));

    // ── Write corpus/<name>.txt (individual classes for existing roundtrip test) ───
    const allIndividual = new Set<string>();
    for (const s of unique) {
        for (const cls of s.split(' ')) {
            if (cls) {
                allIndividual.add(cls);
            }
        }
    }
    const individualLines = [
        `# ${config.name} — auto-extracted individual class corpus`,
        `# Source: ${config.sourceUrl} (${config.license})`,
        `# Generated: ${new Date().toISOString().slice(0, 10)} via scripts/extract-corpus.ts`,
        '# Format: one Tailwind class per line',
        `# Re-generate: pnpm corpus:extract ${config.name}`,
        '',
        ...[...allIndividual].sort(),
        '',
    ];
    writeFileSync(join(CORPUS_DIR, `${config.name}.txt`), individualLines.join('\n'));

    console.log(`  ✓ corpus-combo/${config.name}.txt (${unique.length} element className strings)`);
    console.log(`  ✓ corpus/${config.name}.txt (${allIndividual.size} individual classes)`);
}

// ── Main ─────────────────────────────────────────────────────────────────────

const args = process.argv.slice(2);
const dryRun = args.includes('--dry-run');
const targets = args.filter(a => !a.startsWith('--'));

const frameworks =
    targets.length > 0 ? FRAMEWORKS.filter(f => targets.includes(f.name)) : FRAMEWORKS;

if (frameworks.length === 0) {
    console.error(`Unknown framework(s): ${targets.join(', ')}`);
    console.error(`Available: ${FRAMEWORKS.map(f => f.name).join(', ')}`);
    process.exit(1);
}

const tmpDir = `/tmp/csszyx-corpus-${Date.now()}`;
mkdirSync(tmpDir, { recursive: true });

let failed = 0;
try {
    for (const fw of frameworks) {
        try {
            processFramework(fw, tmpDir, dryRun);
        } catch (err) {
            console.error(`\n✗ ${fw.name}: ${(err as Error).message}`);
            failed++;
        }
    }
    console.log(
        failed > 0
            ? `\n⚠ Corpus extraction done with ${failed} failure(s).\n`
            : '\n✓ Corpus extraction complete.\n',
    );
} finally {
    rmSync(tmpDir, { recursive: true, force: true });
}
if (failed > 0) {
    process.exit(1);
}
