/**
 * The one walk over a project's files, and the directories it never enters.
 *
 * Every surface that lists a project's files used to carry its own skip list,
 * and the lists disagreed. They are split in two on purpose, not unified:
 * a directory that holds dependencies or a framework's output is never a
 * source, while a generated report or a build copy (`coverage/`, `target/`,
 * `storybook-static/`) is skipped only by the walks that read stylesheets and
 * markup. The sz prescan must keep reading those names, because
 * `src/features/target/Card.tsx` is a source like any other and skipping it
 * would drop its CSS without a word.
 *
 * The walk reads `.gitignore` the way Tailwind's Scanner does: every
 * `.gitignore` in the walked tree, plus those in parent folders up to the
 * nearest one holding `.git` (or the filesystem root when none does), with
 * patterns matched case-sensitively and a tracked file that a pattern matches
 * still ignored. A folder's verdict is settled when the walk reaches it, as git
 * settles it: the deepest `.gitignore` with a matching pattern decides, so a
 * nested `!gen/` takes back a folder an outer `gen/` ignores. When any
 * `.gitignore` that applies ignores the root itself, no `.gitignore` is read at
 * all, which is what the Scanner does for such a base: a parent folder's that
 * ignores the root or a folder above it, even when a nearer one takes it back,
 * and the root's own when its last pattern that matches the empty path (`*`,
 * `**`, `*\/`, `/*`) is not a negation. `.git/info/exclude` and
 * a global `core.excludesFile` are not read: they differ from machine to
 * machine, and the build must not.
 *
 * @module
 */
import fs from 'node:fs';
import path from 'node:path';

import ignore from 'ignore';

/**
 * Dependency and framework output directories. No walk reads a source from
 * one of these.
 */
export const DEPENDENCY_OUTPUT_DIRS: ReadonlySet<string> = new Set([
    'node_modules',
    '.git',
    '.next',
    '.nuxt',
    '.astro',
    '.turbo',
    'dist',
    'build',
]);

/**
 * Generated reports and build copies: a Rust `target/`, a coverage report, a
 * built Storybook. They carry copies of the app's stylesheets and pages from
 * some earlier build, so the stylesheet and markup walks skip them. The sz
 * prescan does not: these names are ordinary folder names in an app's
 * sources too.
 */
export const GENERATED_REPORT_DIRS: ReadonlySet<string> = new Set([
    'target',
    'coverage',
    'storybook-static',
]);

/** What the stylesheet walks skip: both sets. */
export const STYLESHEET_WALK_SKIP_DIRS: ReadonlySet<string> = new Set([
    ...DEPENDENCY_OUTPUT_DIRS,
    ...GENERATED_REPORT_DIRS,
]);

/**
 * Glob ignore patterns for a set of directory names, the form fast-glob and the
 * Next commands' ignore matcher read.
 *
 * @param dirs - Directory names to leave out.
 * @param options - How the patterns are anchored.
 * @param options.anchored - True for `name/**` (only at the root); false for
 *        `**\/name/**` (at any depth).
 * @returns One pattern per directory, in the set's order.
 */
export function skippedDirGlobs(
    dirs: ReadonlySet<string>,
    options: { anchored: boolean },
): string[] {
    return [...dirs].map(dir => (options.anchored ? `${dir}/**` : `**/${dir}/**`));
}

/**
 * How a walk treats `.gitignore`.
 *
 * - `off`: reads none; every file is visited with `gitignored: false`.
 * - `skip`: an ignored directory is never opened, an ignored file never
 *   visited. For the walks that read stylesheets and markup.
 * - `mark`: every file is visited and the ignored ones say so. For a walk that
 *   reads every source for one purpose (the sz safelist) and only the files
 *   git keeps for another (merge hooks).
 */
export type GitignoreMode = 'off' | 'skip' | 'mark';

/** One file the walk found. */
export interface WalkedFile {
    /** Absolute path. */
    path: string;
    /** Extension with its dot, as `path.extname` gives it. */
    extension: string;
    /** Whether a `.gitignore` covers it; always false when the mode is `off`. */
    gitignored: boolean;
}

/** How a walk chooses what it enters. */
export interface ProjectWalkOptions {
    /** Directory names never entered, at any depth. */
    skipDirs: ReadonlySet<string>;
    /**
     * Whether directories whose name starts with `.` are skipped too. Default
     * true; that is also what keeps a walk out of `.csszyx/`, where csszyx
     * writes its own output.
     */
    skipDotDirs?: boolean;
    /**
     * A caller's own question about a directory, asked before it is opened:
     * true leaves it unread.
     */
    prune?: (dir: string) => boolean;
    /** How `.gitignore` is read; `off` when not given. */
    gitignore?: GitignoreMode;
}

/** What a walk read besides the files it visited. */
export interface ProjectWalkResult {
    /**
     * Every `.gitignore` the walk applied, parents first, as absolute paths.
     * Empty when the mode is `off`. A caller that records what the walk found
     * fingerprints these, so an edit to one makes the record stale.
     */
    gitignoreFiles: string[];
}

/** What one `.gitignore` says of one path, by the last of its patterns that matches it. */
interface GitignoreVerdict {
    ignored: boolean;
    unignored: boolean;
}

/** The patterns of one `.gitignore`, and the folder they are relative to. */
interface GitignoreLayer {
    base: string;
    /** The verdict on {@link base} itself, the empty path relative to it. */
    self: GitignoreVerdict;
    /**
     * The verdict of the patterns that match the path itself. A folder above
     * the path is not consulted: the walk settled it on the way down, with
     * every layer that applies there.
     *
     * @param relative - Posix path relative to {@link base}, with a trailing
     *        `/` for a folder.
     */
    verdict: (relative: string) => GitignoreVerdict;
}

/** The part of an `ignore` instance that matches one path without its parents. */
interface OwnPathRules {
    test(path: string, checkUnignored: boolean, mode: 'regex'): GitignoreVerdict;
}

/**
 * Match one path against an `ignore` instance's patterns, its parent folders
 * left out.
 *
 * `ignore`'s public `test()` first asks about every parent folder of a path
 * with the same patterns, and answers for the parent when one matches. git does
 * not: an outer `gen/` cannot ignore `x/gen/a.css` once `x/.gitignore` has
 * taken `x/gen/` back, because the walk already entered `x/gen/`. `checkIgnore`
 * asks about the parents the same way. The rule list `ignore` keeps internally
 * matches one path alone; this reaches it, and fails loudly if a release of
 * `ignore` moves it rather than read every nested negation wrong.
 *
 * @param matcher - The instance the `.gitignore` was added to.
 * @returns A verdict per path.
 */
function ownPathVerdict(
    matcher: ReturnType<typeof ignore>,
): (relative: string) => GitignoreVerdict {
    const rules = (matcher as unknown as { _rules?: Partial<OwnPathRules> })._rules;
    if (typeof rules?.test !== 'function') {
        throw new TypeError(
            '[csszyx] the installed `ignore` package no longer matches one path apart from its parent folders; .gitignore cannot be read.\n' +
                '  help: install ignore@7.0.6, the version @csszyx/unplugin pins, and remove any override that forces another.',
        );
    }
    const own = rules as OwnPathRules;
    return relative => own.test(relative, true, 'regex');
}

/** The name of the file a walk reads patterns from. */
const GITIGNORE = '.gitignore';

/**
 * Read the text of one folder's `.gitignore`.
 *
 * @param dir - The folder holding it.
 * @returns The text, or null when there is no such file to read.
 */
function readGitignoreText(dir: string): string | null {
    try {
        return fs.readFileSync(path.join(dir, GITIGNORE), 'utf8');
    } catch {
        return null;
    }
}

/**
 * Read one `.gitignore` into a layer.
 *
 * @param dir - The folder holding it.
 * @param read - Where the path is recorded once read.
 * @returns The layer, or null when there is no such file to read.
 */
function readGitignore(dir: string, read: string[]): GitignoreLayer | null {
    const text = readGitignoreText(dir);
    if (text === null) return null;
    read.push(path.join(dir, GITIGNORE));
    // Case-sensitive, like the matcher in Tailwind's Scanner: `gen/` does not
    // ignore `Gen/`, whatever the filesystem folds.
    return {
        base: dir,
        self: emptyPathVerdict(text),
        verdict: ownPathVerdict(ignore({ ignorecase: false }).add(text)),
    };
}

/**
 * Whether a glob, as the Scanner's matcher compiles a `.gitignore` line, matches
 * the empty path: any `**` folders, then one name made only of `*`.
 *
 * @param glob - The line with its `!`, one leading `/` and one trailing `/`
 *        taken off.
 * @returns True when it matches the empty path.
 */
function globMatchesEmpty(glob: string): boolean {
    const parts = glob.split('/');
    const last = parts.pop() as string;
    return parts.every(part => part === '**') && [...last].every(char => char === '*');
}

/**
 * What a `.gitignore` says of the folder holding it, the empty path relative
 * to it. Tailwind's Scanner asks that of a base's own `.gitignore`, and of
 * each parent's after the folders between: only a line like `*`, `**`, `*\/`,
 * `/*` or `/` matches, and the last line that does decides. `ignore` cannot be
 * asked about the empty path, so the lines are read here.
 *
 * @param text - The `.gitignore`.
 * @returns The verdict of its last line that matches the empty path.
 */
function emptyPathVerdict(text: string): GitignoreVerdict {
    const verdict: GitignoreVerdict = { ignored: false, unignored: false };
    for (const raw of text.split(/\r?\n/)) {
        // Trailing spaces are dropped unless the last one is escaped; an
        // escaped one is a literal space, which the empty path never holds.
        const line = raw.endsWith(String.raw`\ `) ? raw : raw.trimEnd();
        if (line === '' || line.startsWith('#')) continue;
        const negated = line.startsWith('!');
        let glob = negated ? line.slice(1) : line;
        if (glob.startsWith('/')) glob = glob.slice(1);
        if (glob.endsWith('/')) glob = glob.slice(0, -1);
        if (globMatchesEmpty(glob)) {
            verdict.ignored = !negated;
            verdict.unignored = negated;
        }
    }
    return verdict;
}

/**
 * Whether a folder is the top of a git working tree.
 *
 * @param dir - The folder.
 * @returns True when it holds `.git`, a directory or a worktree's file.
 */
function holdsGit(dir: string): boolean {
    return fs.existsSync(path.join(dir, '.git'));
}

/**
 * The relative form of a path a layer matches.
 *
 * @param layer - The layer.
 * @param target - Absolute path below the layer's folder.
 * @param isDir - Whether it is a folder; a `name/` pattern matches only one.
 * @returns Posix path relative to the layer, `/`-terminated for a folder.
 */
function relativeTo(layer: GitignoreLayer, target: string, isDir: boolean): string {
    const relative = path.relative(layer.base, target).split(path.sep).join('/');
    return isDir ? `${relative}/` : relative;
}

/**
 * The `.gitignore` layers above a walk's root that apply inside it: every
 * parent folder's, up to and including the nearest folder holding `.git`, or
 * up to the filesystem root when none does. A root that is itself a
 * repository takes none from above.
 *
 * Those layers, and the root's own `.gitignore`, also judge the root.
 * Tailwind's Scanner reads no `.gitignore` at all for a base any of them
 * ignores. Each layer is asked on its own: the root first, then each folder
 * above it, and the first pattern that matches answers for that layer. A layer
 * that takes the root back does not stop the next one out from being asked, so
 * an outer `web/` still ignores `apps/web` that `apps/.gitignore` takes back
 * with `!web/`. The root's own `.gitignore` can only match the empty path (see
 * {@link emptyPathVerdict}). An app kept under an ignored `examples/` is
 * then scanned whole, where git would skip it whole and leave the walk with no
 * file and no word about why.
 *
 * @param root - The walk's root, absolute.
 * @param read - Where each path read is recorded.
 * @returns The layers, outermost first, or null when they ignore the root.
 */
function parentLayers(root: string, read: string[]): GitignoreLayer[] | null {
    const own = readGitignoreText(root);
    if (own !== null && emptyPathVerdict(own).ignored) {
        // Recorded so an edit that stops ignoring the root makes a record stale.
        read.push(path.join(root, GITIGNORE));
        return null;
    }
    if (holdsGit(root)) return [];
    const layers: GitignoreLayer[] = [];
    const found: string[] = [];
    let dir = path.dirname(root);
    for (;;) {
        const layer = readGitignore(dir, found);
        if (layer !== null) layers.unshift(layer);
        if (holdsGit(dir)) break;
        const parent = path.dirname(dir);
        if (parent === dir) break;
        dir = parent;
    }
    found.reverse();
    read.push(...found);
    return layers.some(layer => layerIgnoresRoot(layer, root)) ? null : layers;
}

/**
 * One parent layer's answer about a walk's root: the root is asked first, then
 * each folder above it up to and including the layer's own, and the first that
 * a pattern matches answers. The layer's own folder is the empty path, so a
 * parent's `/` ignores every root below it that nothing nearer answered for.
 *
 * @param layer - A layer above the root.
 * @param root - The walk's root, absolute.
 * @returns True when that answer is ignored.
 */
function layerIgnoresRoot(layer: GitignoreLayer, root: string): boolean {
    for (let folder = root; folder !== layer.base; folder = path.dirname(folder)) {
        const verdict = layer.verdict(relativeTo(layer, folder, true));
        if (verdict.ignored) return true;
        if (verdict.unignored) return false;
    }
    return layer.self.ignored;
}

/**
 * Whether the layers ignore a path whose parent folders the walk entered. The
 * innermost layer with an opinion wins, the way git lets a nested
 * `.gitignore` re-include what a parent's ignores.
 *
 * @param layers - Layers that apply, outermost first.
 * @param target - Absolute path.
 * @param isDir - Whether it is a directory; a `name/` pattern matches only one.
 * @returns True when ignored.
 */
function isIgnored(layers: readonly GitignoreLayer[], target: string, isDir: boolean): boolean {
    for (let index = layers.length - 1; index >= 0; index--) {
        const layer = layers[index] as GitignoreLayer;
        const verdict = layer.verdict(relativeTo(layer, target, isDir));
        if (verdict.ignored) return true;
        if (verdict.unignored) return false;
    }
    return false;
}

/**
 * The layers that apply inside a folder: those above it, plus its own
 * `.gitignore` when its listing has one that can be read.
 *
 * @param dir - The folder.
 * @param entries - Its listing, which saves a stat for the `.gitignore`.
 * @param layers - The layers above it, outermost first.
 * @param gitignoreFiles - Every `.gitignore` applied so far; a read one is added.
 * @returns The layers for its entries, outermost first.
 */
function withOwnGitignore(
    dir: string,
    entries: readonly fs.Dirent[],
    layers: readonly GitignoreLayer[],
    gitignoreFiles: string[],
): readonly GitignoreLayer[] {
    if (!entries.some(entry => entry.name === GITIGNORE)) return layers;
    const layer = readGitignore(dir, gitignoreFiles);
    return layer === null ? layers : [...layers, layer];
}

/**
 * Whether the walk leaves a directory unread, before any `.gitignore` is asked:
 * by its name, as a dot-folder, or by the caller's own prune.
 *
 * @param options - What to skip.
 * @param skipDotDirs - Whether dot-folders are skipped.
 * @param name - The directory's own name.
 * @param dirPath - Its absolute path, for the caller's prune.
 * @returns True when the walk does not enter it.
 */
function isSkippedDir(
    options: ProjectWalkOptions,
    skipDotDirs: boolean,
    name: string,
    dirPath: string,
): boolean {
    return (
        options.skipDirs.has(name) ||
        (skipDotDirs && name.startsWith('.')) ||
        options.prune?.(dirPath) === true
    );
}

/**
 * Visit every file under a directory, skipping the directories the options
 * name.
 *
 * Directories are read in the order the filesystem lists them; a caller that
 * needs a stable order sorts what it collects. With `.gitignore` read, each
 * folder costs one extra stat-free lookup in the listing it already has, and
 * each path one match per `.gitignore` that applies to it.
 *
 * @param walkRoot - Directory to walk; a relative one is resolved against the
 *        working directory.
 * @param options - What to skip.
 * @param visit - Called once per file.
 * @returns The `.gitignore` files the walk applied.
 */
export function walkProject(
    walkRoot: string,
    options: ProjectWalkOptions,
    visit: (file: WalkedFile) => void,
): ProjectWalkResult {
    // A relative root would turn the parent search into a walk over `.`.
    const root = path.resolve(walkRoot);
    const skipDotDirs = options.skipDotDirs !== false;
    const gitignoreFiles: string[] = [];
    const above = (options.gitignore ?? 'off') === 'off' ? [] : parentLayers(root, gitignoreFiles);
    // A root a `.gitignore` ignores is walked as if none existed.
    const mode = above === null ? 'off' : (options.gitignore ?? 'off');

    /**
     * Walk one folder.
     *
     * @param dir - The folder.
     * @param layers - The `.gitignore` layers above it.
     * @param below - Whether the folder itself is ignored (`mark` mode only):
     *        nothing under an ignored folder can be taken back in.
     */
    const walkDir = (dir: string, layers: readonly GitignoreLayer[], below: boolean): void => {
        let entries: fs.Dirent[];
        try {
            entries = fs.readdirSync(dir, { withFileTypes: true });
        } catch {
            return;
        }
        const applying =
            mode !== 'off' && !below
                ? withOwnGitignore(dir, entries, layers, gitignoreFiles)
                : layers;
        for (const entry of entries) {
            const entryPath = path.join(dir, entry.name);
            const isDir = entry.isDirectory();
            if (isDir && isSkippedDir(options, skipDotDirs, entry.name, entryPath)) continue;
            const ignored = below || (mode !== 'off' && isIgnored(applying, entryPath, isDir));
            if (ignored && mode === 'skip') continue;
            if (isDir) walkDir(entryPath, applying, ignored);
            else
                visit({
                    path: entryPath,
                    extension: path.extname(entry.name),
                    gitignored: ignored,
                });
        }
    };

    walkDir(root, above ?? [], false);
    return { gitignoreFiles };
}

/**
 * Ask whether one path is gitignored, the way {@link walkProject} would decide
 * it on a walk from the same root.
 *
 * For a file a watcher reports, where no walk is running. The `.gitignore` of
 * each folder is read once per query object and kept: make a new one after an
 * edit to a `.gitignore` should count.
 *
 * @param queryRoot - The walk's root; a relative one is resolved against the
 *        working directory, as a relative target is.
 * @returns A predicate; false for the root itself and for any path outside it.
 */
export function createGitignoreQuery(queryRoot: string): (target: string) => boolean {
    const root = path.resolve(queryRoot);
    const top = parentLayers(root, []);
    if (top === null) return () => false;
    const byDir = new Map<string, readonly GitignoreLayer[]>();
    /**
     * The layers that apply to entries of a folder under the root.
     *
     * @param dir - The folder.
     * @returns Its layers, outermost first.
     */
    const layersIn = (dir: string): readonly GitignoreLayer[] => {
        const known = byDir.get(dir);
        if (known !== undefined) return known;
        const above = dir === root ? top : layersIn(path.dirname(dir));
        const own = readGitignore(dir, []);
        const layers = own === null ? above : [...above, own];
        byDir.set(dir, layers);
        return layers;
    };
    return target => {
        const relative = path.relative(root, path.resolve(target));
        if (
            relative === '' ||
            relative === '..' ||
            relative.startsWith(`..${path.sep}`) ||
            path.isAbsolute(relative)
        ) {
            return false;
        }
        const parts = relative.split(path.sep);
        let dir = root;
        for (const part of parts.slice(0, -1)) {
            const next = path.join(dir, part);
            if (isIgnored(layersIn(dir), next, true)) return true;
            dir = next;
        }
        return isIgnored(layersIn(dir), path.join(dir, parts[parts.length - 1] as string), false);
    };
}

/** How a stylesheet walk narrows what it reads. */
export interface StylesheetWalkOptions {
    /** A caller's own question about a directory: true leaves it unread. */
    prune?: (dir: string) => boolean;
    /** A caller's own question about a file: true leaves it out. */
    ignoresFile?: (file: string) => boolean;
}

/** What a stylesheet walk found. */
export interface StylesheetWalk {
    /** Absolute stylesheet paths: walked ones first, then imported ones. */
    files: string[];
    /** The text of every file in `files` that could be read. */
    texts: Map<string, string>;
    /** Every `.gitignore` the walk applied. */
    gitignoreFiles: string[];
}

/**
 * The at-rules whose quoted target the walk follows, as Tailwind spells them.
 * Tailwind compiles `@reference` as an `@import` whose rules it does not emit,
 * so the theme the target declares still counts.
 */
const IMPORTING_AT_RULES = ['@import', '@reference'] as const;

/** The characters that end an at-rule's name for Tailwind's CSS parser. */
const AT_RULE_SPACE = new Set([' ', '\t', '\n', '\r']);

/**
 * Where a quoted string ends.
 *
 * @param css - The stylesheet.
 * @param open - Index of the opening quote.
 * @returns The index of the closing quote, or the text's length when there is
 *          none; a backslash escapes the character after it.
 */
function stringEnd(css: string, open: number): number {
    const quote = css[open];
    let index = open + 1;
    while (index < css.length && css[index] !== quote) index += css[index] === '\\' ? 2 : 1;
    return Math.min(index, css.length);
}

/**
 * Where a block comment ends.
 *
 * @param css - The stylesheet.
 * @param open - Index of its `/*`.
 * @returns The index just past its `*\/`, or the text's length when it is
 *          never closed.
 */
function commentEnd(css: string, open: number): number {
    const close = css.indexOf('*/', open + 2);
    return close === -1 ? css.length : close + 2;
}

/**
 * Where the first parameter of an at-rule starts, past spaces and comments.
 *
 * @param css - The stylesheet.
 * @param from - Index just past the at-rule's name.
 * @returns The index of the first other character, or the text's length.
 */
function paramStart(css: string, from: number): number {
    let index = from;
    for (;;) {
        while (index < css.length && AT_RULE_SPACE.has(css[index] as string)) index++;
        if (!css.startsWith('/*', index)) return index;
        index = commentEnd(css, index);
    }
}

/**
 * Where the name of an importing at-rule ends, when one starts here.
 *
 * @param css - The stylesheet.
 * @param index - Index of an `@`.
 * @returns The index just past `@import` or `@reference` when a space follows
 *          the name, or -1.
 */
function importingRuleEnd(css: string, index: number): number {
    for (const name of IMPORTING_AT_RULES) {
        const end = index + name.length;
        if (css.startsWith(name, index) && AT_RULE_SPACE.has(css[end] as string)) return end;
    }
    return -1;
}

/**
 * Read the first parameter of an importing at-rule.
 *
 * Only a quoted string is a target. An unclosed one names nothing and runs to
 * the end of the text.
 *
 * @param css - The stylesheet.
 * @param ruleEnd - Index just past the at-rule's name.
 * @returns The target as written, or null, and the index the scan resumes at:
 *          past the closing quote, or at the parameter when it is not quoted.
 */
function importingRuleParam(css: string, ruleEnd: number): { target: string | null; end: number } {
    const start = paramStart(css, ruleEnd);
    const quote = css[start];
    if (quote !== '"' && quote !== "'") return { target: null, end: start };
    const close = stringEnd(css, start);
    return { target: close < css.length ? css.slice(start + 1, close) : null, end: close + 1 };
}

/**
 * The targets a stylesheet's `@import` and `@reference` rules name, in the
 * order written: the ones Tailwind's `compile()` follows, and no others.
 *
 * Tailwind reads either as an at-rule wherever one may stand, a block
 * included, spelled in lower case and followed by a space, and takes its first
 * parameter when that is a quoted string, as written: no escape is decoded.
 * A `url()` target is left to the browser. An at-rule inside a comment or a
 * string is text. One linear pass, no backtracking.
 *
 * @param css - The stylesheet.
 * @returns The targets as written.
 */
function importedSpecifiers(css: string): string[] {
    const found: string[] = [];
    let index = 0;
    while (index < css.length) {
        const char = css[index];
        const ruleEnd = char === '@' ? importingRuleEnd(css, index) : -1;
        if (char === '/' && css[index + 1] === '*') {
            index = commentEnd(css, index);
        } else if (char === '"' || char === "'") {
            index = stringEnd(css, index) + 1;
        } else if (char === '\\') {
            index += 2;
        } else if (ruleEnd !== -1) {
            const param = importingRuleParam(css, ruleEnd);
            if (param.target !== null) found.push(param.target);
            index = param.end;
        } else {
            index++;
        }
    }
    return found;
}

/** A specifier Tailwind resolves against the importing file's folder. */
const RELATIVE_SPECIFIER_RE = /^\.{1,2}(?:\/|$)/;

/**
 * Whether a path names a file, following a symlink.
 *
 * @param target - Absolute path.
 * @returns True for a file.
 */
function isFile(target: string): boolean {
    return fs.statSync(target, { throwIfNoEntry: false })?.isFile() === true;
}

/**
 * A path as a file, the way Tailwind's resolver tries one: as written, then
 * with `.css` added.
 *
 * @param target - Absolute path.
 * @returns The file, or null.
 */
function asStylesheetFile(target: string): string | null {
    if (isFile(target)) return target;
    return isFile(`${target}.css`) ? `${target}.css` : null;
}

/**
 * The `style` field of a folder's `package.json`, which Tailwind's resolver
 * reads before `index.css`.
 *
 * @param dir - The folder.
 * @returns The field, or null when there is none to read.
 */
function packageStyle(dir: string): string | null {
    try {
        const style: unknown = JSON.parse(
            fs.readFileSync(path.join(dir, 'package.json'), 'utf8'),
        )?.style;
        return typeof style === 'string' ? style : null;
    } catch {
        return null;
    }
}

/**
 * A path as a folder: its `package.json` `style`, then its `index.css`.
 *
 * @param dir - Absolute path.
 * @returns The stylesheet, or null.
 */
function asStylesheetFolder(dir: string): string | null {
    const style = packageStyle(dir);
    const main = style === null ? null : path.resolve(dir, style);
    return (
        (main === null
            ? null
            : (asStylesheetFile(main) ?? asStylesheetFile(path.join(main, 'index')))) ??
        asStylesheetFile(path.join(dir, 'index'))
    );
}

/**
 * The file an `@import` names, resolved as Tailwind's `compile()` resolves
 * it: a relative or absolute path, as a file and then as a folder. A bare
 * specifier is a package, which the walk never reads.
 *
 * @param from - The importing stylesheet.
 * @param specifier - The target as written.
 * @returns The file, or null.
 */
function resolveImport(from: string, specifier: string): string | null {
    if (!RELATIVE_SPECIFIER_RE.test(specifier) && !path.isAbsolute(specifier)) return null;
    const target = path.resolve(path.dirname(from), specifier);
    return asStylesheetFile(target) ?? asStylesheetFolder(target);
}

/**
 * Whether a path lies under a base, below folders the stylesheet walk enters.
 *
 * @param base - A walked folder.
 * @param target - Absolute path.
 * @returns False for anything outside the base, or under a folder skipped by
 *          name or a dot-folder.
 */
function walkableUnder(base: string, target: string): boolean {
    const relative = path.relative(base, target);
    if (relative === '..' || relative.startsWith(`..${path.sep}`) || path.isAbsolute(relative)) {
        return false;
    }
    return relative
        .split(path.sep)
        .slice(0, -1)
        .every(part => !STYLESHEET_WALK_SKIP_DIRS.has(part) && !part.startsWith('.'));
}

/**
 * Every `.css` file under the bases, outside dependencies, build output,
 * generated reports and what `.gitignore` covers, plus every stylesheet one of
 * them imports that `.gitignore` alone left out. An import counts when
 * Tailwind's own `compile()` (`@tailwindcss/node` 4.3.3) follows it: a quoted
 * relative or absolute path after `@import` or `@reference`, resolved as a file, with `.css`
 * added, then as a folder; whatever its extension. A `url()` target, a bare
 * package name and an `@import` inside a comment or a string are not.
 *
 * The import is the exception because it is evidence the app loads the file:
 * a gitignored generated `@theme` file still sets tokens, and dropping it
 * would take their merge groups away without a word. Everything else the
 * walk skips stays skipped when imported: a folder skipped by name, a
 * dot-folder, a path the caller leaves out, a path outside every base.
 *
 * Each stylesheet is read once; imports are followed transitively. For `S`
 * stylesheets of `B` bytes this costs `O(S + B)` beyond the walk itself.
 *
 * @param bases - Folders to walk.
 * @param options - What the caller leaves out.
 * @returns The stylesheets, their text, and the `.gitignore` files applied.
 */
export function walkProjectStylesheets(
    bases: readonly string[],
    options: StylesheetWalkOptions = {},
): StylesheetWalk {
    const files: string[] = [];
    const gitignoreFiles: string[] = [];
    const ignoresFile = options.ignoresFile ?? (() => false);
    for (const base of bases) {
        const walked = walkProject(
            base,
            { skipDirs: STYLESHEET_WALK_SKIP_DIRS, prune: options.prune, gitignore: 'skip' },
            file => {
                if (file.extension === '.css' && !ignoresFile(file.path)) files.push(file.path);
            },
        );
        gitignoreFiles.push(...walked.gitignoreFiles);
    }

    const texts = new Map<string, string>();
    const seen = new Set(files);
    // The list grows while it is read, and an array iterator reaches what is
    // appended: an imported stylesheet is read in turn.
    for (const file of files) {
        let text: string;
        try {
            text = fs.readFileSync(file, 'utf8');
        } catch {
            continue;
        }
        texts.set(file, text);
        if (!text.includes('@import') && !text.includes('@reference')) continue;
        for (const written of importedSpecifiers(text)) {
            const target = resolveImport(file, written);
            if (target === null || seen.has(target) || ignoresFile(target)) continue;
            if (!bases.some(base => walkableUnder(base, target))) continue;
            seen.add(target);
            files.push(target);
        }
    }
    return { files, texts, gitignoreFiles };
}
