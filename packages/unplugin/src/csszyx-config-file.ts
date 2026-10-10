/**
 * Loading `csszyx.config.{ts,mts,js,mjs}` and handing its policy to the lanes
 * that cannot load it.
 *
 * Node's own `import()` reads every name: Node `^22.18 || >=24.11` strips
 * TypeScript types natively, so no bundler or transpiler is involved. One case
 * needs help, measured on Node 24.18: outside a `"type": "module"` package a
 * `.ts` or `.js` file is CommonJS to Node, and the config every project is
 * told to write uses `export default`. Under `"type": "commonjs"` `import()`
 * throws "Cannot use import statement outside a module"; with no `"type"` it
 * loads, but Node prints `MODULE_TYPELESS_PACKAGE_JSON` advising
 * `"type": "module"`, which would break a CommonJS app. So when the nearest
 * package.json is not `"type": "module"` and the file is written as an ES
 * module, the loader imports the same text under an `.mts`/`.mjs` name written
 * beside the original — so its relative imports and packages resolve from the
 * same place — and removes it again. Vite loads its own config the same way.
 *
 * The Turbopack loader and jest run synchronously and never import TypeScript,
 * so `csszyx next prebuild`/`watch` resolve the policy into
 * `.csszyx/diagnostic-policy.json`, the way they write `merge-table.json`, and
 * those lanes read it with {@link readDiagnosticPolicyState}.
 *
 * @module csszyx-config-file
 */
import { randomBytes } from 'node:crypto';
import { existsSync, readFileSync, rmSync, statSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { pathToFileURL } from 'node:url';

import { atomicWriteFileSync } from './atomic-write.js';
import {
    createDiagnosticPolicy,
    DIAGNOSTIC_POLICY_FORMAT,
    type DiagnosticConfigProblem,
    type DiagnosticPolicy,
    type DiagnosticPolicyState,
    readCsszyxFileConfig,
} from './diagnostic-policy.js';

/** Every name the config file can have, in the order they are looked for. */
export const CSSZYX_CONFIG_FILE_NAMES = [
    'csszyx.config.ts',
    'csszyx.config.mts',
    'csszyx.config.js',
    'csszyx.config.mjs',
] as const;

/** The state file the Turbopack loader and jest read, under `.csszyx/`. */
export const DIAGNOSTIC_POLICY_STATE_FILE = 'diagnostic-policy.json';

/** The config file a project has, and any others it holds that are not read. */
export interface FoundConfigFile {
    /** Absolute path of the file that is read. */
    file: string;
    /** Names of the other config files present, which are not read. */
    ignored: string[];
}

/**
 * Find the project's config file.
 *
 * @param root - The project root.
 * @returns The file read and the ones left unread, or null when there is none.
 */
export function findCsszyxConfigFile(root: string): FoundConfigFile | null {
    const present = CSSZYX_CONFIG_FILE_NAMES.filter(name => existsSync(path.join(root, name)));
    const [first, ...ignored] = present;
    return first === undefined ? null : { file: path.join(root, first), ignored };
}

/** Imports a module by URL; Node's `import()` unless a caller substitutes one. */
export type ModuleImporter = (url: string) => Promise<unknown>;

/**
 * Node's own `import()`.
 *
 * @param url - A `file:` URL.
 * @returns The module namespace.
 */
const nativeImport: ModuleImporter = url => import(url);

/** The ES-module twin of each name that Node may read as CommonJS. */
const ESM_TWIN: Readonly<Record<string, string>> = { '.ts': '.mts', '.js': '.mjs' };

/**
 * Whether the nearest package.json at or above a directory says
 * `"type": "module"`, which is when Node reads a `.ts` or `.js` file as an
 * ES module. One that cannot be parsed counts as not saying so.
 *
 * @param dir - Absolute directory.
 * @returns True for an ES-module package.
 */
function isModulePackage(dir: string): boolean {
    for (let current = dir; ; current = path.dirname(current)) {
        const manifest = path.join(current, 'package.json');
        if (existsSync(manifest)) {
            try {
                return JSON.parse(readFileSync(manifest, 'utf8')).type === 'module';
            } catch {
                return false;
            }
        }
        if (path.dirname(current) === current) return false;
    }
}

/**
 * The name a new config file gets in a project: one Node reads as an ES
 * module whatever the package type, so `export default` loads without Node
 * advising `"type": "module"` — `.ts`/`.js` in an ES-module package,
 * `.mts`/`.mjs` everywhere else.
 *
 * @param root - The project root.
 * @param options - What the project is written in.
 * @param options.typescript - Whether the project uses TypeScript.
 * @returns The file name, such as `csszyx.config.mts`.
 */
export function csszyxConfigFileNameFor(root: string, options: { typescript: boolean }): string {
    const esm = isModulePackage(root);
    if (options.typescript) return esm ? 'csszyx.config.ts' : 'csszyx.config.mts';
    return esm ? 'csszyx.config.js' : 'csszyx.config.mjs';
}

/**
 * Whether a file is written as an ES module: a line that starts with `import`
 * or `export` as a statement. A CommonJS file (`module.exports = …`) has none.
 *
 * @param text - The file's text.
 * @returns True for ES-module syntax.
 */
function hasModuleSyntax(text: string): boolean {
    return /^[ \t]*(?:import|export)[\s{*]/m.test(text);
}

/**
 * The URL a config is imported from directly. It carries the file's mtime, so
 * a config edited during a dev session is read again rather than served from
 * the module cache.
 *
 * @param file - Absolute path.
 * @returns The URL.
 */
function versionedUrl(file: string): string {
    return `${pathToFileURL(file).href}?mtime=${statSync(file).mtimeMs}`;
}

/** The write errors of a directory the loader may not write into. */
const UNWRITABLE = new Set(['EACCES', 'EPERM', 'EROFS']);

/**
 * Import the same text under a name Node reads as an ES module, beside the
 * original, and remove it again.
 *
 * The name is unique per call — process id plus random bytes, and `wx` refuses
 * an existing file — so two loads in one process never share, and remove,
 * each other's copy. In a directory that cannot be written (a read-only
 * checkout or mount) the original is imported instead: Node may print its own
 * advice about the package type, and the config still loads.
 *
 * @param file - Absolute path of the config.
 * @param text - Its text.
 * @param twin - The ES-module extension.
 * @param importModule - The importer.
 * @returns The module namespace.
 */
async function importCopy(
    file: string,
    text: string,
    twin: string,
    importModule: ModuleImporter,
): Promise<unknown> {
    const unique = `${Date.now()}-${process.pid}-${randomBytes(4).toString('hex')}`;
    const copy = `${file}.timestamp-${unique}${twin}`;
    try {
        writeFileSync(copy, text, { flag: 'wx' });
    } catch (error) {
        if (UNWRITABLE.has((error as NodeJS.ErrnoException).code ?? '')) {
            return importModule(versionedUrl(file));
        }
        throw error;
    }
    try {
        return await importModule(pathToFileURL(copy).href);
    } finally {
        rmSync(copy, { force: true });
    }
}

/**
 * Import a config file, as an ES module when Node would read it as CommonJS.
 *
 * A file whose ES syntax {@link hasModuleSyntax} did not recognise is still
 * retried from a copy when Node throws a `SyntaxError` for it.
 *
 * @param file - Absolute path.
 * @param importModule - The importer.
 * @returns The module namespace.
 */
async function importConfig(file: string, importModule: ModuleImporter): Promise<unknown> {
    const twin = ESM_TWIN[path.extname(file)];
    if (twin === undefined) return importModule(versionedUrl(file));
    const text = readFileSync(file, 'utf8');
    if (!isModulePackage(path.dirname(file)) && hasModuleSyntax(text)) {
        return importCopy(file, text, twin, importModule);
    }
    try {
        return await importModule(versionedUrl(file));
    } catch (error) {
        if (!(error instanceof SyntaxError)) throw error;
    }
    return importCopy(file, text, twin, importModule);
}

/**
 * Where a quoted string ends.
 *
 * @param text - Source text.
 * @param open - Index of the opening quote.
 * @returns The index just past the closing quote, or the text's length when
 *          the string is never closed.
 */
function quotedEnd(text: string, open: number): number {
    const quote = text[open];
    let i = open + 1;
    while (i < text.length) {
        const char = text[i];
        // An escape carries the character after it, a quote included.
        i += char === '\\' ? 2 : 1;
        if (char === quote) break;
    }
    return Math.min(i, text.length);
}

/**
 * The comment that starts at an index outside a string, if one does.
 *
 * A line comment runs to its newline, which stays in the code; a block comment
 * runs past its `*\/` and leaves one space behind, so the tokens either side
 * stay apart. Either one left open runs to the end of the text.
 *
 * @param text - Source text.
 * @param i - Index outside any string.
 * @returns Where the code resumes and what stands in for the comment, or null
 *          when no comment starts here.
 */
function commentAt(text: string, i: number): { end: number; blank: string } | null {
    const pair = text.slice(i, i + 2);
    if (pair === '//') {
        const end = text.indexOf('\n', i);
        return { end: end === -1 ? text.length : end, blank: '' };
    }
    if (pair === '/*') {
        const end = text.indexOf('*/', i + 2);
        return { end: end === -1 ? text.length : end + 2, blank: ' ' };
    }
    return null;
}

/**
 * The code of a JavaScript or TypeScript file with its comments blanked out,
 * strings kept whole, so a `//` inside a URL is not read as a comment.
 *
 * @param text - Source text.
 * @returns The text without comments.
 */
function withoutComments(text: string): string {
    let out = '';
    let i = 0;
    while (i < text.length) {
        const char = text[i] as string;
        const comment = commentAt(text, i);
        if (comment !== null) {
            i = comment.end;
            out += comment.blank;
        } else if (char === "'" || char === '"' || char === '`') {
            const end = quotedEnd(text, i);
            out += text.slice(i, end);
            i = end;
        } else {
            out += char;
            i++;
        }
    }
    return out;
}

/**
 * The file `csszyx init` 0.17 and earlier wrote: plugin options typed with
 * `CsszyxConfig`, in TypeScript syntax even into `csszyx.config.js`. Matched
 * on the code with comments removed and whitespace squeezed out around
 * punctuation, so either quote, any spacing, a trailing comma and optional
 * semicolons are still the template: a copy a formatter rewrote is one.
 */
const OLD_INIT_TEMPLATE_HEAD = /^import type\{CsszyxConfig,?\}from ?(['"])csszyx\1;?/;
/** The declaration that follows the import, up to the object's opening brace. */
const OLD_INIT_TEMPLATE_DECLARATION = 'const config:CsszyxConfig={';
/** The end of the template, after the object's closing brace. */
const OLD_INIT_TEMPLATE_TAIL = /\};?export default config;?$/;

/** Longer than any copy of the template; such a file is someone's code. */
const OLD_INIT_TEMPLATE_MAX_LENGTH = 65_536;

/**
 * Whether braces close in order and never close one that was not opened, so
 * the text between the template's own braces is one object, not two
 * statements around a `};`.
 *
 * @param body - The text inside the object literal.
 * @returns True when it is balanced.
 */
function hasBalancedBraces(body: string): boolean {
    let depth = 0;
    for (const char of body) {
        if (char === '{') depth++;
        else if (char === '}' && --depth < 0) return false;
    }
    return depth === 0;
}

/**
 * Whether a config file's text is the one an older `csszyx init` wrote,
 * unchanged in shape and setting no `diagnostics`.
 *
 * Nothing read that file, so it never failed anyone; now the file is
 * imported, its TypeScript syntax does not load as `.js`, and failing `check`
 * over it would turn a file the project never configured into a red CI. Any
 * other file that fails to load stays an error: its levels were meant.
 * `csszyx init` replaces this file and keeps any other.
 *
 * @param text - The file's text.
 * @returns True for the old template.
 */
export function isLegacyInitTemplate(text: string): boolean {
    if (text.length > OLD_INIT_TEMPLATE_MAX_LENGTH) return false;
    const code = withoutComments(text)
        .replace(/\s+/g, ' ')
        .replace(/ ?([,:;={}]) ?/g, '$1')
        .trim();
    const head = OLD_INIT_TEMPLATE_HEAD.exec(code);
    if (head === null) return false;
    const rest = code.slice(head[0].length).trimStart();
    if (!rest.startsWith(OLD_INIT_TEMPLATE_DECLARATION)) return false;
    const object = rest.slice(OLD_INIT_TEMPLATE_DECLARATION.length);
    const tail = OLD_INIT_TEMPLATE_TAIL.exec(object);
    if (tail === null) return false;
    const body = object.slice(0, tail.index);
    return hasBalancedBraces(body) && !body.includes('diagnostics');
}

/**
 * Whether the config file is the old `csszyx init` template.
 *
 * @param file - Absolute path.
 * @returns True for the old template; false for a file it cannot read.
 */
function isOldInitTemplate(file: string): boolean {
    try {
        return isLegacyInitTemplate(readFileSync(file, 'utf8'));
    } catch {
        return false;
    }
}

/**
 * TypeScript-only syntax a `.js` or `.mjs` config may hold: a type import or
 * export, an interface or type alias, a typed declaration, `satisfies` or
 * `as const`.
 */
const TYPESCRIPT_SYNTAX: readonly RegExp[] = [
    /^[ \t]*(?:import|export)[ \t]+type\b/m,
    /^[ \t]*(?:export[ \t]+)?(?:interface|type)[ \t]+[\w$]+[ \t]*[<={]/m,
    /\b(?:const|let|var)[ \t]+[\w$]+[ \t]*:[ \t]*[\w${[]/,
    /\bsatisfies[ \t]+[\w$]/,
    /\bas[ \t]+const\b/,
];

/**
 * What may follow the config's path where an error names it: the name of its
 * ES-module copy, the query that busts the module cache, and a line and
 * column.
 */
const AFTER_CONFIG_PATH = /^(?:\.timestamp-[\w-]+\.m[jt]s)?(?:\?[^\s:)]*)?(?::(\d+)(?::(\d+))?)?/;

/**
 * Name the config the way the user knows it wherever an error's text names
 * it, by URL or path, as itself or as its ES-module copy.
 *
 * @param text - Error text: a message or a stack.
 * @param file - Absolute path of the config.
 * @returns The text with each mention as the file name, and the first
 * `name:line[:column]` it names, or null.
 */
function namingUserFile(text: string, file: string): { text: string; location: string | null } {
    const name = path.basename(file);
    const spellings = [pathToFileURL(file).href, file];
    let out = '';
    let rest = text;
    let location: string | null = null;
    for (;;) {
        const found = spellings
            .map(spelling => ({ spelling, index: rest.indexOf(spelling) }))
            .filter(hit => hit.index !== -1)
            .sort((a, b) => a.index - b.index)[0];
        if (found === undefined) return { text: out + rest, location };
        const after = rest.slice(found.index + found.spelling.length);
        // Every part is optional, so this always matches, if only nothing.
        const [suffix, line, column] = AFTER_CONFIG_PATH.exec(after) as RegExpExecArray;
        const position = [line, column].filter(part => part !== undefined).join(':');
        const at = position === '' ? name : `${name}:${position}`;
        if (position !== '') location ??= at;
        out += rest.slice(0, found.index) + at;
        rest = after.slice(suffix.length);
    }
}

/**
 * Why a config did not load, in the user's terms: the first line of the
 * error with the ES-module copy named as the user's file, the line and column
 * of the file's own stack frame when the error has one, and a rename when a
 * JavaScript file failed on TypeScript syntax.
 *
 * @param error - What the import threw.
 * @param file - Absolute path of the config.
 * @returns The reason.
 */
function loadFailureReason(error: unknown, file: string): string {
    const name = path.basename(file);
    const message = error instanceof Error ? error.message : String(error);
    let reason = namingUserFile(message.split('\n')[0] as string, file).text;
    // Node's SyntaxError for a module names no file; a runtime error does.
    const location =
        error instanceof Error ? namingUserFile(error.stack ?? '', file).location : null;
    if (location !== null) reason += ` (at ${location})`;
    if (error instanceof SyntaxError && /\.m?js$/.test(name) && looksLikeTypeScript(file)) {
        const renamed = csszyxConfigFileNameFor(path.dirname(file), { typescript: true });
        reason += `. \`${name}\` holds TypeScript syntax; rename it to \`${renamed}\`.`;
    }
    return reason;
}

/**
 * Whether a file's code holds TypeScript-only syntax.
 *
 * @param file - Absolute path.
 * @returns True when it does; false for a file it cannot read.
 */
function looksLikeTypeScript(file: string): boolean {
    try {
        const code = withoutComments(readFileSync(file, 'utf8'));
        return TYPESCRIPT_SYNTAX.some(syntax => syntax.test(code));
    } catch {
        return false;
    }
}

/**
 * The warning for the old `csszyx init` template, which does not load.
 *
 * @param reason - Why it did not load.
 * @returns The problem text.
 */
function unloadableTemplateMessage(reason: string): string {
    return (
        'could not be loaded and is ignored: it is the file `csszyx init` 0.17 and earlier ' +
        'wrote, which nothing read. Replace it with ' +
        '`export default defineConfig({ diagnostics: { … } })`, importing `defineConfig` ' +
        `from \`csszyx\`, or delete it. Load error: ${reason}`
    );
}

/** What loading a project's config produced. */
export interface LoadedDiagnosticPolicy {
    /** Absolute path of the config read, or null when the project has none. */
    file: string | null;
    /** The policy; the defaults when there is no file or it did not load. */
    policy: DiagnosticPolicy;
    /** Everything wrong with the file, `error` first in the order found. */
    problems: DiagnosticConfigProblem[];
}

/**
 * Load the project's config and build its diagnostic policy.
 *
 * Never throws: a config that does not load is an `error` problem and the
 * defaults apply, so each caller decides what a broken config costs — `check`
 * fails the run, a build prints the problem and carries on. So is one with no
 * default export. The file an older `csszyx init` wrote, which does not load,
 * is only a `warning`: see {@link isOldInitTemplate}.
 *
 * @param root - The project root.
 * @param importModule - The importer; Node's `import()` by default.
 * @returns The file, the policy and the problems.
 */
export async function loadDiagnosticPolicy(
    root: string,
    importModule: ModuleImporter = nativeImport,
): Promise<LoadedDiagnosticPolicy> {
    const found = findCsszyxConfigFile(root);
    if (found === null) return { file: null, policy: createDiagnosticPolicy(), problems: [] };
    const name = path.basename(found.file);
    const problems: DiagnosticConfigProblem[] = found.ignored.map(ignored => ({
        severity: 'warning',
        path: ignored,
        message: `not read: \`${name}\` is read first. Keep one config file.`,
    }));
    let module: unknown;
    try {
        module = await importConfig(found.file, importModule);
    } catch (error) {
        const reason = loadFailureReason(error, found.file);
        problems.unshift(
            isOldInitTemplate(found.file)
                ? {
                      severity: 'warning',
                      path: name,
                      message: unloadableTemplateMessage(reason),
                      fileIgnored: true,
                  }
                : {
                      severity: 'error',
                      path: name,
                      message: `could not be loaded: ${reason}`,
                      fileIgnored: true,
                  },
        );
        return { file: found.file, policy: createDiagnosticPolicy(), problems };
    }
    const exported = (module as { default?: unknown }).default;
    if (exported === undefined) {
        // `export const config = …` loads cleanly and sets nothing.
        problems.unshift({
            severity: 'error',
            path: name,
            message: 'has no default export; write `export default defineConfig({ … })`.',
            fileIgnored: true,
        });
        return { file: found.file, policy: createDiagnosticPolicy(), problems };
    }
    const read = readCsszyxFileConfig(exported);
    return {
        file: found.file,
        policy: createDiagnosticPolicy(read.config),
        problems: [...read.problems, ...problems],
    };
}

/**
 * Where the policy state file lives for a project.
 *
 * @param root - The project root.
 * @returns Absolute path.
 */
export function diagnosticPolicyStatePath(root: string): string {
    return path.join(root, '.csszyx', DIAGNOSTIC_POLICY_STATE_FILE);
}

/**
 * Write the policy for the lanes that cannot load the config, when it changed.
 *
 * Unchanged content is not rewritten: Turbopack re-runs every module that
 * depends on the file when it changes.
 *
 * @param root - The project root.
 * @param policy - The resolved policy.
 * @returns Whether the file was written.
 */
export function writeDiagnosticPolicyState(root: string, policy: DiagnosticPolicy): boolean {
    const target = diagnosticPolicyStatePath(root);
    const text = `${JSON.stringify(policy.toJSON())}\n`;
    if (existsSync(target) && readFileSync(target, 'utf8') === text) return false;
    atomicWriteFileSync(target, text);
    return true;
}

/**
 * Read the policy a Next command wrote.
 *
 * A missing, unreadable or other-format file gives the defaults: the policy
 * only decides how loudly something is said, never what is built.
 *
 * @param root - The project root.
 * @returns The policy.
 */
export function readDiagnosticPolicyState(root: string): DiagnosticPolicy {
    let state: Partial<DiagnosticPolicyState>;
    try {
        state = JSON.parse(readFileSync(diagnosticPolicyStatePath(root), 'utf8'));
    } catch {
        return createDiagnosticPolicy();
    }
    return diagnosticPolicyFromState(state);
}

/**
 * Build the policy a {@link DiagnosticPolicy.toJSON} record describes.
 *
 * @param state - The parsed record.
 * @returns The policy; the defaults for another format.
 */
export function diagnosticPolicyFromState(state: Partial<DiagnosticPolicyState>): DiagnosticPolicy {
    if (state.format !== DIAGNOSTIC_POLICY_FORMAT) return createDiagnosticPolicy();
    return createDiagnosticPolicy(readCsszyxFileConfig({ diagnostics: state.config }).config);
}
