use serde::ser::{SerializeMap, Serializer};
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
///
/// Unknown fields are refused: a compiler newer than the engine sends options
/// the engine cannot honour, and ignoring them produced wrong output with no
/// word (the 0.17 engine dropped `class_prefix`).
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize, Default)]
#[serde(deny_unknown_fields)]
pub struct TransformOptions {
    /// Whether dynamic CSS custom properties should use tiered short names.
    pub mangle_vars: bool,
    /// Maximum cascade depth for component-tier CSS variable hoisting.
    pub mangle_var_hoist_max_depth: Option<usize>,
    /// Exact app-owned global custom-property aliases for static sz values.
    pub global_var_aliases: Vec<GlobalVarAliasEntry>,
    /// Per-file AST node cap override (`build.astBudgetLimit`). Engines count
    /// AST nodes differently, so a real page file can trip the default cap
    /// under one engine only — the override must reach the native parser too.
    #[serde(default)]
    pub ast_budget: Option<usize>,
    /// Cross-module szv registry payload, ordered-pair JSON from the bundler.
    #[serde(default)]
    pub cross_module_statics_json: Option<String>,
    /// Cross-module static sz OBJECT registry payload, ordered-pair JSON from
    /// the bundler. Kept apart from the szv payload because an szv config is a
    /// variant table the engine compiles and picks from, while an sz object is
    /// a value it lowers — one untagged map would leave the decoder guessing
    /// which machinery applies.
    #[serde(default)]
    pub cross_module_sz_objects_json: Option<String>,
    /// The Tailwind `prefix()` of the project's stylesheet, written before
    /// every class the engine emits (`tw` gives `tw:p-4`). Classes the author
    /// wrote as strings are left as written.
    #[serde(default)]
    pub class_prefix: Option<String>,
    /// Which of this file's classes cover which, as the plugin read them from
    /// the project's compiled stylesheet. A later key of a static object then
    /// replaces an earlier one it covers. Absent means nothing is merged.
    #[serde(default)]
    pub merge_table_json: Option<String>,
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
    /// Whether the result imports the runtime __szvPick1 single-dimension helper.
    pub uses_szv_pick1: bool,
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
    /// Whether the result imports the runtime bool-class helper (boolean-only keys).
    #[serde(default)]
    pub uses_bool_class: bool,
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

/// One named value a diagnostic carries.
#[derive(Debug, Clone, PartialEq, Eq)]
pub enum ArgValue {
    /// Text: a key, a value, a class name, as written or lowered.
    Text(String),
    /// A count or a depth.
    Count(u64),
    /// A list of texts.
    List(Vec<String>),
}

impl Serialize for ArgValue {
    fn serialize<S: Serializer>(&self, serializer: S) -> Result<S::Ok, S::Error> {
        match self {
            Self::Text(text) => serializer.serialize_str(text),
            Self::Count(count) => serializer.serialize_u64(*count),
            Self::List(items) => serializer.collect_seq(items),
        }
    }
}

/// The named values of one diagnostic, in the registry's order.
///
/// Serialized as a JSON object whose keys keep that order on both artifacts.
/// An optional value the diagnostic has nothing for is left out, never `null`.
/// Serialize-only on purpose: nothing reads args back into the engine.
#[derive(Debug, Clone, Default, PartialEq, Eq)]
pub struct Args(Vec<(&'static str, ArgValue)>);

impl Args {
    /// Append one value; the generated constructors call this in registry order.
    #[must_use]
    pub fn with(mut self, name: &'static str, value: ArgValue) -> Self {
        self.0.push((name, value));
        self
    }

    // One out-of-line helper per arg shape, so a constructor inlines to a few
    // calls instead of a copy of the push for every arg it names.

    /// Append a text value.
    #[must_use]
    #[inline(never)]
    pub fn text(self, name: &'static str, value: &str) -> Self {
        self.with(name, ArgValue::Text(value.to_string()))
    }

    /// Append a text value when there is one.
    #[must_use]
    #[inline(never)]
    pub fn optional_text(self, name: &'static str, value: Option<&str>) -> Self {
        match value {
            Some(value) => self.text(name, value),
            None => self,
        }
    }

    /// Append a count.
    #[must_use]
    #[inline(never)]
    pub fn count(self, name: &'static str, value: u64) -> Self {
        self.with(name, ArgValue::Count(value))
    }

    /// Append a count when there is one.
    #[must_use]
    #[inline(never)]
    pub fn optional_count(self, name: &'static str, value: Option<u64>) -> Self {
        match value {
            Some(value) => self.count(name, value),
            None => self,
        }
    }

    /// Append a list.
    #[must_use]
    #[inline(never)]
    pub fn list(self, name: &'static str, value: Vec<String>) -> Self {
        self.with(name, ArgValue::List(value))
    }

    /// The value named `name`, if the diagnostic carries it.
    #[must_use]
    pub fn get(&self, name: &str) -> Option<&ArgValue> {
        self.0
            .iter()
            .find(|(key, _)| *key == name)
            .map(|(_, value)| value)
    }

    /// The args as the JSON object the wire carries.
    #[must_use]
    pub fn to_json(&self) -> String {
        serde_json::to_string(self).expect("args serialize")
    }
}

impl Serialize for Args {
    fn serialize<S: Serializer>(&self, serializer: S) -> Result<S::Ok, S::Error> {
        let mut map = serializer.serialize_map(Some(self.0.len()))?;
        for (name, value) in &self.0 {
            map.serialize_entry(name, value)?;
        }
        map.end()
    }
}

/// What one diagnostic reports, where, and the values its sentence names.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
pub struct Issue {
    /// The kind of problem.
    pub code: super::DiagnosticCode,
    /// Byte offset in the source the diagnostic points at; `0` for one about
    /// the whole file.
    pub start: u32,
    /// The named values, in the registry's order. Never read back, so a
    /// deserialized result carries none.
    #[serde(skip_deserializing)]
    pub args: Args,
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
    /// Each static object a merge would read, when the pass had no merge
    /// table; objects of one class are left out.
    #[serde(default)]
    pub merge_groups: Vec<super::merge::MergeGroup>,
    /// Each static object of one class, when the pass had no merge table, in
    /// the shape of `merge_groups`: a merge reads nothing here, a report reads
    /// the key and offset behind the class.
    #[serde(default)]
    pub single_class_groups: Vec<super::merge::MergeGroup>,
    /// Each static class name beside a static `sz` a merge would read, when
    /// the pass had no merge table; one side empty is left out.
    #[serde(default)]
    pub merge_overrides: Vec<super::merge::MergeOverride>,
    /// Each non-fatal diagnostic: its code, position and args. The engine
    /// writes no sentence; the compiler renders one from the registry.
    #[serde(default)]
    pub issues: Vec<Issue>,
    /// Recovery token metadata emitted for hydration safety.
    pub recovery_tokens: Vec<RecoveryToken>,
    /// CSS custom property mangle metadata.
    pub css_variable_map: Vec<CssVariableMapEntry>,
    /// Native transform metadata used by unplugin and benchmarks.
    pub metadata: TransformMetadata,
    /// Native parser lane used for this file.
    pub parser_path: ParserPath,
}

#[cfg(test)]
mod tests {
    use super::TransformOptions;

    #[test]
    fn options_refuse_a_field_the_engine_does_not_know() {
        let known =
            r#"{"mangle_vars":false,"mangle_var_hoist_max_depth":null,"global_var_aliases":[]}"#;
        assert!(serde_json::from_str::<TransformOptions>(known).is_ok());
        let unknown = r#"{"mangle_vars":false,"mangle_var_hoist_max_depth":null,"global_var_aliases":[],"class_suffix":"x"}"#;
        let error = serde_json::from_str::<TransformOptions>(unknown)
            .expect_err("an unknown option is refused")
            .to_string();
        assert!(error.contains("unknown field `class_suffix`"), "{error}");
    }
}
