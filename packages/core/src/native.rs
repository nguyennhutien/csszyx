//! NAPI entrypoints for the Node-native transform package.
//!
//! The module is compiled only with the `native` Cargo feature. It bridges the
//! JavaScript batch API to the Rust transform contract.

use napi_derive::napi;

use crate::migrate::{self, HtmlTransformOptions, InjectRuntime, SzObject};
use crate::transform::{
    transform_batch_with_options, GlobalVarAliasEntry, ParserPath, RecoveryMode, TransformFile,
    TransformOptions, TransformProducer, TransformResult, TransformTimings,
};

/// Source file passed from JavaScript to the native transform.
#[derive(Debug)]
#[napi(object)]
pub struct NativeTransformFile {
    /// Absolute or project-relative filename used for diagnostics and cache identity.
    pub filename: String,
    /// Source module contents.
    pub source: String,
}

/// Options passed from JavaScript to the native transform.
#[derive(Debug, Default)]
#[napi(object)]
pub struct NativeTransformOptions {
    /// Whether dynamic CSS custom properties should use tiered short names.
    pub mangle_vars: Option<bool>,
    /// Maximum cascade depth for component-tier CSS variable hoisting.
    pub mangle_var_hoist_max_depth: Option<u32>,
    /// Exact app-owned global custom-property aliases for static sz values.
    pub global_var_aliases: Option<Vec<NativeGlobalVarAliasEntry>>,
    /// Project root used only to render diagnostic file paths relative to it.
    pub root_dir: Option<String>,
    /// Per-file AST node cap override (`build.astBudgetLimit`).
    pub ast_budget: Option<u32>,
    /// Cross-module szv registry payload (ordered-pair JSON).
    pub cross_module_statics_json: Option<String>,
    /// Cross-module static sz OBJECT registry payload (ordered-pair JSON).
    pub cross_module_sz_objects_json: Option<String>,
}

/// One exact app-owned global custom-property alias.
#[derive(Debug)]
#[napi(object)]
pub struct NativeGlobalVarAliasEntry {
    /// Original custom-property name, including `--`.
    pub original: String,
    /// Alias custom-property name, including `--`.
    pub alias: String,
}

/// Recovery token emitted by the native transform.
#[derive(Debug)]
#[napi(object)]
pub struct NativeRecoveryToken {
    /// Public token inserted into generated code.
    pub token: String,
    /// Recovery mode encoded in the token.
    pub mode: String,
    /// Component label associated with the token.
    pub component: String,
    /// Source path associated with the token.
    pub path: String,
}

/// CSS custom property mangle mapping emitted by the native transform.
#[derive(Debug)]
#[napi(object)]
pub struct NativeCssVariableMapEntry {
    /// Original csszyx-generated custom property name.
    pub original: String,
    /// Mangled custom property name.
    pub mangled: String,
}

/// Metadata describing which runtime helpers a native transform result needs.
#[derive(Debug)]
#[allow(clippy::struct_excessive_bools)]
#[napi(object)]
pub struct NativeTransformMetadata {
    /// Whether source code changed.
    pub transformed: bool,
    /// Whether the result imports the runtime _sz helper.
    pub uses_runtime: bool,
    /// Whether the result imports the runtime _szMerge helper.
    pub uses_merge: bool,
    /// Whether the result imports the runtime szcn helper (sz array composition).
    pub uses_szcn: bool,
    /// Whether the result imports the runtime _szPart helper (dynamic array elements).
    pub uses_sz_part: bool,
    /// Whether the result imports the runtime __szvPick helper.
    pub uses_szv_pick: bool,
    /// Whether the result imports the runtime __szvPick1 helper.
    pub uses_szv_pick1: bool,
    /// True when every emitted `_szPart` argument is provably string/falsy.
    pub sz_part_args_provable: bool,
    /// Whether the result imports the runtime color-var helper.
    pub uses_color_var: bool,
    /// Whether the result imports the runtime spacing-var helper.
    pub uses_spacing_var: bool,
    /// Whether the result imports the runtime unit-var helper (angle/duration).
    pub uses_unit_var: bool,
    /// Whether the result imports the runtime bool-class helper.
    pub uses_bool_class: bool,
    /// Producer identity for cache safety.
    pub producer: String,
    /// Whether native AST budget protection fired.
    pub ast_budget_exceeded: bool,
    /// Native timing breakdown in nanoseconds.
    pub timings: NativeTransformTimings,
}

/// Native transform timing breakdown in nanoseconds.
#[derive(Debug)]
#[napi(object)]
pub struct NativeTransformTimings {
    /// Fast pre-parser triage time.
    pub triage_ns: u32,
    /// oxc parser time.
    pub parse_ns: u32,
    /// Same-file scope collection time.
    pub scope_ns: u32,
    /// AST visitor to IR lowering time.
    pub ir_ns: u32,
    /// IR class lowering time.
    pub lower_ns: u32,
    /// Recovery token collection time.
    pub recovery_ns: u32,
    /// Safety diagnostic assembly time.
    pub diagnostics_ns: u32,
    /// Source rewrite time.
    pub rewrite_ns: u32,
    /// Total native transform time.
    pub total_ns: u32,
}

/// Transform output shape returned to JavaScript per source file.
#[derive(Debug)]
#[napi(object)]
pub struct NativeTransformResult {
    /// Rewritten source code.
    pub code: String,
    /// Source map payload, or null when the native rewrite does not emit a map.
    pub map: Option<String>,
    /// Generated csszyx/Tailwind classes.
    pub classes: Vec<String>,
    /// Static className/class strings discovered in the source.
    pub raw_class_names: Vec<String>,
    /// Non-fatal transform diagnostics.
    pub diagnostics: Vec<String>,
    /// Recovery token metadata emitted for hydration safety.
    pub recovery_tokens: Vec<NativeRecoveryToken>,
    /// CSS custom property mangle metadata.
    pub css_variable_map: Vec<NativeCssVariableMapEntry>,
    /// Native transform metadata used by unplugin and benchmarks.
    pub metadata: NativeTransformMetadata,
    /// Native parser lane used for this file.
    pub parser_path: String,
}

/// Transforms a batch of files with the native Rust core.
///
/// # Errors
///
/// Returns a NAPI error when the Rust transform engine cannot run in this build.
#[napi(js_name = "transformBatch")]
pub fn transform_batch_native(
    files: Vec<NativeTransformFile>,
    options: Option<NativeTransformOptions>,
) -> napi::Result<Vec<NativeTransformResult>> {
    let files = files
        .into_iter()
        .map(|file| TransformFile {
            filename: file.filename,
            source: file.source,
        })
        .collect::<Vec<_>>();

    let options = options.unwrap_or_default();

    transform_batch_with_options(
        &files,
        TransformOptions {
            mangle_vars: options.mangle_vars.unwrap_or(false),
            mangle_var_hoist_max_depth: options
                .mangle_var_hoist_max_depth
                .map(|depth| depth as usize),
            global_var_aliases: options
                .global_var_aliases
                .unwrap_or_default()
                .into_iter()
                .map(|entry| GlobalVarAliasEntry {
                    original: entry.original,
                    alias: entry.alias,
                })
                .collect(),
            root_dir: options.root_dir,
            ast_budget: options.ast_budget.map(|budget| budget as usize),
            cross_module_statics_json: options.cross_module_statics_json,
            cross_module_sz_objects_json: options.cross_module_sz_objects_json,
        },
    )
    .map(|results| {
        results
            .into_iter()
            .map(NativeTransformResult::from)
            .collect()
    })
    .map_err(|err| napi::Error::from_reason(err.to_string()))
}

impl From<TransformResult> for NativeTransformResult {
    fn from(result: TransformResult) -> Self {
        Self {
            code: result.code,
            map: result.map.map(|map| map.to_string()),
            classes: result.classes,
            raw_class_names: result.raw_class_names,
            diagnostics: result.diagnostics,
            recovery_tokens: result
                .recovery_tokens
                .into_iter()
                .map(|token| NativeRecoveryToken {
                    token: token.token,
                    mode: recovery_mode_to_js(token.mode).to_string(),
                    component: token.component,
                    path: token.path,
                })
                .collect(),
            css_variable_map: result
                .css_variable_map
                .into_iter()
                .map(|entry| NativeCssVariableMapEntry {
                    original: entry.original,
                    mangled: entry.mangled,
                })
                .collect(),
            metadata: NativeTransformMetadata {
                transformed: result.metadata.transformed,
                uses_runtime: result.metadata.uses_runtime,
                uses_merge: result.metadata.uses_merge,
                uses_szcn: result.metadata.uses_szcn,
                uses_sz_part: result.metadata.uses_sz_part,
                uses_szv_pick: result.metadata.uses_szv_pick,
                uses_szv_pick1: result.metadata.uses_szv_pick1,
                sz_part_args_provable: result.metadata.sz_part_args_provable,
                uses_color_var: result.metadata.uses_color_var,
                uses_spacing_var: result.metadata.uses_spacing_var,
                uses_unit_var: result.metadata.uses_unit_var,
                uses_bool_class: result.metadata.uses_bool_class,
                producer: producer_to_js(result.metadata.producer).to_string(),
                ast_budget_exceeded: result.metadata.ast_budget_exceeded,
                timings: NativeTransformTimings::from(result.metadata.timings),
            },
            parser_path: parser_path_to_js(result.parser_path).to_string(),
        }
    }
}

impl From<TransformTimings> for NativeTransformTimings {
    fn from(timings: TransformTimings) -> Self {
        Self {
            triage_ns: saturating_u32(timings.triage_ns),
            parse_ns: saturating_u32(timings.parse_ns),
            scope_ns: saturating_u32(timings.scope_ns),
            ir_ns: saturating_u32(timings.ir_ns),
            lower_ns: saturating_u32(timings.lower_ns),
            recovery_ns: saturating_u32(timings.recovery_ns),
            diagnostics_ns: saturating_u32(timings.diagnostics_ns),
            rewrite_ns: saturating_u32(timings.rewrite_ns),
            total_ns: saturating_u32(timings.total_ns),
        }
    }
}

fn saturating_u32(value: u64) -> u32 {
    u32::try_from(value).unwrap_or(u32::MAX)
}

const fn recovery_mode_to_js(mode: RecoveryMode) -> &'static str {
    match mode {
        RecoveryMode::Csr => "csr",
        RecoveryMode::DevOnly => "dev-only",
    }
}

const fn producer_to_js(producer: TransformProducer) -> &'static str {
    match producer {
        TransformProducer::Rust => "rust",
    }
}

const fn parser_path_to_js(path: ParserPath) -> &'static str {
    match path {
        ParserPath::FastRegex => "fastRegex",
        ParserPath::Static => "static",
        ParserPath::Semantic => "semantic",
    }
}

/// Source file passed from JavaScript to the native migrate.
#[derive(Debug)]
#[napi(object)]
pub struct NativeMigrateFile {
    /// Path used in warnings and to pick the parser's view of the file.
    pub filename: String,
    /// Source contents.
    pub source: String,
}

/// Options passed from JavaScript to the native migrate.
#[derive(Debug, Default)]
#[napi(object)]
pub struct NativeMigrateOptions {
    /// Insert a `@sz-todo` comment above elements with unrecognised classes.
    pub inject_todos: Option<bool>,
    /// Only normalise legacy sz keys; leave every className untouched.
    pub keys_only: Option<bool>,
    /// The migration-resolution map, as JSON text.
    pub custom_map_json: Option<String>,
}

/// Options passed from JavaScript to the native HTML migrate.
#[derive(Debug, Default)]
#[napi(object)]
pub struct NativeMigrateHtmlOptions {
    /// Wrap the sz attribute value in outer braces.
    pub braces: Option<bool>,
    /// Inject the first-paint guard before `</head>`.
    pub inject_fouc: Option<bool>,
    /// `cdn`, `local`, or absent for no runtime script.
    pub inject_runtime: Option<String>,
    /// The script URL for `cdn`.
    pub cdn_url: Option<String>,
    /// The script path for `local`.
    pub local_path: Option<String>,
}

/// The counts of one migrated file.
#[derive(Debug)]
#[napi(object)]
pub struct NativeMigrateStats {
    /// className attributes rewritten.
    pub class_names_transformed: u32,
    /// className attributes left alone.
    pub class_names_skipped: u32,
    /// className kept on capitalised components.
    pub class_names_skipped_component: u32,
    /// Classes the parser did not know.
    pub classes_unrecognized: Vec<String>,
    /// Legacy sz keys rewritten; absent when the file was never parsed.
    pub sz_keys_normalized: Option<u32>,
}

/// What migrate did to one file.
#[derive(Debug)]
#[napi(object)]
pub struct NativeMigrateResult {
    /// The migrated source.
    pub code: String,
    /// Whether anything was written.
    pub changed: bool,
    /// Why something was left alone, each prefixed with the file path.
    pub warnings: Vec<String>,
    /// The counts.
    pub stats: NativeMigrateStats,
    /// Composition helpers imported but no longer called after migration.
    pub potentially_unused_imports: Vec<String>,
}

impl From<migrate::TransformResult> for NativeMigrateResult {
    fn from(result: migrate::TransformResult) -> Self {
        Self {
            code: result.code,
            changed: result.changed,
            warnings: result.warnings,
            stats: NativeMigrateStats {
                class_names_transformed: result.stats.class_names_transformed,
                class_names_skipped: result.stats.class_names_skipped,
                class_names_skipped_component: result.stats.class_names_skipped_component,
                classes_unrecognized: result.stats.classes_unrecognized,
                sz_keys_normalized: result.stats.sz_keys_normalized,
            },
            potentially_unused_imports: result.potentially_unused_imports,
        }
    }
}

/// Migrates a batch of JSX/TSX sources with the native Rust core: one call
/// for the whole job, because a call per file costs more than the parse.
///
/// # Errors
///
/// Returns a NAPI error when `customMapJson` is not a JSON object.
#[napi(js_name = "migrateBatch")]
pub fn migrate_batch_native(
    files: Vec<NativeMigrateFile>,
    options: Option<NativeMigrateOptions>,
) -> napi::Result<Vec<NativeMigrateResult>> {
    let options = options.unwrap_or_default();
    let custom_map = options
        .custom_map_json
        .as_deref()
        .map(serde_json::from_str::<SzObject>)
        .transpose()
        .map_err(|error| {
            napi::Error::from_reason(format!("customMapJson is not a JSON object: {error}"))
        })?;
    let migrate_options = migrate::TransformOptions {
        inject_todos: options.inject_todos.unwrap_or(false),
        keys_only: options.keys_only.unwrap_or(false),
        custom_map: custom_map.as_ref(),
    };
    Ok(files
        .into_iter()
        .map(|file| {
            migrate::transform_source(&file.source, &file.filename, &migrate_options).into()
        })
        .collect())
}

/// Migrates one HTML source with the native Rust core.
///
/// # Errors
///
/// Returns a NAPI error when `injectRuntime` is not `cdn`, `local` or absent.
// napi hands a JavaScript string over as an owned `String`.
#[allow(clippy::needless_pass_by_value)]
#[napi(js_name = "migrateHtml")]
pub fn migrate_html_native(
    source: String,
    options: Option<NativeMigrateHtmlOptions>,
) -> napi::Result<NativeMigrateResult> {
    let options = options.unwrap_or_default();
    let inject_runtime = match options.inject_runtime.as_deref() {
        None | Some("" | "false") => InjectRuntime::Off,
        Some("cdn") => InjectRuntime::Cdn,
        Some("local") => InjectRuntime::Local,
        Some(other) => {
            return Err(napi::Error::from_reason(format!(
                "injectRuntime must be 'cdn', 'local' or false, got {other}"
            )))
        }
    };
    let html_options = HtmlTransformOptions {
        braces: options.braces.unwrap_or(false),
        inject_fouc: options.inject_fouc.unwrap_or(true),
        inject_runtime,
        cdn_url: options.cdn_url,
        local_path: options.local_path,
    };
    Ok(migrate::transform_html_source(&source, &html_options).into())
}
