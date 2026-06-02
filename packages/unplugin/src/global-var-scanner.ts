import { createHash } from 'node:crypto';
import * as fs from 'node:fs';
import * as path from 'node:path';

import { type GlobalVarUsageDiagnostic, scanGlobalVarUsages } from '@csszyx/compiler';
import { encode } from '@csszyx/core';
import {
    CSSZYX_GLOBAL_ALIAS_PREFIX,
    isCsszyxGlobalAliasCustomProperty,
    isTailwindReservedCustomProperty,
} from '@csszyx/types';
import postcss, {
    type AtRule,
    type ChildNode,
    type Declaration,
    type Root,
    type Rule,
} from 'postcss';
import valueParser from 'postcss-value-parser';

export { CSSZYX_GLOBAL_ALIAS_PREFIX, TAILWIND_RESERVED_PREFIXES } from '@csszyx/types';

/** Source location for one CSS custom-property occurrence. */
export interface CssVarLocation {
    /** Source file path, when known. */
    filePath: string;
    /** 1-based source line. */
    line: number;
    /** 1-based source column. */
    column: number;
}

/** One CSS custom-property definition. */
export interface CssVarDefinition extends CssVarLocation {
    /** Custom-property name including the leading `--`. */
    name: string;
    /** Stable declaration scope key built from ancestor at-rules and selectors. */
    scopeId: string;
    /** Whether the definition lives inside a Tailwind v4 @theme block. */
    tailwindOwned: boolean;
    /** Whether this name is registered by an @property at-rule. */
    registered: boolean;
}

/** One var(--token) reference. */
export interface CssVarReference extends CssVarLocation {
    /** Custom-property name including the leading `--`. */
    name: string;
    /** Stable reference scope key built from ancestor at-rules and selectors. */
    scopeId: string;
    /** Declaration property or at-rule params where the reference appears. */
    owner: string;
    /** Whether the reference lives inside a Tailwind v4 @theme block. */
    tailwindOwned: boolean;
}

/** CSS custom-property scan output for one CSS source. */
export interface CssVarScanResult {
    /** Source file path, when known. */
    filePath: string;
    /** Custom-property declarations. */
    definitions: CssVarDefinition[];
    /** var(--token) references. */
    references: CssVarReference[];
    /** @property registered custom-property names. */
    registered: string[];
    /** Whether the file path appears to be third-party CSS. */
    thirdParty: boolean;
}

/** Cache entry for one CSS variable scan result. */
export interface GlobalVarScanCacheEntry {
    /** Cache key derived from file path, mtime, and content hash. */
    key: string;
    /** Cached scan result. */
    result: CssVarScanResult;
}

/** Inputs used to derive a scan cache key. */
export interface GlobalVarScanCacheKeyInput {
    /** Source file path. */
    filePath: string;
    /** CSS source text. */
    css: string;
    /** Source file mtime in milliseconds. */
    mtimeMs: number;
}

/** CSS source supplied to the Phase H validation orchestrator. */
export interface GlobalVarCssSource {
    /** Source file path. */
    filePath: string;
    /** CSS source text. */
    css: string;
    /** Source file mtime in milliseconds, used when cacheDir is set. */
    mtimeMs?: number;
}

/** JS/TS/JSX/TSX source supplied to the Phase H validation orchestrator. */
export interface GlobalVarCodeSource {
    /** Source file path. */
    filePath: string;
    /** JS/TS/JSX/TSX source text. */
    code: string;
}

/** CSS asset supplied by a bundler output hook. */
export interface GlobalVarCssAssetSource {
    /** CSS asset file name, relative to the build output or absolute. */
    fileName: string;
    /** CSS asset source contents. */
    source: string | Uint8Array;
    /** Source file mtime in milliseconds, used when cacheDir is set. */
    mtimeMs?: number;
}

/** Options for scanning one CSS source. */
export interface ScanGlobalVarCssOptions {
    /** File path used for diagnostics. */
    filePath?: string;
}

/** Planner diagnostic severity. */
export type GlobalVarAliasDiagnosticSeverity = 'error';

/** Planner diagnostic. */
export interface GlobalVarAliasDiagnostic {
    /** Machine-readable diagnostic code. */
    code:
        | 'missing-definition'
        | 'tailwind-reserved'
        | 'tailwind-owned'
        | 'registered-property'
        | 'alias-collision';
    /** Diagnostic severity. Phase H M2 is fail-closed. */
    severity: GlobalVarAliasDiagnosticSeverity;
    /** Related custom-property name. */
    name: string;
    /** Human-readable message. */
    message: string;
    /** Source location when available. */
    location?: CssVarLocation;
}

/** One planned alias mapping. */
export interface GlobalVarAliasEntry {
    /** Original app-owned custom-property name. */
    original: string;
    /** Deterministic short alias name. */
    alias: string;
    /** Declaration scopes where aliases must be emitted. */
    scopes: string[];
}

/** Input to the pure global variable alias planner. */
export interface PlanGlobalVarAliasesInput {
    /** CSS scan results. */
    scans: CssVarScanResult[];
    /** Explicit app-owned custom-property names. */
    tokens?: string[];
    /** Optional app-owned prefix discovery. Empty string disables discovery. */
    autoPrefix?: string;
    /** Prefix for generated aliases. Defaults to `---g`. */
    aliasPrefix?: string;
    /** Additional reserved names or prefixes. Prefixes may end with `*`. */
    reserved?: string[];
}

/** Output from the pure global variable alias planner. */
export interface GlobalVarAliasPlan {
    /** Deterministic alias entries. Empty when diagnostics contain errors. */
    entries: GlobalVarAliasEntry[];
    /** Original-to-alias lookup. Empty when diagnostics contain errors. */
    aliases: Map<string, string>;
    /** Planner diagnostics. */
    diagnostics: GlobalVarAliasDiagnostic[];
}

/** Input for Phase H scanner/planner/diagnostics integration. */
export interface ValidateGlobalVarAliasInputsOptions {
    /** CSS sources that define or reference custom properties. */
    cssFiles: GlobalVarCssSource[];
    /** JS/TS/JSX/TSX sources to scan for out-of-band usage. */
    sourceFiles?: GlobalVarCodeSource[];
    /** Explicit app-owned custom-property names. */
    tokens?: string[];
    /** Optional app-owned prefix discovery. Empty string disables discovery. */
    autoPrefix?: string;
    /** Prefix for generated aliases. Defaults to `---g`. */
    aliasPrefix?: string;
    /** Additional reserved names or prefixes. Prefixes may end with `*`. */
    reserved?: string[];
    /** Optional global-var scan cache directory. */
    cacheDir?: string;
}

/** Input for building validation options from bundler output state. */
export interface CreateGlobalVarAliasValidationOptionsInput {
    /** Project root used to normalize relative asset names. */
    rootDir: string;
    /** CSS assets emitted by the bundler. Non-CSS assets are ignored. */
    cssAssets: GlobalVarCssAssetSource[];
    /** Source files transformed or observed before bundling. */
    sourceFiles?: GlobalVarCodeSource[];
    /** Explicit app-owned custom-property names. */
    tokens?: string[];
    /** Optional app-owned prefix discovery. Empty string disables discovery. */
    autoPrefix?: string;
    /** Prefix for generated aliases. Defaults to `---g`. */
    aliasPrefix?: string;
    /** Additional reserved names or prefixes. Prefixes may end with `*`. */
    reserved?: string[];
    /** Optional global-var scan cache directory. */
    cacheDir?: string;
}

/** Output from Phase H scanner/planner/diagnostics integration. */
export interface GlobalVarAliasValidationResult {
    /** CSS scan results. */
    scans: CssVarScanResult[];
    /** Deterministic alias plan. */
    plan: GlobalVarAliasPlan;
    /** JS/JSX out-of-band usage diagnostics for planned candidates. */
    usageDiagnostics: GlobalVarUsageDiagnostic[];
}

/** Options for rewriting CSS with a validated global variable alias plan. */
export interface RewriteGlobalVarCssAliasesOptions {
    /** CSS source text. */
    css: string;
    /** Validated alias plan. Diagnostics keep the rewrite as a no-op. */
    plan: GlobalVarAliasPlan;
    /** Source file path used by PostCSS diagnostics/source maps. */
    filePath?: string;
}

/** Result of a pure global variable CSS alias rewrite. */
export interface GlobalVarCssAliasRewriteResult {
    /** Rewritten CSS source. */
    css: string;
    /** Number of alias declarations inserted. */
    aliasDeclarations: number;
    /** Number of `var(--token)` references rewritten. */
    rewrittenReferences: number;
    /** Planner diagnostics that prevented rewriting, when any. */
    diagnostics: GlobalVarAliasDiagnostic[];
}

const VAR_REFERENCE_RE = /var\(\s*(--[\w-]+)/g;
const DEFAULT_SCOPE_ID = '<root>';

/**
 * Scans one CSS source for custom-property definitions and var() references.
 *
 * @param css CSS source text.
 * @param options Scan options.
 * @returns Definitions, references, registrations, and ownership metadata.
 */
export function scanGlobalVarCss(
    css: string,
    options: ScanGlobalVarCssOptions = {},
): CssVarScanResult {
    const filePath = options.filePath ?? '<inline>';
    const root = postcss.parse(css, { from: filePath });
    const registered = collectRegisteredProperties(root);
    const definitions: CssVarDefinition[] = [];
    const references: CssVarReference[] = [];

    root.walkDecls(decl => {
        const scopeId = buildScopeId(decl);
        const tailwindOwned = isInsideThemeAtRule(decl);
        if (decl.prop.startsWith('--')) {
            definitions.push({
                name: decl.prop,
                scopeId,
                tailwindOwned,
                registered: registered.has(decl.prop),
                ...nodeLocation(decl, filePath),
            });
        }
        for (const name of extractVarReferences(decl.value)) {
            references.push({
                name,
                scopeId,
                owner: decl.prop,
                tailwindOwned,
                ...nodeLocation(decl, filePath),
            });
        }
    });

    root.walkAtRules(atRule => {
        if (atRule.name === 'property') {
            return;
        }
        for (const name of extractVarReferences(atRule.params)) {
            references.push({
                name,
                scopeId: buildScopeId(atRule),
                owner: `@${atRule.name}`,
                tailwindOwned: isInsideThemeAtRule(atRule),
                ...nodeLocation(atRule, filePath),
            });
        }
    });

    return {
        filePath,
        definitions,
        references,
        registered: [...registered].sort(),
        thirdParty: isThirdPartyCssPath(filePath),
    };
}

/**
 * Plans deterministic global aliases for explicit app-owned tokens.
 *
 * @param input Planner input.
 * @returns Alias plan or fail-closed diagnostics.
 */
export function planGlobalVarAliases(input: PlanGlobalVarAliasesInput): GlobalVarAliasPlan {
    const definitions = flattenDefinitions(input.scans);
    const candidates = collectCandidates(input, definitions);
    const aliasPrefix = input.aliasPrefix ?? CSSZYX_GLOBAL_ALIAS_PREFIX;
    const diagnostics = validateCandidates(
        candidates,
        definitions,
        input.reserved ?? [],
        aliasPrefix,
    );
    if (diagnostics.length > 0) {
        return { entries: [], aliases: new Map(), diagnostics };
    }

    const definitionNames = new Set(definitions.keys());
    const entries: GlobalVarAliasEntry[] = [];
    for (const [index, original] of candidates.entries()) {
        const alias = `${aliasPrefix}${encode(index)}`;
        if (definitionNames.has(alias)) {
            return {
                entries: [],
                aliases: new Map(),
                diagnostics: [
                    {
                        code: 'alias-collision',
                        severity: 'error',
                        name: alias,
                        message: `Generated alias ${alias} collides with an existing CSS custom property.`,
                        location: definitions.get(alias)?.[0],
                    },
                ],
            };
        }
        entries.push({
            original,
            alias,
            scopes: [
                ...new Set((definitions.get(original) ?? []).map(definition => definition.scopeId)),
            ].sort(),
        });
    }

    return {
        entries,
        aliases: new Map(entries.map(entry => [entry.original, entry.alias])),
        diagnostics: [],
    };
}

/**
 * Runs the Phase H pure validation pipeline without mutating build output.
 *
 * @param options Validation input.
 * @returns CSS scans, alias plan, and JS/JSX out-of-band diagnostics.
 */
export function validateGlobalVarAliasInputs(
    options: ValidateGlobalVarAliasInputsOptions,
): GlobalVarAliasValidationResult {
    const scans = options.cssFiles.map(file =>
        scanCssSourceWithOptionalCache(file, options.cacheDir),
    );
    const plan = planGlobalVarAliases({
        scans,
        tokens: options.tokens,
        autoPrefix: options.autoPrefix,
        aliasPrefix: options.aliasPrefix,
        reserved: options.reserved,
    });
    if (plan.diagnostics.length > 0 || plan.entries.length === 0) {
        return { scans, plan, usageDiagnostics: [] };
    }

    const candidateTokens = plan.entries.map(entry => entry.original);
    const usageDiagnostics = (options.sourceFiles ?? []).flatMap(file =>
        scanGlobalVarUsages(file.code, file.filePath, { tokens: candidateTokens }),
    );

    return { scans, plan, usageDiagnostics };
}

/**
 * Builds validation options from bundler CSS assets and observed source files.
 *
 * This keeps production hook wiring deterministic: the same normalized CSS asset
 * inventory can feed fail-closed validation before any CSS/TSX rewrite mutates
 * output.
 *
 * @param input Bundler output and user global-var alias config fields.
 * @returns Normalized validation options.
 */
export function createGlobalVarAliasValidationOptions(
    input: CreateGlobalVarAliasValidationOptionsInput,
): ValidateGlobalVarAliasInputsOptions {
    return {
        cssFiles: input.cssAssets
            .filter(asset => /\.css(?:$|\?)/.test(asset.fileName))
            .map(asset => ({
                filePath: normalizeBuildAssetPath(input.rootDir, asset.fileName),
                css: cssAssetSourceToString(asset.source),
                mtimeMs: asset.mtimeMs,
            })),
        sourceFiles: input.sourceFiles ?? [],
        tokens: input.tokens,
        autoPrefix: input.autoPrefix,
        aliasPrefix: input.aliasPrefix,
        reserved: input.reserved,
        cacheDir: input.cacheDir,
    };
}

/**
 * Rewrites one CSS source with a validated global variable alias plan.
 *
 * This is intentionally pure M5 plumbing. It does not integrate with build
 * hooks yet; callers must provide a fail-closed plan from `planGlobalVarAliases`.
 *
 * @param options Rewrite options.
 * @returns Rewritten CSS and rewrite counters.
 */
export function rewriteGlobalVarCssAliases(
    options: RewriteGlobalVarCssAliasesOptions,
): GlobalVarCssAliasRewriteResult {
    if (options.plan.diagnostics.length > 0 || options.plan.entries.length === 0) {
        return {
            css: options.css,
            aliasDeclarations: 0,
            rewrittenReferences: 0,
            diagnostics: options.plan.diagnostics,
        };
    }

    const root = postcss.parse(options.css, { from: options.filePath });
    const aliasNames = new Set(options.plan.entries.map(entry => entry.alias));
    const referenceAliases = new Map(
        options.plan.entries
            .filter(entry => canRewriteGlobalVarReferences(entry))
            .map(entry => [entry.original, entry.alias]),
    );
    let aliasDeclarations = 0;
    let rewrittenReferences = 0;

    root.walkDecls(decl => {
        if (isInsideThemeAtRule(decl)) {
            return;
        }

        const alias = options.plan.aliases.get(decl.prop);
        if (alias && !hasSiblingDeclaration(decl, alias)) {
            decl.cloneAfter({ prop: alias, value: `var(${decl.prop})` });
            aliasDeclarations++;
        }

        if (options.plan.aliases.has(decl.prop) || aliasNames.has(decl.prop)) {
            return;
        }

        const rewrite = rewriteGlobalVarValue(decl.value, referenceAliases);
        if (rewrite.count > 0) {
            decl.value = rewrite.value;
            rewrittenReferences += rewrite.count;
        }
    });

    return {
        css: root.toString(),
        aliasDeclarations,
        rewrittenReferences,
        diagnostics: [],
    };
}

/**
 * Checks whether a planned alias is safe for broad declaration-value rewrites.
 *
 * The pure CSS pass can always emit alias declarations next to matching custom
 * property definitions. Rewriting unrelated declaration values is stricter:
 * until the build hook has a cascade-aware owned-reference proof, only tokens
 * with at least one inherited global definition scope are eligible.
 *
 * @param entry Alias plan entry.
 * @returns true when declaration values can use this alias.
 */
function canRewriteGlobalVarReferences(entry: GlobalVarAliasEntry): boolean {
    return entry.scopes.some(isInheritedGlobalAliasScope);
}

/**
 * Checks whether a scanner scope describes an inherited global declaration.
 *
 * @param scope Stable scanner scope id.
 * @returns true for rule scopes such as `:root`, `html`, or `body`.
 */
function isInheritedGlobalAliasScope(scope: string): boolean {
    const leaf = scope.split(' > ').at(-1);
    if (!leaf?.startsWith('rule:')) {
        return false;
    }
    const selector = leaf.slice('rule:'.length);
    return selector.split(',').some(part => {
        const normalized = part.trim();
        return normalized === ':root' || normalized === 'html' || normalized === 'body';
    });
}

/**
 * Checks if a custom-property name is reserved by Tailwind v4.
 *
 * @param name Custom-property name.
 * @returns true when the name is Tailwind-owned by namespace.
 */
export function isTailwindReservedGlobalVar(name: string): boolean {
    return isTailwindReservedCustomProperty(name);
}

/**
 * Resolves the global variable scan cache directory.
 *
 * @param cacheDir csszyx cache root.
 * @returns Cache directory for Phase H CSS scans.
 */
export function resolveGlobalVarScanCacheDir(cacheDir: string): string {
    return path.join(cacheDir, 'global-vars');
}

/**
 * Creates a cache key from file path, mtime, and content hash.
 *
 * @param input Cache key input.
 * @returns Stable SHA-256 cache key.
 */
export function createGlobalVarScanCacheKey(input: GlobalVarScanCacheKeyInput): string {
    const hash = createHash('sha256');
    hash.update(input.filePath);
    hash.update('\0');
    hash.update(String(input.mtimeMs));
    hash.update('\0');
    hash.update(createHash('sha256').update(input.css).digest('hex'));
    return hash.digest('hex');
}

/**
 * Reads a cached global variable scan result when the key matches.
 *
 * @param cacheDir Global variable scan cache directory.
 * @param key Expected cache key.
 * @returns Cached scan result, or null on miss/corruption.
 */
export function readGlobalVarScanCache(cacheDir: string, key: string): CssVarScanResult | null {
    try {
        const raw = fs.readFileSync(globalVarScanCacheFile(cacheDir, key), 'utf8');
        const entry = JSON.parse(raw) as Partial<GlobalVarScanCacheEntry>;
        if (entry.key !== key || !entry.result) {
            return null;
        }
        return entry.result;
    } catch {
        return null;
    }
}

/**
 * Writes a global variable scan result cache entry.
 *
 * @param cacheDir Global variable scan cache directory.
 * @param key Cache key.
 * @param result Scan result to cache.
 */
export function writeGlobalVarScanCache(
    cacheDir: string,
    key: string,
    result: CssVarScanResult,
): void {
    fs.mkdirSync(cacheDir, { recursive: true });
    fs.writeFileSync(
        globalVarScanCacheFile(cacheDir, key),
        JSON.stringify({ key, result } satisfies GlobalVarScanCacheEntry),
        'utf8',
    );
}

/**
 * Scans one CSS source with optional cache support.
 *
 * @param file CSS source.
 * @param cacheDir Optional global-var scan cache directory.
 * @returns CSS variable scan result.
 */
function scanCssSourceWithOptionalCache(
    file: GlobalVarCssSource,
    cacheDir: string | undefined,
): CssVarScanResult {
    if (cacheDir === undefined || file.mtimeMs === undefined) {
        return scanGlobalVarCss(file.css, { filePath: file.filePath });
    }

    const key = createGlobalVarScanCacheKey({
        filePath: file.filePath,
        css: file.css,
        mtimeMs: file.mtimeMs,
    });
    const cached = readGlobalVarScanCache(cacheDir, key);
    if (cached) {
        return cached;
    }

    const result = scanGlobalVarCss(file.css, { filePath: file.filePath });
    writeGlobalVarScanCache(cacheDir, key, result);
    return result;
}

/**
 * Normalizes a build asset name to an absolute diagnostic path.
 *
 * @param rootDir Project root.
 * @param fileName Asset file name from the bundler.
 * @returns Absolute normalized file path.
 */
function normalizeBuildAssetPath(rootDir: string, fileName: string): string {
    return (path.isAbsolute(fileName) ? fileName : path.join(rootDir, fileName)).replace(
        /\\/g,
        '/',
    );
}

/**
 * Converts a CSS asset source into UTF-8 text.
 *
 * @param source Bundler asset source.
 * @returns CSS source text.
 */
function cssAssetSourceToString(source: string | Uint8Array): string {
    return typeof source === 'string' ? source : Buffer.from(source).toString('utf8');
}

/**
 * Collects custom properties registered through @property at-rules.
 *
 * @param root Parsed PostCSS root.
 * @returns Registered custom-property names.
 */
function collectRegisteredProperties(root: Root): Set<string> {
    const registered = new Set<string>();
    root.walkAtRules('property', atRule => {
        const name = atRule.params.trim();
        if (name.startsWith('--')) {
            registered.add(name);
        }
    });
    return registered;
}

/**
 * Rewrites `var(--token)` references inside one declaration value.
 *
 * @param value CSS declaration value.
 * @param aliases Original-to-alias custom-property names.
 * @returns Rewritten value and rewrite count.
 */
function rewriteGlobalVarValue(
    value: string,
    aliases: ReadonlyMap<string, string>,
): { value: string; count: number } {
    const parsed = valueParser(value);
    let count = 0;
    parsed.walk(node => {
        if (node.type !== 'function' || node.value.toLowerCase() !== 'var') {
            return;
        }
        const firstArgument = node.nodes.find(child => child.type !== 'space');
        if (!firstArgument || firstArgument.type !== 'word') {
            return;
        }
        const alias = aliases.get(firstArgument.value);
        if (!alias) {
            return;
        }
        firstArgument.value = alias;
        count++;
    });
    return { value: count > 0 ? valueParser.stringify(parsed.nodes) : value, count };
}

/**
 * Checks whether a declaration block already contains a given property.
 *
 * @param decl Declaration whose siblings should be checked.
 * @param prop Custom-property name to find.
 * @returns true when the same parent already declares `prop`.
 */
function hasSiblingDeclaration(decl: Declaration, prop: string): boolean {
    const parent = decl.parent;
    if (!parent || !('nodes' in parent)) {
        return false;
    }
    return parent.nodes.some(node => node.type === 'decl' && node.prop === prop);
}

/**
 * Builds the file path for one scan cache entry.
 *
 * @param cacheDir Global variable scan cache directory.
 * @param key Cache key.
 * @returns Absolute or relative cache entry path.
 */
function globalVarScanCacheFile(cacheDir: string, key: string): string {
    return path.join(cacheDir, `${key}.json`);
}

/**
 * Extracts CSS var() custom-property references from one value string.
 *
 * @param value CSS declaration value or at-rule params.
 * @returns Sorted unique custom-property references.
 */
function extractVarReferences(value: string): string[] {
    const references = new Set<string>();
    for (const match of value.matchAll(VAR_REFERENCE_RE)) {
        references.add(match[1]);
    }
    return [...references].sort();
}

/**
 * Reads a PostCSS node source location.
 *
 * @param node PostCSS node.
 * @param filePath Source file path for diagnostics.
 * @returns Source location with fallback line and column.
 */
function nodeLocation(node: ChildNode, filePath: string): CssVarLocation {
    return {
        filePath,
        line: node.source?.start?.line ?? 1,
        column: node.source?.start?.column ?? 1,
    };
}

/**
 * Checks if a CSS path belongs to a third-party package.
 *
 * @param filePath CSS source file path.
 * @returns true when the path contains node_modules.
 */
function isThirdPartyCssPath(filePath: string): boolean {
    return filePath.split(/[\\/]/).includes('node_modules');
}

/**
 * Checks whether a node is nested inside Tailwind's @theme at-rule.
 *
 * @param node PostCSS child node.
 * @returns true when an ancestor at-rule is @theme.
 */
function isInsideThemeAtRule(node: ChildNode): boolean {
    let current = node.parent as ChildNode | Root | undefined;
    while (current && current.type !== 'root') {
        if (current.type === 'atrule' && (current as AtRule).name === 'theme') {
            return true;
        }
        current = current.parent as ChildNode | Root | undefined;
    }
    return false;
}

/**
 * Builds a stable scope key from ancestor at-rules and selectors.
 *
 * @param node PostCSS child node.
 * @returns Stable scope identifier.
 */
function buildScopeId(node: ChildNode): string {
    const parts: string[] = [];
    let current = node.parent as ChildNode | Root | undefined;
    while (current && current.type !== 'root') {
        if (current.type === 'rule') {
            parts.push(`rule:${(current as Rule).selector}`);
        } else if (current.type === 'atrule') {
            const atRule = current as AtRule;
            parts.push(`@${atRule.name} ${atRule.params}`.trim());
        }
        current = current.parent as ChildNode | Root | undefined;
    }
    return parts.reverse().join(' > ') || DEFAULT_SCOPE_ID;
}

/**
 * Groups definitions by custom-property name.
 *
 * @param scans CSS scan results.
 * @returns Definitions grouped by name.
 */
function flattenDefinitions(scans: CssVarScanResult[]): Map<string, CssVarDefinition[]> {
    const definitions = new Map<string, CssVarDefinition[]>();
    for (const scan of scans) {
        for (const definition of scan.definitions) {
            const existing = definitions.get(definition.name) ?? [];
            existing.push(definition);
            definitions.set(definition.name, existing);
        }
    }
    return definitions;
}

/**
 * Collects explicit and prefix-discovered planner candidates.
 *
 * @param input Planner input.
 * @param definitions Definitions grouped by name.
 * @returns Sorted candidate names.
 */
function collectCandidates(
    input: PlanGlobalVarAliasesInput,
    definitions: ReadonlyMap<string, CssVarDefinition[]>,
): string[] {
    const candidates = new Set(input.tokens ?? []);
    const autoPrefix = input.autoPrefix ?? '';
    if (autoPrefix !== '') {
        for (const name of definitions.keys()) {
            if (name.startsWith(autoPrefix)) {
                candidates.add(name);
            }
        }
    }
    return [...candidates].sort();
}

/**
 * Validates alias candidates before any rewrite can happen.
 *
 * @param candidates Candidate custom-property names.
 * @param definitions Definitions grouped by name.
 * @param reserved User reserved names or prefixes.
 * @param aliasPrefix Active generated alias prefix.
 * @returns Fail-closed diagnostics.
 */
function validateCandidates(
    candidates: string[],
    definitions: ReadonlyMap<string, CssVarDefinition[]>,
    reserved: string[],
    aliasPrefix: string,
): GlobalVarAliasDiagnostic[] {
    const diagnostics: GlobalVarAliasDiagnostic[] = [];
    for (const name of candidates) {
        const tokenDefinitions = definitions.get(name) ?? [];
        if (tokenDefinitions.length === 0) {
            diagnostics.push({
                code: 'missing-definition',
                severity: 'error',
                name,
                message: `Global variable token ${name} is not defined in scanned CSS.`,
            });
            continue;
        }
        if (isTailwindReservedGlobalVar(name) || matchesUserReserved(name, reserved)) {
            diagnostics.push({
                code: 'tailwind-reserved',
                severity: 'error',
                name,
                message: `Global variable token ${name} is reserved and cannot be aliased.`,
                location: tokenDefinitions[0],
            });
        }
        if (isCsszyxGlobalAliasCustomProperty(name, aliasPrefix)) {
            diagnostics.push({
                code: 'tailwind-reserved',
                severity: 'error',
                name,
                message: `Global variable token ${name} uses csszyx reserved namespace ${aliasPrefix}* and cannot be aliased.`,
                location: tokenDefinitions[0],
            });
        }
        const tailwindDefinition = tokenDefinitions.find(definition => definition.tailwindOwned);
        if (tailwindDefinition) {
            diagnostics.push({
                code: 'tailwind-owned',
                severity: 'error',
                name,
                message: `Global variable token ${name} is declared inside @theme and cannot be aliased.`,
                location: tailwindDefinition,
            });
        }
        const registeredDefinition = tokenDefinitions.find(definition => definition.registered);
        if (registeredDefinition) {
            diagnostics.push({
                code: 'registered-property',
                severity: 'error',
                name,
                message: `Registered custom property ${name} is not aliasable in Phase H v1.`,
                location: registeredDefinition,
            });
        }
    }
    return diagnostics;
}

/**
 * Checks a custom-property name against user reserved names or prefixes.
 *
 * @param name Custom-property name.
 * @param reserved User reserved names or prefixes.
 * @returns true when the name is reserved.
 */
function matchesUserReserved(name: string, reserved: string[]): boolean {
    return reserved.some(pattern => {
        if (pattern.endsWith('*')) {
            return name.startsWith(pattern.slice(0, -1));
        }
        return name === pattern;
    });
}
