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

// Tailwind class token pattern:
// optional ! (important) + optional variant(s) ending in : + core utility chars
const TW_TOKEN_RE = /^!?(?:[\w-]+:)*[\w\-./[\]()@#%]+$/;

// CSS function names that indicate a value is a CSS expression, not a TW class
const CSS_FN_RE = /^(?:calc|var|url|rgb|rgba|hsl|hsla|oklch|color|env|min|max|clamp)\(/;

/**
 * Returns true if the token looks like a valid Tailwind class.
 * @param token - The token to validate
 * @returns True if the token matches the Tailwind class pattern
 */
function isValidTwToken(token: string): boolean {
    if (token === '-' || token === '/' || CSS_FN_RE.test(token)) {
        return false;
    }
    return TW_TOKEN_RE.test(token) && token.length >= 1 && token.length <= 120;
}

/**
 * Extract static className/class attribute string values from source content.
 * Only captures plain string literals — skips template literals and expressions.
 * @param content - Source file content to scan
 * @returns One string per element className (may contain multiple space-separated classes)
 */
function extractClassStrings(content: string): string[] {
    const results: string[] = [];

    // Capture string literals from multiple patterns:
    // 1. className="..." / class="..." / className={'...'}
    // 2. First arg to class helpers: cn("..."), clsx("..."), cva("..."), cx("...")
    // 3. Any double/single-quoted string literal that looks like TW classes
    //    (catches theme object properties like base: "flex items-center ...",
    //     variant strings, etc. — validated by the 80% TW token threshold below)
    const patterns = [
        /className="([^"\\]+)"/g,
        /className='([^'\\]+)'/g,
        /className=\{'([^'\\]+)'\}/g,
        /\bclass="([^"\\]+)"/g,
        /\bclass='([^'\\]+)'/g,
        // First string argument to common class composition utilities
        /\bcn\("([^"\\]+)"/g,
        /\bcn\('([^'\\]+)'/g,
        /\bclsx\("([^"\\]+)"/g,
        /\bclsx\('([^'\\]+)'/g,
        /\bcva\("([^"\\]+)"/g,
        /\bcva\('([^'\\]+)'/g,
        /\bcx\("([^"\\]+)"/g,
        /\bcx\('([^'\\]+)'/g,
        // Generic: any string literal that might be a TW class list
        // (handles theme objects, variant maps, etc.)
        // Note: validated separately — requires TW-specific tokens to avoid prose
        /"([a-z!][a-z0-9 !:/.[\\]()@#%]{15,})"/g,
        /'([a-z!][a-z0-9 !:/.[\\]()@#%]{15,})'/g,
    ];

    // Patterns that came from targeted contexts (className=, cn(), etc.)
    // vs the generic fallback patterns that need extra validation
    const GENERIC_PATTERN_START = 13; // index of first generic pattern above

    for (let pi = 0; pi < patterns.length; pi++) {
        const re = patterns[pi];
        const isGeneric = pi >= GENERIC_PATTERN_START;
        for (const match of content.matchAll(re)) {
            const value = match[1];
            if (!value) {
                continue;
            }

            const tokens = value.split(/\s+/).filter(Boolean);
            if (tokens.length < 2) {
                continue;
            } // single-class elements uninteresting for combo

            // Keep only tokens that look like TW classes; require ≥80% valid
            const valid = tokens.filter(isValidTwToken);
            if (valid.length < 2 || valid.length / tokens.length < 0.8) {
                continue;
            }

            // Generic patterns: require at least one token with a TW-specific
            // character (hyphen, colon, slash) to filter out English prose
            if (isGeneric) {
                const hasTwSpecific = valid.some(
                    t => t.includes('-') || t.includes(':') || t.includes('/'),
                );
                if (!hasTwSpecific) {
                    continue;
                }
            }

            results.push(valid.join(' '));
        }
    }

    return results;
}

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
