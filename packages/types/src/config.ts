/**
 * Configuration types for csszyx.
 *
 * This module defines all configuration interfaces and types used
 * throughout the csszyx framework.
 */
import {
    CSSZYX_GLOBAL_ALIAS_PREFIX,
    isCsszyxGlobalAliasCustomProperty,
    isTailwindReservedCustomProperty,
} from './tailwind-reserved.js';

/**
 * Development mode configuration options.
 */
export interface DevelopmentConfig {
    /**
     * Enable strict mode - fail build on warnings.
     * When enabled, warnings are treated as errors.
     *
     * @default false
     */
    strictMode: boolean;

    /**
     * Enable debug logging during build.
     *
     * @default false
     */
    debug: boolean;
}

/**
 * Production mode configuration options.
 */
export interface ProductionConfig {
    /**
     * Rewrite csszyx-owned class names to short aliases (`z`, `y`, `x`, …).
     *
     * This is a **name-obfuscation** feature, not a compression one. Over a
     * gzip- or brotli-served response it is flat to slightly negative: utility
     * class names share long prefixes and repeat, which is exactly what the
     * compressor exploits, so shortening them trades highly compressible bytes
     * for the poorly compressible mangle map the runtime needs. Measured on the
     * `vite-react` playground, mangling costs about 2 KB gzipped and its
     * absolute ceiling — with a hypothetically free map — is a 0.26% saving.
     *
     * Enable it when the original class names should not be readable in the
     * shipped bundle. Do not enable it expecting a smaller payload.
     *
     * @default false
     */
    mangle: boolean;

    /**
     * Enable CSS custom property name mangling and hoisting.
     *
     * This is an opt-in feature gate for the tiered CSS variable system.
     * When disabled, dynamic `sz` values keep the existing `--_sz-*`
     * variable names and no variable hoisting is applied.
     *
     * @default false
     */
    mangleVars: boolean;

    /**
     * Maximum cascade depth for component-tier CSS variable hoisting.
     *
     * Only used when `mangleVars` is enabled. Lower values prefer local scoped
     * variables; higher values allow hoisting across deeper DOM subtrees.
     *
     * @default 5
     */
    mangleVarHoistMaxDepth: number;

    /**
     * Class names the mangler must never assign as a short token.
     *
     * Mangling allocates short aliases (`z`, `y`, `x`, …) over the classes csszyx
     * generates, blind to class names that already exist in non-csszyx CSS. In a
     * hybrid build — a separate Tailwind plugin owns the utility CSS, or
     * hand-written CSS uses literal short class names (e.g. `.x`/`.y`) — a token
     * can collide with one of those names and contaminate it. List those external
     * names here and the allocator skips them, so no mangled token equals one.
     *
     * Run `csszyx scan-collisions` to discover which names to list. Exact names
     * only (no globs).
     *
     * @default [] (nothing reserved)
     */
    mangleExclude?: string[];

    /**
     * Where the runtime mangle map is delivered to the browser.
     *
     * The map is what lets runtime helpers (`szr`, `szv`, `szcn`, `szDecode`)
     * speak the same class names as the mangled CSS. It travels two ways: an
     * inline script in build-emitted HTML, and a module inside the JS bundle
     * for pages the build does not own (a bundle embedded in a host shell, or
     * a CSP that strips inline scripts).
     *
     * Both deliveries carry the full census, so a build that ships both pays
     * for the map twice across HTML and JS. Narrow this when the app knows
     * which delivery it actually needs:
     *
     * - `'both'` — inline script plus bundle module. Always correct.
     * - `'html'` — inline script only. For apps that serve their own
     *   csszyx-built HTML and allow inline scripts.
     * - `'bundle'` — bundle module only. For embedded builds and CSP setups
     *   that strip inline scripts.
     *
     * The hydration checksum payload is unaffected — it ships in every mode,
     * so `'bundle'` still emits the JSON census tag into HTML the build owns
     * (hydration verify reads it from the DOM); the value only drops the
     * runtime installer script. Choosing a delivery the page does not receive
     * leaves runtime helpers without a map, which passes original class names
     * through while the CSS ships mangled, so narrow this only against a
     * known deployment shape.
     *
     * Narrowing runs where the map is injected — the vite/rollup lanes. A
     * webpack build ships the map unchanged and warns that the value has no
     * effect there; an unknown value fails the build.
     *
     * @default 'both'
     */
    mangleMapDelivery?: MangleMapDelivery;

    /**
     * Alias stable app-owned global CSS custom properties.
     *
     * This is the opt-in gate for the `g` tier. Phase H v1 is alias-only:
     * original public custom-property declarations remain defined, and
     * csszyx-owned references may use short generated aliases. Explicit
     * `tokens` are supported first; `autoPrefix` remains blocked until CSS
     * pre-scan support exists.
     *
     * @default undefined (disabled)
     */
    mangleGlobalVars?: GlobalVarMangleConfig;

    /**
     * Inject checksum for SSR hydration validation.
     *
     * @default true
     */
    injectChecksum: boolean;

    /**
     * Minify output (class names and attributes).
     *
     * @default true in production
     */
    minify: boolean;
}

/**
 * Delivery channels for the runtime mangle map.
 */
export type MangleMapDelivery = 'both' | 'html' | 'bundle';

/**
 * Supported global custom-property optimization mode.
 */
export type GlobalVarMangleMode = 'alias';

/**
 * Reaction to unsafe global custom-property usage.
 */
export type GlobalVarUnsafeUsageMode = 'error';

/**
 * Configuration for app-owned global custom-property aliases.
 */
export interface GlobalVarMangleConfig {
    /**
     * Master switch for global custom-property aliasing.
     *
     * @default false
     */
    enabled: boolean;

    /**
     * Phase H v1 only supports alias mode.
     *
     * @default "alias"
     */
    mode?: GlobalVarMangleMode;

    /**
     * Explicit app-owned custom-property names to alias.
     *
     * Every token must include the leading `--`.
     *
     * @default []
     */
    tokens?: string[];

    /**
     * Optional app-owned prefix discovery. Empty string disables prefix
     * discovery and requires explicit tokens.
     *
     * This must not default to a Tailwind namespace or the generated alias
     * prefix.
     *
     * @default ""
     */
    autoPrefix?: string;

    /**
     * Prefix used for generated global aliases.
     *
     * Phase H v1 defaults to `---g`, then appends csszyx's z-y-x encoder
     * output: `---gz`, `---gy`, `---gx`, ...
     *
     * @default "---g"
     */
    aliasPrefix?: string;

    /**
     * Unsafe usage handling. Phase H v1 keeps this as error-only.
     *
     * @default "error"
     */
    onUnsafeUsage?: GlobalVarUnsafeUsageMode;

    /**
     * Additional app-specific custom-property names or prefixes that must
     * never be aliased. Tailwind-owned prefixes are reserved implicitly by the
     * implementation.
     *
     * @default []
     */
    reserved?: string[];

    /**
     * Emit the standalone `.csszyx/global-var-map.json` tooling asset.
     *
     * `csszyx-manifest.json` still includes `globalVarAliases` when aliases
     * exist, so disabling this only removes the extra dedicated map file.
     *
     * @default true
     */
    emitMap?: boolean;
}

/**
 * Validate the optional automatic custom-property prefix.
 *
 * @param config User-provided alias configuration.
 * @returns Validation message or null when valid.
 */
function validateAutoPrefix(config: GlobalVarMangleConfig): string | null {
    const { autoPrefix } = config;
    if (autoPrefix === undefined) {
        return null;
    }
    if (!isValidCustomPropertyPrefix(autoPrefix)) {
        return 'production.mangleGlobalVars.autoPrefix must be empty or start with "--".';
    }
    if (autoPrefix !== '' && isTailwindReservedCustomProperty(autoPrefix)) {
        return `production.mangleGlobalVars.autoPrefix cannot target Tailwind reserved namespace "${autoPrefix}".`;
    }
    if (
        autoPrefix !== '' &&
        isCsszyxGlobalAliasCustomProperty(autoPrefix, resolveGlobalVarAliasPrefix(config))
    ) {
        return `production.mangleGlobalVars.autoPrefix cannot target csszyx reserved namespace "${resolveGlobalVarAliasPrefix(config)}*".`;
    }
    return null;
}

/**
 * Validate the optional generated-alias prefix.
 *
 * @param config User-provided alias configuration.
 * @returns Validation message or null when valid.
 */
function validateAliasPrefix(config: GlobalVarMangleConfig): string | null {
    const { aliasPrefix, autoPrefix } = config;
    if (aliasPrefix === undefined) {
        return null;
    }
    if (aliasPrefix === '' || !isValidCustomPropertyPrefix(aliasPrefix)) {
        return 'production.mangleGlobalVars.aliasPrefix must be non-empty and start with "--".';
    }
    if (isTailwindReservedCustomProperty(aliasPrefix)) {
        return `production.mangleGlobalVars.aliasPrefix cannot target Tailwind reserved namespace "${aliasPrefix}".`;
    }
    if (autoPrefix !== undefined && autoPrefix !== '' && prefixesOverlap(autoPrefix, aliasPrefix)) {
        return `production.mangleGlobalVars.aliasPrefix "${aliasPrefix}" must not overlap autoPrefix "${autoPrefix}".`;
    }
    return null;
}

/**
 * Validates the Phase H global variable alias config shape.
 *
 * @param config User-provided global variable alias config.
 * @returns Validation errors. Empty means the config shape is valid.
 */
export function validateGlobalVarMangleConfig(config: GlobalVarMangleConfig | undefined): string[] {
    if (!config) {
        return [];
    }

    const errors: string[] = [];
    if (config.mode !== undefined && config.mode !== 'alias') {
        errors.push("production.mangleGlobalVars.mode only supports 'alias' in Phase H v1.");
    }
    if (config.onUnsafeUsage !== undefined && config.onUnsafeUsage !== 'error') {
        errors.push(
            "production.mangleGlobalVars.onUnsafeUsage only supports 'error' in Phase H v1.",
        );
    }
    const prefixErrors = [validateAutoPrefix(config), validateAliasPrefix(config)];
    for (const error of prefixErrors) {
        if (error) {
            errors.push(error);
        }
    }

    validateCustomPropertyList(
        config.tokens,
        'tokens',
        errors,
        resolveGlobalVarAliasPrefix(config),
    );
    validateCustomPropertyList(config.reserved, 'reserved', errors);

    return errors;
}

/**
 * Checks whether a custom-property discovery prefix is valid.
 *
 * @param prefix User-provided prefix.
 * @returns true when the prefix is empty or CSS custom-property-like.
 */
function isValidCustomPropertyPrefix(prefix: string): boolean {
    return prefix === '' || prefix.startsWith('--');
}

/**
 * Resolves the generated alias prefix.
 *
 * @param config User-provided global variable alias config.
 * @returns Active alias prefix.
 */
function resolveGlobalVarAliasPrefix(config: GlobalVarMangleConfig): string {
    return config.aliasPrefix ?? CSSZYX_GLOBAL_ALIAS_PREFIX;
}

/**
 * Checks whether two custom-property prefixes overlap.
 *
 * @param left First prefix.
 * @param right Second prefix.
 * @returns true when either prefix can include the other.
 */
function prefixesOverlap(left: string, right: string): boolean {
    return left.startsWith(right) || right.startsWith(left);
}

/**
 * Validates an optional list of custom-property names.
 *
 * @param values User-provided list.
 * @param field Field name for diagnostics.
 * @param errors Mutable error list.
 * @param aliasPrefix Active generated alias prefix.
 */
function validateCustomPropertyList(
    values: string[] | undefined,
    field: 'tokens' | 'reserved',
    errors: string[],
    aliasPrefix = CSSZYX_GLOBAL_ALIAS_PREFIX,
): void {
    if (!values) {
        return;
    }
    for (const value of values) {
        if (!value.startsWith('--')) {
            errors.push(`production.mangleGlobalVars.${field} entries must start with "--".`);
            return;
        }
        if (field === 'tokens' && isTailwindReservedCustomProperty(value)) {
            errors.push(
                `production.mangleGlobalVars.tokens cannot include Tailwind reserved namespace token "${value}".`,
            );
            return;
        }
        if (field === 'tokens' && isCsszyxGlobalAliasCustomProperty(value, aliasPrefix)) {
            errors.push(
                `production.mangleGlobalVars.tokens cannot include csszyx reserved namespace token "${value}".`,
            );
            return;
        }
    }
}

/**
 * Build pipeline configuration.
 */
export interface BuildConfig {
    /**
     * Build ID (git hash or timestamp).
     * Auto-generated if not provided.
     */
    buildId?: string;

    /**
     * Emit `csszyx-manifest.json` next to the build output.
     *
     * Only `@csszyx/dynamic` reads it, to answer "is this class already in the
     * built CSS?" and skip injecting a duplicate rule. A build that emits it
     * therefore pays for the WHOLE class census to answer questions about the
     * handful of classes `dynamic()` renders — measured on a 668-class census,
     * the file costs about 2 kB gzipped while a typical `dynamic()` surface
     * saves a few hundred bytes of injection. It only comes out ahead once most
     * of the app is rendered at runtime.
     *
     * Turning it off is safe: `dynamic()` treats a missing manifest as "nothing
     * is pre-built" and injects rules itself, so styles are identical either
     * way. What changes is bytes and one-time work.
     *
     * Turning it ON only pays if the app calls `preloadManifest()` and awaits it
     * before its first render — `dynamic()` is synchronous and the fetch is not,
     * so an unawaited manifest arrives after the first paint has already
     * injected everything, and the build pays both costs.
     *
     * Run `dynamicReport()` from `@csszyx/dynamic` in development to measure
     * which side your app is on.
     *
     * @default false
     */
    emitManifest?: boolean;

    /**
     * Output directory for generated files.
     *
     * @default ".csszyx"
     */
    outputDir?: string;

    /**
     * Cache directory for incremental builds.
     *
     * @default ".csszyx/cache"
     */
    cacheDir?: string;

    /**
     * Enable the per-file transform cache.
     *
     * @default true
     */
    cache?: boolean;

    /**
     * Maximum AST nodes per file before the transform gives up on it.
     *
     * A file over the cap is left unrewritten and contributes NO classes to
     * the safelist (warned loudly). Applies to every parser engine, including
     * the native `rust` one. The safelist prescan runs with a 10× cap by
     * default because a skipped file means silently missing CSS under
     * Tailwind `source(none)`; setting this applies the same value to both
     * lanes. Raise it when a warning names a legitimate large page file.
     *
     * @default 50000
     */
    astBudgetLimit?: number;

    /**
     * Source parser used for JSX/TSX sz transforms.
     *
     * `rust` is the default parser. The Rust engine ships through the
     * matching optional `@csszyx/core-*` platform package. The package
     * installs automatically as an optional dependency on supported
     * platforms; when missing, csszyx fails loudly with an actionable error
     * rather than silently falling back. Set this option to `oxc` to keep
     * the previous JavaScript oxc-parser path, or to `babel` as a final
     * compatibility escape hatch.
     *
     * @default "rust"
     */
    parser?: 'babel' | 'oxc' | 'rust';

    /**
     * CSS file(s) to scan for Tailwind v4 @theme blocks.
     * When set, the plugin generates .csszyx/theme.d.ts with TypeScript augmentation
     * for custom design tokens, enabling IntelliSense for user-defined colors, spacings, etc.
     *
     * Accepts a single glob/path or an array of globs/paths.
     *
     * @example ['src/styles/theme.css', 'src/styles/tokens.css']
     */
    scanCss?: string | string[];

    /**
     * Compile a static sz object that a component imports from another module.
     *
     * `export const cardSz = { p: 4 }` in one file and `sz={cardSz}` in another
     * is an ordinary way to share a fixed style, but the compiler reads one file
     * at a time: the imported binding is a name it cannot see through, so the
     * element falls back to the runtime AND contributes no classes. The class
     * text then exists in no output at all, so nothing tells Tailwind to
     * generate the CSS the browser will ask for.
     *
     * With this on, the prescan records those exports and each importer lowers
     * them exactly as it would the same literal written locally.
     *
     * Off by default because it changes emitted output for code that already
     * builds. A project that MUTATES an exported style object after declaring
     * it is relying on the runtime fallback, and compiling the declared value
     * would be correct by the contract while still being a change that project
     * has to notice. See the shared-style-object contract in the docs.
     *
     * v1 covers a direct `sz={binding}` from a relative named import. A
     * barrel, a package specifier, a tsconfig alias, a namespace or default
     * import, and the Next.js Turbopack lane all keep the runtime path they
     * have today, and keep reporting it.
     *
     * @default false
     */
    importedStaticSz?: boolean;
}

/**
 * File patterns accepted by csszyx plugin filters.
 *
 * String patterns may be literal paths (`src/generated/icon-dump.tsx`) or
 * simple globs such as `src/generated/**` or any TSX file. RegExp patterns are matched
 * against both absolute paths and paths relative to the project root.
 */
export type FilePattern = string | RegExp;

/**
 * Hydration safety configuration.
 */
export interface HydrationConfig {
    /**
     * Enable strict hydration checks.
     * When enabled, hydration mismatches trigger abort protocol.
     *
     * @default true
     */
    strict: boolean;
}

/**
 * Main csszyx configuration.
 */
export interface CsszyxConfig {
    /**
     * Development mode configuration.
     */
    development: DevelopmentConfig;

    /**
     * Production mode configuration.
     */
    production: ProductionConfig;

    /**
     * Build pipeline configuration.
     */
    build: BuildConfig;

    /**
     * Hydration safety configuration.
     */
    hydration: HydrationConfig;
}

/**
 * Partial configuration for user-provided config.
 * All fields are optional and will be merged with defaults.
 */
export type PartialCsszyxConfig = {
    /**
     * Restrict source files that csszyx transforms.
     *
     * CSS files used for Tailwind class discovery are still processed unless
     * excluded explicitly, so narrow source includes do not accidentally disable
     * CSS safelist injection.
     */
    include?: FilePattern | FilePattern[];

    /**
     * Exclude files from csszyx processing before parsing.
     *
     * Use this for large generated source files that happen to contain an `sz`
     * marker and would otherwise hit the AST budget guard.
     */
    exclude?: FilePattern | FilePattern[];

    /**
     * Opt extra source locations into compilation by PATH.
     *
     * csszyx hard-ignores `/packages/` by default (published libraries are
     * expected to ship pre-extracted CSS) and only pre-scans the build root, so
     * a workspace design-system that lives under `/packages/` or as a sibling
     * outside the build root is not compiled or safelisted. List its
     * directory here to (a) exempt it from the ignore so its `sz`/`szv` is
     * compiled, and (b) add it as a pre-scan root so its classes are safelisted.
     *
     * Paths resolve like Vite config paths: relative to the resolved project
     * root (`config.root`, default the build cwd); absolute paths pass through.
     * Examples: `['packages/vui']`, `['../libs/vui']`, `['/abs/path/ui']`.
     * `node_modules`/`.next` stay ignored unless a listed path points into them.
     *
     * Symlinked workspace packages (pnpm) are matched after realpath resolution,
     * which relies on Vite's default `resolve.preserveSymlinks: false`.
     */
    compileSources?: string[];

    /**
     * Warn when, inside a monorepo, the Tailwind entry imports `tailwindcss`
     * without scoping its content detection (no `source(none)` / `source(...)` /
     * `@source not`). Unscoped, Tailwind v4 climbs to the workspace root and
     * scans sibling packages + docs (`.md`/`.mdx`/`.txt` are not ignored),
     * which can generate phantom or broken `url()` classes and fail the build.
     * The warning prints the one-time fix; set `false` to silence it when a
     * broad scan is intentional. Defaults to `true`.
     */
    contentScopeCheck?: boolean;

    /**
     * Silence csszyx build warnings.
     *
     * `true` silences ALL of them (the skipped-`sz`, missing-Tailwind-entry,
     * unscoped-content, unresolvable-spread, and safelist-cap messages) —
     * including the ones reporting that classes never reached the safelist, so
     * the CSS for them is simply absent. Those are not style advice: they say
     * the build produced less than it was asked for, and `true` hides them.
     *
     * `'nudges'` silences only the advisory half and keeps every
     * integrity report. Reach for it when the goal is a calmer build log
     * rather than accepting known-missing output.
     *
     * Errors that throw (security / crash / build-break guards) are unaffected
     * in either mode — only warnings are muted. Defaults to `false`.
     */
    quiet?: boolean | 'nudges';

    development?: Partial<DevelopmentConfig>;
    production?: Partial<ProductionConfig>;
    build?: Partial<BuildConfig>;
    hydration?: Partial<HydrationConfig>;
};

/**
 * Default development configuration.
 */
export const DEFAULT_DEVELOPMENT_CONFIG: DevelopmentConfig = {
    strictMode: false,
    debug: false,
};

/**
 * Default production configuration.
 */
export const DEFAULT_PRODUCTION_CONFIG: ProductionConfig = {
    // Off like the plugin's own default: mangling is obfuscation, not
    // compression (the map costs more than the class bytes it saves), so a
    // consumer merging these exported defaults must not get it implicitly.
    mangle: false,
    mangleVars: false,
    mangleVarHoistMaxDepth: 5,
    injectChecksum: true,
    minify: true,
};

/**
 * Default build configuration.
 */
export const DEFAULT_BUILD_CONFIG: BuildConfig = {
    emitManifest: false,
    outputDir: '.csszyx',
    cacheDir: '.csszyx/cache',
    cache: true,
    astBudgetLimit: 50000,
    parser: 'rust',
    importedStaticSz: false,
};

/**
 * Default hydration configuration.
 */
export const DEFAULT_HYDRATION_CONFIG: HydrationConfig = {
    strict: true,
};

/**
 * Default csszyx configuration.
 */
export const DEFAULT_CSSZYX_CONFIG: CsszyxConfig = {
    development: DEFAULT_DEVELOPMENT_CONFIG,
    production: DEFAULT_PRODUCTION_CONFIG,
    build: DEFAULT_BUILD_CONFIG,
    hydration: DEFAULT_HYDRATION_CONFIG,
};

/**
 * Environment type.
 */
export type Environment = 'development' | 'production' | 'test';

/**
 * Gets the current environment.
 *
 * @returns {Environment} Current environment
 */
export function getCurrentEnvironment(): Environment {
    const env = process.env.NODE_ENV;
    if (env === 'production') {
        return 'production';
    }
    if (env === 'test') {
        return 'test';
    }
    return 'development';
}
