/**
 * csszyx migrate - Convert Tailwind className to sz prop.
 *
 * Phase 2: Babel AST for JSX/TSX (static + dynamic classNames).
 * Regex for HTML files.
 * Supports --dry-run, --ignore patterns.
 */

import fs from 'node:fs';
import path from 'node:path';
import readline from 'node:readline';

import fg from 'fast-glob';

import { transformHtmlSourceSimple, transformSource } from '../migrate/ast-transformer.js';
import type { CsszyxTodoMap } from '../migrate/variant-parser.js';
import { printHeader, printInfo, printSuccess, printWarn, spinner } from '../utils/terminal-ui.js';

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
    /** Scan without modifying files, and generate a .csszyx-todo.json map of unrecognized classes */
    audit?: boolean;
    /** Inject {/* @sz-todo *\/} comments above unrecognized classes instead of failing */
    injectTodos?: boolean;
    /** Path to a JSON mapping file (like .csszyx-todo.json) to resolve previously unrecognized classes */
    resolveTodos?: string;
    /**
     * Only normalize legacy sz-prop keys to their single-way canonical (e.g.
     * `fontWeight`→`weight`, `padding`→`p`, `{ flex: true }`→`{ display: 'flex' }`)
     * and leave every `className` 100% untouched. The sz-key-only upgrade for
     * 0.9.10 → 0.10.0, for projects already on sz that do not want a Tailwind
     * className migration. TRANSITIONAL — remove at v1.
     */
    keysOnly?: boolean;
}

// ============================================================================
// HELPERS
// ============================================================================

/**
 * Create a timestamped log file writer under .csszyx/logs/.
 * @param cwd - Project root directory.
 * @returns Object with writeLine, filePath, and flush helpers.
 */
function createLogFile(cwd: string): {
    writeLine: (line: string) => void;
    filePath: string;
    flush: () => void;
} {
    const now = new Date();
    // Format: 2026-04-12_14-05-30
    const ts = now.toISOString().slice(0, 19).replace('T', '_').replace(/:/g, '-');
    const logDir = path.join(cwd, '.csszyx', 'logs');
    fs.mkdirSync(logDir, { recursive: true });
    const filePath = path.join(logDir, `migrate-${ts}.log`);
    const lines: string[] = [`csszyx migrate — ${now.toISOString()}`, ''];
    return {
        filePath,
        writeLine: (line: string) => lines.push(line),
        flush: () => fs.writeFileSync(filePath, `${lines.join('\n')}\n`, 'utf-8'),
    };
}

/**
 * Return true if `pattern` appears in the root .gitignore.
 * @param cwd - Project root directory.
 * @param pattern - Pattern string to search for.
 * @returns True if the pattern is present in .gitignore.
 */
function isGitignored(cwd: string, pattern: string): boolean {
    try {
        const content = fs.readFileSync(path.join(cwd, '.gitignore'), 'utf-8');
        return content.split('\n').some(l => {
            const t = l.trim();
            return t === pattern || t === `${pattern}/` || t === `/${pattern}`;
        });
    } catch {
        return false;
    }
}

/**
 * Prompt a yes/no question on TTY. Returns true only for explicit 'y'. Default is no.
 * @param question - The question string to display.
 * @returns Promise resolving to true if user answered 'y'.
 */
async function askYesNo(question: string): Promise<boolean> {
    const rl = readline.createInterface({ input: process.stdin, output: process.stdout });
    return new Promise(resolve => {
        rl.question(question, answer => {
            rl.close();
            resolve(answer.trim().toLowerCase() === 'y');
        });
    });
}

// ============================================================================
// MAIN COMMAND
// ============================================================================

/**
 * Run the csszyx migration tool.
 * @param options - Migration configuration options
 */
export async function migrate(options: MigrateOptions = {}): Promise<void> {
    const cwd = options.cwd || process.cwd();
    let dryRun = options.dryRun || false;
    const ignorePatterns = options.ignore || [];
    const audit = options.audit || false;
    const resolveTodosPath = options.resolveTodos;
    let customMap: CsszyxTodoMap | undefined, files: string[];

    if (audit) {
        dryRun = true; // force dry-run for audit so we don't mutate files
    }

    // When --resolve-todos is active, automatically re-inject @sz-todo comments
    // for classes that remain unresolved after the resolution pass, so the user
    // can see at a glance which entries in csszyx-todo.json still need attention.
    let injectTodos = options.injectTodos || false;
    if (resolveTodosPath && !injectTodos) {
        injectTodos = true;
    }

    printHeader('csszyx Migration Tool');

    // ── TTY: ask about @sz-todo comment injection upfront ──────────────────
    if (process.stdout.isTTY && !injectTodos && !audit && !resolveTodosPath) {
        const answer = await askYesNo(
            'Add {/* @sz-todo */} comments above elements with unrecognized classes? [y/N] ',
        );
        if (answer) {
            injectTodos = true;
        }
    }

    if (resolveTodosPath) {
        try {
            const absolutePath = path.resolve(cwd, resolveTodosPath);
            const content = fs.readFileSync(absolutePath, 'utf-8');
            customMap = JSON.parse(content);
            printInfo(`Loaded resolution map from ${resolveTodosPath}`);
        } catch {
            printWarn(
                `Could not load resolve map from ${resolveTodosPath}. Ensure the file exists and is valid JSON.`,
            );
            return;
        }
    }

    if (audit) {
        printInfo('Audit mode — scanning for unrecognized classes to generate a mapping file...');
    } else if (dryRun) {
        printInfo('Dry run mode — no files will be modified');
    }

    // ── Create log file ─────────────────────────────────────────────────────
    const log = createLogFile(cwd);
    log.writeLine(
        `Mode: ${audit ? 'audit' : dryRun ? 'dry-run' : 'migrate'}${resolveTodosPath ? ` (resolve-todos: ${resolveTodosPath})` : ''}`,
    );
    log.writeLine(`injectTodos: ${injectTodos}`);
    log.writeLine('');

    // Warn if .csszyx directory is not gitignored
    if (!isGitignored(cwd, '.csszyx')) {
        printWarn(
            'Tip: add .csszyx/ to your .gitignore to exclude migration logs from version control.',
        );
    }

    // Find JSX/TSX/HTML files
    const patterns = options.pattern ? [options.pattern] : ['**/*.{jsx,tsx,html}'];

    const ignore = [
        '**/node_modules/**',
        '**/dist/**',
        '**/build/**',
        '**/.next/**',
        '**/.nuxt/**',
        ...ignorePatterns,
    ];

    const s = spinner.start('Scanning for files...');
    try {
        files = await fg(patterns, { cwd, ignore, absolute: true });
    } catch (err) {
        s.fail('File scan failed');
        printWarn(`Could not scan files: ${err instanceof Error ? err.message : String(err)}`);
        log.flush();
        return;
    }
    s.succeed(`Found ${files.length} files`);

    if (files.length === 0) {
        printWarn(
            options.pattern
                ? `No files found matching pattern: ${options.pattern}`
                : 'No JSX/TSX/HTML files found',
        );
        log.writeLine('No files found.');
        log.flush();
        return;
    }

    let totalTransformed = 0;
    let totalSkipped = 0;
    let totalSkippedComponent = 0;
    let totalSzKeysNormalized = 0;
    let totalFiles = 0;
    const allUnrecognized: string[] = [];
    const allWarnings: string[] = [];
    const unusedImportFiles: { file: string; imports: string[] }[] = [];

    const s2 = spinner.start('Migrating...');

    for (const filePath of files) {
        const source = fs.readFileSync(filePath, 'utf-8');
        const isHtml = filePath.endsWith('.html');

        // keys-only normalizes sz props in JSX/TSX only — HTML has no sz objects.
        if (options.keysOnly && isHtml) {
            continue;
        }

        // Skip files with nothing to do. keys-only needs an sz prop; a normal run
        // needs a className to convert OR an sz prop whose legacy keys to normalize.
        const hasRelevantAttr = isHtml
            ? source.includes('class=')
            : options.keysOnly
              ? source.includes('sz=')
              : source.includes('className=') || source.includes('sz=');
        if (!hasRelevantAttr) {
            continue;
        }

        // Strip existing @sz-todo comments before re-processing.
        // When --resolve-todos is active, resolved classes get no new comment;
        // still-unresolved classes get a fresh comment via the injectTodos pass.
        let processSource = source;
        if (resolveTodosPath && !isHtml) {
            processSource = processSource.replace(
                /\{\/\*\s*@sz-todo:\s*(\S(?:.*\S)?)\s*\*\/\}\n?/g,
                '',
            );
        }

        const result = isHtml
            ? transformHtmlSourceSimple(processSource, filePath, {
                  braces: options.braces,
                  injectFouc: options.injectFouc,
                  injectRuntime: options.injectRuntime,
                  cdnUrl: options.cdnUrl,
                  localPath: options.localPath,
              })
            : transformSource(processSource, filePath, {
                  injectTodos,
                  customMap,
                  keysOnly: options.keysOnly,
              });

        // Collect warnings from every scanned file — not just changed ones.
        // CVA warnings and other diagnostics are emitted regardless of whether
        // any className was actually transformed (e.g. a file that only uses
        // cva() with no static className strings still needs the szv() hint).
        allWarnings.push(...result.warnings);

        if (result.changed) {
            totalFiles++;
            totalTransformed += result.stats.classNamesTransformed;
            totalSkipped += result.stats.classNamesSkipped;
            totalSkippedComponent += result.stats.classNamesSkippedComponent;
            totalSzKeysNormalized += result.stats.szKeysNormalized ?? 0;
            allUnrecognized.push(...result.stats.classesUnrecognized);

            // Track potentially unused imports
            if (result.potentiallyUnusedImports.length > 0) {
                const rel = path.relative(cwd, filePath);
                unusedImportFiles.push({ file: rel, imports: result.potentiallyUnusedImports });
            }

            if (!dryRun) {
                try {
                    fs.writeFileSync(filePath, result.code, 'utf-8');
                } catch (err) {
                    const rel = path.relative(cwd, filePath);
                    printWarn(
                        `Could not write ${rel}: ${err instanceof Error ? err.message : String(err)}`,
                    );
                    log.writeLine(`  Write error: ${rel}`);
                    continue;
                }
            }

            const rel = path.relative(cwd, filePath);
            const detail = options.keysOnly
                ? `${result.stats.szKeysNormalized ?? 0} sz key(s) normalized`
                : `${result.stats.classNamesTransformed} className(s) → sz`;
            if (dryRun) {
                printInfo(`  ${rel}: ${detail}`);
            }
            log.writeLine(`  ${rel}: ${detail}`);
        }
    }

    s2.succeed('Migration complete');

    // ── Summary ──────────────────────────────────────────────────────────────
    console.info();
    printSuccess(`Files modified: ${totalFiles}`);
    if (!options.keysOnly) {
        printSuccess(`classNames converted: ${totalTransformed}`);
    }
    log.writeLine(`Files modified: ${totalFiles}`);
    log.writeLine(`classNames converted: ${totalTransformed}`);

    if (totalSzKeysNormalized > 0) {
        printSuccess(`legacy sz keys normalized: ${totalSzKeysNormalized}`);
        log.writeLine(`legacy sz keys normalized: ${totalSzKeysNormalized}`);
    }

    if (totalSkipped > 0) {
        printWarn(`classNames skipped (dynamic): ${totalSkipped}`);
        log.writeLine(`classNames skipped (dynamic): ${totalSkipped}`);
    }
    if (totalSkippedComponent > 0) {
        printWarn(`classNames kept on components (no sz support): ${totalSkippedComponent}`);
        log.writeLine(`classNames kept on components (no sz support): ${totalSkippedComponent}`);
    }
    if (allUnrecognized.length > 0) {
        const unique = [...new Set(allUnrecognized)];
        printWarn(
            `Unrecognized classes (${unique.length}): ${unique.slice(0, 10).join(', ')}${unique.length > 10 ? '...' : ''}`,
        );
        log.writeLine(`Unrecognized classes (${unique.length}): ${unique.join(', ')}`);
    }
    if (allWarnings.length > 0) {
        console.info();
        for (const w of allWarnings.slice(0, 5)) {
            printWarn(w);
        }
        if (allWarnings.length > 5) {
            printWarn(`... and ${allWarnings.length - 5} more warnings`);
        }
        log.writeLine('');
        log.writeLine('Warnings:');
        for (const w of allWarnings) {
            log.writeLine(`  ${w}`);
        }
    }

    // ── Audit: write .csszyx-todo.json ───────────────────────────────────────
    // Only --audit writes to the todo file. --resolve-todos is read-only: it
    // never modifies the file the dev is editing. Remaining unknowns (including
    // partial cascades from TW string values) are reported in log/console only —
    // the dev re-runs --audit when they want a fresh snapshot.
    if (audit) {
        const todoPath = path.join(cwd, '.csszyx-todo.json');
        const unique = [...new Set(allUnrecognized)];
        console.info();

        if (unique.length === 0) {
            printSuccess(
                'Audit complete. 100% of your classes are perfectly recognized by csszyx!',
            );
            log.writeLine('Audit: 100% recognized.');
        } else {
            const todoObj: Record<string, unknown> = {};
            for (const u of unique) {
                todoObj[u] = 'sz:todo';
            }
            try {
                fs.writeFileSync(todoPath, JSON.stringify(todoObj, null, 2));
            } catch (err) {
                printWarn(
                    `Could not write ${path.relative(cwd, todoPath)}: ${err instanceof Error ? err.message : String(err)}`,
                );
                log.flush();
                return;
            }
            printSuccess(
                `Audit complete. Exported ${unique.length} unrecognized classes to ${path.relative(cwd, todoPath)}.`,
            );
            printInfo(
                'Edit this file to map custom classes, then run: npx @csszyx/cli migrate --resolve-todos .csszyx-todo.json',
            );
            log.writeLine(
                `Audit: ${unique.length} unrecognized classes written to ${path.relative(cwd, todoPath)}`,
            );
        }
    }

    // ── resolve-todos: report remaining unknowns (read-only, no file write) ──
    if (resolveTodosPath) {
        const unique = [...new Set(allUnrecognized)];
        if (unique.length > 0) {
            console.info();
            printWarn(
                `Still unresolved after this pass (${unique.length}): ${unique.slice(0, 10).join(', ')}${unique.length > 10 ? '...' : ''}`,
            );
            printInfo('Re-run --audit to generate a fresh snapshot when ready.');
            log.writeLine(`Still unresolved (${unique.length}): ${unique.join(', ')}`);
        }
    }

    // ── Report potentially unused imports ─────────────────────────────────────
    if (unusedImportFiles.length > 0) {
        console.info();
        printWarn('Potentially unused imports (run ESLint to clean up):');
        for (const { file, imports } of unusedImportFiles) {
            printInfo(`  ${file}: ${imports.map(i => `import { ${i} }`).join(', ')}`);
            log.writeLine(`  Unused import in ${file}: ${imports.join(', ')}`);
        }
    }

    // ── Flush log ─────────────────────────────────────────────────────────────
    try {
        log.flush();
        printInfo(`Migration log saved to ${path.relative(cwd, log.filePath)}`);
    } catch {
        // Non-fatal: log flush failure should not crash the process
    }
}
