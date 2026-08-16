import { THEME_VALUE_PROPERTIES, type ThemeValueCategory } from '@csszyx/tooling-metadata';
import type ts from 'typescript/lib/tsserverlibrary';

const MAX_THEME_SOURCE_BYTES = 128 * 1024;
const MAX_THEME_TOKENS = 2_000;
const MAX_THEME_TOKEN_LENGTH = 128;
const THEME_FILE_SUFFIX = '/.csszyx/theme.d.ts';
const THEME_TOKEN = /^[a-z][a-z0-9-]*$/;
const BREAKPOINT_TOKEN = /^[a-z0-9][a-z0-9-]*$/;
const THEME_CATEGORIES = Object.freeze(Object.keys(THEME_VALUE_PROPERTIES) as ThemeValueCategory[]);

/** Immutable values extracted from one generated theme declaration. */
export interface ThemeSnapshot {
    readonly colors: readonly string[];
    readonly spacings: readonly string[];
    readonly fonts: readonly string[];
    readonly textSizes: readonly string[];
    readonly fontWeights: readonly string[];
    readonly radii: readonly string[];
    readonly shadows: readonly string[];
    readonly breakpoints: readonly string[];
}

/** Shared no-theme result used by all bounded failure paths. */
export const EMPTY_THEME_SNAPSHOT: ThemeSnapshot = Object.freeze({
    colors: Object.freeze([]),
    spacings: Object.freeze([]),
    fonts: Object.freeze([]),
    textSizes: Object.freeze([]),
    fontWeights: Object.freeze([]),
    radii: Object.freeze([]),
    shadows: Object.freeze([]),
    breakpoints: Object.freeze([]),
});

const snapshotCache = new WeakMap<object, WeakMap<object, ThemeSnapshot>>();

/** Normalize a TypeScript path for generated-file matching.
 * @param tsMod - Host TypeScript instance.
 * @param fileName - Host-provided path.
 * @returns Slash-normalized path with host-appropriate casing.
 */
function normalizedPath(tsMod: typeof ts, fileName: string): string {
    const slashed = fileName.replaceAll('\\', '/');
    return tsMod.sys.useCaseSensitiveFileNames ? slashed : slashed.toLowerCase();
}

/** Look up the generated declaration at the owning project root without
 * scanning Program source files or touching the filesystem.
 * @param tsMod - Host TypeScript instance.
 * @param program - Current immutable Program.
 * @param projectRoot - Host-reported project root fallback.
 * @returns Generated theme source when it belongs to the Program.
 */
function projectThemeSource(
    tsMod: typeof ts,
    program: ts.Program,
    projectRoot: string,
): ts.SourceFile | undefined {
    const configFilePath = program.getCompilerOptions?.().configFilePath;
    const configuredRoot =
        typeof configFilePath === 'string'
            ? normalizedPath(tsMod, configFilePath).replace(/\/[^/]*$/, '')
            : normalizedPath(tsMod, projectRoot);
    const root = configuredRoot.replace(/\/$/, '');
    return program.getSourceFile(`${root}${THEME_FILE_SUFFIX}`);
}

/** Read a static interface member name.
 * @param tsMod - Host TypeScript instance.
 * @param member - Candidate property signature.
 * @returns Its static name, or undefined.
 */
function memberName(tsMod: typeof ts, member: ts.TypeElement): string | undefined {
    // No `!member.name` guard: a property signature's name is required by the
    // AST type, so testing for it left an arm no input could reach.
    if (!tsMod.isPropertySignature(member)) return undefined;
    const name = member.name;
    if (tsMod.isIdentifier(name) || tsMod.isStringLiteral(name)) return name.text;
    return undefined;
}

/** Extract an all-string-literal union, rejecting mixed/dynamic type nodes.
 * @param tsMod - Host TypeScript instance.
 * @param node - Property type node.
 * @returns Valid bounded tokens, or undefined when the whole member is opaque.
 */
function stringLiteralUnion(tsMod: typeof ts, node: ts.TypeNode | undefined): string[] | undefined {
    if (!node) return undefined;
    const nodes = tsMod.isUnionTypeNode(node) ? node.types : [node];
    const tokens: string[] = [];
    for (const candidate of nodes) {
        if (!tsMod.isLiteralTypeNode(candidate) || !tsMod.isStringLiteral(candidate.literal)) {
            return undefined;
        }
        const token = candidate.literal.text;
        if (token.length <= MAX_THEME_TOKEN_LENGTH) tokens.push(token);
    }
    return tokens;
}

/** Mutable bounded accumulator used only while parsing one declaration. */
interface MutableTheme {
    readonly colors: Set<string>;
    readonly spacings: Set<string>;
    readonly fonts: Set<string>;
    readonly textSizes: Set<string>;
    readonly fontWeights: Set<string>;
    readonly radii: Set<string>;
    readonly shadows: Set<string>;
    readonly breakpoints: Set<string>;
}

/** Allocate the bounded parser accumulator.
 * @returns Empty category sets.
 */
function mutableTheme(): MutableTheme {
    return {
        colors: new Set(),
        spacings: new Set(),
        fonts: new Set(),
        textSizes: new Set(),
        fontWeights: new Set(),
        radii: new Set(),
        shadows: new Set(),
        breakpoints: new Set(),
    };
}

/** Count all accumulated tokens.
 * @param theme - Current parser accumulator.
 * @returns Total distinct tokens across categories.
 */
function tokenCount(theme: MutableTheme): number {
    return (
        theme.colors.size +
        theme.spacings.size +
        theme.fonts.size +
        theme.textSizes.size +
        theme.fontWeights.size +
        theme.radii.size +
        theme.shadows.size +
        theme.breakpoints.size
    );
}

/** Inputs for parsing one supported augmentation interface. */
interface AddInterfaceOptions {
    readonly tsMod: typeof ts;
    readonly declaration: ts.InterfaceDeclaration;
    readonly theme: MutableTheme;
    readonly shouldStop: () => boolean;
}

/** Add one validated compiler augmentation interface.
 * @param options - Host AST helpers, declaration, accumulator, and stop check.
 * @returns False when the global token cap is exceeded.
 */
function addInterface(options: AddInterfaceOptions): boolean {
    const { tsMod, declaration, theme, shouldStop } = options;
    if (declaration.name.text === 'CustomTheme') {
        return addThemeCategories(tsMod, declaration, theme, shouldStop);
    }
    if (declaration.name.text === 'VariantModifiers') {
        return addBreakpoints(tsMod, declaration, theme, shouldStop);
    }
    return true;
}

/** Collect one `CustomTheme` member's token union into its category bucket.
 * @param tsMod - Host TypeScript instance.
 * @param member - Interface member to read.
 * @param theme - Accumulator to fill.
 */
function addThemeMember(tsMod: typeof ts, member: ts.TypeElement, theme: MutableTheme): void {
    // Narrowed here rather than re-tested at the type read: `memberName`
    // requires a property signature too, so asking twice left an arm no input
    // could reach. A method signature takes this exit.
    if (!tsMod.isPropertySignature(member)) return;
    const name = memberName(tsMod, member);
    if (!name || !THEME_CATEGORIES.includes(name as ThemeValueCategory)) return;
    const values = stringLiteralUnion(tsMod, member.type);
    if (!values) return;
    const bucket = theme[name as ThemeValueCategory];
    for (const value of values) {
        if (THEME_TOKEN.test(value)) bucket.add(value);
    }
}

/** Read the `CustomTheme` augmentation, one member per category.
 * @param tsMod - Host TypeScript instance.
 * @param declaration - The interface being read.
 * @param theme - Accumulator to fill.
 * @param shouldStop - Cooperative cancellation/deadline check.
 * @returns False when cancelled or the global token cap is exceeded.
 */
function addThemeCategories(
    tsMod: typeof ts,
    declaration: ts.InterfaceDeclaration,
    theme: MutableTheme,
    shouldStop: () => boolean,
): boolean {
    for (const member of declaration.members) {
        if (shouldStop()) return false;
        addThemeMember(tsMod, member, theme);
        if (tokenCount(theme) > MAX_THEME_TOKENS) return false;
    }
    return true;
}

/** Read the `VariantModifiers` augmentation for breakpoint keys.
 * @param tsMod - Host TypeScript instance.
 * @param declaration - The interface being read.
 * @param theme - Accumulator to fill.
 * @param shouldStop - Cooperative cancellation/deadline check.
 * @returns False when cancelled or the global token cap is exceeded.
 */
function addBreakpoints(
    tsMod: typeof ts,
    declaration: ts.InterfaceDeclaration,
    theme: MutableTheme,
    shouldStop: () => boolean,
): boolean {
    for (const member of declaration.members) {
        if (shouldStop()) return false;
        const name = memberName(tsMod, member);
        if (name && name.length <= MAX_THEME_TOKEN_LENGTH && BREAKPOINT_TOKEN.test(name)) {
            theme.breakpoints.add(name);
        }
        if (tokenCount(theme) > MAX_THEME_TOKENS) return false;
    }
    return true;
}

/** Parse only `declare module '@csszyx/compiler'` interface declarations.
 * @param tsMod - Host TypeScript instance.
 * @param sourceFile - Generated declaration already in the Program.
 * @param shouldStop - Cooperative cancellation/deadline check.
 * @returns Immutable bounded theme snapshot.
 */
function parseThemeSource(
    tsMod: typeof ts,
    sourceFile: ts.SourceFile,
    shouldStop: () => boolean,
): ThemeSnapshot {
    if (Buffer.byteLength(sourceFile.text, 'utf8') > MAX_THEME_SOURCE_BYTES) {
        return EMPTY_THEME_SNAPSHOT;
    }
    const theme = mutableTheme();
    for (const statement of sourceFile.statements) {
        if (shouldStop()) return EMPTY_THEME_SNAPSHOT;
        const body = compilerModuleBlock(tsMod, statement);
        if (!body) continue;
        if (!addModuleBlock(tsMod, body, theme, shouldStop)) return EMPTY_THEME_SNAPSHOT;
    }
    return tokenCount(theme) === 0 ? EMPTY_THEME_SNAPSHOT : freezeTheme(theme);
}

/** The block of a `declare module '@csszyx/compiler'` statement, if it is one.
 * @param tsMod - Host TypeScript instance.
 * @param statement - Top-level statement to classify.
 * @returns The module block, or undefined for every other statement.
 */
function compilerModuleBlock(
    tsMod: typeof ts,
    statement: ts.Statement,
): ts.ModuleBlock | undefined {
    if (!tsMod.isModuleDeclaration(statement)) return undefined;
    if (!tsMod.isStringLiteral(statement.name) || statement.name.text !== '@csszyx/compiler') {
        return undefined;
    }
    // A module named by a string literal carries either no body or a block.
    // The nested-declaration form needs a dotted identifier name, which the
    // check above already excluded, so testing for a block again would leave
    // an arm no input could reach.
    return statement.body as ts.ModuleBlock | undefined;
}

/** Read every augmentation interface inside one module block.
 * @param tsMod - Host TypeScript instance.
 * @param body - Module block to walk.
 * @param theme - Accumulator to fill.
 * @param shouldStop - Cooperative cancellation/deadline check.
 * @returns False when cancelled or the global token cap is exceeded.
 */
function addModuleBlock(
    tsMod: typeof ts,
    body: ts.ModuleBlock,
    theme: MutableTheme,
    shouldStop: () => boolean,
): boolean {
    for (const nested of body.statements) {
        if (shouldStop()) return false;
        if (!tsMod.isInterfaceDeclaration(nested)) continue;
        if (!addInterface({ tsMod, declaration: nested, theme, shouldStop })) return false;
    }
    return true;
}

/** Freeze the accumulator into the immutable snapshot callers receive.
 * @param theme - Filled accumulator.
 * @returns Sorted, frozen snapshot.
 */
function freezeTheme(theme: MutableTheme): ThemeSnapshot {
    const freeze = (values: Set<string>): readonly string[] =>
        Object.freeze([...values].sort((left, right) => left.localeCompare(right)));
    return Object.freeze({
        colors: freeze(theme.colors),
        spacings: freeze(theme.spacings),
        fonts: freeze(theme.fonts),
        textSizes: freeze(theme.textSizes),
        fontWeights: freeze(theme.fontWeights),
        radii: freeze(theme.radii),
        shadows: freeze(theme.shadows),
        breakpoints: freeze(theme.breakpoints),
    });
}

/** Inputs for locating and caching one project's theme snapshot. */
export interface ThemeSnapshotOptions {
    readonly tsMod: typeof ts;
    readonly program: ts.Program;
    readonly projectRoot: string;
    readonly shouldStop?: () => boolean;
}

/** Read and cache the generated declaration for one Program/source identity.
 * @param options - Host Program, project root, and stop check.
 * @returns Immutable project theme, or the shared empty snapshot.
 */
export function themeSnapshotForProgram(options: ThemeSnapshotOptions): ThemeSnapshot {
    const { tsMod, program, projectRoot, shouldStop = () => false } = options;
    if (shouldStop()) return EMPTY_THEME_SNAPSHOT;
    let sourceFile: ts.SourceFile | undefined;
    try {
        sourceFile = projectThemeSource(tsMod, program, projectRoot);
    } catch {
        return EMPTY_THEME_SNAPSHOT;
    }
    if (!sourceFile || shouldStop()) return EMPTY_THEME_SNAPSHOT;
    let bySource = snapshotCache.get(program);
    if (!bySource) {
        bySource = new WeakMap();
        snapshotCache.set(program, bySource);
    }
    const cached = bySource.get(sourceFile);
    if (cached) return cached;
    const snapshot = parseThemeSource(tsMod, sourceFile, shouldStop);
    if (!shouldStop()) bySource.set(sourceFile, snapshot);
    return snapshot;
}

/** Values from the theme namespaces applicable to one canonical sz property.
 * @param snapshot - Parsed project theme.
 * @param property - Canonical sz property.
 * @returns Additive theme values in stable category order.
 */
export function themeValuesForProperty(
    snapshot: ThemeSnapshot,
    property: string,
): readonly string[] {
    const values: string[] = [];
    for (const category of THEME_CATEGORIES) {
        if (THEME_VALUE_PROPERTIES[category].includes(property)) values.push(...snapshot[category]);
    }
    return values;
}
