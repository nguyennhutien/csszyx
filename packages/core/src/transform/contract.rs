use serde::{Deserialize, Serialize};

/// Source file passed to the Rust transform core.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
pub struct TransformFile {
    /// Absolute or project-relative filename used for diagnostics and cache identity.
    pub filename: String,
    /// Source module contents.
    pub source: String,
}

/// Options passed to the Rust transform core.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize, Default)]
pub struct TransformOptions {
    /// Whether dynamic CSS custom properties should use tiered short names.
    pub mangle_vars: bool,
    /// Maximum cascade depth for component-tier CSS variable hoisting.
    pub mangle_var_hoist_max_depth: Option<usize>,
    /// Exact app-owned global custom-property aliases for static sz values.
    pub global_var_aliases: Vec<GlobalVarAliasEntry>,
    /// Project root used only to render diagnostic file paths relative to it.
    #[serde(default)]
    pub root_dir: Option<String>,
    /// Per-file AST node cap override (`build.astBudgetLimit`). Engines count
    /// AST nodes differently, so a real page file can trip the default cap
    /// under one engine only — the override must reach the native parser too.
    #[serde(default)]
    pub ast_budget: Option<usize>,
    /// Cross-module szv registry payload, ordered-pair JSON from the bundler.
    #[serde(default)]
    pub cross_module_statics_json: Option<String>,
}

/// One exact app-owned global custom-property alias.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
pub struct GlobalVarAliasEntry {
    /// Original custom-property name, including `--`.
    pub original: String,
    /// Alias custom-property name, including `--`.
    pub alias: String,
}

/// Recovery token emitted by a transform result.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
pub struct RecoveryToken {
    /// Public token inserted into generated code.
    pub token: String,
    /// Recovery mode encoded in the token.
    pub mode: RecoveryMode,
    /// Component label associated with the token.
    pub component: String,
    /// Source path associated with the token.
    pub path: String,
}

/// CSS custom property mapping emitted by a transform.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
pub struct CssVariableMapEntry {
    /// Original csszyx-generated custom property name.
    pub original: String,
    /// Mangled custom property name.
    pub mangled: String,
}

/// Recovery mode encoded in a token.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "kebab-case")]
pub enum RecoveryMode {
    /// Client-side recovery token.
    Csr,
    /// Development-only recovery token.
    DevOnly,
}

/// Metadata describing which runtime helpers a transform result needs.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[allow(clippy::struct_excessive_bools)]
pub struct TransformMetadata {
    /// Whether source code changed.
    pub transformed: bool,
    /// Whether the result imports the runtime _sz helper.
    pub uses_runtime: bool,
    /// Whether the result imports the runtime _szMerge helper.
    pub uses_merge: bool,
    /// Whether the result imports the runtime szcn helper (sz array composition).
    #[serde(default)]
    pub uses_szcn: bool,
    /// Whether the result imports the runtime _szPart helper (dynamic array elements).
    #[serde(default)]
    pub uses_sz_part: bool,
    /// Whether the result imports the runtime __szvPick helper (precompiled szv tables).
    #[serde(default)]
    pub uses_szv_pick: bool,
    /// True when every emitted `_szPart` argument is provably a string or
    /// falsy (vacuously true with none).
    #[serde(default)]
    pub sz_part_args_provable: bool,
    /// Whether the result imports the runtime color-var helper.
    pub uses_color_var: bool,
    /// Whether the result imports the runtime spacing-var helper.
    #[serde(default)]
    pub uses_spacing_var: bool,
    /// Whether the result imports the runtime unit-var helper (angle/duration).
    #[serde(default)]
    pub uses_unit_var: bool,
    /// Producer identity for cache safety.
    pub producer: TransformProducer,
    /// Whether native AST budget protection fired.
    pub ast_budget_exceeded: bool,
    /// Native timing breakdown in nanoseconds.
    pub timings: TransformTimings,
}

/// Native transform timing breakdown in nanoseconds.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize, Default)]
pub struct TransformTimings {
    /// Fast pre-parser triage time.
    pub triage_ns: u64,
    /// oxc parser time.
    pub parse_ns: u64,
    /// Same-file scope collection time.
    pub scope_ns: u64,
    /// AST visitor to IR lowering time.
    pub ir_ns: u64,
    /// IR class lowering time.
    pub lower_ns: u64,
    /// Recovery token collection time.
    pub recovery_ns: u64,
    /// Safety diagnostic assembly time.
    pub diagnostics_ns: u64,
    /// Source rewrite time.
    pub rewrite_ns: u64,
    /// Total native transform time.
    pub total_ns: u64,
}

/// Producer identity for native transform cache safety.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "kebab-case")]
pub enum TransformProducer {
    /// Rust core producer.
    Rust,
}

/// Native parser lane used for a transformed file.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "kebab-case")]
pub enum ParserPath {
    /// AST-free static JSX path.
    FastRegex,
    /// Static AST path.
    Static,
    /// Semantic binding-resolution path.
    Semantic,
}

/// Transform output shape returned per source file.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
pub struct TransformResult {
    /// Rewritten source code.
    pub code: String,
    /// Source map payload, or null when the native rewrite does not emit a map.
    pub map: Option<serde_json::Value>,
    /// Generated csszyx/Tailwind classes.
    pub classes: Vec<String>,
    /// Static className/class strings discovered in the source.
    pub raw_class_names: Vec<String>,
    /// Non-fatal transform diagnostics.
    pub diagnostics: Vec<String>,
    /// Recovery token metadata emitted for hydration safety.
    pub recovery_tokens: Vec<RecoveryToken>,
    /// CSS custom property mangle metadata.
    pub css_variable_map: Vec<CssVariableMapEntry>,
    /// Native transform metadata used by unplugin and benchmarks.
    pub metadata: TransformMetadata,
    /// Native parser lane used for this file.
    pub parser_path: ParserPath,
}
