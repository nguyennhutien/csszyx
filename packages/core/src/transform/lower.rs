//! Static csszyx IR lowering.
//!
//! This module converts parser-neutral static sz IR into ordered class names.
//! It is kept separate from rewrite so class-generation parity can be tested
//! before any source mutation ships.

use std::borrow::Cow;

use super::{
    generated::tables::{
        boolean_class, css_var_type_hint, is_aria_state, is_known_variant,
        is_removed_boolean_sugar, is_special_variant, key_migration_note, key_suggestion,
        property_prefix, split_shorthand_form, variant_prefix,
    },
    SourceIr, StaticSzObject, StaticSzProperty, StaticSzValue,
};

/// Class data lowered from parser-neutral source IR.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct LoweredSourceClasses {
    /// Generated csszyx/Tailwind classes from static `sz` attributes.
    pub classes: Vec<String>,
    /// Static class/className strings discovered in source order.
    pub raw_class_names: Vec<String>,
}

/// Lower parser-neutral source IR into class lists without rewriting source.
pub fn lower_source_ir_classes(ir: &SourceIr) -> LoweredSourceClasses {
    // szs classes join AFTER every sz-derived class so the discovery order
    // (which fixes production mangle IDs) matches the other engines.
    let classes = ir
        .extracted_classes
        .iter()
        .cloned()
        .chain(ir.sz_attributes.iter().flat_map(lower_sz_attribute_classes))
        .chain(ir.szs_attributes.iter().flat_map(|attribute| {
            attribute.entries.iter().flat_map(|entry| {
                entry
                    .class_name
                    .split_whitespace()
                    .map(ToString::to_string)
                    .collect::<Vec<_>>()
            })
        }))
        .collect();
    // Split each static class attribute into individual class tokens, matching
    // the JavaScript path it replaced: consumers (safelist, mangle) iterate raw_class_names as
    // single classes, so a whole `"flex gap-2"` string would be treated as one
    // bogus class on the default rust parser.
    let raw_class_names = ir
        .class_attributes
        .iter()
        .filter(|attr| attr.expression_span.is_none())
        .flat_map(|attr| attr.value.split_whitespace().map(ToString::to_string))
        .collect();

    LoweredSourceClasses {
        classes,
        raw_class_names,
    }
}

/// Lower one static `sz` attribute into classes.
///
/// For a ternary `sz={cond ? A : B}` attribute both branches contribute to the
/// reported class list so `result.classes` matches what the JavaScript pipeline reported
/// (both possible runtime outcomes flow back as static knowledge for the
/// className manifest). The rewrite layer keeps the two branches separate
/// when it emits source.
pub fn lower_sz_attribute_classes(attribute: &super::SzAttributeIr) -> Vec<String> {
    let mut classes = attribute
        .literal_class_name
        .as_deref()
        .into_iter()
        .flat_map(str::split_whitespace)
        .filter(|class_name| !class_name.is_empty())
        .map(ToString::to_string)
        .collect::<Vec<_>>();
    classes.extend(lower_static_sz_object(&attribute.object));
    classes.extend(attribute.candidate_classes.iter().cloned());
    classes.extend(attribute.array_parts.iter().flat_map(|part| {
        // Element order: a static part contributes its classes, a dynamic part
        // its safelist candidates — mangle IDs follow discovery order.
        part.classes
            .iter()
            .chain(part.ternary.iter().flat_map(ternary_classes))
            .chain(part.candidates.iter())
            .cloned()
    }));
    classes.extend(
        attribute
            .dynamic_css_vars
            .iter()
            .filter(|prop| !prop.skip_class)
            .map(dynamic_css_var_class),
    );
    for ternary in &attribute.ternaries {
        classes.extend(ternary_classes(ternary).cloned());
    }
    classes
}

/// Every class a conditional can produce, head and chain arms alike.
///
/// One walk so the safelist cannot learn about a branch the emitter can pick:
/// a chain arm missing here would name a class Tailwind was never asked to
/// generate, and only for the input that reaches that arm.
fn ternary_classes(ternary: &super::StaticTernaryIr) -> impl Iterator<Item = &String> {
    ternary
        .consequent_classes
        .iter()
        .chain(ternary.chain_arms.iter().flat_map(|arm| arm.classes.iter()))
        .chain(ternary.alternate_classes.iter())
}

/// Build the Tailwind CSS-variable utility for one dynamic property.
pub(super) fn dynamic_css_var_class(prop: &super::DynamicCssVarIr) -> String {
    let variant = prop
        .variant_prefix
        .as_ref()
        .map_or_else(String::new, |prefix| format!("{prefix}:"));
    // A custom property written as a key is a declaration, not a utility, so
    // its runtime form is the same `[--name:value]` class as its static form
    // with the hoisted variable as the value. The generic shape below gave
    // `--ring-(--_sz---ring)`, which names no Tailwind utility.
    if prop.key.starts_with("--") {
        return with_class_prefix(format!("{variant}[{}:var({})]", prop.key, prop.var_name));
    }
    // The hoisted variable takes the type hint a static `--x` value takes:
    // without it Tailwind reads `bg-(--v)` as a colour and `shadow-(--v)` as
    // the shadow itself.
    let hint = css_var_type_hint(&prop.key).map_or_else(String::new, |hint| format!("{hint}:"));
    with_class_prefix(format!(
        "{variant}{}-({hint}{})",
        prop.class_prefix, prop.var_name
    ))
}

thread_local! {
    /// The Tailwind prefix of the file being transformed on this thread.
    static CLASS_PREFIX: std::cell::RefCell<Option<String>> = const { std::cell::RefCell::new(None) };
}

/// The project's Tailwind `prefix()` for every class lowered while it lives.
///
/// A scope rather than a parameter: classes are lowered from more than twenty
/// places in the parser, the rewrite and the szv precompile, and one of them
/// missing the prefix would emit a class that styles nothing with no error.
/// The engine opens one scope per file, the whole transform of a file runs on
/// one thread, and dropping the scope restores the previous value even when
/// the transform unwinds.
#[must_use = "the prefix applies only while the scope is alive"]
pub struct ClassPrefixScope {
    previous: Option<String>,
}

impl ClassPrefixScope {
    /// Apply `class_prefix` to every class lowered on this thread until the
    /// scope drops. An empty prefix is no prefix.
    pub fn enter(class_prefix: Option<&str>) -> Self {
        let next = class_prefix
            .filter(|prefix| !prefix.is_empty())
            .map(str::to_owned);
        Self {
            previous: CLASS_PREFIX.with(|cell| cell.replace(next)),
        }
    }
}

impl Drop for ClassPrefixScope {
    fn drop(&mut self) {
        CLASS_PREFIX.with(|cell| cell.replace(self.previous.take()));
    }
}

/// Each lowered class with the active prefix written before it, the
/// thread-local read once for the whole list.
fn with_class_prefix_all(classes: Vec<String>) -> Vec<String> {
    CLASS_PREFIX.with(|cell| match cell.borrow().as_deref() {
        Some(prefix) => classes
            .into_iter()
            .map(|class_name| format!("{prefix}:{class_name}"))
            .collect(),
        None => classes,
    })
}

/// A lowered class with the active prefix written before it.
fn with_class_prefix(class_name: String) -> String {
    CLASS_PREFIX.with(|cell| match cell.borrow().as_deref() {
        Some(prefix) => format!("{prefix}:{class_name}"),
        None => class_name,
    })
}

/// [`lower_static_sz_object`] with the project's Tailwind prefix written
/// before every class.
#[must_use]
pub fn lower_static_sz_object_with_class_prefix(
    object: &StaticSzObject,
    class_prefix: Option<&str>,
) -> Vec<String> {
    let _scope = ClassPrefixScope::enter(class_prefix);
    lower_static_sz_object(object)
}

/// Lower a static sz object into Tailwind/csszyx class names in source order.
pub fn lower_static_sz_object(object: &StaticSzObject) -> Vec<String> {
    if super::merge::recording_groups() {
        return lower_static_sz_object_recorded(object);
    }
    let mut classes = Vec::with_capacity(object.properties.len());
    lower_object_into(object, "", &mut classes);
    finish_lowered_classes(classes)
}

/// Fuse, prefix and merge the classes one object lowered to.
fn finish_lowered_classes(classes: Vec<String>) -> Vec<String> {
    // Merged last: the table names classes as they are emitted, prefix
    // included, and the text-size/leading pair is one class by then.
    let classes = merge_text_size_and_leading(one_class_each(classes));
    super::merge::apply_active(with_class_prefix_all(classes))
}

/// Each class one value lowered to, as one class: a space inside a value
/// becomes `_`, as Tailwind reads it in an arbitrary value. Written raw,
/// `brightness: 'calc(1 + 2)'` split the attribute into three names that
/// style nothing, and `display: 'flex hidden'` into two that do. Mirrors
/// `oneClassEach` in `transform-core.ts`.
fn one_class_each(classes: Vec<String>) -> Vec<String> {
    classes.into_iter().map(one_class).collect()
}

/// A class with whitespace in it, as one class: its runs of whitespace become
/// `_`. Every lowered class goes through it, and so does the class a
/// diagnostic names. Mirrors `oneClass`.
fn one_class(class_name: String) -> String {
    if class_name.contains(char::is_whitespace) {
        class_name.split_whitespace().collect::<Vec<_>>().join("_")
    } else {
        class_name
    }
}

/// [`lower_static_sz_object`] on a pass that collects what a merge would
/// read: the object is recorded with the key behind each class and that key's
/// offset, so a report can name the key and the line it is written on.
///
/// Kept apart so a pass with a table pays nothing for the keys: each top-level
/// property marks where its classes start, and the marks are read only here.
fn lower_static_sz_object_recorded(object: &StaticSzObject) -> Vec<String> {
    let mut classes = Vec::with_capacity(object.properties.len());
    // The property behind each class, index-parallel to `classes`: each class
    // belongs to the last property that started at or before it.
    let mut owners: Vec<&StaticSzProperty> = Vec::with_capacity(object.properties.len());
    let mut current: Option<usize> = None;
    lower_object_into_marked(object, "", &mut classes, &mut |index, len| {
        if let Some(owner) = current {
            owners.resize(len, &object.properties[owner]);
        }
        current = Some(index);
    });
    let mut classes = one_class_each(classes);
    // A one-class object merges with nothing but is recorded all the same:
    // the group is where its key and offset travel to a dead-class report.
    if classes.is_empty() {
        return finish_lowered_classes(classes);
    }
    if let Some(owner) = current {
        owners.resize(classes.len(), &object.properties[owner]);
    }
    let consumed = fuse_text_size_and_leading(&mut classes);
    let mut keys = Vec::with_capacity(classes.len());
    let mut key_starts = Vec::with_capacity(classes.len());
    let mut kept = Vec::with_capacity(classes.len());
    for (index, (owner, class_name)) in owners.into_iter().zip(classes).enumerate() {
        if !consumed.get(index).copied().unwrap_or(false) {
            keys.push(owner.key.clone());
            key_starts.push(owner.span.start);
            kept.push(class_name);
        }
    }
    let kept = with_class_prefix_all(kept);
    super::merge::record_group(super::merge::MergeGroup {
        keys,
        key_starts,
        classes: kept.clone(),
    });
    super::merge::apply_active(kept)
}

/// Whether a key was removed from the authoring contract and has migration
/// guidance. Unlike an arbitrary unknown key, these names cannot be custom
/// utility escape hatches: preserving them would silently keep legacy aliases.
pub(crate) fn is_removed_sz_key(key: &str) -> bool {
    key_suggestion(key).is_some()
        || key_migration_note(key).is_some()
        || split_shorthand_form(key).is_some()
}

/// Whether a key is a recognized sz property or variant name. Generous by
/// construction — a key is "known" if ANY table or special form claims it
/// (`property_prefix` already covers the many special-cased keys like
/// `content`/`display`/`snapAlign`), so a valid key is never taken for a
/// variant. It decides what a runtime value on a key means
/// ([`is_variant_key`], the parser's conditional branches); which scalar keys
/// are reported unknown is [`is_scalar_sz_key`]'s answer, as at runtime.
///
/// An ARIA state name counts here and not there: a runtime value on it keeps
/// the lane it had, but `expanded: 'x'` is a key no table owns — the name is
/// the `aria` variant's parameter (`{ aria: { expanded: … } }`).
#[cfg(any(feature = "native-engine", test))]
pub(crate) fn is_known_sz_key(key: &str) -> bool {
    is_scalar_sz_key(key, true) || is_aria_state(key)
}

/// Whether a key holding a scalar is one the runtime's `isKnownSzPropertyKey`
/// knows, so the engine reports the same unknown keys. Removed boolean sugar
/// is known only in its `true` form: with any other value it is a key no
/// table owns (`tabularNums: 'x'`), unless a table owns it in its own right
/// (`flex: 1`).
#[cfg(any(feature = "native-engine", test))]
fn is_scalar_sz_key(key: &str, value_is_true: bool) -> bool {
    (value_is_true && is_removed_boolean_sugar(key)) || is_value_sz_key(key)
}

/// Whether a key is known whatever its value holds; see [`is_scalar_sz_key`].
#[cfg(any(feature = "native-engine", test))]
fn is_value_sz_key(key: &str) -> bool {
    property_prefix(key).is_some()
        || boolean_class(key).is_some()
        // Flag-only utilities (truncate, blur, grayscale, invert, sepia,
        // backdrop*) carry no value, so they are absent from `boolean_class`'s
        // emit table (which only lists shorthands whose class name differs from
        // the key). The `Boolean(true)` emit path falls back to the key itself
        // for them, so they DO produce a class — the known-key check must agree,
        // or rust warns "Unknown property … will be ignored" for a class it
        // actually emits, diverging from the removed JavaScript lanes (whose BOOLEAN_SHORTHANDS
        // set includes them and never warns).
        // Fully-qualified rather than imported: this is the ONLY caller, and it
        // is gated behind `#[cfg(any(feature = "native-engine", test))]`. A plain
        // `use` would read as unused under the default feature set, and a
        // `cargo clippy --fix` pass (e.g. the pre-commit hook) would delete the
        // import, breaking the native build. Referencing it inline keeps the
        // symbol tied to its single cfg-gated use.
        || super::generated::tables::is_boolean_shorthand(key)
        || super::generated::tables::is_known_special_property(key)
        || is_known_variant(key)
        // Cheap byte probes BEFORE variant_string_prefix: that helper builds a
        // whitespace-stripped String for any `[...]` key just to answer
        // `.is_some()`, so a bracket key must short-circuit ahead of it (the
        // TypeScript twin already orders these this way).
        || key.starts_with("--")
        || key.starts_with('[')
        || key.starts_with('@')
        || variant_string_prefix(key).is_some()
        || variant_prefix(key).is_some()
        || matches!(
            key,
            "min"
                | "max"
                | "group"
                | "peer"
                | "has"
                | "not"
                | "data"
                | "aria"
                | "supports"
        )
}

/// Collect the keys of unrecognized sz properties (likely typos) as
/// `(key, byte_offset)` pairs. Walks nested variant objects the way the
/// lowering does, a parametric variant's bodies included
/// ([`for_each_sz_object_in`]) — its parameters are names, never judged as sz
/// keys — and skips `css`, `bgImg`, the mask slots and color-with-opacity
/// objects, whose members are values, not sz properties.
#[cfg(any(feature = "native-engine", test))]
pub(crate) fn collect_unknown_sz_keys(object: &StaticSzObject, out: &mut Vec<(String, u32)>) {
    for property in &object.properties {
        if property.value == StaticSzValue::Boolean(false) {
            continue;
        }
        if is_removed_sz_key(&property.key) {
            // An alias holding a value that moved is named by the moved-value
            // report, which says where the value went; the alias's canonical
            // key no longer takes it.
            let moved = matches!(&property.value, StaticSzValue::String(value)
                if moved_value(&property.key, value.strip_suffix('!').unwrap_or(value)).is_some());
            if !moved {
                out.push((property.key.clone(), property.span.start));
            }
            continue;
        }
        let known = is_scalar_sz_key(
            &property.key,
            property.value == StaticSzValue::Boolean(true),
        );
        if !known {
            // An OBJECT value means variant nesting, and variant names are
            // open-ended: a `--breakpoint-*` token from the app's `@theme`
            // (`{ tablet: { p: 4 } }`) or an arbitrary selector cannot appear in
            // any static table here. The lowering treats the key as a variant
            // and emits `tablet:p-4` correctly, so flagging it read as
            // "Unknown property …" for a class that WAS
            // emitted — a warning that lies, and only on this engine (the JS
            // lanes warn from their scalar-value path alone). Descend so the
            // nested keys are still checked.
            if let StaticSzValue::Object(nested) = &property.value {
                collect_unknown_sz_keys(nested, out);
            } else {
                out.push((property.key.clone(), property.span.start));
            }
            continue;
        }
        if let StaticSzValue::Object(nested) = &property.value {
            // A mask slot's members are geometry with their own closed
            // check (`collect_unknown_mask_slot_members`); walking them
            // here read `angle` / `at` / `shape` as unknown sz keys.
            if mask_slot_members(&property.key).is_some() || is_value_object(&property.key, nested)
            {
                continue;
            }
            for_each_sz_object_in(&property.key, nested, &mut |object| {
                collect_unknown_sz_keys(object, out);
            });
        }
    }
}

/// Collects spacing-scale properties whose numeric value is not a quarter
/// step — Tailwind's bare spacing syntax only accepts multiples of 0.25, so
/// `p-1.4` generates no CSS, and a unitless bracket is no escape (`padding:
/// 1.4` is invalid CSS). Same descent rules as `collect_unknown_sz_keys`;
/// `leading` is excluded because it falls back to the unitless-ratio bracket.
/// Collect removed boolean-sugar aliases carrying `true`, for the diagnostic.
///
/// The `true` form is the one that lost its meaning: the same keys still take
/// values in their own right (`flex: 1` is the flex shorthand), so keying on
/// the key alone would report a line that compiles correctly.
///
/// Same descent rules as `collect_dead_spacing_steps`: variant nesting is
/// walked, parameter namespaces are not.
#[cfg(feature = "native-engine")]
pub(crate) fn collect_removed_boolean_sugar(
    object: &StaticSzObject,
    out: &mut Vec<(String, &'static str, &'static str, u32)>,
) {
    for property in &object.properties {
        match &property.value {
            StaticSzValue::Boolean(true) => {
                // Membership IS the replacement lookup: both tables are
                // generated from the same source object, so asking one and then
                // the other would leave a branch that cannot run.
                if let Some((canonical, value)) =
                    super::generated::tables::removed_boolean_sugar_replacement(&property.key)
                {
                    out.push((property.key.clone(), canonical, value, property.span.start));
                }
            }
            StaticSzValue::Object(nested) => {
                if property_prefix(&property.key).is_some() {
                    continue;
                }
                collect_removed_boolean_sugar(nested, out);
            }
            _ => {}
        }
    }
}

#[cfg(feature = "native-engine")]
pub(crate) fn collect_dead_spacing_steps(
    object: &StaticSzObject,
    out: &mut Vec<(String, f64, u32)>,
) {
    for property in &object.properties {
        match &property.value {
            StaticSzValue::Number(value) => {
                if is_dead_spacing_step(&property.key, *value) {
                    out.push((property.key.clone(), *value, property.span.start));
                }
            }
            StaticSzValue::String(_) => {
                if let Some(parsed) = numeric_string_value(&property.key, &property.value)
                    .filter(|parsed| is_dead_spacing_step(&property.key, *parsed))
                {
                    out.push((property.key.clone(), parsed, property.span.start));
                }
            }
            StaticSzValue::Object(nested) if !is_value_object(&property.key, nested) => {
                for_each_sz_object_in(&property.key, nested, &mut |object| {
                    collect_dead_spacing_steps(object, out);
                });
            }
            StaticSzValue::Object(_) | StaticSzValue::Boolean(_) => {}
        }
    }
}

/// Keys csszyx OWNS that cannot mean a variant, reported when they carry an
/// object.
///
/// The variant namespace is open — a project declares its own with
/// `@custom-variant` and its own breakpoints with `--breakpoint-*` in `@theme`
/// — so `{ tablet: { p: 4 } }` and `{ 'tablt': { p: 4 } }` are the same shape
/// to a compiler that cannot read the project's CSS. Warning on both was
/// measured as worse than silence in the field and is locked out by
/// `custom-theme-variant-keys.test.ts`.
///
/// These two are different: csszyx defines what they mean, and neither meaning
/// is a variant. A `--*` key is a custom-property declaration whose value is a
/// declaration value; `container` is the boolean/`@container/name` utility. An
/// object under either lowers to a class prefix Tailwind serves nothing for.
#[cfg(feature = "native-engine")]
fn is_owned_non_variant_key(key: &str) -> bool {
    key.starts_with("--") || key == "container"
}

/// Collect csszyx-owned keys used in variant position, for the diagnostic.
///
/// `{ '--v-x': { p: 4 } }` emits `--v-x:p-4` and `{ container: { sm: { … } } }`
/// emits `container:sm:p-4`. Both are dead classes on a green build. Descends
/// like the lowering does, minus the parametric stems whose nested keys are
/// selector text rather than key names.
#[cfg(feature = "native-engine")]
pub(crate) fn collect_owned_key_variant_objects(
    object: &StaticSzObject,
    out: &mut Vec<(String, u32)>,
) {
    for property in &object.properties {
        let StaticSzValue::Object(nested) = &property.value else {
            continue;
        };
        let key = property.key.as_str();
        if is_owned_non_variant_key(key) {
            out.push((property.key.clone(), property.span.start));
            continue;
        }
        // A mask slot's members are geometry. A breakpoint stem (`min` /
        // `max`) or a parametric stem holds names — the project's own
        // breakpoints, SELECTOR text (`has: { img: … }`) — which are not
        // judged, while what they hold is walked, as the runtime lane walks it.
        if mask_slot_members(key).is_none() {
            for_each_sz_object_in(key, nested, &mut |object| {
                collect_owned_key_variant_objects(object, out);
            });
        }
    }
}

/// Collect closed-key values that moved onto their group's own key, as the
/// key, the value and the offset.
///
/// `touch: 'pan-x'` is `touchPanX: 'x'` now; the lowering emits nothing for
/// it, and the diagnostic names the replacement from the key and the value. Descends wherever the lowering does,
/// parametric variants (`group`, `data`, …) included, so a moved value is
/// named in every place it can be written; a value a later key of its object
/// replaced is left out, as the runtime leaves it out.
#[cfg(feature = "native-engine")]
pub(crate) fn collect_moved_values(object: &StaticSzObject, out: &mut Vec<MovedValue>) {
    let settled = settle_global_keywords(object).skipped;
    for (index, property) in object.properties.iter().enumerate() {
        match &property.value {
            StaticSzValue::String(value) if !settled.contains(&index) => {
                // The important modifier is a class suffix, not part of the
                // value: `pan-x!` moved as `pan-x` did.
                let base = value.strip_suffix('!').unwrap_or(value);
                if moved_value(&property.key, base).is_some() {
                    out.push((property.key.clone(), base.to_string(), property.span.start));
                }
            }
            StaticSzValue::Object(nested) => {
                for_each_sz_object_in(&property.key, nested, &mut |object| {
                    collect_moved_values(object, out);
                });
            }
            _ => {}
        }
    }
}

/// The key and value a closed-key value moved to, whether it was written on
/// the key itself or on an alias of it: `touchAction: 'pan-x'` names
/// `touchPanX: 'x'`, not the `touch` key that no longer takes the value.
#[cfg(any(feature = "native-engine", test))]
pub(crate) fn moved_value(key: &str, value: &str) -> Option<(&'static str, &'static str)> {
    super::generated::tables::closed_enum_value_move(key, value)
        .or_else(|| super::generated::tables::closed_enum_value_move(key_suggestion(key)?, value))
}

/// A stand-alone key a group key written after it replaces: the key, its
/// value as text, the value's JavaScript type, the group and the offset of
/// the value.
#[cfg(feature = "native-engine")]
pub(crate) type GlobalBeforeGroup = (String, String, &'static str, &'static str, u32);

/// Collect each stand-alone key a group key written after it replaces.
///
/// Written that way by hand the keyword is dead code; it is also the shape a
/// spread override leaves, which keeps the overridden key at the place the
/// spread gave it. Descends like [`collect_moved_values`].
#[cfg(feature = "native-engine")]
pub(crate) fn collect_globals_before_groups(
    object: &StaticSzObject,
    out: &mut Vec<GlobalBeforeGroup>,
) {
    for (global, group) in settle_global_keywords(object).replaced {
        // Any literal, spelled as JavaScript's `String()` spells it, with its
        // type so the line quotes a string and writes a number or boolean
        // bare; an object there is a different mistake, which its own report
        // names.
        let (value, value_type) = match &global.value {
            // Named as the group value it is, by the dead-value pass.
            StaticSzValue::String(value)
                if is_stray_group_value(&global.key, value.strip_suffix('!').unwrap_or(value)) =>
            {
                continue;
            }
            StaticSzValue::String(value) => (value.clone(), "string"),
            StaticSzValue::Number(value) => (value.to_string(), "number"),
            StaticSzValue::Boolean(value) => (value.to_string(), "boolean"),
            StaticSzValue::Object(_) => continue,
        };
        out.push((
            global.key.clone(),
            value,
            value_type,
            group,
            global.span.start,
        ));
    }
    for property in &object.properties {
        if let StaticSzValue::Object(nested) = &property.value {
            for_each_sz_object_in(&property.key, nested, &mut |object| {
                collect_globals_before_groups(object, out);
            });
        }
    }
}

/// Call `visit` with each object under `key` that holds sz keys, as the
/// lowering reads them.
///
/// A variant's object is one. A parametric variant (`group`, `peer`, `data`,
/// `aria`, `has`, `not`, `supports`) and a breakpoint stem (`min`, `max`) hold
/// parameters, each naming an object of sz keys; a parameter is a name, never
/// an sz key, and one whose value is not an object lowers nothing. `group` and
/// `peer` take a second level where the lowering does (`has`/`data`/`aria`
/// and a named scope's states), `not` under its `supports`. `css` and `bgImg`
/// hold declaration values. Mirrors `lower_object_into`'s dispatch to
/// `lower_group_peer_variant`, `lower_not_variant`, `lower_has_variant`,
/// `lower_aria_variant`, `lower_bracket_param_variant` and
/// `lower_breakpoint_variant`, so a collector reaches every object that
/// lowers and no parameter.
#[cfg(any(feature = "native-engine", test))]
pub(crate) fn for_each_sz_object_in(
    key: &str,
    nested: &StaticSzObject,
    visit: &mut dyn FnMut(&StaticSzObject),
) {
    match key {
        "css" | "bgImg" => {}
        "group" | "peer" => for_each_group_peer_body(nested, visit),
        "not" => {
            for (condition, body) in object_children(nested) {
                if condition == "supports" {
                    object_children(body).for_each(|(_, inner)| visit(inner));
                } else {
                    visit(body);
                }
            }
        }
        "supports" | "data" | "aria" | "has" | "min" | "max" => {
            object_children(nested).for_each(|(_, body)| visit(body));
        }
        _ => visit(nested),
    }
}

/// The sz objects of a `group` / `peer` object, as
/// `lower_group_peer_variant` lowers them: `has`/`data`/`aria` hold
/// attributes, a selector or a known variant holds the body, and any other
/// key is a scope name whose states hold the bodies, `data`/`aria` a level
/// further down.
#[cfg(any(feature = "native-engine", test))]
fn for_each_group_peer_body(object: &StaticSzObject, visit: &mut dyn FnMut(&StaticSzObject)) {
    for (key, nested) in object_children(object) {
        if matches!(key, "has" | "data" | "aria") {
            object_children(nested).for_each(|(_, body)| visit(body));
        } else if key.starts_with(['.', '#', '[', ':'])
            || is_known_variant(key)
            || is_known_variant(get_variant_prefix(key).as_ref())
        {
            visit(nested);
        } else {
            for (state, body) in object_children(nested) {
                if matches!(state, "data" | "aria") {
                    object_children(body).for_each(|(_, inner)| visit(inner));
                } else {
                    visit(body);
                }
            }
        }
    }
}

/// The keys whose `{ size, op }` object writes a shadow with its opacity
/// (`shadow-sm/50`, which scales the theme shadow's alpha). Migrate reads the
/// same list.
pub(crate) const SHADOW_SIZE_KEYS: [&str; 4] =
    ["shadow", "insetShadow", "textShadow", "dropShadow"];

/// The member a value object writes its class from, and its text: `color` on
/// any key with a utility prefix (`{ color, op }`), or `size` on a shadow key
/// (`{ size, op }`). `None` for any other object, which is sz nesting.
#[inline(never)]
fn value_member<'a>(key: &str, nested: &'a StaticSzObject) -> Option<(&'static str, &'a str)> {
    property_prefix(key)?;
    if let Some(colour) = object_string_property(nested, "color") {
        return Some(("color", colour));
    }
    if !SHADOW_SIZE_KEYS.contains(&key) {
        return None;
    }
    object_string_property(nested, "size").map(|size| ("size", size))
}

/// Whether `key: nested` is one value written as an object (`{ color, op }`,
/// `{ size, op }`), whose members are not sz keys.
#[cfg(any(feature = "native-engine", test))]
fn is_value_object(key: &str, nested: &StaticSzObject) -> bool {
    value_member(key, nested).is_some()
}

/// A moved value: key, value, offset.
#[cfg(feature = "native-engine")]
pub(crate) type MovedValue = (String, String, u32);

/// The class a closed-enum key emits for a value outside its table.
///
/// The value keeps its key's fixed part (`isolation-`, `-nums`, …) from the
/// generated `closed_enum_affix`, or goes out verbatim on the keys whose value
/// IS the class. Mirrors `bareClosedEnumClass` in the TypeScript core, so the
/// diagnostic names the class both engines emit.
pub(crate) fn bare_closed_enum_class(key: &str, value: &str) -> String {
    one_class(
        super::generated::tables::closed_enum_affix(key).map_or_else(
            || value.to_string(),
            |(prefix, suffix)| format!("{prefix}{value}{suffix}"),
        ),
    )
}

/// The group key and value whose class a stand-alone key's stray value emits:
/// `contain: 'paint'` emits `contain-paint`, the class of `{ containPaint: true }`.
/// Mirrors `siblingGroupOf` in the TypeScript core.
///
/// Returns the group key and the value to write on it; `true` for a boolean
/// group, written bare.
#[cfg(feature = "native-engine")]
pub(crate) fn sibling_group_of(key: &str, bare: &str) -> Option<(&'static str, &'static str)> {
    let groups = super::generated::tables::global_keyword_groups(key)?;
    groups.split(' ').find_map(|group| {
        let values = super::generated::tables::closed_enum_values(group).unwrap_or_default();
        values
            .split(", ")
            .find(|value| super::generated::tables::closed_enum_class(group, value) == Some(bare))
            .map(|value| (group, value))
            .or_else(|| {
                (super::generated::tables::boolean_class(group) == Some(bare))
                    .then_some((group, "true"))
            })
    })
}

/// Whether a stand-alone key's value is no value of its own but the class of
/// one of its groups: `contain: 'size'` is `{ containSize: 'size' }`.
///
/// Such a value is reported as that group's value wherever it stands, and a
/// group written after it does not make it an order mistake: layering it, as
/// the order report advises, keeps the same wrong key.
#[cfg(feature = "native-engine")]
fn is_stray_group_value(key: &str, value: &str) -> bool {
    is_dead_enum_value(key, value)
        && sibling_group_of(key, &bare_closed_enum_class(key, value)).is_some()
}

/// Whether a closed-enum key takes no such value, even as one moved away.
#[cfg(feature = "native-engine")]
fn is_dead_enum_value(key: &str, value: &str) -> bool {
    super::generated::tables::is_closed_enum_key(key)
        && super::generated::tables::closed_enum_class(key, value).is_none()
        && super::generated::tables::closed_enum_value_move(key, value).is_none()
}

/// A value no closed-enum table holds that still has no Tailwind class: the
/// values the runtime lane names beside the closed sets.
#[cfg(feature = "native-engine")]
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub(crate) enum UnclassedValue {
    /// A CSS longhand on an alignment key, with the short form to write; its
    /// class is still emitted, and generates no CSS.
    CssValue(&'static str),
    /// A `fontStyle` other than `italic` and `normal`; nothing is emitted.
    FontStyle,
    /// A `fontSmoothing` other than `grayscale` and `subpixel`; nothing is
    /// emitted.
    FontSmoothing,
}

/// Which [`UnclassedValue`] a key's value is, if any. The font modes mirror
/// the lowering's own match on them.
#[cfg(feature = "native-engine")]
pub(crate) fn unclassed_value(key: &str, value: &str) -> Option<UnclassedValue> {
    match key {
        "fontStyle" => (!matches!(value, "italic" | "normal")).then_some(UnclassedValue::FontStyle),
        "fontSmoothing" => {
            (!matches!(value, "grayscale" | "subpixel")).then_some(UnclassedValue::FontSmoothing)
        }
        _ if super::generated::tables::is_alignment_key(key) => {
            super::generated::tables::alignment_css_value_hint(value).map(UnclassedValue::CssValue)
        }
        _ => None,
    }
}

/// Collect closed-enum keys whose value is not in their set, for the diagnostic.
///
/// `display`, `position`, `visibility` and `isolation` spell their value as the
/// bare Tailwind utility, so an unrecognised one is emitted verbatim as an
/// unprefixed class name — the shape a project's own component CSS is made
/// of, which makes the typo a possible collision rather than a plain dead
/// class. Descends like the lowering does, so a value nested under a variant
/// is reported too. The important modifier is split off first, as
/// `format_static_class` does: `flex!` is a legal value with a legal suffix.
///
/// A number or a string on a key that takes only a boolean (`truncate: 2`) is
/// collected here too, as written (`2`, `'yes'`): the same walk, and the same
/// diagnostic under its `flag` form. The lowering still writes the class
/// (`truncate-2`): a project's own `@utility` may serve it.
#[cfg(feature = "native-engine")]
pub(crate) fn collect_dead_enum_values(
    object: &StaticSzObject,
    out: &mut Vec<(String, String, u32)>,
) {
    // A value its object settles away is not lowered, so it is not named
    // either, as the runtime does not name it.
    let settlement = settle_global_keywords(object);
    for (index, property) in object.properties.iter().enumerate() {
        match &property.value {
            StaticSzValue::String(value) => {
                let base = value.strip_suffix('!').unwrap_or(value);
                // A stray group value a later group replaced is still named,
                // since it is that value, not its place, that is wrong.
                let named = !settlement.skipped.contains(&index)
                    || (settlement
                        .replaced
                        .iter()
                        .any(|(replaced, _)| std::ptr::eq(*replaced, property))
                        && is_stray_group_value(&property.key, base));
                // A value in the brackets csszyx writes is named once, by
                // `bracketed-value`, as the runtime names it.
                if named
                    && bracket_spelling(&property.key, value).is_none()
                    && (is_dead_enum_value(&property.key, base)
                        || unclassed_value(&property.key, base).is_some())
                {
                    out.push((property.key.clone(), base.to_string(), property.span.start));
                } else if super::generated::tables::is_flag_only(&property.key)
                    && bracket_spelling(&property.key, value).is_none()
                {
                    // A numeric string is reported as the number it is read as.
                    out.push((
                        property.key.clone(),
                        numeric_string_value(&property.key, &property.value)
                            .map_or_else(|| format!("'{base}'"), format_number_literal),
                        property.span.start,
                    ));
                }
            }
            StaticSzValue::Number(value)
                if super::generated::tables::is_flag_only(&property.key) =>
            {
                out.push((
                    property.key.clone(),
                    format_number_literal(*value),
                    property.span.start,
                ));
            }
            StaticSzValue::Object(nested) if !is_value_object(&property.key, nested) => {
                for_each_sz_object_in(&property.key, nested, &mut |object| {
                    collect_dead_enum_values(object, out);
                });
            }
            _ => {}
        }
    }
}

/// The first `/` outside brackets and parentheses.
///
/// `rgb(0_0_0/50%)/20` splits at its last slash. Linear in the text's length.
/// `csszyx migrate` reads a class's modifier with it, and the engine a colour
/// value's slash opacity.
#[cfg(any(feature = "native-engine", feature = "migrate"))]
pub fn find_top_level_slash(text: &str) -> Option<usize> {
    let mut depth = 0_i32;
    for (index, byte) in text.bytes().enumerate() {
        match byte {
            b'[' | b'(' => depth += 1,
            b']' | b')' => depth -= 1,
            b'/' if depth == 0 => return Some(index),
            _ => {}
        }
    }
    None
}

/// Whether a background value, its `-` taken off, names a Tailwind gradient
/// utility: `linear-to-r`, `radial`, `conic-180`, `gradient-to-b`.
fn is_background_gradient(normalized: &str) -> bool {
    normalized.starts_with("linear-")
        || normalized.starts_with("radial")
        || normalized.starts_with("conic")
        || normalized.starts_with("gradient-to-")
}

/// The colour and the opacity of a colour value that carries a slash opacity:
/// the first `/` outside brackets and parentheses, so `#f00/50`,
/// `rgb(255 0 0)/50` and `[#f00]/50` split and `rgb(255_0_0/50%)` does not. A
/// bare fraction or a numeric ratio is a sizing value, and a gradient's slash
/// names its interpolation (`linear-to-r/oklch`). Mirrors `slashOpacitySplit`
/// in `transform-core.ts`; linear in the value's length.
#[cfg(feature = "native-engine")]
pub(crate) fn slash_opacity_split(value: &str) -> Option<(&str, &str)> {
    if is_bare_fraction(value) || is_decimal_ratio(value) {
        return None;
    }
    let at = find_top_level_slash(value)?;
    let (color, opacity) = (&value[..at], &value[at + 1..]);
    let gradient = is_background_gradient(color.strip_prefix('-').unwrap_or(color));
    (!color.is_empty() && !opacity.is_empty() && !gradient).then_some((color, opacity))
}

/// The `op` an opacity modifier names.
#[cfg(any(feature = "native-engine", feature = "migrate"))]
#[derive(Debug, Clone, Copy, PartialEq)]
pub enum ModifierOp<'a> {
    /// A percent: `50`, or `[0.5]` read as 50.
    Number(f64),
    /// A string `op`: `[50%]` as `50%`, `(--o)` as `--o`.
    Text(&'a str),
}

/// Digits with at most one point, read as a number: `50`, `0.5`, `.5`.
#[cfg(any(feature = "native-engine", feature = "migrate"))]
fn plain_decimal(text: &str) -> Option<f64> {
    let digits = text
        .bytes()
        .all(|byte| byte.is_ascii_digit() || byte == b'.');
    let points = text.bytes().filter(|&byte| byte == b'.').count();
    if digits && points <= 1 {
        text.parse().ok()
    } else {
        None
    }
}

/// The `op` an opacity modifier names, as Tailwind reads the modifier.
///
/// `50` is 50, `[50%]` is `'50%'`, `[0.5]` is a fraction of one, 50, and `(--o)` is
/// `'--o'`. `None` for a modifier no `op` writes, such as `[2]`, which is
/// 200%. `csszyx migrate` reads a class's modifier with it, and a slash
/// report's help names the `op` to write. Mirrors `modifierOp`.
#[cfg(any(feature = "native-engine", feature = "migrate"))]
pub fn modifier_op(modifier: &str) -> Option<ModifierOp<'_>> {
    let inner = |open: char, close: char| {
        (modifier.len() >= 2 && modifier.starts_with(open) && modifier.ends_with(close))
            .then(|| &modifier[1..modifier.len() - 1])
    };
    if let Some(variable) = inner('(', ')') {
        return Some(ModifierOp::Text(variable));
    }
    let Some(bracketed) = inner('[', ']') else {
        return plain_decimal(modifier).map(ModifierOp::Number);
    };
    if bracketed.contains('%') {
        return Some(ModifierOp::Text(bracketed));
    }
    // Rounded so `0.05` reads 5, not 5.000000000000001.
    plain_decimal(bracketed)
        .filter(|fraction| *fraction <= 1.0)
        .map(|fraction| ModifierOp::Number((fraction * 100.0 * 1e9).round() / 1e9))
}

/// The `op` literal a slash report's help writes for an opacity: what
/// [`modifier_op`] reads, a number bare and a string quoted, or the opacity
/// as written, quoted, when no `op` names it. Mirrors `opLiteral`.
#[cfg(feature = "native-engine")]
pub(crate) fn op_literal(opacity: &str) -> String {
    match modifier_op(opacity) {
        Some(ModifierOp::Number(number)) => format_number_literal(number),
        Some(ModifierOp::Text(text)) => format!("'{text}'"),
        None => format!("'{opacity}'"),
    }
}

/// A colour or shadow key holding a slash opacity in a string: key, the
/// object member the value goes in, the value before the slash, opacity,
/// whether the important modifier ends it, offset.
#[cfg(feature = "native-engine")]
pub(crate) type SlashOpacityString = (String, &'static str, String, String, bool, u32);

/// The member of the object that replaces `value/op` on `key`: `size` for a
/// shadow on a shadow key (a size keyword, a bracket, a variable, which
/// Tailwind reads as the shadow itself), `color` for anything else.
#[cfg(feature = "native-engine")]
fn slash_member(shadow_key: bool, value: &str) -> &'static str {
    if shadow_key
        && (super::generated::migrate_tables::shadow_size_keywords(value)
            || value.starts_with(['[', '('])
            || value.starts_with("--"))
    {
        "size"
    } else {
        "color"
    }
}

/// Collect each colour key whose string carries a slash opacity. The class
/// is written as given (ADR 0036); the object form is the one spelling of an
/// opacity (ADR 0037 §8). The important modifier is split off first. Descends
/// through variants and parametric variants like the lowering, and skips a
/// colour object, whose `color` member is a value rather than a key.
#[cfg(feature = "native-engine")]
pub(crate) fn collect_slash_opacity_strings(
    object: &StaticSzObject,
    out: &mut Vec<SlashOpacityString>,
) {
    for property in &object.properties {
        match &property.value {
            // A value the bracket lane claims is that lane's to report.
            StaticSzValue::String(value) => {
                let shadow_key = SHADOW_SIZE_KEYS.contains(&property.key.as_str());
                if !(shadow_key || super::generated::tables::is_color_property(&property.key))
                    || bracket_spelling(&property.key, value).is_some()
                {
                    continue;
                }
                let base = value.strip_suffix('!');
                if let Some((color, opacity)) = slash_opacity_split(base.unwrap_or(value)) {
                    out.push((
                        property.key.clone(),
                        slash_member(shadow_key, color),
                        color.to_owned(),
                        opacity.to_owned(),
                        base.is_some(),
                        property.span.start,
                    ));
                }
            }
            StaticSzValue::Object(nested) if !is_value_object(&property.key, nested) => {
                for_each_sz_object_in(&property.key, nested, &mut |object| {
                    collect_slash_opacity_strings(object, out);
                });
            }
            _ => {}
        }
    }
}

/// A colour object whose `color` carries a slash opacity: key, `color` as
/// written, `op` as written when given, offset.
#[cfg(feature = "native-engine")]
pub(crate) type ColorSlashOpacity = (String, String, Option<String>, u32);

/// Collect the colour objects whose `color` carries a slash opacity
/// (`color-slash-opacity`). `color` is written as given; the finding points at
/// `op`, the one spelling. Descends like [`collect_slash_opacity_strings`].
#[cfg(feature = "native-engine")]
pub(crate) fn collect_color_slash_opacities(
    object: &StaticSzObject,
    out: &mut Vec<ColorSlashOpacity>,
) {
    for property in &object.properties {
        let StaticSzValue::Object(nested) = &property.value else {
            continue;
        };
        match object_string_property(nested, "color") {
            Some(color) if property_prefix(&property.key).is_some() => {
                if slash_opacity_split(split_important(color).0).is_some() {
                    let op = nested
                        .properties
                        .iter()
                        .find(|prop| prop.key == "op")
                        .and_then(|prop| match &prop.value {
                            StaticSzValue::Number(value) => Some(format_number_literal(*value)),
                            StaticSzValue::String(value) => Some(format!("'{value}'")),
                            _ => None,
                        });
                    out.push((
                        property.key.clone(),
                        color.to_string(),
                        op,
                        property.span.start,
                    ));
                }
            }
            _ => for_each_sz_object_in(&property.key, nested, &mut |object| {
                collect_color_slash_opacities(object, out);
            }),
        }
    }
}

/// Legal members of one mask slot, minus the linear sides.
///
/// `maskLinear` also accepts every entry in `MASK_SIDES`, reported by the
/// second field so the side vocabulary is named once in this file rather than
/// re-spelled per use. Mirrors the TypeScript `MASK_SLOT_MEMBERS` table;
/// anything else emits nothing at lowering.
#[cfg(any(feature = "native-engine", test))]
fn mask_slot_members(slot: &str) -> Option<(&'static [&'static str], bool)> {
    match slot {
        "maskLinear" => Some((&["angle", "from", "to"], true)),
        "maskConic" => Some((&["angle", "from", "to"], false)),
        "maskRadial" => Some((&["at", "size", "shape", "from", "to"], false)),
        _ => None,
    }
}

/// Whether one member name is legal in a slot with these base members.
#[cfg(feature = "native-engine")]
fn is_mask_slot_member(name: &str, base: &[&str], accepts_sides: bool) -> bool {
    base.contains(&name) || (accepts_sides && MASK_SIDES.contains(&name))
}

/// Render the legal member list a diagnostic names, in the table's order.
///
/// Only runs when a member is already known to be wrong, so the allocation
/// stays off the path every correct mask slot takes.
#[cfg(feature = "native-engine")]
fn mask_slot_member_list(base: &[&str], accepts_sides: bool) -> Vec<String> {
    let mut names: Vec<String> = base.iter().map(|name| (*name).to_string()).collect();
    if accepts_sides {
        names.extend(MASK_SIDES.iter().map(|side| (*side).to_string()));
    }
    names
}

/// Legal members of one linear edge object. Mirrors `MASK_EDGE_MEMBERS`.
#[cfg(feature = "native-engine")]
const MASK_EDGE_MEMBERS: [&str; 2] = ["from", "to"];

/// Collect mask-slot members the builders do not recognise.
///
/// An unknown member inside a slot emits NOTHING — worse than an unknown
/// top-level key, which at least leaves a dead class in the DOM to find. The
/// slot shapes are closed, so member NAMES are fully checkable (values stay
/// unvalidated, matching the prefix-mapping design). Descends through variant
/// nesting like the lowering does.
#[cfg(feature = "native-engine")]
pub(crate) fn collect_unknown_mask_slot_members(
    object: &StaticSzObject,
    out: &mut Vec<(String, String, Vec<String>, u32)>,
) {
    for property in &object.properties {
        let StaticSzValue::Object(nested) = &property.value else {
            continue;
        };
        let Some((base, accepts_sides)) = mask_slot_members(&property.key) else {
            collect_unknown_mask_slot_members(nested, out);
            continue;
        };
        for entry in &nested.properties {
            if !is_mask_slot_member(&entry.key, base, accepts_sides) {
                out.push((
                    property.key.clone(),
                    entry.key.clone(),
                    mask_slot_member_list(base, accepts_sides),
                    entry.span.start,
                ));
                continue;
            }
            if !accepts_sides || !MASK_SIDES.contains(&entry.key.as_str()) {
                continue;
            }
            let StaticSzValue::Object(edge) = &entry.value else {
                continue;
            };
            for edge_entry in &edge.properties {
                if !MASK_EDGE_MEMBERS.contains(&edge_entry.key.as_str()) {
                    out.push((
                        format!("{}.{}", property.key, entry.key),
                        edge_entry.key.clone(),
                        MASK_EDGE_MEMBERS
                            .iter()
                            .map(|member| (*member).to_string())
                            .collect(),
                        edge_entry.span.start,
                    ));
                }
            }
        }
    }
}

/// Collect colour-object members the lowering does not read.
///
/// A colour object (`{ color, op }`) writes one class from those two; any other
/// member writes nothing, so `ring: { width: 2, color }` lost the width
/// without a word. Reported as the field a structured value does not take, as
/// a mask slot's stray member is. Descends like the lowering does.
#[cfg(feature = "native-engine")]
pub(crate) fn collect_unknown_color_object_members(
    object: &StaticSzObject,
    out: &mut Vec<(String, String, Vec<String>, u32)>,
) {
    for property in &object.properties {
        let StaticSzValue::Object(nested) = &property.value else {
            continue;
        };
        // In the lowering's order: a mask slot (its stops hold `color` beside
        // `at`, and `collect_unknown_mask_slot_members` checks them), `css`
        // and `bgImg` are read before a colour object is.
        if mask_slot_members(&property.key).is_some()
            || matches!(property.key.as_str(), "css" | "bgImg")
        {
            continue;
        }
        // A value object reads its value member and `op`. Mirrors
        // `valueObjectClass` in `transform-core.ts`.
        let Some((member, _)) = value_member(&property.key, nested) else {
            for_each_sz_object_in(&property.key, nested, &mut |object| {
                collect_unknown_color_object_members(object, out);
            });
            continue;
        };
        for entry in &nested.properties {
            if entry.key != member && entry.key != "op" {
                out.push((
                    property.key.clone(),
                    entry.key.clone(),
                    vec![member.to_string(), "op".to_string()],
                    entry.span.start,
                ));
            }
        }
    }
}

/// `{ color, op }` form. The lowering falls through to variant handling and
/// emits classes like `p:bg-red-500` — `p:` matches no Tailwind variant, so
/// the styles silently generate no CSS. Reports the first nested keys so the
/// diagnostic can echo the stray shape; descends like the lowering does.
#[cfg(feature = "native-engine")]
pub(crate) fn collect_property_object_values(
    object: &StaticSzObject,
    out: &mut Vec<(String, Vec<String>, u32)>,
) {
    for property in &object.properties {
        let StaticSzValue::Object(nested) = &property.value else {
            continue;
        };
        // The `{ color, op }` object form on a property key is the documented
        // color-opacity spelling.
        if is_value_object(&property.key, nested) {
            continue;
        }
        // Parametric/scope variants and object-shaped value keys take nested
        // objects legitimately; a parametric variant's bodies are walked.
        if matches!(
            property.key.as_str(),
            "css" | "bgImg" | "supports" | "data" | "not" | "aria" | "has" | "group" | "peer"
        ) {
            for_each_sz_object_in(&property.key, nested, &mut |object| {
                collect_property_object_values(object, out);
            });
            continue;
        }
        if property_prefix(&property.key).is_some()
            && !super::generated::tables::is_known_variant(&property.key)
        {
            let nested_keys = nested
                .properties
                .iter()
                .take(3)
                .map(|p| p.key.clone())
                .collect::<Vec<_>>();
            out.push((property.key.clone(), nested_keys, property.span.start));
            continue;
        }
        collect_property_object_values(nested, out);
    }
}

/// Per-side border keys — the ones whose Tailwind prefix extends `border-`.
///
/// CSS gives every one of these a border-style of its own; Tailwind gives none
/// of them one, and spells the style at the root only.
const BORDER_SIDE_KEYS: [&str; 10] = [
    "borderT", "borderR", "borderB", "borderL", "borderX", "borderY", "borderS", "borderE",
    "borderBs", "borderBe",
];

/// The border-style keywords Tailwind spells, at the root only.
const BORDER_STYLE_VALUES: [&str; 6] = ["solid", "dashed", "dotted", "double", "hidden", "none"];

/// Whether a value on a per-side border key names a style Tailwind cannot
/// spell per side.
///
/// `border: 'none'` works and `borderB: 'none'` did not, which is what made it
/// a trap rather than a gap — the author generalises from the spelling that
/// does. Measured against the pinned Tailwind, all six style keywords are dead
/// on all ten side keys, while widths, colours and theme tokens resolve on
/// every one of them, so the refusal is exactly this pairing and no wider.
///
/// There is nothing to lower it to — Tailwind has no per-side border-style
/// utility at all — so the class is dropped rather than translated, like every
/// other class this build cannot back with CSS.
pub(crate) fn is_border_side_style_value(key: &str, value: &str) -> bool {
    BORDER_SIDE_KEYS.contains(&key) && BORDER_STYLE_VALUES.contains(&value)
}

/// Collect per-side border keys carrying a style keyword, for the diagnostic.
///
/// Same descent rules as `collect_dead_spacing_steps`: variant nesting is
/// walked, parameter namespaces are not.
#[cfg(feature = "native-engine")]
pub(crate) fn collect_border_side_styles(
    object: &StaticSzObject,
    out: &mut Vec<(String, String, u32)>,
) {
    for property in &object.properties {
        match &property.value {
            StaticSzValue::String(value) => {
                if is_border_side_style_value(&property.key, value) {
                    out.push((property.key.clone(), value.clone(), property.span.start));
                }
            }
            StaticSzValue::Object(nested) if !is_value_object(&property.key, nested) => {
                for_each_sz_object_in(&property.key, nested, &mut |object| {
                    collect_border_side_styles(object, out);
                });
            }
            StaticSzValue::Object(_) | StaticSzValue::Number(_) | StaticSzValue::Boolean(_) => {}
        }
    }
}

/// Whether a bare numeric value on a spacing-scale key has no Tailwind class.
#[cfg(feature = "native-engine")]
fn is_dead_spacing_step(key: &str, value: f64) -> bool {
    (value * 4.0).fract() != 0.0
        && matches!(
            super::parser::dynamic_css_var_category(key),
            super::ir::DynamicCssVarCategory::Spacing
        )
}

fn merge_text_size_and_leading(mut classes: Vec<String>) -> Vec<String> {
    let consumed = fuse_text_size_and_leading(&mut classes);
    if consumed.is_empty() {
        return classes;
    }
    classes
        .into_iter()
        .zip(consumed)
        .filter_map(|(class_name, consumed)| (!consumed).then_some(class_name))
        .collect()
}

/// Fold each leading class into the text size of the same variant, in place,
/// and say which leading classes were folded so the caller drops them.
fn fuse_text_size_and_leading(classes: &mut [String]) -> Vec<bool> {
    // Empty until a pair fuses: almost no object holds one, and the caller
    // reads a missing entry as not consumed.
    let mut consumed: Vec<bool> = Vec::new();

    for text_index in 0..classes.len() {
        let Some((text_prefix, text_size)) = text_size_class_parts(&classes[text_index]) else {
            continue;
        };
        for leading_index in 0..classes.len() {
            // The text class itself never reads as a leading one.
            if consumed.get(leading_index).copied().unwrap_or(false) {
                continue;
            }
            let Some((leading_prefix, leading_value)) =
                leading_class_parts(&classes[leading_index])
            else {
                continue;
            };
            if text_prefix != leading_prefix {
                continue;
            }
            classes[text_index] = format!("{text_prefix}text-{text_size}/{leading_value}");
            if consumed.is_empty() {
                consumed = vec![false; classes.len()];
            }
            consumed[leading_index] = true;
            break;
        }
    }
    consumed
}

fn text_size_class_parts(class_name: &str) -> Option<(&str, &str)> {
    let (prefix, base) = split_variant_prefix(class_name);
    let size = base.strip_prefix("text-")?;
    let known_size = matches!(
        size,
        "xs" | "sm"
            | "base"
            | "lg"
            | "xl"
            | "2xl"
            | "3xl"
            | "4xl"
            | "5xl"
            | "6xl"
            | "7xl"
            | "8xl"
            | "9xl"
    ) || size
        .strip_prefix('[')
        .and_then(|inner| inner.strip_suffix(']'))
        .is_some_and(is_font_size_value)
        || (size.starts_with('(') && size.ends_with(')'));
    known_size.then_some((prefix, size))
}

/// Whether an arbitrary `text-[…]` value is a font size for certain, so a
/// leading class can fold into it: a digit or a point first, or a length
/// function. A `length:` hint never reaches here, since the variant prefix is
/// cut at the last `:`. `text-[#f00]` is a colour to Tailwind, and
/// `text-[#f00]/6` would be that colour at 6% opacity with no line-height.
/// Mirrors `TEXT_SIZE_BASE_RE` in `transform-core.ts`.
fn is_font_size_value(inner: &str) -> bool {
    inner.starts_with(|c: char| c.is_ascii_digit() || c == '.')
        || ["calc(", "clamp(", "min(", "max("]
            .iter()
            .any(|function| inner.starts_with(function))
}

fn leading_class_parts(class_name: &str) -> Option<(&str, &str)> {
    let (prefix, base) = split_variant_prefix(class_name);
    Some((prefix, base.strip_prefix("leading-")?))
}

fn split_variant_prefix(class_name: &str) -> (&str, &str) {
    class_name
        .rfind(':')
        .map_or(("", class_name), |index| class_name.split_at(index + 1))
}

/// What the stand-alone keywords of one object level settle. Mirrors
/// `keysShadowedByGlobalKeywords` in the TypeScript core.
///
/// The object's own order decides: a global keyword resets each group written
/// before it, and the groups written after it combine and replace it. The two
/// are never emitted together, so the result does not hang on Tailwind's sort,
/// which puts the stand-alone class after its groups whatever the order written.
///
/// A `.jsx` object may repeat a key, and JavaScript keeps the FIRST place and
/// the LAST value; the settlement reads a repeated key of a family the same way
/// and leaves its earlier occurrences out.
pub(crate) struct GlobalKeywordSettlement<'a> {
    /// Indices of the properties to leave out of the lowering.
    pub(crate) skipped: Vec<usize>,
    /// Each stand-alone key a later group replaces — the property holding its
    /// value — with the first such group.
    pub(crate) replaced: Vec<(&'a StaticSzProperty, &'static str)>,
}

/// Settle the stand-alone keywords of one object level; see
/// [`GlobalKeywordSettlement`].
pub(crate) fn settle_global_keywords(object: &StaticSzObject) -> GlobalKeywordSettlement<'_> {
    settle_global_keyword_properties(&object.properties)
}

/// [`settle_global_keywords`] over one level's properties, for a caller that
/// holds them outside an object.
pub(crate) fn settle_global_keyword_properties(
    properties: &[StaticSzProperty],
) -> GlobalKeywordSettlement<'_> {
    let mut settlement = GlobalKeywordSettlement {
        skipped: Vec::new(),
        replaced: Vec::new(),
    };
    // Runs on every object level; almost none holds a stand-alone keyword, so
    // answer those without allocating.
    if !properties
        .iter()
        .any(|property| super::generated::tables::global_keyword_groups(&property.key).is_some())
    {
        return settlement;
    }
    // Where JavaScript places a key (its first occurrence) and the property
    // that holds its value (its last).
    let first = |key: &str| properties.iter().position(|property| property.key == key);
    let last = |key: &str| properties.iter().rposition(|property| property.key == key);
    let active = |index: usize| !matches!(properties[index].value, StaticSzValue::Boolean(false));
    for (index, property) in properties.iter().enumerate() {
        let family = super::generated::tables::global_keyword_groups(&property.key).is_some()
            || super::generated::tables::global_keyword_for_group(&property.key).is_some();
        if family && last(&property.key) != Some(index) {
            settlement.skipped.push(index);
        }
    }
    for (index, global) in properties.iter().enumerate() {
        let Some(groups) = super::generated::tables::global_keyword_groups(&global.key) else {
            continue;
        };
        if first(&global.key) != Some(index) {
            continue;
        }
        let value_at = last(&global.key).unwrap_or(index);
        if !active(value_at) {
            continue;
        }
        // A group is written before the global when its first place lies in
        // the properties before the global's own; a group present and not
        // written before is written after, as the two are different keys.
        let before = &properties[..index];
        let members: Vec<(&'static str, usize, usize, bool)> = groups
            .split(' ')
            .filter_map(|group| {
                let earlier = before.iter().any(|property| property.key == group);
                Some((group, first(group)?, last(group)?, earlier))
            })
            .collect();
        let later = members
            .iter()
            .filter(|(_, _, value, earlier)| !*earlier && active(*value))
            .min_by_key(|(_, at, ..)| *at);
        if let Some((group, ..)) = later {
            settlement.skipped.push(value_at);
            settlement.replaced.push((&properties[value_at], group));
        }
        for (_, _, value, earlier) in &members {
            if later.is_none() || *earlier {
                settlement.skipped.push(*value);
            }
        }
    }
    settlement
}

fn lower_object_into(object: &StaticSzObject, prefix: &str, classes: &mut Vec<String>) {
    lower_object_into_marked(object, prefix, classes, &mut |_, _| {});
}

/// [`lower_object_into`], calling `mark` with each lowered property's index
/// and the class count before it, so a caller can tell which property each
/// class came from.
fn lower_object_into_marked(
    object: &StaticSzObject,
    prefix: &str,
    classes: &mut Vec<String>,
    mark: &mut dyn FnMut(usize, usize),
) {
    let settled = settle_global_keywords(object).skipped;
    for (index, property) in object.properties.iter().enumerate() {
        if is_removed_sz_key(&property.key) || settled.contains(&index) {
            continue;
        }
        mark(index, classes.len());
        // A style keyword on a per-side border key has no Tailwind utility
        // behind it, so emitting the class would leave the element naming a
        // rule nothing generates. `collect_border_side_styles` reports it.
        if let StaticSzValue::String(value) = &property.value {
            // A value in the brackets csszyx writes itself writes its class
            // or nothing; the engine names it (`collect_bracketed_values`).
            if lower_bracketed_value(property, value, prefix, classes)
                || is_border_side_style_value(&property.key, value)
            {
                continue;
            }
        }
        match &property.value {
            StaticSzValue::Object(nested) => {
                if property.key == "css" {
                    lower_css_properties(nested, prefix, classes);
                    continue;
                }

                if property.key == "bgImg" {
                    if let Some(class_name) = format_bg_img_object(nested, prefix) {
                        classes.push(class_name);
                    }
                    continue;
                }

                if matches!(
                    property.key.as_str(),
                    "maskLinear" | "maskRadial" | "maskConic"
                ) {
                    for utility in build_mask_slot_classes(&property.key, nested) {
                        classes.push(format!("{prefix}{utility}"));
                    }
                    continue;
                }

                // Color-with-opacity object — { bg: { color: 'blue-500', op: 20 } }
                // → bg-blue-500/20. Distinguished from variant nesting by a
                // `color` member on a key that maps to a color utility, matching
                // the JavaScript transform it replaced; without this it lowered as a nested
                // variant into broken classes like `bg:text-white` / `bg:op-20`.
                if value_member(&property.key, nested).is_some() {
                    if let Some(class_name) = format_value_object(&property.key, nested, prefix) {
                        classes.push(class_name);
                    }
                    continue;
                }

                // Parametric / scope variants combine with `-` and bracket their
                // parameter rather than chaining a plain `:` like simple variants
                // do, matching the JavaScript transform it replaced.
                match property.key.as_str() {
                    "min" | "max" => {
                        lower_breakpoint_variant(nested, prefix, &property.key, classes);
                        continue;
                    }
                    key if key.starts_with('@') => {
                        lower_container_query_variant(key, nested, prefix, classes);
                        continue;
                    }
                    "supports" => {
                        lower_bracket_param_variant(nested, prefix, "supports", classes);
                        continue;
                    }
                    "data" => {
                        lower_bracket_param_variant(nested, prefix, "data", classes);
                        continue;
                    }
                    "not" => {
                        lower_not_variant(nested, prefix, classes);
                        continue;
                    }
                    "aria" => {
                        lower_aria_variant(nested, prefix, classes);
                        continue;
                    }
                    "has" => {
                        lower_has_variant(nested, prefix, classes);
                        continue;
                    }
                    "group" => {
                        lower_group_peer_variant("group", nested, prefix, classes);
                        continue;
                    }
                    "peer" => {
                        lower_group_peer_variant("peer", nested, prefix, classes);
                        continue;
                    }
                    _ => {}
                }

                let variant = object_variant_segment(&property.key);
                let mut next_prefix = String::with_capacity(prefix.len() + variant.len() + 1);
                next_prefix.push_str(prefix);
                next_prefix.push_str(&variant);
                next_prefix.push(':');
                lower_object_into(nested, &next_prefix, classes);
            }
            value => {
                if let Some(class_name) = format_static_class(&property.key, value, prefix) {
                    classes.push(class_name);
                }
            }
        }
    }
}

/// The value of a CSS declaration, as an arbitrary-value class carries it.
///
/// Read by the two spellings that lower to `[property:value]` — the `css:`
/// sub-prop and a custom property written as a key — so one object answers the
/// same whichever the author chose.
///
/// Numbers keep their sign, unlike the ones in a utility class: a utility
/// carries its minus in the class prefix (`-mt-4`), and a declaration inside
/// brackets has no prefix to carry it, so an absolute value turned
/// `{ css: { zIndex: -1 } }` into `[z-index:1]` — the opposite rule, with
/// nothing said. A boolean or an object is not a declaration value and has
/// no class, which is the TypeScript rule for the `css:` spelling.
fn declaration_value(value: &StaticSzValue) -> Option<String> {
    match value {
        StaticSzValue::String(text) => Some(text.clone()),
        StaticSzValue::Number(number) => Some(format_number_literal(*number)),
        StaticSzValue::Boolean(_) | StaticSzValue::Object(_) => None,
    }
}

/// The right-hand side of `[prop:value]`, with the spaces a class cannot carry
/// turned into underscores. Unlike a utility value it keeps its outer
/// brackets: nobody pre-wraps a declaration value, and `[a] 1fr [b]` is a grid
/// line name Tailwind reads as written.
fn normalize_declaration_value(value: &str) -> String {
    value.split_whitespace().collect::<Vec<_>>().join("_")
}

fn lower_css_properties(object: &StaticSzObject, prefix: &str, classes: &mut Vec<String>) {
    for property in &object.properties {
        let Some(value) = declaration_value(&property.value) else {
            continue;
        };
        // A custom property is case-sensitive; a CSS property name is not.
        let key = if property.key.starts_with("--") {
            property.key.clone()
        } else {
            kebab_case(&property.key)
        };
        classes.push(format!(
            "{prefix}[{key}:{}]",
            normalize_declaration_value(&value)
        ));
    }
}

/// Lowers a parametric bracket variant such as `supports`/`data`:
/// `{ supports: { 'display:grid': {...} } }` → `supports-[display:grid]:…`,
/// `{ data: { active: {...} } }` → `data-[active]:…`.
fn lower_bracket_param_variant(
    object: &StaticSzObject,
    prefix: &str,
    name: &str,
    classes: &mut Vec<String>,
) {
    for property in &object.properties {
        if let StaticSzValue::Object(body) = &property.value {
            let next_prefix = format!("{prefix}{name}-[{}]:", property.key);
            lower_object_into(body, &next_prefix, classes);
        }
    }
}

/// Lowers a `min`/`max` breakpoint variant: the breakpoint joins its stem with
/// a dash as one variant segment ([`breakpoint_segment`]). Without this arm the
/// two stems fell through to the plain-variant path and came out as
/// `min:330px:…` — three variants Tailwind does not have.
fn lower_breakpoint_variant(
    object: &StaticSzObject,
    prefix: &str,
    kind: &str,
    classes: &mut Vec<String>,
) {
    for property in &object.properties {
        let StaticSzValue::Object(body) = &property.value else {
            continue;
        };
        let segment = min_max_segment(&property.key);
        lower_object_into(body, &format!("{prefix}{kind}-{segment}:"), classes);
    }
}

/// A breakpoint after `min-` or `max-`. Its name is the `--breakpoint-*` name
/// a bare variant key writes, so it is spelled as that key is: `tabletLarge`
/// → `tablet-large`. Mirrors `minMaxSegment`.
fn min_max_segment(breakpoint: &str) -> Cow<'_, str> {
    match breakpoint_segment(breakpoint) {
        Cow::Borrowed(name) if !(name.starts_with('[') && name.ends_with(']')) => {
            Cow::Owned(kebab_case(name))
        }
        segment => segment,
    }
}

/// A breakpoint after `min-`, `max-`, `@min-` or `@max-`: a name as written, so
/// a project's own (`tablet`, `sidebar`) is served, and a length bracketed as
/// on every other key (`640px` → `[640px]`). Mirrors `breakpointSegment`.
fn breakpoint_segment(breakpoint: &str) -> Cow<'_, str> {
    if (breakpoint.starts_with('[') && breakpoint.ends_with(']')) || !needs_brackets(breakpoint) {
        Cow::Borrowed(breakpoint)
    } else {
        Cow::Owned(format!("[{breakpoint}]"))
    }
}

/// Lowers a container query key (`@md`, `@min`). A query is a variant like
/// any other, so its object lowers in one pass under it (`@md:p-4`,
/// `@md:hover:`), a project's own variant name chaining on too; a named
/// container is the key Tailwind spells, `@md/sidebar`. `@min` and `@max`
/// take a container size instead (`@min-sidebar`, `@min-[475px]`). Mirrors
/// `collectContainerQueryVariants`.
fn lower_container_query_variant(
    key: &str,
    object: &StaticSzObject,
    prefix: &str,
    classes: &mut Vec<String>,
) {
    let query = object_variant_segment(key);
    if !matches!(query.as_ref(), "@min" | "@max") {
        lower_object_into(object, &format!("{prefix}{query}:"), classes);
        return;
    }
    for property in &object.properties {
        let StaticSzValue::Object(nested) = &property.value else {
            lower_single_property(property, &format!("{prefix}{query}:"), classes);
            continue;
        };
        if property_prefix(&property.key).is_some() {
            lower_single_property(property, &format!("{prefix}{query}:"), classes);
            continue;
        }
        let segment = format!("{query}-{}", breakpoint_segment(&property.key));
        lower_object_into(nested, &format!("{prefix}{segment}:"), classes);
    }
}

/// One property lowered on its own under `prefix`, as a key of its own object.
fn lower_single_property(property: &StaticSzProperty, prefix: &str, classes: &mut Vec<String>) {
    let single = StaticSzObject {
        properties: vec![property.clone()],
    };
    lower_object_into(&single, prefix, classes);
}

/// Lowers the `not` variant: `{ not: { first: {...} } }` → `not-first:…`, with a
/// nested supports condition bracketed
/// (`{ not: { supports: { 'x': {...} } } }` → `not-supports-[x]:…`).
fn lower_not_variant(object: &StaticSzObject, prefix: &str, classes: &mut Vec<String>) {
    for property in &object.properties {
        let StaticSzValue::Object(body) = &property.value else {
            continue;
        };
        if property.key == "supports" {
            for condition in &body.properties {
                if let StaticSzValue::Object(inner) = &condition.value {
                    let next_prefix = format!("{prefix}not-supports-[{}]:", condition.key);
                    lower_object_into(inner, &next_prefix, classes);
                }
            }
        } else {
            let variant = get_variant_prefix(&property.key);
            let next_prefix = format!("{prefix}not-{variant}:");
            lower_object_into(body, &next_prefix, classes);
        }
    }
}

/// Resolves a key to the variant prefix a STRING value chains onto with `:`.
///
/// A string value under a variant key is a ready-made utility to prefix
/// (`{ hover: 'translate-x-full' }` → `hover:translate-x-full`). Mirrors
/// `variantStringPrefix` in `transform-core.ts` decision for decision — the
/// two must stay in lockstep, parity-tested per shape. A positive list on
/// purpose: a typo'd property key with a string value must keep reaching the
/// unknown-property path instead of silently minting a variant.
fn variant_string_prefix(key: &str) -> Option<Cow<'_, str>> {
    if is_known_variant(key) {
        return Some(get_variant_prefix(key));
    }
    if key.starts_with('[') && key.ends_with(']') {
        // "[& > li]" → "[&>li]", matching the JS normalizeArbitraryVariant.
        return Some(Cow::Owned(
            key.chars().filter(|c| !c.is_whitespace()).collect(),
        ));
    }
    if let Some(bracket_at) = key.find("-[") {
        if bracket_at > 0 && key.ends_with(']') {
            let stem = &key[..bracket_at];
            if is_special_variant(stem) || is_known_variant(stem) || stem == "min" || stem == "max"
            {
                return Some(Cow::Borrowed(key));
            }
        }
        return None;
    }
    if let Some(dash_at) = key.find('-') {
        let stem = &key[..dash_at];
        let rest = &key[dash_at + 1..];
        // group-hover / peer-checked / not-hover: scope variants compound with
        // a KNOWN variant state. Gating on the rest excludes utilities that
        // merely start with the same stem (not-italic is font-style).
        if (stem == "group" || stem == "peer" || stem == "not") && is_known_variant(rest) {
            return Some(Cow::Borrowed(key));
        }
        // aria-checked and friends are Tailwind's built-in aria set; anything
        // outside it needs the bracket form and must not silently variant.
        if stem == "aria" && is_aria_state(rest) {
            return Some(Cow::Borrowed(key));
        }
        // Tailwind v4 accepts any bare data-* variant (attribute presence).
        if stem == "data" && !rest.is_empty() {
            return Some(Cow::Borrowed(key));
        }
    }
    None
}

/// Whether a key names a variant whatever its value holds — an sz object, a
/// class string, a conditional of them — so a value only the runtime knows
/// still lowers under the key's prefix at runtime.
///
/// A property key is never one, even where a variant shares its name: its
/// runtime value takes the css-variable lane. The parametric stems are
/// variants by name alone, since their members are parameters.
///
/// A key no table claims is one too. The variant namespace is open — a
/// project names its own with `@custom-variant` and `--breakpoint-*` in
/// `@theme`, which this engine never reads — so `tablet` is a variant to the
/// runtime lowering whenever its value is an object, and the key's own
/// `@utility` class otherwise. Either way the runtime decides, and a css
/// variable behind `tablet-(--_sz-tablet)` would hold the object.
#[cfg(feature = "native-engine")]
pub(crate) fn is_variant_key(key: &str) -> bool {
    is_unclaimed_key(key) || property_prefix(key).is_none() && chains_as_variant(key)
}

/// Whether a key is a variant by its name: one the tables know, a compound or
/// arbitrary one, a container query, or a parametric stem whose members are
/// parameters.
#[cfg(feature = "native-engine")]
fn chains_as_variant(key: &str) -> bool {
    variant_string_prefix(key).is_some()
        || key.starts_with('@')
        || matches!(
            key,
            "min" | "max" | "group" | "peer" | "has" | "not" | "data" | "aria" | "supports"
        )
}

/// Whether no table claims `key`: no property, no sz key csszyx knows. Such a
/// key holding an object is the project's own variant (`@custom-variant`,
/// `--breakpoint-*` in `@theme`, which this engine never reads), and is
/// lowered and collected exactly as a known variant is.
#[cfg(feature = "native-engine")]
pub(crate) fn is_unclaimed_key(key: &str) -> bool {
    property_prefix(key).is_none() && !is_known_sz_key(key)
}

/// Resolves a variant key to its emitted prefix (VARIANT_MAP entry or
/// kebab-case fallback), mirroring `getVariantPrefix` in `transform-core.ts`.
fn get_variant_prefix(key: &str) -> Cow<'static, str> {
    variant_prefix(key).map_or_else(|| Cow::Owned(kebab_case(key)), Cow::Borrowed)
}

/// The variant segment a key holding an object chains onto with `:`.
///
/// An arbitrary variant loses its whitespace (`[& > li]` → `[&>li]`), a
/// container query key is kept as written, and any other key is its
/// `VARIANT_MAP` entry or its kebab-case — so a project variant written in
/// camelCase (`tabletLarge`) is spelled `tablet-large:`, as the runtime
/// lowering spells it. Mirrors `collectNestedVariant` in the TypeScript core.
pub(crate) fn object_variant_segment(key: &str) -> Cow<'_, str> {
    if key.starts_with('[') && key.ends_with(']') {
        return Cow::Owned(key.chars().filter(|c| !c.is_whitespace()).collect());
    }
    if key.starts_with('@') {
        // A named container (`@maxLg/sidebar`) maps its query, not its name.
        if let Some((query, name)) = key.split_once('/') {
            if let Some(mapped) = variant_prefix(query) {
                return Cow::Owned(format!("{mapped}/{name}"));
            }
            return Cow::Borrowed(key);
        }
        return variant_prefix(key).map_or(Cow::Borrowed(key), Cow::Borrowed);
    }
    get_variant_prefix(key)
}

/// Lowers the `aria` variant: `{ aria: { checked: {...} } }` → `aria-checked:…`
/// for standard states, `{ aria: { 'busy=true': {...} } }` → `aria-[busy=true]:…`
/// otherwise.
fn lower_aria_variant(object: &StaticSzObject, prefix: &str, classes: &mut Vec<String>) {
    for property in &object.properties {
        if let StaticSzValue::Object(body) = &property.value {
            let next_prefix = if is_aria_state(&property.key) {
                format!("{prefix}aria-{}:", property.key)
            } else {
                format!("{prefix}aria-[{}]:", property.key)
            };
            lower_object_into(body, &next_prefix, classes);
        }
    }
}

/// Lowers the `has` variant: `{ has: { checked: {...} } }` → `has-[:checked]:…`
/// for states, `{ has: { img: {...} } }` → `has-[img]:…` for raw selectors.
fn lower_has_variant(object: &StaticSzObject, prefix: &str, classes: &mut Vec<String>) {
    for (selector, body) in object_children(object) {
        let next_prefix = if selector.starts_with(':') {
            format!("{prefix}has-[{selector}]:")
        } else if is_known_variant(selector) {
            format!("{prefix}has-[:{selector}]:")
        } else {
            format!("{prefix}has-[{selector}]:")
        };
        lower_object_into(body, &next_prefix, classes);
    }
}

/// Lowers the `group`/`peer` scope variants, mirroring `handleGroupPeer` in `transform-core.ts`:
/// known variants combine with `-` (group-hover), has/data/aria nest as
/// parameters, arbitrary selectors bracket, and a named scope appends `/name`.
fn lower_group_peer_variant(
    scope: &str,
    object: &StaticSzObject,
    prefix: &str,
    classes: &mut Vec<String>,
) {
    for property in &object.properties {
        let StaticSzValue::Object(nested) = &property.value else {
            continue;
        };
        let nested_key = property.key.as_str();

        match nested_key {
            "has" => {
                for selector in &nested.properties {
                    if let StaticSzValue::Object(body) = &selector.value {
                        let np = format!("{prefix}{scope}-has-[{}]:", selector.key);
                        lower_object_into(body, &np, classes);
                    }
                }
                continue;
            }
            "data" => {
                for (attribute, body) in object_children(nested) {
                    let np = format!("{prefix}{scope}-data-[{attribute}]:");
                    lower_object_into(body, &np, classes);
                }
                continue;
            }
            "aria" => {
                for (attribute, body) in object_children(nested) {
                    let np = if is_aria_state(attribute) {
                        format!("{prefix}{scope}-aria-{attribute}:")
                    } else {
                        format!("{prefix}{scope}-aria-[{attribute}]:")
                    };
                    lower_object_into(body, &np, classes);
                }
                continue;
            }
            _ => {}
        }

        if nested_key.starts_with('.')
            || nested_key.starts_with('#')
            || nested_key.starts_with('[')
            || nested_key.starts_with(':')
        {
            let np = format!("{prefix}{scope}-[{nested_key}]:");
            lower_object_into(nested, &np, classes);
            continue;
        }

        if is_known_variant(nested_key) || is_known_variant(get_variant_prefix(nested_key).as_ref())
        {
            let mapped = get_variant_prefix(nested_key);
            let np = format!("{prefix}{scope}-{mapped}:");
            lower_object_into(nested, &np, classes);
            continue;
        }

        // Named scope: { group: { name: { hover: {...} } } } → group-hover/name:
        for state in &nested.properties {
            let StaticSzValue::Object(state_body) = &state.value else {
                continue;
            };
            match state.key.as_str() {
                "data" => {
                    for (attribute, body) in object_children(state_body) {
                        let np = format!("{prefix}{scope}-data-[{attribute}]/{nested_key}:");
                        lower_object_into(body, &np, classes);
                    }
                }
                "aria" => {
                    for (attribute, body) in object_children(state_body) {
                        let aria_segment = if is_aria_state(attribute) {
                            format!("aria-{attribute}")
                        } else {
                            format!("aria-[{attribute}]")
                        };
                        let np = format!("{prefix}{scope}-{aria_segment}/{nested_key}:");
                        lower_object_into(body, &np, classes);
                    }
                }
                _ => {
                    let mapped = get_variant_prefix(&state.key);
                    let np = format!("{prefix}{scope}-{mapped}/{nested_key}:");
                    lower_object_into(state_body, &np, classes);
                }
            }
        }
    }
}

fn object_children(object: &StaticSzObject) -> impl Iterator<Item = (&str, &StaticSzObject)> {
    object
        .properties
        .iter()
        .filter_map(|property| match &property.value {
            StaticSzValue::Object(body) => Some((property.key.as_str(), body)),
            _ => None,
        })
}

fn format_static_class(key: &str, value: &StaticSzValue, prefix: &str) -> Option<String> {
    // A custom property written as a KEY is a declaration, not a utility:
    // `{ '--brand': 'navy' }` lowers to the arbitrary-property class
    // `[--brand:navy]`, the same class the `css:` spelling produces. Without
    // this the generic fallback concatenated `--brand-navy`, which Tailwind
    // generates no CSS for and which shipped with no diagnostic. It sits ahead
    // of the important split because a trailing bang belongs to the declaration
    // value here, which is where the TypeScript lowering leaves it.
    if key.starts_with("--") {
        // Booleans follow the rule of every key: `false` switches the
        // property off, `true` coerces like any scalar.
        let text = match value {
            StaticSzValue::Boolean(true) => "true".to_string(),
            StaticSzValue::Boolean(false) => return None,
            other => declaration_value(other)?,
        };
        return Some(format!(
            "{prefix}[{key}:{}]",
            normalize_declaration_value(&text)
        ));
    }
    // The important modifier belongs to the CLASS, not to the value. Every
    // decision below reads the value itself — whether it needs brackets,
    // whether it is a fraction, where a leading minus goes — and a trailing
    // `!` made a unit stop looking like one: `14px!` matched no CSS unit, so
    // `text-14px!` shipped without brackets and Tailwind has no such utility.
    // Values that bracket for another reason had the opposite problem, closing
    // the bracket after the bang (`bg-[#fff!]`). Split it off first and put it
    // back on the finished class, mirroring `handleImportant` in the
    // TypeScript core. Only a TRAILING bang is the modifier; one inside an
    // arbitrary value belongs to the value.
    if let StaticSzValue::String(text) = value {
        if let Some(base) = text.strip_suffix('!') {
            // Exactly one bang, never a loop: the TypeScript core strips one
            // and so must this, or `14px!!` would lower differently per engine.
            let without_bang = StaticSzValue::String(base.to_string());
            return format_static_class_value(key, &without_bang, prefix)
                .map(|class_name| format!("{class_name}!"));
        }
    }
    format_static_class_value(key, value, prefix)
}

/// The declaration value `animationDelay` writes, which Tailwind has no utility
/// for: a number is milliseconds, and a variable is `var()`, as `--x` reads on
/// every key (`animation-delay: --x` is no value). Mirrors
/// `animationDelayValue`.
fn animation_delay_value(value: &StaticSzValue) -> Option<String> {
    match value {
        // A negative delay starts the animation part-way through: the sign is
        // CSS, as the TypeScript core keeps it.
        StaticSzValue::Number(num) => Some(format!("{}ms", format_number_literal(*num))),
        StaticSzValue::String(text) if text.starts_with("--") && !text.contains('(') => {
            Some(format!("var({text})"))
        }
        StaticSzValue::String(text) => Some(text.clone()),
        _ => None,
    }
}

/// Lower one key/value pair, with the important modifier already accounted for.
///
/// Split from [`format_static_class`] so the bang is removed exactly once. The
/// value reaching here never carries one, which is what lets every decision
/// below read the value as written.
#[allow(clippy::too_many_lines)]
fn format_static_class_value(key: &str, value: &StaticSzValue, prefix: &str) -> Option<String> {
    if let Some(number) = factor_string_value(key, value) {
        let class_key = property_prefix(key)?;
        return Some(format!(
            "{prefix}{class_key}-[{}]",
            format_number_literal(number)
        ));
    }
    if let Some(number) = numeric_string_value(key, value) {
        return format_static_class_value(key, &StaticSzValue::Number(number), prefix);
    }
    if key == "animationDelay" {
        return animation_delay_value(value)
            .map(|delay| format!("{prefix}[animation-delay:{delay}]"));
    }

    // A purely numeric key can never be a CSS property or Tailwind utility —
    // it is almost always a numeric lookup table (`{ 50: 100 }`) swallowed by
    // extraction, and the fallback below would mint garbage classes like
    // `50-100` straight into the safelist. Emit nothing (matches the JS core).
    if property_prefix(key).is_none() && key.parse::<f64>().is_ok() {
        return None;
    }

    // Unknown keys fall back to a kebab-cased utility name (breakWord →
    // break-word) the way the JavaScript path it replaced does, instead of the raw camelCase key.
    let class_key: Cow<str> =
        property_prefix(key).map_or_else(|| Cow::Owned(kebab_case(key)), Cow::Borrowed);

    match value {
        // Removed boolean-sugar aliases (flex/absolute/italic/...): emit nothing.
        // The canonical key with a value is the only spelling now. Guarded on the
        // `true` form so the flex shorthand (`flex: 1`, handled below) is untouched.
        StaticSzValue::Boolean(true) if is_removed_boolean_sugar(key) => None,
        StaticSzValue::Boolean(true) => Some(format!(
            "{prefix}{}",
            boolean_class(key).unwrap_or_else(|| class_key.as_ref())
        )),
        StaticSzValue::Boolean(false) | StaticSzValue::Object(_) => None,
        StaticSzValue::Number(value) => {
            // Gradient color-stop positions render as a bare percent: from-50%.
            if let Some(grad) = gradient_stop_prefix(key) {
                return Some(format!("{prefix}{grad}-{}%", format_abs_number(*value)));
            }
            // The bare class is dead and the bracket sets the number written:
            // every number on `aspect`/`weight` (Tailwind spells weights by
            // name through `--font-weight-*`), a decimal where bare and
            // bracket otherwise agree (`grow-[2.5]`). ADR 0037; mirrors
            // `collectNumericProperty` in `transform-core.ts`.
            if super::generated::tables::brackets_every_number(key)
                || (super::generated::tables::brackets_bare_decimal(key) && value.fract() != 0.0)
            {
                return Some(format!(
                    "{prefix}{}-[{}]",
                    class_key.as_ref(),
                    format_number_literal(*value)
                ));
            }
            Some(format_number_class(class_key.as_ref(), *value, prefix))
        }
        StaticSzValue::String(value) => {
            // A string under a variant key is a ready-made utility to prefix.
            // Property keys and variant keys are disjoint (locked by test), so
            // checking first cannot shadow a property lowering. The JS lanes
            // previously owned this branch alone, which left the default
            // engine emitting `hover-translate-x-full` — a dash-joined class
            // Tailwind never generates (field-reported as silent dead styles).
            if let Some(variant) = variant_string_prefix(key) {
                return Some(format!("{prefix}{variant}:{value}"));
            }
            if key == "bgImg" {
                return Some(format_bg_img_string(value, prefix));
            }
            if key == "bgSize" {
                return Some(format_bg_size(value, prefix));
            }
            if key == "bgRepeat" || key == "backgroundRepeat" {
                return Some(format_bg_repeat(value, prefix));
            }
            if key == "content" {
                return Some(format_content(value, prefix));
            }
            // display / position / visibility / isolation carry their value as
            // the bare Tailwind utility (`flex`, `grid`, `absolute`, `visible`),
            // not a `display-flex` style prefix-value pair. CSS closes all four
            // value sets, so a value outside the table is a typo the build can
            // decide — and `collect_dead_enum_values` reports it. The class is
            // still emitted: the collectors do not reach a conditional branch
            // or a parametric variant, and a drop there would be a silent loss
            // where the pre-diagnostic behaviour at least left the typo in the
            // DOM to find.
            if super::generated::tables::is_closed_enum_key(key) {
                // A value that moved onto its group's own key emits nothing;
                // `collect_moved_values` names the replacement.
                if super::generated::tables::closed_enum_value_move(key, value).is_some() {
                    return None;
                }
                let utility = super::generated::tables::closed_enum_class(key, value)
                    .map_or_else(|| bare_closed_enum_class(key, value), str::to_string);
                return Some(format!("{prefix}{utility}"));
            }
            // Single-property typography utilities carry their value as a bare
            // Tailwind class (`uppercase`, `italic`, `underline`, `antialiased`),
            // mirroring the JavaScript transform it replaced. The boolean-sugar aliases were
            // removed, so these canonical string forms are the only spelling.
            // Any other value takes the generic spelling below, as the
            // TypeScript core writes it; the build's dead-class check judges it.
            if key == "textTransform" {
                match value.as_str() {
                    "none" | "normal-case" => return Some(format!("{prefix}normal-case")),
                    "uppercase" | "lowercase" | "capitalize" => {
                        return Some(format!("{prefix}{value}"))
                    }
                    _ => {}
                }
            }
            if key == "fontStyle" {
                return Some(match value.as_str() {
                    "italic" => format!("{prefix}italic"),
                    "normal" => format!("{prefix}not-italic"),
                    _ => return None,
                });
            }
            if key == "fontSmoothing" {
                return Some(match value.as_str() {
                    "grayscale" => format!("{prefix}antialiased"),
                    "subpixel" => format!("{prefix}subpixel-antialiased"),
                    _ => return None,
                });
            }
            // A line keyword is its own utility; any other value (a colour,
            // `wavy`, a thickness, `inherit`) is a `decoration-*` value and
            // takes the generic lowering below, as in the TypeScript core.
            if key == "decoration" {
                match value.as_str() {
                    "none" => return Some(format!("{prefix}no-underline")),
                    "underline" | "overline" | "line-through" | "no-underline" => {
                        return Some(format!("{prefix}{value}"));
                    }
                    _ => {}
                }
            }
            // listStyleType: standard keywords stay bare (list-disc), CSS vars use
            // the paren form, everything else is arbitrary (list-[upper-roman]).
            // The keywords are `LIST_STYLE_STANDARD`'s, generated.
            if key == "list" || key == "listStyle" {
                return Some(if value.starts_with("--") {
                    format!("{prefix}list-({value})")
                } else if super::generated::tables::is_list_style_keyword(value) {
                    format!("{prefix}list-{value}")
                } else {
                    format!("{prefix}list-[{value}]")
                });
            }
            // alignContent maps onto Tailwind's content-* utilities (content-center,
            // content-between). Kept distinct from the `content` CSS property above.
            if key == "alignContent" {
                return Some(format!("{prefix}content-{value}"));
            }
            // `ring: 'none'` reads like CSS, but Tailwind spells the zero ring
            // `ring-0` — `ring-none` styles nothing.
            if key == "ring" && value == "none" {
                return Some(format!("{prefix}ring-0"));
            }
            // Tailwind's font-features utility is functional-only: bare
            // `font-features-normal` styles nothing while
            // `font-features-[normal]` compiles.
            if key == "fontFeatures" && value == "normal" {
                return Some(format!("{prefix}font-features-[normal]"));
            }
            // Only these two mask keys take the value as the suffix verbatim.
            // The rest need a formatter: Tailwind renames some keywords and
            // moves arbitrary values under a longer prefix, so a blanket
            // `mask-{value}` emitted names it does not serve.
            if key == "maskComposite" {
                return Some(format!("{prefix}mask-{value}"));
            }
            if key == "maskType" {
                return Some(format!("{prefix}mask-type-{value}"));
            }
            // The gradient LAYERS moved to maskLinear/maskRadial/maskConic, which
            // own the `--tw-mask-<layer>` variables. `mask` now carries only a
            // direct mask-image, so a layer value emits nothing here.
            if key == "mask" && is_mask_layer_value(value) {
                return None;
            }
            if key == "maskSize" {
                return Some(format!("{prefix}{}", format_mask_size(value)));
            }
            if key == "maskPos" {
                return Some(format!("{prefix}{}", format_mask_position(value)));
            }
            if key == "maskMode" {
                // Tailwind shortens `match-source` to `mask-match`.
                return Some(if value == "match-source" {
                    format!("{prefix}mask-match")
                } else {
                    format!("{prefix}mask-{value}")
                });
            }
            if key == "maskClip" {
                // Every box keyword takes `mask-clip-` EXCEPT `no-clip`.
                return Some(if value == "no-clip" {
                    format!("{prefix}mask-no-clip")
                } else {
                    format!("{prefix}mask-clip-{value}")
                });
            }
            if key == "maskRepeat" {
                return Some(match value.as_str() {
                    "repeat" => format!("{prefix}mask-repeat"),
                    "no-repeat" => format!("{prefix}mask-no-repeat"),
                    // space/round keep the `mask-repeat-` prefix.
                    "space" | "round" => format!("{prefix}mask-repeat-{value}"),
                    _ => format!("{prefix}mask-{value}"),
                });
            }
            // scroll-snap direct maps: the sub-axis is dropped (snap-mandatory,
            // snap-center, which the generic spelling below already writes),
            // except snap-align-none which keeps the axis. Any other value
            // takes the generic spelling, as the TypeScript core writes it, for
            // the build's dead-class check to judge.
            if key == "snapAlign" && value == "none" {
                return Some(format!("{prefix}snap-align-none"));
            }
            if key == "snapStrictness" {
                return match value.as_str() {
                    "mandatory" => Some(format!("{prefix}snap-mandatory")),
                    "proximity" => Some(format!("{prefix}snap-proximity")),
                    _ => None,
                };
            }
            if key == "snapStop" && matches!(value.as_str(), "normal" | "always") {
                return Some(format!("{prefix}snap-{value}"));
            }
            if key == "snapType" && matches!(value.as_str(), "none" | "x" | "y" | "both") {
                return Some(format!("{prefix}snap-{value}"));
            }
            // Named container: { '@container': 'sidebar' } → @container/sidebar.
            if key == "@container" {
                return Some(format!("{prefix}@container/{value}"));
            }
            // Named scope markers: { group: 'item' } → group/item, mirroring
            // the `collectUnresolvedStringProperty` branch in `transform-core.ts`.
            if key == "group" || key == "peer" {
                return Some(format!("{prefix}{key}/{value}"));
            }
            // Gradient color-stop positions reuse the from/via/to prefix. CSS vars
            // use the paren form, bare integer percents stay bare, the rest bracket.
            if let Some(grad) = gradient_stop_prefix(key) {
                return Some(typed_variable_value(key, value).map_or_else(
                    || {
                        if is_integer_percent(value) {
                            format!("{prefix}{grad}-{value}")
                        } else {
                            format!("{prefix}{grad}-[{value}]")
                        }
                    },
                    |typed| format!("{prefix}{grad}-{typed}"),
                ));
            }
            // font-stretch: named keywords keep the font-stretch- prefix,
            // integer percents stay bare (font-stretch-50%), decimals bracket.
            if key == "fontStretch" {
                return Some(format!("{prefix}{}", format_font_stretch(value)));
            }
            // will-change: the four keywords stay bare, anything else names
            // properties and brackets (`will-change-[opacity]`, which Tailwind
            // serves where `will-change-opacity` is no class). Mirrors
            // `formatWillChange` in `transform-core.ts`.
            if key == "willChange" {
                return Some(format!("{prefix}{}", format_will_change(value)));
            }
            // Filter functions take a unit-bearing numeric whose string form is
            // always arbitrary (brightness-[1.25]); scale takes two keywords.
            if matches!(
                key,
                "brightness"
                    | "contrast"
                    | "saturate"
                    | "scale"
                    | "backdropBrightness"
                    | "backdropContrast"
                    | "backdropSaturate"
            ) {
                // The two keywords `scale` serves by name; any other value is
                // a number. Mirrors `formatArbitraryEffect` in the TypeScript core.
                if key == "scale" && matches!(value.as_str(), "3d" | "none") {
                    return Some(format!("{prefix}scale-{value}"));
                }
                return Some(if value.starts_with("--") {
                    format!("{prefix}{class_key}-({value})")
                } else if let Some(unsigned) =
                    value.strip_prefix('-').filter(|rest| rest.starts_with('('))
                {
                    // A signed custom property hoists its sign, as on every
                    // other key: `-scale-(--v)`, never `scale-[-(--v)]`.
                    format!("{prefix}-{class_key}-{unsigned}")
                } else {
                    format!("{prefix}{class_key}-[{value}]")
                });
            }
            // Composite/function values (origin, ease, animate, filter, drop-shadow)
            // are arbitrary whenever they carry a function, underscore, percent, or a
            // unit/space that needs brackets.
            if matches!(
                key,
                "origin" | "ease" | "animate" | "filter" | "backdropFilter" | "dropShadow"
            ) && (needs_brackets(value)
                || value.contains('(')
                || value.contains('_')
                || value.contains('%'))
            {
                return Some(format!(
                    "{prefix}{class_key}-[{}]",
                    normalize_arbitrary_value(value)
                ));
            }
            // perspective-origin: named keywords stay bare, the rest are arbitrary
            // (perspective-origin-[25%_25%]).
            if key == "perspectiveOrigin" {
                return Some(
                    if matches!(
                        value.as_str(),
                        "center"
                            | "top"
                            | "right"
                            | "bottom"
                            | "left"
                            | "top-left"
                            | "top-right"
                            | "bottom-left"
                            | "bottom-right"
                    ) {
                        format!("{prefix}perspective-origin-{value}")
                    } else if value.starts_with("--") {
                        format!("{prefix}perspective-origin-({value})")
                    } else {
                        format!(
                            "{prefix}perspective-origin-[{}]",
                            normalize_arbitrary_value(value)
                        )
                    },
                );
            }
            // transformStyle: 'flat' | '3d' → transform-flat, transform-3d.
            if key == "transformStyle" {
                return Some(format!("{prefix}transform-{value}"));
            }

            // Bare numeric fractions (1/2, 3/4) are sizing values, not the
            // `color/op` slash strings the guard below suppresses. Fraction-
            // friendly properties keep them native (w-1/2, basis-1/3). A spacing
            // key with no fraction utilities writes the class a Tailwind author
            // would (`p-1/2`, no CSS, reported as `off-scale-value`): its bracket
            // `p-[1/2]` was `padding: 1/2`, which the browser drops. Any other
            // key brackets it (`row-[1/3]` is `grid-row: 1/3`). Mirrors
            // `normalizeRatioValue` in `transform-core.ts`.
            if is_bare_fraction(value) {
                return Some(
                    if super::generated::tables::is_fraction_supported_prop(key)
                        || is_spacing_fraction(key, value)
                    {
                        format!("{prefix}{class_key}-{value}")
                    } else {
                        format!("{prefix}{class_key}-[{value}]")
                    },
                );
            }

            // A CSS-wide keyword is valid CSS on every property, but Tailwind
            // serves it by name on only a few prefixes (`text-inherit`). On a
            // key whose arbitrary form sets its own property it takes the
            // bracket (`p-[inherit]`); elsewhere the bracket would set a
            // different property or an invalid value, so the class is left for
            // the build to report. The capability table says which keys take
            // it: a spelling convention from the Tailwind this repo pins, gated
            // across Tailwind versions in this repo's CI, never a verdict on
            // whether a class is served. Mirrors `normalizeGenericStringValue`
            // in the TypeScript core.
            if super::generated::tables::is_css_wide_keyword(value)
                && !super::generated::tables::is_css_wide_keyword_utility(&format!(
                    "{class_key}-{value}"
                ))
                && super::generated::tables::sz_capabilities(key)
                    & super::generated::tables::SZ_CAP_CSS_WIDE_BRACKET
                    != 0
            {
                return Some(format!("{prefix}{class_key}-[{value}]"));
            }

            if let Some(typed) = typed_variable_value(key, value) {
                return Some(format!("{prefix}{class_key}-{typed}"));
            }

            if is_tailwind_build_function(value) {
                return Some(format!(
                    "{prefix}{class_key}-[{}]",
                    normalize_arbitrary_value(value)
                ));
            }

            // `--spacing(4)` calls a function; `--v,calc(1px)` is a custom
            // property with a fallback, written `(--v,calc(1px))` below.
            if is_dashed_function_call(value) {
                return Some(format!(
                    "{prefix}{class_key}-[{}]",
                    normalize_arbitrary_value(value)
                ));
            }

            if value.starts_with("--") {
                return Some(format!("{prefix}{class_key}-({value})"));
            }

            // Bracket the whole value (sign included) when it needs arbitrary
            // syntax, then hoist a surviving leading `-` to the utility prefix.
            // A negative length stays inside the bracket (top-[-1px]); a bare
            // negative fraction hoists (-inset-1/2), mirroring
            // `buildGenericStringClass` in `transform-core.ts`.
            let final_value = if key == "aspect" && is_decimal_ratio(value) {
                format!("[{value}]")
            } else if needs_brackets(value)
                // A grid line name (`[a]_1fr`) or tracks spelled with `_`
                // (`1fr_2fr`): no bare class carries either.
                || (crate::transform::generated::tables::takes_grid_line_names(key) && is_grid_track_list(value))
            {
                // Tailwind arbitrary values cannot contain raw spaces (the class
                // attribute would split into separate tokens), so collapse
                // whitespace to underscores, matching the JavaScript transform it replaced.
                format!("[{}]", normalize_arbitrary_value(value))
            } else {
                value.clone()
            };

            Some(final_value.strip_prefix('-').map_or_else(
                || format!("{prefix}{class_key}-{final_value}"),
                |stripped| format!("{prefix}-{class_key}-{stripped}"),
            ))
        }
    }
}

/// Maps a gradient color-stop position key to its Tailwind prefix
/// (`fromPos` → `from`, `viaPos` → `via`, `toPos` → `to`).
pub(crate) fn gradient_stop_prefix(key: &str) -> Option<&'static str> {
    match key {
        "fromPos" => Some("from"),
        "viaPos" => Some("via"),
        "toPos" => Some("to"),
        _ => None,
    }
}

/// Matches a bare integer percentage such as `50%` (the `^\d+%$` form).
pub(crate) fn is_integer_percent(value: &str) -> bool {
    value
        .strip_suffix('%')
        .is_some_and(|n| !n.is_empty() && n.bytes().all(|b| b.is_ascii_digit()))
}

/// Matches a percentage with an optional decimal part such as `50%` or `12.5%`.
fn is_percent(value: &str) -> bool {
    let Some(num) = value.strip_suffix('%') else {
        return false;
    };
    let mut parts = num.split('.');
    match (parts.next(), parts.next(), parts.next()) {
        (Some(int), None, None) => !int.is_empty() && int.bytes().all(|b| b.is_ascii_digit()),
        (Some(int), Some(frac), None) => {
            !int.is_empty()
                && !frac.is_empty()
                && int.bytes().all(|b| b.is_ascii_digit())
                && frac.bytes().all(|b| b.is_ascii_digit())
        }
        _ => false,
    }
}

/// Lowers `fontStretch` to its bare Tailwind class (caller prepends the variant
/// prefix): named keywords keep the `font-stretch-` prefix, integer
/// percents stay bare (`font-stretch-50%`), decimals and other values arbitrary.
pub(crate) fn format_font_stretch(value: &str) -> String {
    const KEYWORDS: &[&str] = &[
        "ultra-condensed",
        "extra-condensed",
        "condensed",
        "semi-condensed",
        "normal",
        "semi-expanded",
        "expanded",
        "extra-expanded",
        "ultra-expanded",
    ];
    if KEYWORDS.contains(&value) {
        format!("font-stretch-{value}")
    } else if value.starts_with("--") {
        format!("font-stretch-({value})")
    } else if is_percent(value) {
        if value.contains('.') {
            format!("font-stretch-[{value}]")
        } else {
            format!("font-stretch-{value}")
        }
    } else {
        format!("font-stretch-[{value}]")
    }
}

/// A variable value on a key that takes a type hint, spelled with it.
///
/// Tailwind infers no type from a custom property, so `bg-(--v)` and
/// `bg-[var(--v)]` are background colours and `border-(--v)` a border colour.
/// A bare `--v` becomes `(hint:--v)` and a `var(…)` becomes
/// `[hint:var(…)]`; a key without a hint, or any other value, is left
/// to the key's own lowering. The hints are the generated `CSS_VAR_TYPE_HINTS`.
/// Mirrors `typedVariableValue` in the TypeScript core.
fn typed_variable_value(key: &str, value: &str) -> Option<String> {
    let hint = css_var_type_hint(key)?;
    if value.starts_with("--") && !value.contains('(') {
        return Some(format!("({hint}:{value})"));
    }
    value
        .starts_with("var(")
        .then(|| format!("[{hint}:{}]", normalize_arbitrary_value(value)))
}

/// Sides of the linear mask slot; each writes its own `--tw-mask-<side>`.
const MASK_SIDES: [&str; 6] = ["t", "r", "b", "l", "x", "y"];

/// Render one gradient stop. Position and colour live in DIFFERENT custom
/// properties, so a stop carrying both emits two utilities. A bare CSS variable
/// reads as a POSITION; a variable meant as a colour needs the `(color:--x)`
/// hint. Mirrors the TypeScript `buildMaskStopClasses`.
fn build_mask_stop_classes(base: &str, value: Option<&StaticSzValue>) -> Vec<String> {
    let Some(value) = value else {
        return Vec::new();
    };
    match value {
        StaticSzValue::Number(number) => vec![format!("{base}-{}", format_abs_number(*number))],
        StaticSzValue::String(text) if text.starts_with("--") => vec![format!("{base}-({text})")],
        StaticSzValue::String(text) => vec![format!("{base}-{text}")],
        StaticSzValue::Object(object) => {
            let mut out = Vec::new();
            if let Some(at) = object.properties.iter().find(|prop| prop.key == "at") {
                let rendered = match &at.value {
                    StaticSzValue::Number(number) => {
                        format!("{base}-{}", format_abs_number(*number))
                    }
                    StaticSzValue::String(text) if text.starts_with("--") => {
                        format!("{base}-({text})")
                    }
                    StaticSzValue::String(text) => format!("{base}-{text}"),
                    StaticSzValue::Boolean(_) | StaticSzValue::Object(_) => String::new(),
                };
                if !rendered.is_empty() {
                    out.push(rendered);
                }
            }
            if let Some(colour) = object_string_property(object, "color") {
                let rendered = if colour.starts_with("--") {
                    format!("(color:{colour})")
                } else {
                    colour.to_string()
                };
                // Written as a colour object's `op` is; one that is no opacity
                // leaves the colour alone (`collect_invalid_opacities`).
                let opacity = object
                    .properties
                    .iter()
                    .find(|prop| prop.key == "op")
                    .and_then(|prop| format_opacity_value(&prop.value))
                    .map_or_else(String::new, |op| format!("/{op}"));
                out.push(format!("{base}-{rendered}{opacity}"));
            }
            out
        }
        StaticSzValue::Boolean(_) => Vec::new(),
    }
}

/// Build the radial slot. `at`, `size` and `shape` each write their own
/// `--tw-mask-radial-*` variable, so they compose with the stops.
fn build_mask_radial_classes(object: &StaticSzObject) -> Vec<String> {
    let mut out = Vec::new();
    if let Some(at) = object_string_property(object, "at") {
        out.push(format!("mask-radial-at-{at}"));
    }
    if let Some(size) = object_string_property(object, "size") {
        out.push(format!("mask-radial-{size}"));
    }
    if let Some(shape) = object_string_property(object, "shape") {
        if matches!(shape, "circle" | "ellipse") {
            out.push(format!("mask-{shape}"));
        }
    }
    let find = |name: &str| {
        object
            .properties
            .iter()
            .find(|p| p.key == name)
            .map(|p| &p.value)
    };
    out.extend(build_mask_stop_classes("mask-radial-from", find("from")));
    out.extend(build_mask_stop_classes("mask-radial-to", find("to")));
    out
}

/// Build every utility for one mask slot. Mirrors `buildMaskSlotClasses`.
fn build_mask_slot_classes(slot_key: &str, object: &StaticSzObject) -> Vec<String> {
    if slot_key == "maskRadial" {
        return build_mask_radial_classes(object);
    }
    let family = if slot_key == "maskConic" {
        "conic"
    } else {
        "linear"
    };
    let mut out = Vec::new();
    if let Some(angle) = object.properties.iter().find(|prop| prop.key == "angle") {
        match &angle.value {
            StaticSzValue::Number(number) if *number < 0.0 => {
                out.push(format!("-mask-{family}-{}", format_abs_number(*number)));
            }
            StaticSzValue::Number(number) => {
                out.push(format!("mask-{family}-{}", format_abs_number(*number)));
            }
            StaticSzValue::String(text) if text.starts_with("--") => {
                out.push(format!("mask-{family}-({text})"));
            }
            StaticSzValue::String(text) => out.push(format!("mask-{family}-{text}")),
            _ => {}
        }
    }
    let find = |name: &str| {
        object
            .properties
            .iter()
            .find(|p| p.key == name)
            .map(|p| &p.value)
    };
    out.extend(build_mask_stop_classes(
        &format!("mask-{family}-from"),
        find("from"),
    ));
    out.extend(build_mask_stop_classes(
        &format!("mask-{family}-to"),
        find("to"),
    ));
    if family == "linear" {
        for side in MASK_SIDES {
            let Some(StaticSzValue::Object(edge)) = find(side) else {
                continue;
            };
            let edge_find = |name: &str| {
                edge.properties
                    .iter()
                    .find(|p| p.key == name)
                    .map(|p| &p.value)
            };
            out.extend(build_mask_stop_classes(
                &format!("mask-{side}-from"),
                edge_find("from"),
            ));
            out.extend(build_mask_stop_classes(
                &format!("mask-{side}-to"),
                edge_find("to"),
            ));
        }
    }
    out
}

/// Whether a `mask` value names a gradient LAYER rather than an image. Mirrors
/// the TypeScript `isMaskLayerValue`.
fn is_mask_layer_value(value: &str) -> bool {
    mask_layer_key(value).is_some()
}

/// The key a `mask` gradient-layer value moved to (`linear-45` →
/// `maskLinear`), or `None` for a mask image.
fn mask_layer_key(value: &str) -> Option<&'static str> {
    // A CSS function is an arbitrary mask-image, not a layer name:
    // `linear-gradient(…)` shares the `linear-` opening but compiles to
    // `mask-[linear-gradient(…)]` and must keep working.
    if value.contains('(') {
        return None;
    }
    let bare = value.strip_prefix('-').unwrap_or(value);
    [
        ("linear", "maskLinear"),
        ("radial", "maskRadial"),
        ("conic", "maskConic"),
    ]
    .into_iter()
    .find(|(family, _)| {
        bare.strip_prefix(family)
            .is_some_and(|rest| rest.is_empty() || rest.starts_with('-'))
    })
    .map(|(_, key)| key)
}

/// Collect `mask` values that name a gradient layer, as the value (without a
/// trailing `!`), the key the layer moved to, and the offset.
///
/// The lowering emits nothing for one, so the drop is missing output (ADR
/// 0011) and the runtime channel names the same value. Descends like
/// [`collect_moved_values`].
#[cfg(feature = "native-engine")]
pub(crate) fn collect_mask_layer_values(
    object: &StaticSzObject,
    out: &mut Vec<(String, &'static str, u32)>,
) {
    let settled = settle_global_keywords(object).skipped;
    for (index, property) in object.properties.iter().enumerate() {
        match &property.value {
            StaticSzValue::String(value) if property.key == "mask" && !settled.contains(&index) => {
                let base = value.strip_suffix('!').unwrap_or(value);
                if let Some(key) = mask_layer_key(base) {
                    out.push((base.to_string(), key, property.span.start));
                }
            }
            StaticSzValue::Object(nested) => {
                for_each_sz_object_in(&property.key, nested, &mut |object| {
                    collect_mask_layer_values(object, out);
                });
            }
            _ => {}
        }
    }
}

/// Bare `mask-<keyword>` positions; anything else is an arbitrary position.
const MASK_POSITION_KEYWORDS: [&str; 9] = [
    "center",
    "top",
    "bottom",
    "left",
    "right",
    "top-left",
    "top-right",
    "bottom-left",
    "bottom-right",
];

/// Formats a mask-size value, mirroring the TypeScript `formatMaskSize`.
fn format_mask_size(value: &str) -> String {
    if matches!(value, "auto" | "cover" | "contain") {
        return format!("mask-{value}");
    }
    if value.starts_with("--") {
        return format!("mask-size-({value})");
    }
    format!("mask-size-[{}]", normalize_arbitrary_value(value))
}

/// Formats a mask-position value, mirroring `formatMaskPosition`.
fn format_mask_position(value: &str) -> String {
    if MASK_POSITION_KEYWORDS.contains(&value) {
        return format!("mask-{value}");
    }
    if value.starts_with("--") {
        return format!("mask-position-({value})");
    }
    format!("mask-position-[{}]", normalize_arbitrary_value(value))
}

fn format_bg_img_object(object: &StaticSzObject, prefix: &str) -> Option<String> {
    let gradient = object_string_property(object, "gradient")?;
    let mut class_name = match gradient {
        "linear" => match object.properties.iter().find(|prop| prop.key == "dir") {
            Some(prop) => match &prop.value {
                StaticSzValue::Number(value) if *value < 0.0 => {
                    format!("-bg-linear-{}", format_abs_number(*value))
                }
                StaticSzValue::Number(value) => format!("bg-linear-{}", format_abs_number(*value)),
                StaticSzValue::String(value) if value.starts_with("--") => {
                    format!("bg-linear-({value})")
                }
                StaticSzValue::String(value) if value.starts_with("to-") => {
                    format!("bg-linear-{value}")
                }
                StaticSzValue::String(value) => {
                    format!("bg-linear-[{}]", normalize_arbitrary_value(value))
                }
                _ => return None,
            },
            None => "bg-linear-to-r".to_string(),
        },
        "radial" => match object.properties.iter().find(|prop| prop.key == "dir") {
            Some(prop) => match &prop.value {
                StaticSzValue::String(value) if value.starts_with("--") => {
                    format!("bg-radial-({value})")
                }
                StaticSzValue::String(value) => {
                    format!("bg-radial-[{}]", normalize_arbitrary_value(value))
                }
                _ => return None,
            },
            None => "bg-radial".to_string(),
        },
        "conic" => match object.properties.iter().find(|prop| prop.key == "dir") {
            Some(prop) => match &prop.value {
                StaticSzValue::Number(value) if *value < 0.0 => {
                    format!("-bg-conic-{}", format_abs_number(*value))
                }
                StaticSzValue::Number(value) => format!("bg-conic-{}", format_abs_number(*value)),
                StaticSzValue::String(value) if value.starts_with("--") => {
                    format!("bg-conic-({value})")
                }
                StaticSzValue::String(value) => {
                    format!("bg-conic-[{}]", normalize_arbitrary_value(value))
                }
                _ => return None,
            },
            None => "bg-conic".to_string(),
        },
        _ => return None,
    };

    if let Some(interpolation) = object_string_property(object, "in") {
        class_name.push('/');
        class_name.push_str(interpolation);
    }

    Some(format!("{prefix}{class_name}"))
}

fn object_string_property<'a>(object: &'a StaticSzObject, key: &str) -> Option<&'a str> {
    object
        .properties
        .iter()
        .find(|prop| prop.key == key)
        .and_then(|prop| match &prop.value {
            StaticSzValue::String(value) => Some(value.as_str()),
            _ => None,
        })
}

/// A colour without its trailing important modifier, and the modifier. The
/// modifier ends the class (`bg-red-500/20!`): written before the opacity it
/// makes a class no Tailwind serves.
fn split_important(color: &str) -> (&str, &'static str) {
    color
        .strip_suffix('!')
        .map_or((color, ""), |color| (color, "!"))
}

/// The class of a value object: its `color` or `size`, then the opacity
/// `op` names and `!`. One formatter for both, so a size takes `op` exactly
/// as a colour does. Mirrors `buildValueObjectClass` in `transform-core.ts`.
fn format_value_object(key: &str, object: &StaticSzObject, prefix: &str) -> Option<String> {
    let tw_prefix = property_prefix(key)?;
    let (member, written) = value_member(key, object)?;
    let (raw, important) = split_important(written);
    let head = if member == "size" {
        size_class(key, raw, prefix)?
    } else {
        format!("{prefix}{tw_prefix}-{}", color_base(tw_prefix, raw))
    };

    let op_value = object
        .properties
        .iter()
        .find(|prop| prop.key == "op")
        .map(|prop| &prop.value);

    // An `op` that is not an opacity writes the value alone; the engine
    // reports it (`collect_invalid_opacities`).
    Some(op_value.and_then(format_opacity_value).map_or_else(
        || format!("{head}{important}"),
        |op| format!("{head}/{op}{important}"),
    ))
}

/// The one class a shadow key writes for `size` as its string value, the
/// lane a size takes when it is not in an object.
fn size_class(key: &str, size: &str, prefix: &str) -> Option<String> {
    let mut classes = Vec::new();
    lower_object_into(
        &StaticSzObject {
            properties: vec![StaticSzProperty {
                key: key.to_owned(),
                span: super::TextSpan { start: 0, end: 0 },
                value: StaticSzValue::String(size.to_owned()),
            }],
        },
        prefix,
        &mut classes,
    );
    (classes.len() == 1).then(|| classes.remove(0))
}

/// A colour as the utility after the prefix spells it. `color` is written as
/// given, a slash opacity included.
fn color_base(tw_prefix: &str, raw_color: &str) -> String {
    if is_tailwind_build_function(raw_color)
        || (raw_color.starts_with("--") && raw_color.contains('('))
    {
        format!("[{}]", normalize_arbitrary_value(raw_color))
    } else if raw_color.starts_with("--") {
        // Shadow-family prefixes parse a bare `(--var)` suffix as the shadow
        // VALUE, so a var used as a color needs the `color:` hint. Mirrors
        // `buildColorObjectClass` in the JavaScript transform it replaced.
        if matches!(
            tw_prefix,
            "shadow" | "inset-shadow" | "text-shadow" | "drop-shadow"
        ) {
            format!("(color:{raw_color})")
        } else {
            format!("({raw_color})")
        }
    } else if needs_brackets(raw_color) {
        format!("[{}]", normalize_arbitrary_value(raw_color))
    } else {
        normalize_arbitrary_value(raw_color)
    }
}

/// The modifier `op` writes, or `None` when it is not an opacity.
///
/// Tailwind reads a bracketed modifier as a fraction of one, so `/[33.3]` is
/// 3,330%: a quarter step is served bare on every Tailwind v4 (`/75.5`), and any
/// other number from 0 to 100 keeps its percent in the brackets, as a percent
/// string does (`'78%'`). A custom property is read as the opacity it holds. Mirrors `formatOpacity` in
/// `transform-core.ts`.
fn format_opacity_value(value: &StaticSzValue) -> Option<String> {
    match value {
        StaticSzValue::Number(op) if (0.0..=100.0).contains(op) => {
            Some(if (op * 4.0).fract() == 0.0 {
                format_number_literal(*op)
            } else {
                // Never an exponent inside the percent: `Display` writes
                // `0.0000001`, as `plainDecimal` in `transform-core.ts` does.
                format!("[{op}%]")
            })
        }
        StaticSzValue::String(op) if op.starts_with("--") => Some(format!("({op})")),
        StaticSzValue::String(op) if is_percent_opacity(op) => Some(format!("[{op}]")),
        _ => None,
    }
}

/// Whether `op` is a percent from 0 to 100 written as a string: `'78%'`.
fn is_percent_opacity(op: &str) -> bool {
    op.strip_suffix('%')
        .filter(|digits| is_unsigned_decimal(digits))
        .and_then(|digits| digits.parse::<f64>().ok())
        .is_some_and(|percent| percent <= 100.0)
}

/// Each colour object whose `op` is not an opacity ([`format_opacity_value`]),
/// with the key, `op` as the author wrote it, and where it is written.
#[cfg(feature = "native-engine")]
pub(crate) fn collect_invalid_opacities(object: &StaticSzObject, out: &mut Vec<InvalidOpacity>) {
    for property in &object.properties {
        let StaticSzValue::Object(nested) = &property.value else {
            continue;
        };
        if let Some((member, value)) = value_member(&property.key, nested) {
            for op in nested.properties.iter().filter(|prop| prop.key == "op") {
                push_invalid_opacity(&property.key, op, out);
                // `shadow-(--s)/50` sets the shadow's alpha, which the
                // variable's shadow uses only if it reads it.
                if member == "size"
                    && split_important(value).0.starts_with("--")
                    && format_opacity_value(&op.value).is_some()
                {
                    out.push((
                        property.key.clone(),
                        value.to_string(),
                        OpacityFinding::VariableShadow,
                        property.span.start,
                    ));
                }
            }
        } else if mask_slot_members(&property.key).is_some() {
            collect_invalid_mask_stop_opacities(nested, out);
        } else {
            for_each_sz_object_in(&property.key, nested, &mut |object| {
                collect_invalid_opacities(object, out);
            });
        }
    }
}

/// Each mask stop in a mask slot (`from`, `to`, a side's `from` / `to`) whose
/// `op` is not an opacity, named by the stop's member, as the runtime does.
#[cfg(feature = "native-engine")]
fn collect_invalid_mask_stop_opacities(slot: &StaticSzObject, out: &mut Vec<InvalidOpacity>) {
    for member in &slot.properties {
        let StaticSzValue::Object(stop) = &member.value else {
            continue;
        };
        if object_string_property(stop, "color").is_some() {
            for op in stop.properties.iter().filter(|prop| prop.key == "op") {
                push_invalid_opacity(&member.key, op, out);
            }
        } else {
            collect_invalid_mask_stop_opacities(stop, out);
        }
    }
}

/// An `op` to report: its key, the literal the author wrote, the percent to
/// write when it reads as a fraction of 1 (none when it is no opacity), and
/// where it is written.
#[cfg(feature = "native-engine")]
pub(crate) type InvalidOpacity = (String, String, OpacityFinding, u32);

/// What a finding on an `op` reports.
#[cfg(feature = "native-engine")]
#[derive(Debug, PartialEq, Eq)]
pub(crate) enum OpacityFinding {
    /// No opacity (`opacity-value`, form `range`).
    Range,
    /// A number between 0 and 1, written as this percent (form `fraction`).
    Fraction(String),
    /// A size held in a custom property, which the opacity may not reach
    /// (`variable-shadow-opacity`); the text is the size as written.
    VariableShadow,
}

/// Record `op` under `key` when it is no opacity, or a number between 0 and 1,
/// which 0.17 wrote as a fraction of 1 and which is now the percent it is.
#[cfg(feature = "native-engine")]
fn push_invalid_opacity(key: &str, op: &StaticSzProperty, out: &mut Vec<InvalidOpacity>) {
    let percent = match (&op.value, format_opacity_value(&op.value)) {
        (_, None) => OpacityFinding::Range,
        (StaticSzValue::Number(number), Some(_)) if *number > 0.0 && *number < 1.0 => {
            // `Display`, never an exponent, as `plainDecimal` writes it.
            OpacityFinding::Fraction(((number * 100.0 * 1e9).round() / 1e9).to_string())
        }
        (_, Some(_)) => return,
    };
    out.push((
        key.to_string(),
        literal_of(&op.value),
        percent,
        op.span.start,
    ));
}

/// A static value as JS source: a string quoted, a number as written.
#[cfg(feature = "native-engine")]
fn literal_of(value: &StaticSzValue) -> String {
    match value {
        StaticSzValue::String(text) => format!("'{text}'"),
        StaticSzValue::Number(number) => format_number_literal(*number),
        StaticSzValue::Boolean(flag) => flag.to_string(),
        StaticSzValue::Object(_) => "{…}".to_owned(),
    }
}

/// Whether `value` calls a dashed function (`--spacing(4)`): the name runs
/// straight into its `(`. Mirrors `isArbitraryFunctionValue`.
fn is_dashed_function_call(value: &str) -> bool {
    value.strip_prefix("--").is_some_and(|rest| {
        let name = rest.len()
            - rest
                .trim_start_matches(|c: char| c.is_ascii_alphanumeric() || c == '-' || c == '_')
                .len();
        name > 0 && rest[name..].starts_with('(')
    })
}

fn format_will_change(value: &str) -> String {
    if matches!(value, "auto" | "scroll" | "contents" | "transform") {
        format!("will-change-{value}")
    } else if value.starts_with("--") {
        format!("will-change-({value})")
    } else {
        format!("will-change-[{}]", normalize_arbitrary_value(value))
    }
}

fn format_bg_img_string(value: &str, prefix: &str) -> String {
    let value = value.trim();
    if value == "none" {
        return format!("{prefix}bg-none");
    }
    // A CSS-wide keyword is the property's value, never a URL: the `image:`
    // hint sets `background-image` to it. Mirrors `formatBackgroundImage`.
    if super::generated::tables::is_css_wide_keyword(value) {
        return format!("{prefix}bg-[image:{value}]");
    }
    if let Some(typed) = typed_variable_value("bgImg", value) {
        return format!("{prefix}bg-{typed}");
    }

    let normalized = value.strip_prefix('-').unwrap_or(value);
    if normalized.starts_with("repeating-") {
        return format!("{prefix}bg-[{}]", normalize_arbitrary_value(value));
    }
    // Any CSS function other than url() is an arbitrary image value, so it goes
    // in brackets verbatim. Gradient functions open with the same
    // `linear-`/`radial`/`conic` the KEYWORDS do; reading one as a keyword
    // produced `bg-linear-gradient(…)`, which Tailwind does not serve, and
    // letting it fall to the url() default wrapped it into a broken URL.
    if normalized.contains('(') && !normalized.starts_with("url(") {
        return format!("{prefix}bg-[{}]", normalize_arbitrary_value(value));
    }
    if is_background_gradient(normalized) {
        let mapped = normalized.replace("gradient-to-", "linear-to-");
        if value.starts_with('-') {
            return format!("{prefix}-bg-{mapped}");
        }
        return format!("{prefix}bg-{mapped}");
    }
    if value.starts_with("url(") {
        return format!("{prefix}bg-[{value}]");
    }
    format!("{prefix}bg-[url({value})]")
}

/// A background-size class. The `length:` hint inside `bg-[…]` / `bg-(…)` is
/// served on every Tailwind v4; `bg-size-*` exists from 4.1 only. Mirrors
/// `formatBackgroundSize` in the TypeScript core.
fn format_bg_size(value: &str, prefix: &str) -> String {
    match value {
        "auto" | "cover" | "contain" => format!("{prefix}bg-{value}"),
        value => typed_variable_value("bgSize", value).map_or_else(
            || format!("{prefix}bg-[length:{}]", normalize_arbitrary_value(value)),
            |typed| format!("{prefix}bg-{typed}"),
        ),
    }
}

fn format_bg_repeat(value: &str, prefix: &str) -> String {
    match value {
        "repeat" => format!("{prefix}bg-repeat"),
        "no-repeat" => format!("{prefix}bg-no-repeat"),
        value => {
            let suffix = value.strip_prefix("repeat-").unwrap_or(value);
            format!("{prefix}bg-repeat-{suffix}")
        }
    }
}

fn format_content(value: &str, prefix: &str) -> String {
    if value == "none" {
        return format!("{prefix}content-none");
    }
    if value.starts_with("--") {
        return format!("{prefix}content-({value})");
    }
    let inner = if value.starts_with('"') && value.ends_with('"') && value.len() >= 2 {
        format!("'{}'", &value[1..value.len() - 1])
    } else {
        value.to_string()
    };
    format!("{prefix}content-[{inner}]")
}

fn format_number_class(key: &str, value: f64, prefix: &str) -> String {
    let is_negative = value < 0.0;
    let final_value = format_abs_number(value);

    if is_negative {
        format!("{prefix}-{key}-{final_value}")
    } else {
        format!("{prefix}{key}-{final_value}")
    }
}

/// Render a number the way JavaScript prints it, sign kept.
///
/// The runtime lowering (`transform-core.ts`) interpolates the value straight
/// into the class string, so the engine only agrees with it by dropping the
/// `.0` that Rust's default float formatting keeps.
///
/// It prints what JavaScript's `Number.prototype.toString` prints, so a value
/// off the usual range writes one class on every lane: the shortest digits
/// that read back, an exponent below 1e-6 and from 1e21 (`1e-7`, `1e+21`),
/// `Infinity`, and `0` for `-0`.
///
/// Rust's `Display` already prints the shortest digits that read back and
/// never an exponent, which is JavaScript's form from 1e-6 up to 1e21; outside
/// that range the exponent is built from the same digits (ECMA-262
/// Number::toString). `{:e}` would do it in one call and costs 2,453 gzip
/// bytes of parser wasm for its formatting code; this reuses what `Display`
/// already links.
///
/// Cost: linear in the printed length, at most 330 bytes for an f64.
fn format_number_literal(value: f64) -> String {
    if value.is_nan() {
        return "NaN".to_owned();
    }
    if value.is_infinite() {
        return if value.is_sign_negative() {
            "-Infinity"
        } else {
            "Infinity"
        }
        .to_owned();
    }
    if value == 0.0 {
        return "0".to_owned();
    }
    let plain = value.to_string();
    let unsigned = plain.strip_prefix('-').unwrap_or(&plain);
    let (whole, fraction) = unsigned.split_once('.').unwrap_or((unsigned, ""));
    let all = format!("{whole}{fraction}");
    let leading_zeros = all.bytes().take_while(|b| *b == b'0').count();
    let digits = all[leading_zeros..].trim_end_matches('0');
    // Where the point sits relative to the first significant digit: 1 for
    // `1.5`, -6 for `0.0000001`, 22 for `1e21`.
    let point = whole.len().cast_signed() - leading_zeros.cast_signed();
    if -6 < point && point <= 21 {
        return plain;
    }
    let exponent = point - 1;
    let (first, rest) = digits.split_at(1);
    let dot = if rest.is_empty() { "" } else { "." };
    let sign = if value.is_sign_negative() { "-" } else { "" };
    let exponent_sign = if exponent >= 0 { "+" } else { "-" };
    format!(
        "{sign}{first}{dot}{rest}e{exponent_sign}{}",
        exponent.unsigned_abs()
    )
}

fn format_abs_number(value: f64) -> String {
    format_number_literal(value.abs())
}

const CSS_UNITS: &[&str] = &[
    "px", "rem", "em", "%", "vh", "vw", "ch", "dvh", "dvw", "svh", "svw", "lvh", "lvw", "cqw",
    "cqh", "deg", "rad", "turn", "grad", "ms", "s", "fr",
];

/// Matches a numeric ratio with optional decimals and an optional leading sign,
/// such as `4/2.5`, `16/9`, or `-1/2`.
pub(crate) fn is_decimal_ratio(value: &str) -> bool {
    let unsigned = value.strip_prefix('-').unwrap_or(value);
    let Some((num, den)) = unsigned.split_once('/') else {
        return false;
    };
    is_unsigned_decimal(num) && is_unsigned_decimal(den)
}

/// Whether a string spells a plain decimal: `4`, `-2`, `2.5`, `.5`.
///
/// Linear in the string's length. The same shape as `NUMERIC_STRING` in
/// `transform-core.ts`.
fn spells_decimal(text: &str) -> bool {
    let digits = text.strip_prefix('-').unwrap_or(text);
    is_unsigned_decimal(digits)
        || digits.strip_prefix('.').is_some_and(|fraction| {
            !fraction.is_empty() && fraction.bytes().all(|b| b.is_ascii_digit())
        })
}

/// The number a numeric string spells on a factor key, where the string is
/// the CSS value itself and lowers to the bracket (`opacity: '.5'` →
/// `opacity-[0.5]`) while a number keeps Tailwind's scale (ADR 0037).
/// Mirrors `collectFactorString` in `transform-core.ts`.
pub(crate) fn factor_string_value(key: &str, value: &StaticSzValue) -> Option<f64> {
    let StaticSzValue::String(text) = value else {
        return None;
    };
    if !super::generated::tables::is_factor_string_key(key) || !spells_decimal(text) {
        return None;
    }
    text.parse::<f64>().ok()
}

/// Factor strings above 1 on a key whose CSS function clamps at 1, for the
/// `clamped-factor` diagnostic: `(key, value as written, offset)`.
///
/// Same descent rules as [`collect_dead_spacing_steps`].
#[cfg(feature = "native-engine")]
pub(crate) fn collect_clamped_factors(
    object: &StaticSzObject,
    out: &mut Vec<(String, String, u32)>,
) {
    for property in &object.properties {
        match &property.value {
            StaticSzValue::String(text) => {
                let unbanged = text.strip_suffix('!').unwrap_or(text);
                let probe = StaticSzValue::String(unbanged.to_string());
                if super::generated::tables::clamps_factor_at_one(&property.key)
                    && factor_string_value(&property.key, &probe).is_some_and(|n| n > 1.0)
                {
                    out.push((
                        property.key.clone(),
                        unbanged.to_string(),
                        property.span.start,
                    ));
                }
            }
            StaticSzValue::Object(nested) if !is_value_object(&property.key, nested) => {
                for_each_sz_object_in(&property.key, nested, &mut |object| {
                    collect_clamped_factors(object, out);
                });
            }
            _ => {}
        }
    }
}

/// The number a numeric string spells, when the key reads it as one (ADR 0037):
/// `{ p: '4' }` from JSON writes what `{ p: 4 }` writes. A key whose string is
/// text or a name (`content`, `bgImg`, `group`, `peer`, `'@md'`), a closed-enum
/// key and a custom property keep the string. Mirrors `numericStringValue` in
/// `transform-core.ts`.
pub(crate) fn numeric_string_value(key: &str, value: &StaticSzValue) -> Option<f64> {
    let StaticSzValue::String(text) = value else {
        return None;
    };
    if super::generated::tables::keeps_numeric_string(key)
        || super::generated::tables::is_factor_string_key(key)
        || key.starts_with("--")
        || key.starts_with('@')
        || super::generated::tables::is_closed_enum_key(key)
    {
        return None;
    }
    spells_decimal(text)
        .then(|| text.parse::<f64>().ok())
        .flatten()
}

/// Matches a non-empty run of digits with at most one decimal point (`12`, `2.5`).
pub(crate) fn is_unsigned_decimal(value: &str) -> bool {
    let mut parts = value.split('.');
    match (parts.next(), parts.next(), parts.next()) {
        (Some(int), None, None) => !int.is_empty() && int.bytes().all(|b| b.is_ascii_digit()),
        (Some(int), Some(frac), None) => {
            !int.is_empty()
                && !frac.is_empty()
                && int.bytes().all(|b| b.is_ascii_digit())
                && frac.bytes().all(|b| b.is_ascii_digit())
        }
        _ => false,
    }
}

/// Kebab-cases a camelCase key the way `camelToKebab` in `transform-core.ts` does:
/// inserts a `-` between a lowercase/digit and an uppercase letter, then
/// lowercases (breakWord → break-word).
fn kebab_case(key: &str) -> String {
    let mut out = String::with_capacity(key.len() + 2);
    let mut prev_lower_or_digit = false;
    for ch in key.chars() {
        if ch.is_ascii_uppercase() {
            if prev_lower_or_digit {
                out.push('-');
            }
            out.push(ch.to_ascii_lowercase());
            prev_lower_or_digit = false;
        } else {
            out.push(ch.to_ascii_lowercase());
            prev_lower_or_digit = ch.is_ascii_lowercase() || ch.is_ascii_digit();
        }
    }
    out
}

/// Keys whose numbers are steps of Tailwind's spacing scale (`p`, `gap`, `w`,
/// `translateX`, …): the `Spacing` category of a runtime value, and the keys
/// `off-scale-value` speaks for. Here rather than in the parser so the lowering
/// reads it in every build.
pub(crate) fn is_spacing_scale_key(key: &str) -> bool {
    matches!(
        key,
        "p" | "pt"
            | "pr"
            | "pb"
            | "pl"
            | "px"
            | "py"
            | "ps"
            | "pe"
            | "pbs"
            | "pbe"
            | "m"
            | "mt"
            | "mr"
            | "mb"
            | "ml"
            | "mx"
            | "my"
            | "ms"
            | "me"
            | "mbs"
            | "mbe"
            | "spaceX"
            | "spaceY"
            | "gap"
            | "gapX"
            | "gapY"
            | "inset"
            | "insetX"
            | "insetY"
            | "top"
            | "right"
            | "bottom"
            | "left"
            | "start"
            | "end"
            | "insetS"
            | "insetE"
            | "insetBs"
            | "insetBe"
            | "w"
            | "minW"
            | "maxW"
            | "h"
            | "minH"
            | "maxH"
            | "size"
            | "blockSize"
            | "minBlockSize"
            | "maxBlockSize"
            | "inlineSize"
            | "minInlineSize"
            | "maxInlineSize"
            | "basis"
            | "indent"
            | "scrollM"
            | "scrollMt"
            | "scrollMr"
            | "scrollMb"
            | "scrollMl"
            | "scrollMs"
            | "scrollMe"
            | "scrollMx"
            | "scrollMy"
            | "scrollP"
            | "scrollPt"
            | "scrollPr"
            | "scrollPb"
            | "scrollPl"
            | "scrollPs"
            | "scrollPe"
            | "scrollPx"
            | "scrollPy"
            | "scrollPbs"
            | "scrollPbe"
            | "scrollMbs"
            | "scrollMbe"
            | "translateX"
            | "translateY"
            | "borderSpacing"
            | "borderSpacingX"
            | "borderSpacingY"
            | "outlineOffset"
            | "ringOffset"
            | "underlineOffset"
    )
}

/// Whether `value` is a fraction on a spacing key that has no fraction
/// utilities (`p: '1/2'`), which lowers bare and is reported. A zero
/// denominator is no share of anything and keeps the bracket.
pub(crate) fn is_spacing_fraction(key: &str, value: &str) -> bool {
    is_bare_fraction(value)
        && !super::generated::tables::is_fraction_supported_prop(key)
        && value
            .split_once('/')
            .is_some_and(|(_, denominator)| denominator.bytes().any(|b| b != b'0'))
        && is_spacing_scale_key(key)
}

/// A bare fraction as the percent it is, to four places, printed as
/// JavaScript prints it: `1/2` → `50`, `1/3` → `33.3333`. Mirrors
/// `fractionPercent` in `transform-core.ts`.
#[cfg(feature = "native-engine")]
pub(crate) fn fraction_percent(value: &str) -> String {
    let (numerator, denominator) = value.split_once('/').unwrap_or((value, "1"));
    let share = numerator.parse::<f64>().unwrap_or(0.0) / denominator.parse::<f64>().unwrap_or(1.0);
    format_number_literal((share * 100.0 * 1e4).round() / 1e4)
}

/// Fractions on spacing keys with no fraction utilities, for the
/// `off-scale-value` fraction form: `(key, value without its \`!\`, offset)`.
///
/// Same descent rules as [`collect_dead_spacing_steps`].
#[cfg(feature = "native-engine")]
pub(crate) fn collect_spacing_fractions(
    object: &StaticSzObject,
    out: &mut Vec<(String, String, u32)>,
) {
    for property in &object.properties {
        match &property.value {
            StaticSzValue::String(text) => {
                let unbanged = text.strip_suffix('!').unwrap_or(text);
                if is_spacing_fraction(&property.key, unbanged) {
                    out.push((
                        property.key.clone(),
                        unbanged.to_string(),
                        property.span.start,
                    ));
                }
            }
            StaticSzValue::Object(nested) if !is_value_object(&property.key, nested) => {
                for_each_sz_object_in(&property.key, nested, &mut |object| {
                    collect_spacing_fractions(object, out);
                });
            }
            _ => {}
        }
    }
}

/// Matches a bare numeric fraction such as `1/2` or `3/4` (the `^\d+/\d+$` form).
fn is_bare_fraction(value: &str) -> bool {
    let mut parts = value.split('/');
    match (parts.next(), parts.next(), parts.next()) {
        (Some(numerator), Some(denominator), None) => {
            !numerator.is_empty()
                && !denominator.is_empty()
                && numerator.bytes().all(|byte| byte.is_ascii_digit())
                && denominator.bytes().all(|byte| byte.is_ascii_digit())
        }
        _ => false,
    }
}

fn needs_brackets(value: &str) -> bool {
    if value.starts_with('#') || contains_css_function_call(value) || value.contains(' ') {
        return true;
    }

    if value.starts_with('.') && value.len() > 1 && value.as_bytes()[1].is_ascii_digit() {
        return true;
    }

    CSS_UNITS.iter().any(|unit| {
        value.strip_suffix(unit).is_some_and(|prefix| {
            // Tolerate a leading sign so a negative length (-1px) brackets too.
            let prefix = prefix.strip_prefix('-').unwrap_or(prefix);
            !prefix.is_empty() && prefix.chars().all(|c| c.is_ascii_digit() || c == '.')
        })
    })
}

#[inline]
/// Whether a value contains a CSS function call, which cannot appear bare in a
/// class name.
///
/// Mirrors `containsCssFunctionCall` in `transform-core.ts`, which replaced the
/// hand-kept name list both engines used to carry. The lists had drifted — this
/// one knew `oklch()`, `lab()`, `lch()` and `hwb()` and the JS one did not, and
/// neither knew `env()` — so the same value could bracket on one engine and
/// emit a dead class on another. A `(` preceded by an identifier that starts
/// with a letter is a function call, whatever its name.
///
/// Three shapes stay bare: Tailwind's `--spacing(4)`, the `(--x)` variable
/// shorthand, and a utility value ending in that shorthand — `thumb-(--c)` puts
/// a dash immediately before the paren and `--` immediately after it, which no
/// function call ever does. A single leading dash is a negative value, not a
/// build-time call, so `-linear-gradient(…)` is still a function.
fn contains_css_function_call(value: &str) -> bool {
    let bytes = value.as_bytes();
    for (at, _) in value.match_indices('(') {
        if at == 0 {
            continue;
        }
        if bytes[at - 1] == b'-' && value[at + 1..].starts_with("--") {
            continue;
        }
        let mut start = at;
        while start > 0 && is_ascii_identifier_byte(bytes[start - 1]) {
            start -= 1;
        }
        if start < at && !value[start..].starts_with("--") {
            return true;
        }
    }
    false
}

const fn is_ascii_identifier_byte(byte: u8) -> bool {
    byte.is_ascii_alphanumeric() || byte == b'_' || byte == b'-'
}

#[inline]
const fn is_ascii_identifier_start_byte(byte: u8) -> bool {
    byte.is_ascii_alphabetic() || byte == b'_'
}

/// Distinguishes Tailwind build-time function calls (`--spacing(4)`) from CSS
/// custom-property names (`--spacing`). This byte scanner is O(n), uses no
/// auxiliary allocation, and rejects incomplete or trailing syntax.
fn is_tailwind_build_function(value: &str) -> bool {
    let bytes = value.as_bytes();
    if bytes.len() < 5 || !bytes.starts_with(b"--") {
        return false;
    }

    if !is_ascii_identifier_start_byte(bytes[2]) {
        return false;
    }

    let mut index = 3;
    while index < bytes.len() && is_ascii_identifier_byte(bytes[index]) {
        index += 1;
    }
    if index == 2 || index >= bytes.len() || bytes[index] != b'(' {
        return false;
    }

    let mut depth = 0_usize;
    let mut quote = 0_u8;
    let mut escaped = false;
    while index < bytes.len() {
        let byte = bytes[index];
        if escaped {
            escaped = false;
        } else if byte == b'\\' {
            escaped = true;
        } else if quote != 0 {
            if byte == quote {
                quote = 0;
            }
        } else if byte == b'\'' || byte == b'"' {
            quote = byte;
        } else if byte == b'(' {
            depth += 1;
        } else if byte == b')' {
            depth -= 1;
            if depth == 0 {
                return index == bytes.len() - 1;
            }
        }
        index += 1;
    }

    false
}

pub(crate) fn normalize_arbitrary_value(value: &str) -> String {
    value.split_whitespace().collect::<Vec<_>>().join("_")
}

/// The variable a value wraps in the parentheses csszyx writes for it
/// (`(--brand)`), or `None`. A function's own parentheses (`--spacing(4)`) and
/// two variables (`(--a) (--b)`) are no such wrapping.
fn paren_variable(value: &str) -> Option<&str> {
    let inner = value.strip_prefix('(')?.strip_suffix(')')?;
    (inner.starts_with("--") && !inner.contains(['(', ')'])).then_some(inner)
}

/// The `bracketed-value` form of a value in brackets that writes nothing.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub(crate) enum BracketDrop {
    /// A shape the brackets cannot carry; `inner` is what to write.
    Unwrap,
    /// Brackets that do not wrap the value as one pair.
    Escape,
}

/// What a value in brackets is (ADR 0037 §2). Mirrors `BracketSpelling` in
/// `transform-core.ts`.
#[derive(Debug, Clone, PartialEq, Eq)]
pub(crate) enum BracketSpelling {
    /// A second spelling of an arbitrary class: `class` is `key-[…]` without
    /// its variant prefix, written when the key's own lowering of `inner`
    /// writes a class that is not arbitrary; `inner` is the value without its
    /// brackets as the main lane spells it ([`main_spelling`]).
    Emit { class: String, inner: String },
    /// Nothing is written; `inner` is what to write on the main lane, or the
    /// value without its outer pair on [`BracketDrop::Escape`]; `hint` is the
    /// type hint taken off it.
    Drop {
        form: BracketDrop,
        inner: String,
        hint: Option<String>,
    },
}

/// A value as the main lane spells it: a lone `var(--x)`, with no fallback,
/// is `--x`, and a trailing `!` stays. Mirrors `mainSpelling` in
/// `transform-core.ts`.
fn main_spelling(value: &str) -> String {
    let (body, bang) = value
        .strip_suffix('!')
        .map_or((value, ""), |unmarked| (unmarked, "!"));
    body.strip_prefix("var(")
        .and_then(|rest| rest.strip_suffix(')'))
        .map(str::trim)
        .filter(|name| {
            name.strip_prefix("--").is_some_and(|ident| {
                !ident.is_empty()
                    && ident
                        .chars()
                        .all(|c| c.is_ascii_alphanumeric() || c == '_' || c == '-')
            })
        })
        .map_or_else(|| value.to_owned(), |name| format!("{name}{bang}"))
}

/// Whether a class is an arbitrary one, a value in brackets or a variable in
/// parentheses: `w-[10px]`, `bg-(image:--x)`, not `p-4`.
fn is_arbitrary_class(class: &str) -> bool {
    class.contains(['[', '('])
}

/// Whether the class a key writes for a value keeps the type hint its
/// bracketed spelling named, or needs none: `text-[13px]` for `length`, not
/// `text-(length:--x)` for `color`. Mirrors `keepsTypeHint`.
#[cfg(feature = "native-engine")]
fn keeps_type_hint(class: &str, hint: &str) -> bool {
    let Some(open) = class.find(['[', '(']) else {
        return false;
    };
    let after = &class[open + 1..];
    match after.split_once(':') {
        Some((name, _))
            if name.starts_with(|c: char| c.is_ascii_lowercase())
                && name.chars().all(|c| c.is_ascii_lowercase() || c == '-') =>
        {
            name == hint
        }
        _ => true,
    }
}

/// A bracket class with a modifier after it (`[#f00]/50`), written as given.
fn is_bracket_then_modifier(rest: &str) -> bool {
    rest.strip_prefix('[')
        .and_then(|rest| rest.split_once("]/"))
        .is_some_and(|(class, modifier)| {
            !class.is_empty()
                && !class.contains(['[', ']'])
                && !modifier.is_empty()
                && !modifier.contains(['[', ']', '/'])
        })
}

/// The classes a key writes for a value, lowered as its own one-property
/// object at the property's span.
fn lower_one_value(property: &StaticSzProperty, value: &str) -> Vec<String> {
    let plain = StaticSzObject {
        properties: vec![StaticSzProperty {
            key: property.key.clone(),
            span: property.span,
            value: StaticSzValue::String(value.to_owned()),
        }],
    };
    let mut classes = Vec::new();
    lower_object_into(&plain, "", &mut classes);
    classes
}

/// Whether a value is a type hint or a property before its value:
/// `length:13px`, `color:red`.
fn is_bracket_type_hint(inner: &str) -> bool {
    inner.split_once(':').is_some_and(|(name, _)| {
        name.starts_with(|c: char| c.is_ascii_lowercase())
            && name.chars().all(|c| c.is_ascii_lowercase() || c == '-')
    })
}

/// Whether a value is a fraction of two integers (`1/2`), no CSS value alone.
fn is_digit_fraction(inner: &str) -> bool {
    let digits = |part: &str| !part.is_empty() && part.bytes().all(|byte| byte.is_ascii_digit());
    inner
        .split_once('/')
        .is_some_and(|(top, bottom)| digits(top) && digits(bottom))
}

/// The utility a key writes an arbitrary value with, or `None` for a key that
/// has none: an alias or a removed key, which emits nothing, a key that takes
/// only a boolean, and a key whose CSS closes its value set. Mirrors
/// `arbitraryUtility` in `transform-core.ts`, whose key table also holds
/// aliases; here an alias, a removed key and a boolean-only key have no
/// prefix to begin with, so only a closed value set is asked.
fn arbitrary_utility(key: &str) -> Option<&'static str> {
    if super::generated::tables::is_closed_enum_key(key) {
        return None;
    }
    property_prefix(key)
}

/// Lower a value in brackets ([`bracket_spelling`]) as its key lowers the
/// value without them (ADR 0037 §2): an arbitrary class it writes is the
/// class, nothing is nothing, and a bare class (`p: 4` → `p-4`) leaves the
/// brackets the only spelling of `key-[…]`. Says whether it was such a value.
/// Mirrors `collectBracketedValue` in `transform-core.ts`.
fn lower_bracketed_value(
    property: &StaticSzProperty,
    value: &str,
    prefix: &str,
    classes: &mut Vec<String>,
) -> bool {
    match bracket_spelling(&property.key, value) {
        Some(BracketSpelling::Emit { class, inner }) => {
            let plain = lower_one_value(property, &inner);
            match plain.as_slice() {
                [] => {}
                [own] if is_arbitrary_class(own) => classes.push(format!("{prefix}{own}")),
                _ => classes.push(format!("{prefix}{class}")),
            }
            true
        }
        Some(BracketSpelling::Drop { .. }) => true,
        None => false,
    }
}

/// Read a value in the brackets (or the parentheses of a variable) csszyx
/// writes itself, or `None` when the value has none at either end and is
/// lowered as written. A custom property's value is a declaration value, where
/// `[a]` is a grid line name, so it never is one. On a key whose CSS takes
/// grid line names, a value whose first bracket closes before its end
/// (`[a] 1fr [b]`) names lines and lowers. Mirrors `bracketSpelling` in
/// `transform-core.ts`.
pub(crate) fn bracket_spelling(key: &str, value: &str) -> Option<BracketSpelling> {
    let drop = |form, inner: String| {
        Some(BracketSpelling::Drop {
            form,
            inner,
            hint: None,
        })
    };
    if key.starts_with("--") {
        return None;
    }
    let (body, bang) = value
        .strip_suffix('!')
        .map_or((value, ""), |unmarked| (unmarked, "!"));
    let grid = super::generated::tables::takes_grid_line_names(key) && body.contains(['[', ']']);
    // A sign is no part of a grid template, whatever its brackets.
    let pair = if grid && !body.starts_with('-') {
        outer_bracket_pair(body)
    } else {
        None
    };
    if pair == Some(false) {
        return None;
    }
    if let Some(variable) = paren_variable(body) {
        return drop(BracketDrop::Unwrap, format!("{variable}{bang}"));
    }
    let lead = if body.starts_with("-[") || body.starts_with("![") {
        &body[..1]
    } else {
        ""
    };
    let rest = &body[lead.len()..];
    let opens = rest.starts_with('[');
    let closes = rest.ends_with(']');
    if lead.is_empty() && is_bracket_then_modifier(rest) {
        return None;
    }
    // Balanced line names that do not wrap the template (`[a] 1fr`).
    if pair == Some(true) && !(opens && closes) {
        return None;
    }
    // A bracket at the end with none before it closes nothing (`10px]`).
    if !opens && (!closes || rest.contains('[')) {
        return if grid {
            drop(BracketDrop::Escape, value.to_owned())
        } else {
            None
        };
    }
    if !opens || !closes || rest.len() < 3 {
        return drop(BracketDrop::Escape, value.to_owned());
    }
    let mut inner = &rest[1..rest.len() - 1];
    // Every pair around a whole grid template at once, so one lowering of the
    // template stands for the value however deep it is wrapped; a pair with no
    // bracket inside is a line name (`[a]`) and stays.
    while pair == Some(true) && outer_bracket_pair(inner) == Some(true) {
        match inner
            .strip_prefix('[')
            .and_then(|rest| rest.strip_suffix(']'))
        {
            Some(core) if core.contains('[') => inner = core,
            _ => break,
        }
    }
    let written = format!(
        "{}{inner}{}",
        if lead == "-" { "-" } else { "" },
        if lead == "!" { "!" } else { bang }
    );
    let escape = if grid {
        pair.is_none()
    } else {
        inner.contains(['[', ']'])
    };
    if escape {
        return drop(BracketDrop::Escape, written);
    }
    if !lead.is_empty() || inner.starts_with("--") || is_digit_fraction(inner) {
        return drop(BracketDrop::Unwrap, written);
    }
    if is_bracket_type_hint(inner) {
        let colon = inner.find(':').unwrap_or_default();
        return Some(BracketSpelling::Drop {
            form: BracketDrop::Unwrap,
            inner: main_spelling(&format!("{}{bang}", &inner[colon + 1..])),
            hint: Some(inner[..colon].to_owned()),
        });
    }
    match arbitrary_utility(key) {
        None => drop(BracketDrop::Unwrap, written),
        Some(utility) => Some(BracketSpelling::Emit {
            class: format!("{utility}-[{}]{bang}", normalize_arbitrary_value(inner)),
            inner: main_spelling(&written),
        }),
    }
}

/// Whether a grid template value needs the arbitrary form: it names a grid
/// line (`[a]_1fr`), or it spells a space `_` between tracks (`1fr_2fr`,
/// `auto_1fr`). A name that only holds `_` (`main_layout`) is a theme value
/// Tailwind serves bare, so a `_` brackets only beside a track: a segment
/// that starts with a digit or `.`, holds `(` or `%`, or is a track keyword.
/// Mirrors `isGridTrackList` in `transform-core.ts`.
fn is_grid_track_list(value: &str) -> bool {
    value.contains('[')
        || (value.contains('_')
            && value.split('_').any(|segment| {
                segment.starts_with(|c: char| c.is_ascii_digit() || c == '.')
                    || segment.contains(['(', '%'])
                    || crate::transform::generated::tables::is_grid_track_keyword(segment)
            }))
}

/// Whether the first `[` of a value closes at its last `]`, so the two are one
/// pair around the whole value: `Some(true)` for `[[a]_1fr]`, `Some(false)`
/// for `[a]_1fr_[b]`, and `None` when the brackets do not balance (`[[a]`),
/// which no grid template is. Mirrors `outerBracketPair` in
/// `transform-core.ts`.
fn outer_bracket_pair(value: &str) -> Option<bool> {
    let last = value.rfind(']');
    let mut depth = 0i32;
    let mut first_closes = None;
    for (at, byte) in value.bytes().enumerate() {
        match byte {
            b'[' => depth += 1,
            b']' => {
                depth -= 1;
                if depth < 0 {
                    return None;
                }
                if depth == 0 && first_closes.is_none() {
                    first_closes = Some(Some(at) == last);
                }
            }
            _ => {}
        }
    }
    if depth == 0 {
        first_closes
    } else {
        None
    }
}

/// A string value with a bare `_`, and the arbitrary class it lowers into.
#[cfg(feature = "native-engine")]
#[derive(Debug, Clone, PartialEq, Eq)]
pub(crate) struct UnderscoreValue {
    /// The sz key, or the CSS property of a `css` declaration.
    pub key: String,
    /// The value as written.
    pub value: String,
    /// The class the value lowers into.
    pub class_name: String,
    /// Where the property is written.
    pub at: u32,
}

/// Whether `value` holds an `_` the author wrote bare: not the `\_` that
/// keeps one in Tailwind's reading. The one rule for both directions: the
/// engine's `underscore-space` fact, and the values migrate asks about.
#[cfg(any(feature = "native-engine", feature = "migrate"))]
pub(crate) fn has_bare_underscore(value: &str) -> bool {
    let bytes = value.as_bytes();
    bytes
        .iter()
        .enumerate()
        .any(|(at, byte)| *byte == b'_' && (at == 0 || bytes[at - 1] != b'\\'))
}

/// Each arbitrary class a string value with a bare `_` lowers into.
///
/// csszyx writes a space as `_`, so the class alone cannot say whether the
/// author wrote `_`. This is the fact only: whether Tailwind reads that `_` as
/// a space is asked of the project's Tailwind by the build, `csszyx check`
/// and the MCP tools (PROJECT-RULES §4), never decided here. A value lowered
/// into no bracket (a theme name) is not one: Tailwind reads it as written.
#[cfg(feature = "native-engine")]
pub(crate) fn collect_underscore_values(object: &StaticSzObject, out: &mut Vec<UnderscoreValue>) {
    for property in &object.properties {
        match &property.value {
            StaticSzValue::String(value) if has_bare_underscore(value) => {
                let single = StaticSzObject {
                    properties: vec![property.clone()],
                };
                let mut classes = Vec::new();
                lower_object_into(&single, "", &mut classes);
                for class_name in classes.into_iter().filter(|class| class.contains('[')) {
                    out.push(UnderscoreValue {
                        key: property.key.clone(),
                        value: value.clone(),
                        // As emitted: one class, its whitespace already `_`,
                        // under the prefix the project's Tailwind serves.
                        class_name: with_class_prefix(one_class(class_name)),
                        at: property.span.start,
                    });
                }
            }
            StaticSzValue::Object(nested) if property.key == "css" => {
                for declaration in &nested.properties {
                    if let StaticSzValue::String(value) = &declaration.value {
                        if has_bare_underscore(value) {
                            let single = StaticSzObject {
                                properties: vec![declaration.clone()],
                            };
                            let mut classes = Vec::new();
                            lower_css_properties(&single, "", &mut classes);
                            out.extend(classes.into_iter().map(|class_name| UnderscoreValue {
                                key: declaration.key.clone(),
                                value: value.clone(),
                                class_name: with_class_prefix(one_class(class_name)),
                                at: declaration.span.start,
                            }));
                        }
                    }
                }
            }
            StaticSzValue::Object(nested) => {
                if is_value_object(&property.key, nested) {
                    collect_color_underscore(&property.key, nested, out);
                } else {
                    for_each_sz_object_in(&property.key, nested, &mut |object| {
                        collect_underscore_values(object, out);
                    });
                }
            }
            _ => {}
        }
    }
}

/// A colour object's `color` with a bare `_`, at that member, naming the
/// class the object is emitted as (`bg-[oklch(0.5_0.1_10)]/50`). Its members
/// are not sz keys, so it is not walked as an object.
#[cfg(feature = "native-engine")]
fn collect_color_underscore(key: &str, nested: &StaticSzObject, out: &mut Vec<UnderscoreValue>) {
    // `is_value_object` held, so `key` has a prefix and the object a string
    // `color`: the class is always written, and only a bracketed one is asked.
    let found = nested
        .properties
        .iter()
        .find_map(|member| match &member.value {
            StaticSzValue::String(value) if member.key == "color" && has_bare_underscore(value) => {
                Some((member, value))
            }
            _ => None,
        })
        .and_then(|(member, value)| {
            let class_name = format_value_object(key, nested, "")?;
            class_name.contains('[').then(|| UnderscoreValue {
                key: member.key.clone(),
                value: value.clone(),
                class_name: with_class_prefix(one_class(class_name)),
                at: member.span.start,
            })
        });
    out.extend(found);
}

/// How a value in brackets the engine names is reported.
#[cfg(feature = "native-engine")]
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub(crate) enum BracketedForm {
    /// `redundant-bracket`: the class is written, and the value without
    /// brackets writes it too.
    Redundant,
    /// `bracketed-value`, form `unwrap`: nothing is written; `inner` is what
    /// to write.
    Unwrap,
    /// `bracketed-value`, form `escape`: nothing is written; the brackets do
    /// not wrap the value as one pair.
    Escape,
    /// `bracketed-value`, form `type-hint`: nothing is written; the key's own
    /// lowering of `inner` does not keep the hint.
    TypeHint,
}

/// A value written in the brackets csszyx writes itself.
#[cfg(feature = "native-engine")]
#[derive(Debug, Clone, PartialEq)]
pub(crate) struct BracketedValue {
    /// The sz key.
    pub key: String,
    /// The value as written.
    pub value: String,
    /// What to write on the main lane, or the value without its outer pair.
    pub inner: String,
    /// Which form names it.
    pub form: BracketedForm,
    /// Where the property is written.
    pub at: u32,
    /// The property as the key lowers `inner`, when this stands for that
    /// lowering: what it reports is reported instead of this.
    pub stands_for: Option<StaticSzProperty>,
}

/// Each string value in the brackets csszyx writes itself
/// ([`bracket_spelling`]) that the engine names: one that writes nothing, and
/// one whose class the key writes for the value without its brackets. Those
/// two stand for that lowering (`stands_for`), whose own findings the engine
/// reports in their place. A class the brackets alone spell (`p: '[4]'`) is
/// not named. Mirrors `collectBracketedValue` in `transform-core.ts`.
#[cfg(feature = "native-engine")]
pub(crate) fn collect_bracketed_values(object: &StaticSzObject, out: &mut Vec<BracketedValue>) {
    for property in &object.properties {
        match &property.value {
            StaticSzValue::String(value) => {
                let stands_for = |inner: &str| StaticSzProperty {
                    key: property.key.clone(),
                    span: property.span,
                    value: StaticSzValue::String(inner.to_owned()),
                };
                let found = match bracket_spelling(&property.key, value) {
                    Some(BracketSpelling::Drop { form, inner, hint }) => {
                        let form = match (form, hint) {
                            (BracketDrop::Escape, _) => BracketedForm::Escape,
                            (BracketDrop::Unwrap, None) => BracketedForm::Unwrap,
                            (BracketDrop::Unwrap, Some(hint)) => {
                                match lower_one_value(property, &inner).as_slice() {
                                    [own] if keeps_type_hint(own, &hint) => BracketedForm::Unwrap,
                                    _ => BracketedForm::TypeHint,
                                }
                            }
                        };
                        Some((form, inner, None))
                    }
                    Some(BracketSpelling::Emit { inner, .. }) => {
                        match lower_one_value(property, &inner).as_slice() {
                            [] => {
                                let lowering = stands_for(&inner);
                                Some((BracketedForm::Unwrap, inner, Some(lowering)))
                            }
                            [own] if is_arbitrary_class(own) => {
                                let lowering = stands_for(&inner);
                                Some((BracketedForm::Redundant, inner, Some(lowering)))
                            }
                            _ => None,
                        }
                    }
                    None => None,
                };
                if let Some((form, inner, stands_for)) = found {
                    out.push(BracketedValue {
                        key: property.key.clone(),
                        value: value.clone(),
                        inner,
                        form,
                        at: property.span.start,
                        stands_for,
                    });
                }
            }
            StaticSzValue::Object(nested)
                if property.key != "css" && !is_value_object(&property.key, nested) =>
            {
                for_each_sz_object_in(&property.key, nested, &mut |object| {
                    collect_bracketed_values(object, out);
                });
            }
            _ => {}
        }
    }
}

#[cfg(test)]
mod tests {
    use super::format_number_literal;

    /// Each row is what JavaScript's `String(n)` prints for the same number,
    /// the form the runtime lowering interpolates into a class.
    #[test]
    fn a_number_prints_as_javascript_prints_it() {
        for (value, javascript) in [
            (0.0, "0"),
            (-0.0, "0"),
            (4.0, "4"),
            (100.0, "100"),
            (-2.5, "-2.5"),
            (0.000_001, "0.000001"),
            (0.000_000_1, "1e-7"),
            (-0.000_000_15, "-1.5e-7"),
            (123_456_789_012_345_680_000.0, "123456789012345680000"),
            (1e21, "1e+21"),
            (1.5e300, "1.5e+300"),
            (f64::INFINITY, "Infinity"),
            (f64::NEG_INFINITY, "-Infinity"),
            (f64::NAN, "NaN"),
        ] {
            assert_eq!(format_number_literal(value), javascript, "{value:?}");
        }
    }

    #[cfg(feature = "native-engine")]
    use super::collect_bracketed_values;
    #[cfg(feature = "native-engine")]
    use super::collect_clamped_factors;
    #[cfg(feature = "native-engine")]
    use super::collect_dead_enum_values;
    #[cfg(feature = "native-engine")]
    use super::collect_dead_spacing_steps;
    #[cfg(feature = "native-engine")]
    use super::collect_invalid_opacities;
    #[cfg(feature = "native-engine")]
    use super::collect_mask_layer_values;
    #[cfg(feature = "native-engine")]
    use super::collect_owned_key_variant_objects;
    #[cfg(feature = "native-engine")]
    use super::collect_underscore_values;
    use super::ClassPrefixScope;
    use super::{breakpoint_segment, format_static_class, is_dashed_function_call};
    use super::{
        build_mask_radial_classes, build_mask_slot_classes, build_mask_stop_classes,
        collect_unknown_sz_keys, format_mask_position, format_mask_size, format_value_object,
        is_known_sz_key, is_mask_layer_value, is_percent, is_removed_sz_key,
        is_tailwind_build_function, is_unsigned_decimal, lower_source_ir_classes,
        lower_static_sz_object, needs_brackets, variant_string_prefix,
    };
    use crate::transform::merge::{GroupsPaused, MergeGroup, MergeGroupScope};
    use crate::transform::test_rng::Rng;
    use crate::transform::{
        ClassAttributeIr, SourceIr, StaticSzObject, StaticSzProperty, StaticSzValue, SzAttributeIr,
        TextSpan,
    };

    fn property(key: &str, value: StaticSzValue) -> StaticSzProperty {
        StaticSzProperty {
            key: key.to_string(),
            span: TextSpan { start: 0, end: 0 },
            value,
        }
    }

    fn object(properties: Vec<StaticSzProperty>) -> StaticSzValue {
        StaticSzValue::Object(StaticSzObject { properties })
    }

    /// Every arbitrary class a value with a bare `_` lowers into is named, at
    /// any depth; a space the author wrote, an escaped `\_`, a theme name and
    /// a colour object are not. Whether Tailwind reads the `_` as a space is
    /// not decided here: a `url()` is named too.
    #[cfg(feature = "native-engine")]
    #[test]
    fn a_bare_underscore_names_the_arbitrary_class_it_lowers_into() {
        let text = |value: &str| StaticSzValue::String(value.to_string());
        let object = StaticSzObject {
            properties: vec![
                property("content", text("'a_b'")),
                property("bgImg", text("url(/a_b.png)")),
                property("_x", text("_")),
                property("content", text("'a b'")),
                property("content", text("'a\\_b'")),
                property("fontFamily", text("my_font")),
                property("p", StaticSzValue::Number(4.0)),
                property(
                    "hover",
                    object(vec![property("w", text("calc(1px_+_2px)"))]),
                ),
                property("bg", object(vec![property("color", text("[a_b]"))])),
                property(
                    "bg",
                    object(vec![
                        property("color", text("oklch(0.5_0.1_10)")),
                        property("op", StaticSzValue::Number(50.0)),
                    ]),
                ),
                property(
                    "css",
                    object(vec![
                        property("gridTemplateAreas", text("'a_b'")),
                        property("content", text("'a b'")),
                        property("order", StaticSzValue::Number(1.0)),
                    ]),
                ),
            ],
        };
        let mut found = Vec::new();
        collect_underscore_values(&object, &mut found);
        let named: Vec<_> = found
            .iter()
            .map(|found| {
                (
                    found.key.as_str(),
                    found.value.as_str(),
                    found.class_name.as_str(),
                )
            })
            .collect();
        assert_eq!(
            named,
            [
                ("content", "'a_b'", "content-['a_b']"),
                ("bgImg", "url(/a_b.png)", "bg-[url(/a_b.png)]"),
                ("w", "calc(1px_+_2px)", "w-[calc(1px_+_2px)]"),
                // A colour object names the class it is emitted as, opacity
                // included, at its `color`: `bg-[a_b]` is what the build
                // writes for `bg: { color: '[a_b]' }`.
                ("color", "[a_b]", "bg-[a_b]"),
                ("color", "oklch(0.5_0.1_10)", "bg-[oklch(0.5_0.1_10)]/50"),
                ("gridTemplateAreas", "'a_b'", "[grid-template-areas:'a_b']"),
            ]
        );
    }

    /// A value in brackets writes the class its key writes for the value
    /// inside: an arbitrary class as it is, nothing as nothing, and `key-[…]`
    /// beside a bare class. A bracket class with a modifier after it, and line
    /// names that do not wrap the template, are lowered as written; every
    /// pair around a whole template comes off at once.
    #[test]
    fn a_bracketed_value_writes_what_its_key_writes_for_the_value_inside() {
        let lowered = |key: &str, value: &str| {
            lower_static_sz_object(&StaticSzObject {
                properties: vec![property(key, StaticSzValue::String(value.into()))],
            })
        };
        assert_eq!(lowered("bgSize", "[10px]"), ["bg-[length:10px]"]);
        assert_eq!(lowered("mask", "[radial]"), Vec::<String>::new());
        assert_eq!(lowered("p", "[4]"), ["p-[4]"]);
        assert_eq!(lowered("bg", "[#f00]/50"), ["bg-[#f00]/50"]);
        assert_eq!(lowered("gridRows", "[a]_1fr"), ["grid-rows-[[a]_1fr]"]);
        assert_eq!(lowered("gridCols", "[[[a]_1fr]]"), ["grid-cols-[[a]_1fr]"]);
        assert_eq!(lowered("gridCols", "[[a]]"), ["grid-cols-[a]"]);
        // Brackets on a grid key that open nowhere do not pair.
        assert!(matches!(
            super::bracket_spelling("gridCols", "a]_1fr_[b]"),
            Some(super::BracketSpelling::Drop {
                form: super::BracketDrop::Escape,
                ..
            })
        ));
        assert_eq!(lowered("gridCols", "a]_1fr_[b]"), Vec::<String>::new());
    }

    /// The `op` a colour-slash finding names is the literal written: a number
    /// bare, a string quoted, and anything else as if `op` were absent.
    #[cfg(feature = "native-engine")]
    #[test]
    fn a_colour_slash_finding_names_the_op_as_written() {
        let colour = |op: StaticSzValue| StaticSzObject {
            properties: vec![property(
                "bg",
                object(vec![
                    property("color", StaticSzValue::String("red-500/50".to_string())),
                    property("op", op),
                ]),
            )],
        };
        for (op, named) in [
            (StaticSzValue::Number(20.0), Some("20".to_string())),
            (
                StaticSzValue::String("78%".to_string()),
                Some("'78%'".to_string()),
            ),
            (StaticSzValue::Boolean(true), None),
        ] {
            let mut found = Vec::new();
            super::collect_color_slash_opacities(&colour(op), &mut found);
            assert_eq!(
                found,
                [("bg".to_string(), "red-500/50".to_string(), named, 0)]
            );
        }
    }

    /// The `op` a modifier names, as `csszyx migrate` and a slash report's
    /// help read it.
    #[cfg(feature = "native-engine")]
    #[test]
    fn a_modifier_names_the_op_tailwind_reads_it_as() {
        use super::{modifier_op, op_literal, ModifierOp};
        for (modifier, op) in [
            ("50", Some(ModifierOp::Number(50.0))),
            ("0.5", Some(ModifierOp::Number(0.5))),
            (".5", Some(ModifierOp::Number(0.5))),
            ("[0.5]", Some(ModifierOp::Number(50.0))),
            ("[0.05]", Some(ModifierOp::Number(5.0))),
            ("[1]", Some(ModifierOp::Number(100.0))),
            ("[50%]", Some(ModifierOp::Text("50%"))),
            ("(--o)", Some(ModifierOp::Text("--o"))),
            ("()", Some(ModifierOp::Text(""))),
            ("[2]", None),
            ("[]", None),
            ("[x]", None),
            ("[", None),
            ("(", None),
            ("(5", None),
            ("5)", None),
            ("[0.5", None),
            ("0.5]", None),
            (".", None),
            ("1.2.3", None),
            ("50%", None),
            ("--o", None),
        ] {
            assert_eq!(modifier_op(modifier), op, "{modifier}");
        }
        for (opacity, literal) in [
            ("50", "50"),
            ("[0.333]", "33.3"),
            ("[50%]", "'50%'"),
            ("(--o)", "'--o'"),
            ("50%", "'50%'"),
        ] {
            assert_eq!(op_literal(opacity), literal, "{opacity}");
        }
    }

    /// A gradient's slash names its interpolation; a fraction is a size.
    #[cfg(feature = "native-engine")]
    #[test]
    fn a_slash_opacity_split_leaves_gradients_and_fractions_alone() {
        use super::slash_opacity_split;
        for value in [
            "linear-to-r/oklch",
            "-linear-45/srgb",
            "radial/oklch",
            "conic-180/decreasing",
            "gradient-to-b/oklch",
            "1/2",
            "4/2.5",
            "red-500/",
            "/50",
            "rgb(255_0_0/50%)",
        ] {
            assert_eq!(slash_opacity_split(value), None, "{value}");
        }
        assert_eq!(slash_opacity_split("[#f00]/50"), Some(("[#f00]", "50")));
    }

    /// A key that takes only a boolean, or closes its value set, has no
    /// arbitrary utility, so a bracketed value writes nothing; a grid
    /// template is unwrapped one whole pair at a time, never through a pair
    /// that closes early, and no other key unwraps.
    #[cfg(feature = "native-engine")]
    #[test]
    fn a_bracketed_value_unwraps_only_what_its_key_reads() {
        let lowered = |key: &str, value: &str| {
            lower_static_sz_object(&StaticSzObject {
                properties: vec![property(key, StaticSzValue::String(value.into()))],
            })
        };
        assert_eq!(lowered("truncate", "[x]"), Vec::<String>::new());
        assert_eq!(lowered("display", "[grid]"), Vec::<String>::new());
        assert_eq!(
            lowered("gridCols", "[[a]_1fr_[b]]"),
            ["grid-cols-[[a]_1fr_[b]]"]
        );
        assert_eq!(lowered("gridCols", "[[[a]_1fr]]"), ["grid-cols-[[a]_1fr]"]);
        assert_eq!(lowered("w", "[[[x]]]"), Vec::<String>::new());
        // The record names the value inside every pair the lane takes off.
        for (key, value, inner) in [
            ("w", "[[[x]]]", "[[x]]"),
            ("gridCols", "[[[a]_1fr]]", "[a]_1fr"),
            ("gridCols", "[[a]]", "[a]"),
        ] {
            let mut found = Vec::new();
            super::collect_bracketed_values(
                &StaticSzObject {
                    properties: vec![property(key, StaticSzValue::String(value.into()))],
                },
                &mut found,
            );
            assert_eq!(found[0].inner, inner, "{key}: {value}");
        }
    }

    #[test]
    fn a_lone_variable_is_spelled_as_the_main_lane_spells_it() {
        for (value, spelled) in [
            ("var(--x)", "--x"),
            ("var( --brand-2 )!", "--brand-2!"),
            ("var(--a_b)", "--a_b"),
            ("var(--x, 2px)", "var(--x, 2px)"),
            ("var(--)", "var(--)"),
            ("var(x)", "var(x)"),
            ("var(--x)y", "var(--x)y"),
            ("10px", "10px"),
        ] {
            assert_eq!(super::main_spelling(value), spelled, "{value}");
        }
    }

    #[test]
    fn a_bracket_class_with_a_modifier_after_it_is_written_as_given() {
        for rest in ["[#f00]/50", "[a]/b"] {
            assert!(super::is_bracket_then_modifier(rest), "{rest}");
        }
        for rest in [
            "[#f00]",
            "[]/50",
            "[#f00]/",
            "[#f00]/[50]",
            "[#f00]/5/0",
            "[[a]]/5",
            "#f00/50",
        ] {
            assert!(!super::is_bracket_then_modifier(rest), "{rest}");
        }
    }

    #[cfg(feature = "native-engine")]
    #[test]
    fn a_type_hint_is_kept_when_the_class_names_it_or_needs_none() {
        for (class, hint, kept) in [
            ("text-[length:13px]", "length", true),
            ("text-(length:--x)", "length", true),
            ("text-(length:--x)", "color", false),
            ("text-[13px]", "length", true),
            ("w-[13px]", "length", true),
            ("text-red", "color", false),
            ("bg-[url(a:b)]", "image", true),
        ] {
            assert_eq!(super::keeps_type_hint(class, hint), kept, "{class} {hint}");
        }
    }

    #[test]
    fn the_important_modifier_comes_off_the_end_of_a_colour() {
        assert_eq!(super::split_important("red-500!"), ("red-500", "!"));
        assert_eq!(super::split_important("red-500"), ("red-500", ""));
    }

    /// A value in brackets is named with its form and what to write, under a
    /// variant too: a second spelling of a class the value without brackets
    /// writes, a shape the brackets cannot carry, and brackets that do not
    /// pair. Brackets that do not wrap all of it, a colour object and `css`
    /// are not read.
    #[cfg(feature = "native-engine")]
    #[test]
    fn a_value_in_brackets_csszyx_writes_is_named_with_what_to_write() {
        use super::BracketedForm::{Escape, Redundant, Unwrap};
        let text = |value: &str| StaticSzValue::String(value.to_string());
        let object = StaticSzObject {
            properties: vec![
                property("w", text("[100px]")),
                property("top", text("-[1px]")),
                property("gridCols", text("[a] 1fr")),
                property("m", text("[a")),
                property("p", text("4")),
                property("--cols", text("[a]")),
                property("bg", object(vec![property("color", text("[#fff]"))])),
                property("css", object(vec![property("width", text("[1px]"))])),
                property("hover", object(vec![property("h", text("[2px]"))])),
                property("gridRows", text("[[a]_1fr]")),
                property("gridCols", text("[a]_1fr_[b]")),
                property("gridCols", text("[[a]")),
                property("gridCols", text("[a]]_[b]")),
                property("gridCols", text("[a]_1fr_[b")),
                property("gridCols", text("-[a]_1fr_[b]")),
                property("gridCols", text("(--cols)")),
                property("p", text("[a]_1_[b]")),
                property("mt", text("-[3px]!")),
                property("animate", text("(--spin)")),
                property("ease", text("(--snappy)!")),
                property("w", text("--spacing(4)")),
                property("bg", text("(--a) (--b)")),
                property("p", text("(4)")),
                // A type hint, a hyphen in its name too; a name with a
                // capital is no hint, and the class is written unnamed.
                property("w", text("[length:13px]")),
                property("leading", text("[line-height:2]")),
                property("w", text("[aB:1]")),
                // A fraction of two integers; a part that is not digits is
                // no fraction.
                property("w", text("[1/2]")),
                property("w", text("[a/b]")),
                property("w", text("[1/x]")),
            ],
        };
        let mut found = Vec::new();
        collect_bracketed_values(&object, &mut found);
        let named: Vec<_> = found
            .iter()
            .map(|found| {
                (
                    found.key.as_str(),
                    found.value.as_str(),
                    found.form,
                    (found.form != Escape).then_some(found.inner.as_str()),
                )
            })
            .collect();
        assert_eq!(
            named,
            [
                ("w", "[100px]", Redundant, Some("100px")),
                ("top", "-[1px]", Unwrap, Some("-1px")),
                // A bracket that never closes.
                ("m", "[a", Escape, None),
                ("h", "[2px]", Redundant, Some("2px")),
                // One pair around a grid template: line names inside are CSS.
                ("gridRows", "[[a]_1fr]", Redundant, Some("[a]_1fr")),
                // Brackets that do not balance: no grid template, no offer.
                ("gridCols", "[[a]", Escape, None),
                ("gridCols", "[a]]_[b]", Escape, None),
                ("gridCols", "[a]_1fr_[b", Escape, None),
                ("gridCols", "-[a]_1fr_[b]", Escape, None),
                ("gridCols", "(--cols)", Unwrap, Some("--cols")),
                // Brackets inside elsewhere: no value of that key carries them.
                ("p", "[a]_1_[b]", Escape, None),
                ("mt", "-[3px]!", Unwrap, Some("-3px!")),
                ("animate", "(--spin)", Unwrap, Some("--spin")),
                ("ease", "(--snappy)!", Unwrap, Some("--snappy!")),
                ("w", "[length:13px]", Unwrap, Some("13px")),
                ("leading", "[line-height:2]", Unwrap, Some("2")),
                ("w", "[1/2]", Unwrap, Some("1/2")),
            ]
        );
        // What is not offered still carries the value without its outer pair.
        let inner_of = |value: &str| {
            found
                .iter()
                .find(|found| found.value == value)
                .map(|found| found.inner.as_str())
        };
        assert_eq!(inner_of("[a]_1_[b]"), Some("a]_1_[b"));
        assert_eq!(inner_of("[a]_1fr_[b"), Some("[a]_1fr_[b"));
    }

    /// Every `op` that is not an opacity is named as the author wrote it, under
    /// a variant too; a percent string and a custom property are opacities.
    #[cfg(feature = "native-engine")]
    #[test]
    fn an_op_that_is_no_opacity_is_named_as_written() {
        let colour = |op: StaticSzValue| {
            object(vec![
                property("color", StaticSzValue::String("red-500".to_string())),
                property("op", op),
            ])
        };
        let object = StaticSzObject {
            properties: vec![
                property("bg", colour(StaticSzValue::Number(150.0))),
                property(
                    "borderColor",
                    colour(StaticSzValue::String("20".to_string())),
                ),
                property("outlineColor", colour(StaticSzValue::Boolean(true))),
                property("ringColor", colour(object(vec![]))),
                property("fill", colour(StaticSzValue::String("78%".to_string()))),
                property("stroke", colour(StaticSzValue::String("--o".to_string()))),
                property("accent", colour(StaticSzValue::Number(0.05))),
                property(
                    "hover",
                    object(vec![property("bg", colour(StaticSzValue::Number(-5.0)))]),
                ),
                // 0 and 1 are opacities as written: only what lies between is
                // read as the fraction 0.17 took it for.
                property("caret", colour(StaticSzValue::Number(0.0))),
                property("decorationColor", colour(StaticSzValue::Number(1.0))),
                // A variant holding `color` and `op` is no colour object.
                property("focus", colour(StaticSzValue::String("x".to_string()))),
            ],
        };
        let mut found = Vec::new();
        collect_invalid_opacities(&object, &mut found);
        let named: Vec<_> = found
            .into_iter()
            .map(|(key, op, finding, _)| (key, op, fraction_percent(finding)))
            .collect();
        assert_eq!(
            named,
            [
                ("bg".to_string(), "150".to_string(), None),
                ("borderColor".to_string(), "'20'".to_string(), None),
                ("outlineColor".to_string(), "true".to_string(), None),
                ("ringColor".to_string(), "{…}".to_string(), None),
                (
                    "accent".to_string(),
                    "0.05".to_string(),
                    Some("5".to_string())
                ),
                ("bg".to_string(), "-5".to_string(), None),
            ]
        );
    }

    /// A value object's class: `size` lowers as the key's own string, `color`
    /// as a colour, then the shared opacity tail.
    #[test]
    fn a_value_object_writes_its_member_then_the_opacity() {
        let lowered = |key: &str, member: &str, value: &str| {
            lower_static_sz_object(&StaticSzObject {
                properties: vec![property(
                    key,
                    object(vec![
                        property(member, StaticSzValue::String(value.to_string())),
                        property("op", StaticSzValue::Number(50.0)),
                    ]),
                )],
            })
        };
        // A variable size is the shadow itself; a variable colour on a shadow
        // key takes the `color:` hint.
        assert_eq!(lowered("shadow", "size", "--s"), ["shadow-(--s)/50"]);
        assert_eq!(lowered("shadow", "color", "--s"), ["shadow-(color:--s)/50"]);
        // A variable with a call in it is bracketed, a bare one is a reference.
        assert_eq!(lowered("bg", "color", "--a(b)"), ["bg-[--a(b)]/50"]);
        assert_eq!(
            lowered("bg", "color", "--a,var(--b)"),
            ["bg-[--a,var(--b)]/50"]
        );
        assert_eq!(lowered("bg", "color", "--a"), ["bg-(--a)/50"]);
        // `size` is a value only on a shadow key.
        assert_eq!(lowered("bg", "size", "sm"), ["bg:size-sm", "bg:op-50"]);
    }

    /// The member a slash string's help writes: `size` for a shadow on a
    /// shadow key, `color` for anything else.
    #[cfg(feature = "native-engine")]
    #[test]
    fn a_slash_string_names_the_member_that_replaces_it() {
        let members = |key: &str, value: &str| {
            let mut out = Vec::new();
            super::collect_slash_opacity_strings(
                &StaticSzObject {
                    properties: vec![property(key, StaticSzValue::String(value.to_string()))],
                },
                &mut out,
            );
            out.into_iter().map(|found| found.1).collect::<Vec<_>>()
        };
        assert_eq!(members("shadow", "sm/50"), ["size"]);
        assert_eq!(members("textShadow", "[0_1px_red]/50"), ["size"]);
        assert_eq!(members("dropShadow", "(--d)/50"), ["size"]);
        assert_eq!(members("insetShadow", "--s/50"), ["size"]);
        assert_eq!(members("shadow", "red-500/50"), ["color"]);
        // A bracket or a variable on a colour key is a colour.
        assert_eq!(members("bg", "[#f00]/50"), ["color"]);
        assert_eq!(members("bg", "--c/50"), ["color"]);
        // No slash on a size key, no report.
        assert!(members("p", "4/50").is_empty());
    }

    /// Only a size held in a variable, with an opacity, is noted.
    #[cfg(feature = "native-engine")]
    #[test]
    fn only_a_variable_shadow_size_with_an_opacity_is_noted() {
        let findings = |key: &str, member: &str, value: &str, op: StaticSzValue| {
            let mut out = Vec::new();
            collect_invalid_opacities(
                &StaticSzObject {
                    properties: vec![property(
                        key,
                        object(vec![
                            property(member, StaticSzValue::String(value.to_string())),
                            property("op", op),
                        ]),
                    )],
                },
                &mut out,
            );
            out.into_iter()
                .map(|(.., finding, _)| finding)
                .collect::<Vec<_>>()
        };
        let fifty = || StaticSzValue::Number(50.0);
        assert_eq!(
            findings("shadow", "size", "--s!", fifty()),
            [super::OpacityFinding::VariableShadow]
        );
        assert!(findings("shadow", "size", "sm", fifty()).is_empty());
        assert!(findings("shadow", "color", "--s", fifty()).is_empty());
        assert!(findings("bg", "color", "--c", fifty()).is_empty());
        // An `op` that is no opacity is that finding alone.
        assert_eq!(
            findings("shadow", "size", "--s", StaticSzValue::Number(150.0)),
            [super::OpacityFinding::Range]
        );
    }

    /// A mask stop's `op` is read as a colour object's is, and one that is no
    /// opacity is named by the stop's member, at a side's stop too.
    #[cfg(feature = "native-engine")]
    #[test]
    fn a_mask_stop_op_that_is_no_opacity_is_named_by_its_member() {
        let stop = |op: StaticSzValue| {
            object(vec![
                property("color", StaticSzValue::String("red-500".to_string())),
                property("op", op),
            ])
        };
        let object = StaticSzObject {
            properties: vec![property(
                "maskLinear",
                object(vec![
                    property("angle", StaticSzValue::Number(45.0)),
                    property("from", stop(StaticSzValue::Number(150.0))),
                    property("to", stop(StaticSzValue::Number(50.0))),
                    property(
                        "top",
                        object(vec![property("from", stop(StaticSzValue::Boolean(true)))]),
                    ),
                ]),
            )],
        };
        let mut found = Vec::new();
        collect_invalid_opacities(&object, &mut found);
        let named: Vec<_> = found
            .into_iter()
            .map(|(key, op, finding, _)| (key, op, fraction_percent(finding)))
            .collect();
        assert_eq!(
            named,
            [
                ("from".to_string(), "150".to_string(), None),
                ("from".to_string(), "true".to_string(), None),
            ]
        );
    }

    /// The percent a `fraction` finding names; none for any other finding.
    #[cfg(feature = "native-engine")]
    fn fraction_percent(finding: super::OpacityFinding) -> Option<String> {
        match finding {
            super::OpacityFinding::Fraction(percent) => Some(percent),
            super::OpacityFinding::Range | super::OpacityFinding::VariableShadow => None,
        }
    }

    /// A breakpoint is bracketed unless it is a name or already wrapped at both
    /// ends; a bracket at one end only wraps nothing.
    #[test]
    fn a_breakpoint_is_bracketed_unless_wrapped_at_both_ends() {
        assert_eq!(breakpoint_segment("tablet"), "tablet");
        assert_eq!(breakpoint_segment("[640px]"), "[640px]");
        assert_eq!(breakpoint_segment("640px"), "[640px]");
        assert_eq!(breakpoint_segment("[a b"), "[[a b]");
    }

    /// `snapAlign` keeps the direct classes Tailwind serves for an edge.
    #[test]
    fn snap_align_writes_the_direct_edge_classes() {
        for edge in ["start", "end", "center"] {
            assert_eq!(
                format_static_class("snapAlign", &StaticSzValue::String(edge.to_string()), ""),
                Some(format!("snap-{edge}"))
            );
        }
    }

    /// A dashed function call names a function: `--` with no name is not one.
    #[test]
    fn a_dashed_function_call_needs_a_name() {
        assert!(is_dashed_function_call("--spacing(4)"));
        assert!(!is_dashed_function_call("--(4)"));
        assert!(!is_dashed_function_call("--spacing"));
    }

    /// A container query's members, as the spec writes them: a property stays
    /// under the query, `@min` takes a breakpoint, and any other name is a
    /// variant that chains on, a project's own too. A named container is the
    /// key Tailwind spells, `@md/sidebar`.
    #[test]
    fn lowers_container_query_members() {
        let p = |n: f64| object(vec![property("p", StaticSzValue::Number(n))]);
        let classes = lower_static_sz_object(&StaticSzObject {
            properties: vec![
                property(
                    "@md",
                    object(vec![
                        property("p", StaticSzValue::Number(1.0)),
                        property("display", StaticSzValue::String("flex".into())),
                        property("sidebar", p(2.0)),
                        property("hover", p(3.0)),
                        property("@maxLg", p(4.0)),
                    ]),
                ),
                property("@md/sidebar", p(8.0)),
                property("@maxLg/sidebar", p(10.0)),
                property("@unknown/sidebar", p(11.0)),
                property(
                    "@min",
                    object(vec![
                        property("sidebar", p(5.0)),
                        property("475px", p(6.0)),
                        property("[30rem]", p(7.0)),
                        property("p", StaticSzValue::Number(9.0)),
                        property(
                            "bg",
                            object(vec![
                                property("color", StaticSzValue::String("red-500".into())),
                                property("op", StaticSzValue::Number(50.0)),
                            ]),
                        ),
                    ]),
                ),
            ],
        });
        assert_eq!(
            classes,
            [
                "@md:p-1",
                "@md:flex",
                "@md:sidebar:p-2",
                "@md:hover:p-3",
                "@md:@max-lg:p-4",
                "@md/sidebar:p-8",
                "@max-lg/sidebar:p-10",
                "@unknown/sidebar:p-11",
                "@min-sidebar:p-5",
                "@min-[475px]:p-6",
                "@min-[30rem]:p-7",
                "@min:p-9",
                "@min:bg-red-500/50",
            ]
        );
    }

    /// A CSS-wide keyword takes the bracket only on a key the table marks:
    /// `cursor` is marked, `bg` is not, so `bg-revert` is left as written for
    /// the build to judge.
    #[test]
    fn a_css_wide_keyword_takes_the_bracket_only_where_the_table_says() {
        let classes = lower_static_sz_object(&StaticSzObject {
            properties: vec![
                property("bg", StaticSzValue::String("revert".to_string())),
                property("cursor", StaticSzValue::String("revert".to_string())),
            ],
        });
        assert_eq!(classes, ["bg-revert", "cursor-[revert]"]);
    }

    /// Grid line names are CSS's own brackets: on the keys whose property
    /// takes them, the value is bracketed and lowered, and one pair around the
    /// whole value is the second spelling of the same class; brackets that do
    /// not balance or a sign write nothing.
    #[test]
    fn grid_line_names_lower_as_an_arbitrary_value() {
        let text = |value: &str| StaticSzValue::String(value.to_string());
        let classes = lower_static_sz_object(&StaticSzObject {
            properties: vec![
                property("gridCols", text("[a]_1fr_[b]")),
                property("gridRows", text("[a]_auto")),
                property("gridCols", text("[[a]_1fr]")),
                property("gridCols", text("[[a]")),
                property("gridCols", text("[a]]_[b]")),
                property("gridRows", text("1fr_2fr")),
                property("gridCols", text("auto_1fr")),
                // Only track keywords: the keyword alone makes it a track list.
                property("gridCols", text("min-content_auto")),
                property("gridCols", text("main_layout")),
                property("gridCols", text("-[a]_1fr")),
            ],
        });
        assert_eq!(
            classes,
            [
                "grid-cols-[[a]_1fr_[b]]",
                "grid-rows-[[a]_auto]",
                "grid-cols-[[a]_1fr]",
                "grid-rows-[1fr_2fr]",
                "grid-cols-[auto_1fr]",
                "grid-cols-[min-content_auto]",
                "grid-cols-main_layout"
            ]
        );
    }

    /// A CSS-wide keyword on `bgImg` is the property's value, never a URL.
    #[test]
    fn a_css_wide_keyword_on_bg_img_takes_the_image_hint() {
        let classes = lower_static_sz_object(&StaticSzObject {
            properties: vec![property(
                "bgImg",
                StaticSzValue::String("inherit".to_string()),
            )],
        });
        assert_eq!(classes, ["bg-[image:inherit]"]);
    }

    /// A custom property is written in Tailwind's `(…)` form on the keys the
    /// runtime spells the same way; a `willChange` property name brackets.
    #[test]
    fn a_custom_property_takes_the_parenthesised_form() {
        let classes = lower_static_sz_object(&StaticSzObject {
            properties: vec![
                property(
                    "perspectiveOrigin",
                    StaticSzValue::String("--o".to_string()),
                ),
                property("willChange", StaticSzValue::String("--w".to_string())),
                property("willChange", StaticSzValue::String("opacity".to_string())),
            ],
        });
        assert_eq!(
            classes,
            [
                "perspective-origin-(--o)",
                "will-change-(--w)",
                "will-change-[opacity]"
            ]
        );
    }

    /// Only a key written wholly in brackets is an arbitrary variant that
    /// loses its whitespace; a named variant with a bracketed argument is
    /// spelled as any other key.
    #[test]
    fn only_a_wholly_bracketed_key_is_an_arbitrary_variant() {
        assert_eq!(super::object_variant_segment("[& > li]"), "[&>li]");
        assert_eq!(super::object_variant_segment("has-[a b]"), "has-[a b]");
        assert_eq!(super::object_variant_segment("[a b"), "[a b");
    }

    /// The AST path hands the settlement one property per key, and the fast
    /// path leaves a repeated key to it, so no `.jsx` source reaches this
    /// shape any more; a caller that does still gets JavaScript's reading.
    #[test]
    fn the_settlement_reads_a_repeated_family_key_as_javascript_does() {
        let object = StaticSzObject {
            properties: vec![
                property("contain", StaticSzValue::String("strict".to_string())),
                property("containPaint", StaticSzValue::Boolean(true)),
                property("contain", StaticSzValue::String("size".to_string())),
            ],
        };
        let settlement = super::settle_global_keywords(&object);
        // The first `contain` gives up its value to the last; the last gives
        // up its place to the first, which `containPaint` then replaces.
        assert!(settlement.skipped.contains(&0), "{:?}", settlement.skipped);
        assert_eq!(settlement.replaced.len(), 1);
        assert_eq!(settlement.replaced[0].0.key, "contain");
        assert_eq!(settlement.replaced[0].1, "containPaint");
    }

    /// The descent rule the value collectors share (`is_colour_object`),
    /// read through the off-scale spacing collector: the diagnostics it feeds
    /// are asserted from the JavaScript side too, and `cargo test` never runs
    /// that suite, so mutation testing needs a Rust test to see this one.
    #[cfg(feature = "native-engine")]
    #[test]
    fn descends_past_a_colour_object_but_not_into_one() {
        let dead = || StaticSzValue::Number(1.4);
        let colour = || StaticSzValue::String("red".to_string());
        let collect = |key: &str, nested: Vec<StaticSzProperty>| {
            let mut out = Vec::new();
            collect_dead_spacing_steps(
                &StaticSzObject {
                    properties: vec![property(key, object(nested))],
                },
                &mut out,
            );
            out
        };

        // A nested object under a property key that also carries a colour is
        // the shape of a colour with a modifier, and is not searched.
        assert!(
            collect(
                "bg",
                vec![property("color", colour()), property("p", dead())]
            )
            .is_empty(),
            "a colour object is not searched"
        );
        // Take the colour away and the same key is searched, because both
        // halves of that test have to hold for the skip to apply.
        assert_eq!(
            collect("bg", vec![property("p", dead())]).len(),
            1,
            "without a colour, the object is searched"
        );
        // Keep the colour but hang it off a key that is not a property, and it
        // is searched again.
        assert_eq!(
            collect(
                "hover",
                vec![property("color", colour()), property("p", dead())]
            )
            .len(),
            1,
            "a variant key is searched even with a colour"
        );
    }

    /// Which strings `clamped-factor` collects, and how deep it looks. The
    /// lanes are compared from the JavaScript side too; this one is for
    /// mutation testing, which reads `cargo test` alone.
    #[cfg(feature = "native-engine")]
    #[test]
    fn collects_a_factor_string_above_one_only_where_it_clamps() {
        let text = |value: &str| StaticSzValue::String(value.to_string());
        let collect = |properties: Vec<StaticSzProperty>| {
            let mut out = Vec::new();
            collect_clamped_factors(&StaticSzObject { properties }, &mut out);
            out.into_iter()
                .map(|(key, value, _)| format!("{key}:{value}"))
                .collect::<Vec<_>>()
        };

        assert_eq!(
            collect(vec![
                property("opacity", text("50")),
                property("grayscale", text("1.5!")),
                property("opacity", text("1")),
                property("opacity", text(".5")),
                property("opacity", StaticSzValue::Number(50.0)),
                property("scale", text("105")),
                property("p", text("50")),
                property("hover", object(vec![property("sepia", text("2"))])),
                // A colour object's members are fields, not sz keys.
                property(
                    "bg",
                    object(vec![
                        property("color", text("red-500")),
                        property("opacity", text("50")),
                    ]),
                ),
            ]),
            ["opacity:50", "grayscale:1.5", "sepia:2"]
        );
    }

    /// The strings both lanes read as a plain decimal: an optional `-`, then
    /// digits with at most one point, or a point and digits. Mirrors
    /// `NUMERIC_STRING` in `numeric-string.ts`.
    #[test]
    fn spells_a_decimal_as_the_runtime_pattern_does() {
        for text in ["4", "-2", "2.5", ".5", "-.5", "007"] {
            assert!(super::spells_decimal(text), "{text}");
        }
        for text in ["", "-", ".", "-.", "1.", ".a", ".5a", "1e3", "+1", " 1"] {
            assert!(!super::spells_decimal(text), "{text}");
        }
    }

    /// A numeric string is read as the number on a key that takes one, and
    /// kept as text on every key that reads a string another way: one row per
    /// exclusion, so dropping any of them turns a row.
    #[test]
    fn reads_a_numeric_string_as_a_number_only_where_the_key_takes_one() {
        let read = |key: &str, value: &str| {
            super::numeric_string_value(key, &StaticSzValue::String(value.to_string()))
        };
        assert_eq!(read("p", "4"), Some(4.0));
        assert_eq!(read("mt", "-.5"), Some(-0.5));
        assert_eq!(read("p", "4px"), None);
        assert_eq!(
            super::numeric_string_value("p", &StaticSzValue::Number(4.0)),
            None
        );
        for key in ["content", "opacity", "--gap", "@md", "display"] {
            assert_eq!(read(key, "4"), None, "{key}");
        }
    }

    /// A key that takes only a boolean still writes a class for a number or a
    /// string, at any depth, and each such value is collected as written; `true`, a
    /// valued shorthand and a colour object are not.
    #[cfg(feature = "native-engine")]
    #[test]
    fn a_non_boolean_value_on_a_flag_only_key_keeps_its_class_and_is_collected() {
        let text = |value: &str| StaticSzValue::String(value.to_string());
        let source = StaticSzObject {
            properties: vec![
                property("truncate", StaticSzValue::Number(2.0)),
                property("srOnly", text("yes!")),
                property("textClip", text("[2]")),
                property(
                    "hover",
                    object(vec![
                        property("numOrdinal", StaticSzValue::Number(0.5)),
                        property("containPaint", StaticSzValue::Boolean(true)),
                    ]),
                ),
                property("ring", StaticSzValue::Number(2.0)),
                // A colour object's members are fields, not sz keys: nothing
                // under it is collected.
                property(
                    "bg",
                    object(vec![
                        property("color", text("red-500")),
                        property("truncate", StaticSzValue::Number(3.0)),
                    ]),
                ),
            ],
        };
        assert_eq!(
            lower_static_sz_object(&source),
            [
                "truncate-2",
                "sr-only-yes!",
                "hover:num-ordinal-0.5",
                "hover:contain-paint",
                "ring-2",
                "bg-red-500"
            ]
        );
        let mut found = Vec::new();
        collect_dead_enum_values(&source, &mut found);
        assert_eq!(
            found
                .iter()
                .map(|(key, value, _)| (key.as_str(), value.as_str()))
                .collect::<Vec<_>>(),
            [
                ("truncate", "2"),
                ("srOnly", "'yes'"),
                ("numOrdinal", "0.5")
            ]
        );
    }

    #[test]
    fn is_known_sz_key_accepts_valid_keys_and_rejects_typos() {
        // Real properties, variants, special-cased keys, removed sugar, escapes.
        for key in [
            "m",
            "p",
            "gap",
            "bg",
            "flexDir",
            "hover",
            "md",
            "data",
            "aria",
            "group",
            "min",
            "max",
            "fromPos",
            "alignContent",
            "maskMode",
            "snapStrictness",
            "grid",
            "flex",
            // Flag-only utilities: emit a class via the Boolean(true) fallback
            // but carry no value, so they are absent from boolean_class's table.
            // is_known_sz_key must still recognize them or rust warns for a class
            // it emits (field-reported for `truncate`).
            "truncate",
            "css",
            "textEllipsis",
            "textClip",
            "blur",
            "grayscale",
            "invert",
            "sepia",
            "backdropBlur",
            "backdropGrayscale",
            "backdropInvert",
            "backdropSepia",
            "--brand",
            "[mask-type]",
            "@container",
        ] {
            assert!(is_known_sz_key(key), "expected known: {key}");
        }
        // Typos must be flagged.
        for key in ["xyzzy", "pading", "colour", "fooBar", "wibble"] {
            assert!(!is_known_sz_key(key), "expected unknown: {key}");
        }
    }

    #[test]
    fn collect_unknown_sz_keys_finds_typos_and_recurses_simple_variants() {
        let object = StaticSzObject {
            properties: vec![
                property("p", StaticSzValue::Number(4.0)),
                property("xyzzy", StaticSzValue::Number(4.0)),
                StaticSzProperty {
                    key: "hover".to_string(),
                    span: TextSpan { start: 0, end: 0 },
                    value: StaticSzValue::Object(StaticSzObject {
                        properties: vec![property("nope", StaticSzValue::Number(1.0))],
                    }),
                },
            ],
        };
        let mut out = Vec::new();
        collect_unknown_sz_keys(&object, &mut out);
        let keys: Vec<&str> = out.iter().map(|(k, _)| k.as_str()).collect();
        // Top-level typo + nested typo under a SIMPLE variant, but not `p`.
        assert_eq!(keys, ["xyzzy", "nope"]);
    }

    #[test]
    fn removed_keys_are_reported_once_and_emit_nothing() {
        let object = StaticSzObject {
            properties: vec![
                property("padding", StaticSzValue::Number(4.0)),
                property("maskFrom", StaticSzValue::String("black".to_string())),
                property("customThing", StaticSzValue::String("active".to_string())),
            ],
        };
        let mut unknown = Vec::new();

        collect_unknown_sz_keys(&object, &mut unknown);

        assert!(is_removed_sz_key("padding"));
        assert!(is_removed_sz_key("maskFrom"));
        // A split shorthand emits nothing either: its report names both keys.
        assert!(is_removed_sz_key("font"));
        assert!(is_removed_sz_key("scrollbarColor"));
        assert!(!is_removed_sz_key("customThing"));
        assert_eq!(
            unknown
                .iter()
                .map(|(key, _)| key.as_str())
                .collect::<Vec<_>>(),
            ["padding", "maskFrom", "customThing"]
        );
        assert_eq!(lower_static_sz_object(&object), ["custom-thing-active"]);
    }

    #[test]
    fn removed_object_key_is_reported_at_the_owner_without_descending() {
        let object = StaticSzObject {
            properties: vec![property(
                "padding",
                object(vec![property("nestedTypo", StaticSzValue::Number(1.0))]),
            )],
        };
        let mut unknown = Vec::new();

        collect_unknown_sz_keys(&object, &mut unknown);

        assert_eq!(
            unknown
                .iter()
                .map(|(key, _)| key.as_str())
                .collect::<Vec<_>>(),
            ["padding"]
        );
        assert!(lower_static_sz_object(&object).is_empty());
    }

    #[test]
    fn collect_unknown_sz_keys_reads_parametric_parameters_as_names() {
        // `data`/`aria`/etc. members are parameter names, not sz props; only
        // the objects they hold are sz objects.
        let object = StaticSzObject {
            properties: vec![StaticSzProperty {
                key: "data".to_string(),
                span: TextSpan { start: 0, end: 0 },
                value: StaticSzValue::Object(StaticSzObject {
                    properties: vec![property("active", StaticSzValue::Boolean(true))],
                }),
            }],
        };
        let mut out = Vec::new();
        collect_unknown_sz_keys(&object, &mut out);
        assert!(
            out.is_empty(),
            "must not warn on parametric params: {out:?}"
        );
    }

    /// A mask slot's members are geometry, not sz keys.
    ///
    /// `maskLinear` is not one of the parametric stems named beside it in the
    /// same guard — it is recognised by its own lookup — so a build that walked
    /// only that list descended into it and reported its members as classes
    /// that style nothing. Both halves of the guard have to hold on their own.
    #[test]
    fn collect_unknown_sz_keys_does_not_descend_mask_slots() {
        let slot = |key: &str, member: &str| {
            property(
                key,
                object(vec![property(member, StaticSzValue::Number(45.0))]),
            )
        };
        let object = StaticSzObject {
            properties: vec![
                slot("maskLinear", "angle"),
                slot("maskConic", "angle"),
                slot("maskRadial", "at"),
                property("md", object(vec![slot("maskRadial", "shape")])),
            ],
        };
        let mut out = Vec::new();
        collect_unknown_sz_keys(&object, &mut out);
        assert!(out.is_empty(), "slot members are not sz keys: {out:?}");
    }

    /// A value in the brackets csszyx writes is named once, by
    /// `bracketed-value`, so a closed-enum key does not name it a second time.
    #[cfg(feature = "native-engine")]
    #[test]
    fn a_bracketed_closed_enum_value_is_left_to_bracketed_value() {
        let object = StaticSzObject {
            properties: vec![
                property("display", StaticSzValue::String("[block]".to_string())),
                property("isolation", StaticSzValue::String("bogus".to_string())),
            ],
        };
        let mut found = Vec::new();
        collect_dead_enum_values(&object, &mut found);
        let named: Vec<_> = found
            .into_iter()
            .map(|(key, value, _)| (key, value))
            .collect();
        assert_eq!(named, [("isolation".to_string(), "bogus".to_string())]);
    }

    /// A dead enum value is reported wherever it sits, not only at the top.
    ///
    /// `display` and its three siblings emit the value as a bare class, so a
    /// typo collides with a project's own CSS rather than doing nothing. Under
    /// a variant it is the same class and the same collision, and the walk has
    /// to descend to find it.
    #[cfg(feature = "native-engine")]
    #[test]
    fn collect_dead_enum_values_descends_into_a_variant() {
        let object = StaticSzObject {
            properties: vec![StaticSzProperty {
                key: "hover".to_string(),
                span: TextSpan { start: 0, end: 0 },
                value: StaticSzValue::Object(StaticSzObject {
                    properties: vec![property(
                        "display",
                        StaticSzValue::String("bogus".to_string()),
                    )],
                }),
            }],
        };
        let mut out = Vec::new();
        collect_dead_enum_values(&object, &mut out);
        assert_eq!(
            out.iter()
                .map(|(k, v, _)| (k.as_str(), v.as_str()))
                .collect::<Vec<_>>(),
            vec![("display", "bogus")],
            "a variant hides nothing: {out:?}"
        );
    }

    /// A `.jsx` object may write a key twice, and JavaScript keeps the last
    /// value, so the value it overwrote is never named, even a group's value
    /// that a later group would have named as stray.
    #[cfg(feature = "native-engine")]
    #[test]
    fn collect_dead_enum_values_skips_the_value_a_repeated_key_overwrote() {
        let object = StaticSzObject {
            properties: vec![
                property("contain", StaticSzValue::String("size".to_string())),
                property("contain", StaticSzValue::String("strict".to_string())),
            ],
        };
        let mut out = Vec::new();
        collect_dead_enum_values(&object, &mut out);
        assert!(out.is_empty(), "{out:?}");
    }

    /// The colour-opacity shape is skipped for BOTH of its reasons at once.
    ///
    /// `{ bg: { color: 'red-500', opacity: 50 } }` is one declaration written as
    /// an object, so its members are not sz keys and must not be walked. A
    /// prefixed key whose object is NOT that shape is an ordinary nesting, and a
    /// dead value inside it still has to be reported — which is what fails if
    /// the two halves of the guard are joined with `or`.
    #[cfg(feature = "native-engine")]
    #[test]
    fn collect_dead_enum_values_walks_a_prefixed_key_that_is_not_a_colour_object() {
        let object = StaticSzObject {
            properties: vec![StaticSzProperty {
                key: "bg".to_string(),
                span: TextSpan { start: 0, end: 0 },
                value: StaticSzValue::Object(StaticSzObject {
                    properties: vec![property(
                        "position",
                        StaticSzValue::String("bogus".to_string()),
                    )],
                }),
            }],
        };
        let mut out = Vec::new();
        collect_dead_enum_values(&object, &mut out);
        assert_eq!(
            out.iter()
                .map(|(k, v, _)| (k.as_str(), v.as_str()))
                .collect::<Vec<_>>(),
            vec![("position", "bogus")],
            "only the colour-opacity object is skipped: {out:?}"
        );
    }

    /// The other half of the colour-opacity guard: the object under a prefixed
    /// key that IS the `{ color, op }` shape is one declaration, so a member
    /// that would read as a dead value outside it is never reported. Each
    /// collector that carries the guard is held to it, so dropping the guard
    /// from any one of them fails here.
    #[cfg(feature = "native-engine")]
    #[test]
    fn collectors_do_not_walk_the_members_of_a_colour_object() {
        let colour = |member: StaticSzProperty| StaticSzObject {
            properties: vec![property(
                "bg",
                object(vec![
                    property("color", StaticSzValue::String("red-500".to_string())),
                    member,
                ]),
            )],
        };

        let mut steps = Vec::new();
        super::collect_dead_spacing_steps(
            &colour(property("p", StaticSzValue::Number(1.4))),
            &mut steps,
        );
        assert!(steps.is_empty(), "spacing steps: {steps:?}");

        let mut enums = Vec::new();
        collect_dead_enum_values(
            &colour(property(
                "position",
                StaticSzValue::String("bogus".to_string()),
            )),
            &mut enums,
        );
        assert!(enums.is_empty(), "closed enums: {enums:?}");

        let mut styles = Vec::new();
        super::collect_border_side_styles(
            &colour(property(
                "borderB",
                StaticSzValue::String("none".to_string()),
            )),
            &mut styles,
        );
        assert!(styles.is_empty(), "border side styles: {styles:?}");
    }

    /// The objects `for_each_sz_object_in` hands its visitor under `key`, each
    /// named by its keys, so a case reads as the bodies the lowering reaches.
    fn sz_objects_under(key: &str, nested: StaticSzValue) -> Vec<String> {
        let StaticSzValue::Object(nested) = nested else {
            panic!("a case nests an object");
        };
        let mut visited = Vec::new();
        super::for_each_sz_object_in(key, &nested, &mut |object| {
            visited.push(
                object
                    .properties
                    .iter()
                    .map(|property| property.key.as_str())
                    .collect::<Vec<_>>()
                    .join(","),
            );
        });
        visited
    }

    /// Every dispatch arm, pinned by the bodies it reaches: an arm that fell
    /// through to the variant default would hand over the parameter object
    /// itself, whose keys are names, never sz keys.
    #[test]
    fn for_each_sz_object_in_reaches_the_bodies_the_lowering_lowers() {
        let body = || object(vec![property("p", StaticSzValue::Number(4.0))]);

        // Declaration values, not sz keys: nothing to visit.
        assert!(sz_objects_under("css", object(vec![property("padding", body())])).is_empty());
        assert!(sz_objects_under("bgImg", object(vec![property("url", body())])).is_empty());

        // A plain variant is itself the body.
        assert_eq!(sz_objects_under("hover", body()), ["p"]);

        // `not` names a condition per body; `supports` adds a level.
        assert_eq!(
            sz_objects_under(
                "not",
                object(vec![
                    property("hover", body()),
                    property("supports", object(vec![property("display:grid", body())])),
                ]),
            ),
            ["p", "p"],
        );

        // `group` and `peer`: a selector, a known variant, a key known only by
        // its variant prefix (`screenPortrait` is `portrait`), `has`, and a
        // named scope whose states hold the bodies.
        for key in ["group", "peer"] {
            assert_eq!(
                sz_objects_under(
                    key,
                    object(vec![
                        property(".item", body()),
                        property("hover", body()),
                        property("screenPortrait", body()),
                        property("has", object(vec![property(":checked", body())])),
                        property("card", object(vec![property("focus", body())])),
                    ]),
                ),
                ["p", "p", "p", "p", "p"],
                "{key}"
            );
        }
    }

    #[cfg(feature = "native-engine")]
    #[test]
    fn collect_owned_key_variants_does_not_descend_a_mask_slot() {
        let object = StaticSzObject {
            properties: vec![StaticSzProperty {
                key: "maskLinear".to_string(),
                span: TextSpan { start: 0, end: 0 },
                value: StaticSzValue::Object(StaticSzObject {
                    properties: vec![StaticSzProperty {
                        key: "--v-x".to_string(),
                        span: TextSpan { start: 0, end: 0 },
                        value: StaticSzValue::Object(StaticSzObject {
                            properties: vec![property("p", StaticSzValue::Number(4.0))],
                        }),
                    }],
                }),
            }],
        };
        let mut out = Vec::new();
        collect_owned_key_variant_objects(&object, &mut out);
        assert!(
            out.is_empty(),
            "a mask slot's members are geometry, not owned keys: {out:?}"
        );
    }

    #[test]
    fn needs_brackets_extended() {
        // Color functions and CSS units must be wrapped as arbitrary values.
        assert!(needs_brackets("rgb(255,0,0)"));
        assert!(needs_brackets("hsl(200,50%,50%)"));
        assert!(needs_brackets("oklch(50% 0.1 200)"));
        assert!(needs_brackets("50dvh"));
        assert!(needs_brackets("1fr"));
        assert!(needs_brackets("1ch"));
        assert!(needs_brackets("90rad"));
        assert!(needs_brackets("180turn"));
        // Plain tokens, already-bracketed values, and bare numbers must not be wrapped.
        assert!(!needs_brackets("red-500"));
        assert!(!needs_brackets("[#333]"));
        assert!(!needs_brackets("4"));
    }

    #[test]
    fn needs_brackets_covers_any_css_function_not_a_name_list() {
        // The name lists this replaced had drifted between engines, and `env()`
        // was in none of them: `pt-env(safe-area-inset-top)` is not a class
        // Tailwind serves.
        assert!(needs_brackets("env(safe-area-inset-top)"));
        assert!(needs_brackets("fit-content(200px)"));
        assert!(needs_brackets("repeat(3,1fr)"));
        assert!(needs_brackets("color-mix(in_srgb,red,blue)"));
        // A single leading dash is a negative value, not a build-time call.
        assert!(needs_brackets("-linear-gradient(black,transparent)"));
        // Tailwind's own call and the CSS-variable shorthand keep their bare
        // form, as does a utility value ending in that shorthand; so does
        // anything with no call in it at all.
        assert!(!needs_brackets("--spacing(4)"));
        assert!(!needs_brackets("(--gap)"));
        assert!(!needs_brackets("thumb-(--c)"));
        assert!(!needs_brackets("size-(--s)"));
        assert!(!needs_brackets("full"));
        // The discriminator is the dash-then-double-dash pair around the paren.
        assert!(needs_brackets("var(--x)"));
    }

    #[test]
    fn lowers_a_custom_property_key_as_an_arbitrary_declaration() {
        // Both spellings of one declaration produce one class.
        assert_eq!(
            lower_static_sz_object(&StaticSzObject {
                properties: vec![property("--brand", StaticSzValue::String("navy".into()))],
            }),
            vec!["[--brand:navy]"]
        );
        assert_eq!(
            lower_static_sz_object(&StaticSzObject {
                properties: vec![property(
                    "css",
                    object(vec![property(
                        "--brand",
                        StaticSzValue::String("navy".into())
                    )]),
                )],
            }),
            vec!["[--brand:navy]"]
        );
        // A space would split the class attribute, so the value underscores.
        assert_eq!(
            lower_static_sz_object(&StaticSzObject {
                properties: vec![property(
                    "--edge",
                    StaticSzValue::String("1px solid red".into()),
                )],
            }),
            vec!["[--edge:1px_solid_red]"]
        );
        // A bracketed declaration has no class prefix to carry a minus, so the
        // sign stays in the value on both the key and the `css:` spelling.
        assert_eq!(
            lower_static_sz_object(&StaticSzObject {
                properties: vec![
                    property("--depth", StaticSzValue::Number(-4.0)),
                    property(
                        "css",
                        object(vec![property("zIndex", StaticSzValue::Number(-1.0))]),
                    ),
                ],
            }),
            vec!["[--depth:-4]", "[z-index:-1]"]
        );
    }

    #[test]
    fn a_custom_property_follows_the_boolean_rule_of_every_key() {
        // `false` switches a property off and `true` coerces like any scalar
        // on the key spelling; the `css:` spelling takes strings and numbers
        // only. Both are what the TypeScript lowering does, and the native
        // branch once emitted `[--x:false]` for the first case.
        assert_eq!(
            lower_static_sz_object(&StaticSzObject {
                properties: vec![
                    property("--off", StaticSzValue::Boolean(false)),
                    property("bg", StaticSzValue::String("red".into())),
                    property(
                        "hover",
                        object(vec![property("--off", StaticSzValue::Boolean(false))]),
                    ),
                    property("--on", StaticSzValue::Boolean(true)),
                    property(
                        "css",
                        object(vec![
                            property("--on", StaticSzValue::Boolean(true)),
                            property("--off", StaticSzValue::Boolean(false)),
                        ]),
                    ),
                ],
            }),
            vec!["bg-red", "[--on:true]"]
        );
    }

    #[test]
    fn a_custom_property_keeps_its_case_and_its_brackets() {
        // Custom properties are case-sensitive, unlike CSS property names,
        // and `[a]` in a declaration value is a grid line name rather than a
        // user pre-wrapping an arbitrary value.
        assert_eq!(
            lower_static_sz_object(&StaticSzObject {
                properties: vec![
                    property("--MyToken", StaticSzValue::Number(1.0)),
                    property(
                        "css",
                        object(vec![
                            property("--MyToken", StaticSzValue::Number(1.0)),
                            property("fontSize", StaticSzValue::String("1rem".into())),
                            property("--rows", StaticSzValue::String("[a] 1fr [b]".into())),
                        ]),
                    ),
                    property("--cols", StaticSzValue::String("[a]".into())),
                ],
            }),
            vec![
                "[--MyToken:1]",
                "[--MyToken:1]",
                "[font-size:1rem]",
                "[--rows:[a]_1fr_[b]]",
                "[--cols:[a]]",
            ]
        );
    }
    #[test]
    fn tailwind_build_function_scanner_handles_nested_and_malformed_input() {
        assert!(is_tailwind_build_function("--spacing(4)"));
        assert!(is_tailwind_build_function("--spacing(var(--step, \"(\"))"));
        assert!(is_tailwind_build_function("--spacing(calc(2\\) + 2))"));
        assert!(!is_tailwind_build_function("--spacing"));
        assert!(!is_tailwind_build_function("--spacing(calc(2 + 2)"));
        assert!(!is_tailwind_build_function("--spacing(4)junk"));
        assert!(!is_tailwind_build_function("--9(4)"));
        assert!(!is_tailwind_build_function("---x(4)"));
        assert!(is_tailwind_build_function("--_x(4)"));

        let long_malformed = format!("--spacing({}", "(".repeat(64 * 1024));
        assert!(!is_tailwind_build_function(&long_malformed));
    }

    #[test]
    fn lowers_primitives_in_source_order() {
        let object = StaticSzObject {
            properties: vec![
                property("p", StaticSzValue::Number(4.0)),
                property("bg", StaticSzValue::String("red-500".to_string())),
                property("fontStyle", StaticSzValue::String("italic".to_string())),
            ],
        };

        assert_eq!(
            lower_static_sz_object(&object),
            ["p-4", "bg-red-500", "italic"]
        );
    }

    /// The bracket list is a closed set: a prefix outside it, or a keyword on
    /// a prefix Tailwind names it for, keeps the value as written.
    #[test]
    fn the_keyword_bracket_list_is_closed() {
        use super::super::generated::tables::{
            is_css_wide_keyword, is_css_wide_keyword_utility, sz_capabilities, SZ_CAPABILITY_ROWS,
            SZ_CAP_CSS_WIDE_BRACKET,
        };
        assert_ne!(sz_capabilities("p") & SZ_CAP_CSS_WIDE_BRACKET, 0);
        assert_ne!(sz_capabilities("cursor") & SZ_CAP_CSS_WIDE_BRACKET, 0);
        assert_eq!(sz_capabilities("bg") & SZ_CAP_CSS_WIDE_BRACKET, 0);
        assert_eq!(sz_capabilities("no-such-key"), 0);
        // The lookup is a binary search: a row out of byte order would read
        // as a key with no column, silently.
        assert!(SZ_CAPABILITY_ROWS
            .windows(2)
            .all(|pair| pair[0].0.as_bytes() < pair[1].0.as_bytes()));
        assert!(SZ_CAPABILITY_ROWS
            .iter()
            .all(|(key, bits)| sz_capabilities(key) == *bits));
        assert!(is_css_wide_keyword("revert-layer"));
        assert!(!is_css_wide_keyword("auto"));
        assert!(is_css_wide_keyword_utility("text-inherit"));
        assert!(!is_css_wide_keyword_utility("p-inherit"));
    }

    /// A CSS-wide keyword brackets on a prefix whose arbitrary form sets the
    /// key's own property, keeps the class Tailwind serves by name, and is
    /// left as written elsewhere for the build to report.
    #[test]
    fn a_css_wide_keyword_takes_the_class_tailwind_serves_for_it() {
        let lowered = |key: &str, value: &str| {
            lower_static_sz_object(&StaticSzObject {
                properties: vec![property(key, StaticSzValue::String(value.to_string()))],
            })
        };
        assert_eq!(lowered("p", "inherit"), ["p-[inherit]"]);
        assert_eq!(lowered("bg", "inherit"), ["bg-inherit"]);
    }

    #[test]
    fn uses_generated_property_and_boolean_maps() {
        let object = StaticSzObject {
            properties: vec![
                property("start", StaticSzValue::Number(4.0)),
                property("display", StaticSzValue::String("inline-block".to_string())),
                property("bgImg", StaticSzValue::String("url(/hero.png)".to_string())),
            ],
        };

        assert_eq!(
            lower_static_sz_object(&object),
            ["start-4", "inline-block", "bg-[url(/hero.png)]"]
        );
    }

    #[test]
    fn lowers_nested_variants() {
        let object = StaticSzObject {
            properties: vec![property(
                "hover",
                StaticSzValue::Object(StaticSzObject {
                    properties: vec![property(
                        "bg",
                        StaticSzValue::String("blue-500".to_string()),
                    )],
                }),
            )],
        };

        assert_eq!(lower_static_sz_object(&object), ["hover:bg-blue-500"]);
    }

    /// A fraction lowers bare and is reported only on a spacing key with no
    /// fraction utilities and a non-zero denominator; one row per condition.
    #[test]
    fn a_fraction_is_a_spacing_fraction_only_where_the_key_has_no_fraction_utility() {
        assert!(super::is_spacing_fraction("p", "1/2"));
        assert!(super::is_spacing_fraction("gap", "10/4"));
        assert!(super::is_spacing_fraction("p", "1/10"));
        for (key, value) in [
            ("p", "1.5"),
            ("p", "1/2/3"),
            ("w", "1/2"),
            ("translateX", "1/2"),
            ("p", "1/0"),
            ("p", "1/00"),
            ("row", "1/3"),
            ("opacity", "1/2"),
        ] {
            assert!(!super::is_spacing_fraction(key, value), "{key}: {value}");
        }
        assert!(super::is_spacing_scale_key("scrollPbe"));
        assert!(!super::is_spacing_scale_key("row"));
    }

    #[cfg(feature = "native-engine")]
    #[test]
    fn a_fraction_is_written_as_the_percent_it_is_to_four_places() {
        for (value, percent) in [
            ("1/2", "50"),
            ("1/3", "33.3333"),
            ("2/3", "66.6667"),
            ("5/4", "125"),
        ] {
            assert_eq!(super::fraction_percent(value), percent, "{value}");
        }
    }

    /// Spacing fractions are collected under variants, without their `!`,
    /// and never inside a colour object.
    #[cfg(feature = "native-engine")]
    #[test]
    fn collects_a_spacing_fraction_at_any_variant_depth() {
        let text = |value: &str| StaticSzValue::String(value.to_string());
        let mut out = Vec::new();
        super::collect_spacing_fractions(
            &StaticSzObject {
                properties: vec![
                    property("p", text("1/2!")),
                    property("w", text("1/2")),
                    property("hover", object(vec![property("mx", text("2/3"))])),
                    property(
                        "bg",
                        object(vec![
                            property("color", text("red-500")),
                            property("p", text("1/2")),
                        ]),
                    ),
                ],
            },
            &mut out,
        );
        let found: Vec<_> = out
            .into_iter()
            .map(|(key, value, _)| format!("{key}:{value}"))
            .collect();
        assert_eq!(found, ["p:1/2", "mx:2/3"]);
    }

    /// A bracket `text-` value folds a leading class in only when it is a
    /// length for certain; a colour keeps both classes.
    #[test]
    fn folds_leading_into_a_bracket_text_size_and_never_into_a_colour() {
        for size in [
            "14px",
            ".875rem",
            "calc(1rem+2px)",
            "clamp(1rem,2vw,2rem)",
            "min(2rem,5vw)",
            "max(1rem,2vw)",
        ] {
            assert!(super::is_font_size_value(size), "{size}");
        }
        for colour in [
            "#f00",
            "rgb(0_0_0)",
            "oklch(0.6_0.2_30)",
            "var(--brand)",
            "red",
            "",
        ] {
            assert!(!super::is_font_size_value(colour), "{colour}");
        }
        let lower = |text: &str| {
            lower_static_sz_object(&StaticSzObject {
                properties: vec![
                    property("text", StaticSzValue::String(text.into())),
                    property("leading", StaticSzValue::Number(6.0)),
                ],
            })
        };
        assert_eq!(lower("#f00"), ["text-[#f00]", "leading-6"]);
        assert_eq!(lower("14px"), ["text-[14px]/6"]);
    }

    #[test]
    fn merges_text_size_and_leading_only_within_the_same_variant() {
        let matching = StaticSzObject {
            properties: vec![
                property(
                    "hover",
                    object(vec![property("text", StaticSzValue::String("sm".into()))]),
                ),
                property(
                    "hover",
                    object(vec![property(
                        "leading",
                        StaticSzValue::String("tight".into()),
                    )]),
                ),
            ],
        };
        assert_eq!(lower_static_sz_object(&matching), ["hover:text-sm/tight"]);

        let mismatched = StaticSzObject {
            properties: vec![
                property(
                    "hover",
                    object(vec![property("text", StaticSzValue::String("sm".into()))]),
                ),
                property(
                    "focus",
                    object(vec![property(
                        "leading",
                        StaticSzValue::String("tight".into()),
                    )]),
                ),
            ],
        };
        assert_eq!(
            lower_static_sz_object(&mismatched),
            ["hover:text-sm", "focus:leading-tight"]
        );
    }

    #[test]
    fn lowers_not_and_aria_variant_matrix() {
        let declaration = |key: &str, value: StaticSzValue| StaticSzObject {
            properties: vec![property(key, value)],
        };
        let padding = || object(vec![property("p", StaticSzValue::Number(4.0))]);

        assert_eq!(
            lower_static_sz_object(&declaration(
                "not",
                object(vec![property(
                    "supports",
                    object(vec![property("display:grid", padding())]),
                )]),
            )),
            ["not-supports-[display:grid]:p-4"]
        );
        assert_eq!(
            lower_static_sz_object(&declaration(
                "not",
                object(vec![
                    property("hover", padding()),
                    property("ignored", StaticSzValue::Boolean(false)),
                ]),
            )),
            ["not-hover:p-4"]
        );
        assert_eq!(
            lower_static_sz_object(&declaration(
                "not",
                object(vec![property("focusVisible", padding())]),
            )),
            ["not-focus-visible:p-4"]
        );
        assert_eq!(
            lower_static_sz_object(&declaration(
                "aria",
                object(vec![
                    property("checked", padding()),
                    property("busy=true", padding()),
                    property("ignored", StaticSzValue::Boolean(false)),
                ]),
            )),
            ["aria-checked:p-4", "aria-[busy=true]:p-4"]
        );
    }

    #[test]
    fn lowers_group_peer_parametric_and_named_scope_matrix() {
        let padding = |value| object(vec![property("p", StaticSzValue::Number(value))]);
        let margin = |value| object(vec![property("m", StaticSzValue::Number(value))]);
        let object = StaticSzObject {
            properties: vec![
                property(
                    "group",
                    object(vec![
                        property("ignored", StaticSzValue::Boolean(false)),
                        property(
                            "data",
                            object(vec![
                                property("active", padding(1.0)),
                                property("ignored", StaticSzValue::Boolean(false)),
                            ]),
                        ),
                        property(
                            "aria",
                            object(vec![
                                property("checked", padding(2.0)),
                                property("x=1", padding(3.0)),
                            ]),
                        ),
                        property(
                            "card",
                            object(vec![
                                property("data", object(vec![property("active", margin(1.0))])),
                                property(
                                    "aria",
                                    object(vec![
                                        property("checked", margin(2.0)),
                                        property("x=1", margin(3.0)),
                                    ]),
                                ),
                                property("ignored", StaticSzValue::Boolean(false)),
                            ]),
                        ),
                    ]),
                ),
                property(
                    "peer",
                    object(vec![property(
                        "has",
                        object(vec![property("img", padding(4.0))]),
                    )]),
                ),
            ],
        };

        assert_eq!(
            lower_static_sz_object(&object),
            [
                "group-data-[active]:p-1",
                "group-aria-checked:p-2",
                "group-aria-[x=1]:p-3",
                "group-data-[active]/card:m-1",
                "group-aria-checked/card:m-2",
                "group-aria-[x=1]/card:m-3",
                "peer-has-[img]:p-4",
            ]
        );
    }

    #[test]
    fn lowers_min_max_breakpoint_variants() {
        // Each value shape exercises one branch of the bracket decision: a
        // name and a pre-bracketed value pass through, a length is bracketed
        // as on every key, and a non-object value is skipped.
        let object = StaticSzObject {
            properties: vec![
                property(
                    "min",
                    object(vec![
                        property(
                            "330px",
                            object(vec![property("p", StaticSzValue::Number(1.0))]),
                        ),
                        property(
                            "md",
                            object(vec![property("p", StaticSzValue::Number(2.0))]),
                        ),
                        property(
                            "[40rem]",
                            object(vec![property("p", StaticSzValue::Number(3.0))]),
                        ),
                        // Only one bracket is not "already bracketed", and
                        // no length either: written as it is, for the build's
                        // dead-class check to report.
                        property(
                            "[40rem",
                            object(vec![property("p", StaticSzValue::Number(5.0))]),
                        ),
                        // A camelCase name is kebab-cased, as a bare key is.
                        property(
                            "tabletLarge",
                            object(vec![property("p", StaticSzValue::Number(6.0))]),
                        ),
                        // A bracketed value is the author's CSS and keeps its
                        // case; a lone bracket is no bracketed value.
                        property(
                            "[var(--bpLarge)]",
                            object(vec![property("p", StaticSzValue::Number(7.0))]),
                        ),
                        property(
                            "[40Rem",
                            object(vec![property("p", StaticSzValue::Number(8.0))]),
                        ),
                        property("ignored", StaticSzValue::Boolean(false)),
                    ]),
                ),
                property(
                    "max",
                    object(vec![property(
                        "900px",
                        object(vec![property(
                            "display",
                            StaticSzValue::String("none".into()),
                        )]),
                    )]),
                ),
                property(
                    "hover",
                    object(vec![property(
                        "min",
                        object(vec![property(
                            "lg",
                            object(vec![property("p", StaticSzValue::Number(4.0))]),
                        )]),
                    )]),
                ),
            ],
        };

        assert_eq!(
            lower_static_sz_object(&object),
            [
                "min-[330px]:p-1",
                "min-md:p-2",
                "min-[40rem]:p-3",
                "min-[40rem:p-5",
                "min-tablet-large:p-6",
                "min-[var(--bpLarge)]:p-7",
                "min-[40-rem:p-8",
                "max-[900px]:hidden",
                "hover:min-lg:p-4",
            ]
        );
    }

    #[test]
    fn lowers_responsive_breakpoints() {
        // Helpers to build nested variant objects compactly.
        fn obj(props: Vec<StaticSzProperty>) -> StaticSzValue {
            StaticSzValue::Object(StaticSzObject { properties: props })
        }
        let nest = |key: &str, child: StaticSzValue| StaticSzObject {
            properties: vec![property(key, child)],
        };

        // breakpoint × state, both nesting orders — order is preserved as authored.
        assert_eq!(
            lower_static_sz_object(&nest(
                "md",
                obj(vec![property(
                    "hover",
                    obj(vec![property(
                        "bg",
                        StaticSzValue::String("blue-500".into())
                    )])
                )]),
            )),
            ["md:hover:bg-blue-500"]
        );
        assert_eq!(
            lower_static_sz_object(&nest(
                "hover",
                obj(vec![property(
                    "md",
                    obj(vec![property(
                        "bg",
                        StaticSzValue::String("blue-500".into())
                    )])
                )]),
            )),
            ["hover:md:bg-blue-500"]
        );

        // breakpoint × group × state.
        assert_eq!(
            lower_static_sz_object(&nest(
                "md",
                obj(vec![property(
                    "group",
                    obj(vec![property(
                        "hover",
                        obj(vec![property("p", StaticSzValue::Number(2.0))])
                    )])
                )]),
            )),
            ["md:group-hover:p-2"]
        );

        // custom breakpoint passes through.
        assert_eq!(
            lower_static_sz_object(&nest(
                "tablet",
                obj(vec![property("p", StaticSzValue::Number(3.0))])
            )),
            ["tablet:p-3"]
        );

        // breakpoint × nested color-opacity value object.
        assert_eq!(
            lower_static_sz_object(&nest(
                "md",
                obj(vec![property(
                    "bg",
                    obj(vec![
                        property("color", StaticSzValue::String("black".into())),
                        property("op", StaticSzValue::Number(30.0)),
                    ]),
                )]),
            )),
            ["md:bg-black/30"]
        );

        // multiple breakpoints on one element keep source order.
        assert_eq!(
            lower_static_sz_object(&StaticSzObject {
                properties: vec![
                    property("sm", obj(vec![property("p", StaticSzValue::Number(1.0))])),
                    property("md", obj(vec![property("p", StaticSzValue::Number(2.0))])),
                ],
            }),
            ["sm:p-1", "md:p-2"]
        );
    }

    #[test]
    fn lowers_background_image_object_syntax() {
        let object = StaticSzObject {
            properties: vec![property(
                "bgImg",
                StaticSzValue::Object(StaticSzObject {
                    properties: vec![
                        property("gradient", StaticSzValue::String("linear".to_string())),
                        property("dir", StaticSzValue::String("to-br".to_string())),
                    ],
                }),
            )],
        };

        assert_eq!(lower_static_sz_object(&object), ["bg-linear-to-br"]);
    }

    #[test]
    fn lowers_background_image_gradient_matrix() {
        let gradient = |kind: &str, dir: Option<StaticSzValue>, interpolation: Option<&str>| {
            let mut properties = vec![property(
                "gradient",
                StaticSzValue::String(kind.to_string()),
            )];
            if let Some(dir) = dir {
                properties.push(property("dir", dir));
            }
            if let Some(interpolation) = interpolation {
                properties.push(property(
                    "in",
                    StaticSzValue::String(interpolation.to_string()),
                ));
            }
            StaticSzObject {
                properties: vec![property("bgImg", object(properties))],
            }
        };

        for (input, expected) in [
            (
                gradient("linear", Some(StaticSzValue::Number(45.0)), None),
                Some("bg-linear-45"),
            ),
            (
                gradient("linear", Some(StaticSzValue::Number(-45.0)), None),
                Some("-bg-linear-45"),
            ),
            (
                gradient("linear", Some(StaticSzValue::String("--a".into())), None),
                Some("bg-linear-(--a)"),
            ),
            (
                gradient("linear", Some(StaticSzValue::Boolean(true)), None),
                None,
            ),
            (
                gradient(
                    "linear",
                    Some(StaticSzValue::String("45deg in oklab".into())),
                    None,
                ),
                Some("bg-linear-[45deg_in_oklab]"),
            ),
            (
                gradient("linear", None, Some("oklch")),
                Some("bg-linear-to-r/oklch"),
            ),
            (gradient("radial", None, None), Some("bg-radial")),
            (
                gradient("radial", Some(StaticSzValue::String("--a".into())), None),
                Some("bg-radial-(--a)"),
            ),
            (
                gradient(
                    "radial",
                    Some(StaticSzValue::String("circle at top".into())),
                    None,
                ),
                Some("bg-radial-[circle_at_top]"),
            ),
            (gradient("conic", None, None), Some("bg-conic")),
            (
                gradient("conic", Some(StaticSzValue::Number(45.0)), None),
                Some("bg-conic-45"),
            ),
            (
                gradient("conic", Some(StaticSzValue::Number(-45.0)), None),
                Some("-bg-conic-45"),
            ),
            (
                gradient("conic", Some(StaticSzValue::String("--a".into())), None),
                Some("bg-conic-(--a)"),
            ),
            (
                gradient(
                    "conic",
                    Some(StaticSzValue::String("from 45deg".into())),
                    None,
                ),
                Some("bg-conic-[from_45deg]"),
            ),
            (
                gradient("radial", Some(StaticSzValue::Number(5.0)), None),
                None,
            ),
            (gradient("unknown", None, None), None),
        ] {
            let classes = lower_static_sz_object(&input);
            assert_eq!(classes.first().map(String::as_str), expected);
            assert_eq!(classes.len(), usize::from(expected.is_some()));
        }

        let missing_gradient = StaticSzObject {
            properties: vec![property(
                "bgImg",
                object(vec![property("dir", StaticSzValue::String("to-r".into()))]),
            )],
        };
        assert!(lower_static_sz_object(&missing_gradient).is_empty());
    }

    #[test]
    fn lowers_font_stretch_value_shapes() {
        let object = StaticSzObject {
            properties: ["condensed", "--f", "50%", "50.5%", "wide"]
                .into_iter()
                .map(|value| property("fontStretch", StaticSzValue::String(value.into())))
                .collect(),
        };

        assert_eq!(
            lower_static_sz_object(&object),
            [
                "font-stretch-condensed",
                "font-stretch-(--f)",
                "font-stretch-50%",
                "font-stretch-[50.5%]",
                "font-stretch-[wide]",
            ]
        );
    }

    #[test]
    fn lowers_tailwind_special_value_matrix() {
        let object = StaticSzObject {
            properties: vec![
                property("animationDelay", StaticSzValue::Number(150.0)),
                property("animationDelay", StaticSzValue::String("2s".into())),
                property("animationDelay", StaticSzValue::Boolean(true)),
                property("animationDelay", StaticSzValue::String("--delay".into())),
                property("fromPos", StaticSzValue::String("--stop".into())),
                property("viaPos", StaticSzValue::String("50%".into())),
                property("toPos", StaticSzValue::String("12.5%".into())),
                property("bgImg", StaticSzValue::String("none".into())),
                property("bgImg", StaticSzValue::String("linear-to-r".into())),
                property("bgImg", StaticSzValue::String("-linear-45".into())),
                property("bgImg", StaticSzValue::String("gradient-to-br".into())),
                property(
                    "bgImg",
                    StaticSzValue::String("repeating-linear-gradient(red, blue)".into()),
                ),
                property("bgImg", StaticSzValue::String("--hero".into())),
                property("bgImg", StaticSzValue::String("url(/hero.png)".into())),
                property("bgImg", StaticSzValue::String("/fallback.png".into())),
                property("content", StaticSzValue::String("none".into())),
                property("content", StaticSzValue::String("--label".into())),
                property("content", StaticSzValue::String("\"hello\"".into())),
                property("decoration", StaticSzValue::String("none".into())),
                property("fontFamily", StaticSzValue::String("--font".into())),
                property("weight", StaticSzValue::String("--weight".into())),
                property("text", StaticSzValue::String("--size".into())),
                property("textTransform", StaticSzValue::String("invalid".into())),
                property("fontStyle", StaticSzValue::String("invalid".into())),
                property("fontSmoothing", StaticSzValue::String("invalid".into())),
                property("decoration", StaticSzValue::String("invalid".into())),
                property("snapAlign", StaticSzValue::String("invalid".into())),
                property("snapStrictness", StaticSzValue::String("invalid".into())),
                property("snapStop", StaticSzValue::String("invalid".into())),
                property("snapType", StaticSzValue::String("invalid".into())),
                property("numFraction", StaticSzValue::String("diagonal".into())),
                property("numFraction", StaticSzValue::String("stacked".into())),
                property(
                    "bg",
                    object(vec![
                        property("color", StaticSzValue::String("red-500".into())),
                        property("op", StaticSzValue::Boolean(true)),
                    ]),
                ),
            ],
        };

        assert_eq!(
            lower_static_sz_object(&object),
            [
                "[animation-delay:150ms]",
                "[animation-delay:2s]",
                "[animation-delay:var(--delay)]",
                "from-(length:--stop)",
                "via-50%",
                "to-[12.5%]",
                "bg-none",
                "bg-linear-to-r",
                "-bg-linear-45",
                "bg-linear-to-br",
                "bg-[repeating-linear-gradient(red,_blue)]",
                "bg-(image:--hero)",
                "bg-[url(/hero.png)]",
                "bg-[url(/fallback.png)]",
                "content-none",
                "content-(--label)",
                "content-['hello']",
                "no-underline",
                "font-(family-name:--font)",
                "font-(--weight)",
                "text-(length:--size)",
                // Outside the key's own keywords, the generic spelling: a
                // class with no CSS, which the build's dead-class check names.
                "text-invalid",
                // Not a line keyword, so a `decoration-*` value, as in the
                // TypeScript core; the build reports it as a class with no CSS.
                "decoration-invalid",
                "snap-invalid",
                "snap-invalid",
                "snap-invalid",
                "diagonal-fractions",
                "stacked-fractions",
                // `op: true` is no opacity: the colour alone, and the engine
                // reports `opacity-value`.
                "bg-red-500",
            ]
        );
    }

    #[test]
    fn every_touch_and_contain_value_lowers_to_its_class() {
        for (key, value, expected) in [
            ("touch", "auto", "touch-auto"),
            ("touch", "none", "touch-none"),
            ("touch", "manipulation", "touch-manipulation"),
            ("touchPanX", "x", "touch-pan-x"),
            ("touchPanX", "left", "touch-pan-left"),
            ("touchPanX", "right", "touch-pan-right"),
            ("touchPanY", "y", "touch-pan-y"),
            ("touchPanY", "up", "touch-pan-up"),
            ("touchPanY", "down", "touch-pan-down"),
            ("contain", "none", "contain-none"),
            ("contain", "strict", "contain-strict"),
            ("contain", "content", "contain-content"),
            ("containSize", "size", "contain-size"),
            ("containSize", "inline-size", "contain-inline-size"),
        ] {
            let object = StaticSzObject {
                properties: vec![property(key, StaticSzValue::String(value.into()))],
            };
            assert_eq!(
                lower_static_sz_object(&object),
                [expected],
                "{key}: {value}"
            );
        }
    }

    // A stand-alone key switched off shadows nothing: the groups around it
    // still combine.
    #[test]
    fn a_stand_alone_key_set_false_leaves_its_groups_alone() {
        let object = StaticSzObject {
            properties: vec![
                property("containLayout", StaticSzValue::Boolean(true)),
                property("contain", StaticSzValue::Boolean(false)),
                property("containPaint", StaticSzValue::Boolean(true)),
            ],
        };

        assert_eq!(
            lower_static_sz_object(&object),
            ["contain-layout", "contain-paint"]
        );
    }

    #[test]
    fn a_closed_enum_typo_keeps_its_key_fixed_part() {
        for (key, expected) in [
            ("display", "bogus"),
            ("isolation", "isolation-bogus"),
            ("nums", "bogus-nums"),
            ("numFigure", "bogus-nums"),
            ("numSpacing", "bogus-nums"),
            ("numFraction", "bogus-fractions"),
        ] {
            assert_eq!(
                super::bare_closed_enum_class(key, "bogus"),
                expected,
                "{key}"
            );
        }
    }

    #[test]
    fn special_lowering_helpers_fail_closed_on_invalid_shapes() {
        let object = StaticSzObject {
            properties: vec![
                property(
                    "css",
                    object(vec![
                        property("zIndex", StaticSzValue::Number(2.0)),
                        // A boolean is not a declaration value under `css:`,
                        // the same as the TypeScript lowering.
                        property("inert", StaticSzValue::Boolean(true)),
                        property("nested", object(vec![])),
                    ]),
                ),
                property(
                    "has",
                    object(vec![
                        property(
                            ":focus",
                            object(vec![property("p", StaticSzValue::Number(1.0))]),
                        ),
                        property(
                            "hover",
                            object(vec![property("p", StaticSzValue::Number(2.0))]),
                        ),
                    ]),
                ),
                property(
                    "perspectiveOrigin",
                    StaticSzValue::String("top-right".into()),
                ),
                property(
                    "bgImg",
                    object(vec![
                        property("gradient", StaticSzValue::String("conic".into())),
                        property("dir", StaticSzValue::Boolean(true)),
                    ]),
                ),
            ],
        };
        assert_eq!(
            lower_static_sz_object(&object),
            [
                "[z-index:2]",
                "has-[:focus]:p-1",
                "has-[:hover]:p-2",
                "perspective-origin-top-right",
            ]
        );

        assert!(format_value_object("unknown", &StaticSzObject::empty(), "").is_none());
        assert!(format_value_object("bg", &StaticSzObject::empty(), "").is_none());
        assert!(!is_percent("1.2.3%"));
        assert!(!is_unsigned_decimal("1.2.3"));
    }

    #[test]
    fn lowers_arbitrary_css_sub_properties() {
        let object = StaticSzObject {
            properties: vec![property(
                "hover",
                StaticSzValue::Object(StaticSzObject {
                    properties: vec![property(
                        "css",
                        StaticSzValue::Object(StaticSzObject {
                            properties: vec![
                                property(
                                    "writingMode",
                                    StaticSzValue::String("vertical-lr".to_string()),
                                ),
                                property(
                                    "--brand",
                                    StaticSzValue::String("rgb(1 2 3)".to_string()),
                                ),
                            ],
                        }),
                    )],
                }),
            )],
        };

        assert_eq!(
            lower_static_sz_object(&object),
            [
                "hover:[writing-mode:vertical-lr]",
                "hover:[--brand:rgb(1_2_3)]"
            ]
        );
    }

    #[test]
    fn reads_a_bracketed_variant_string_prefix() {
        assert_eq!(
            variant_string_prefix("min-[40rem]").as_deref(),
            Some("min-[40rem]")
        );
        assert!(variant_string_prefix("unknown-[value]").is_none());
        assert!(variant_string_prefix("unknown-[value").is_none());
    }

    #[test]
    fn builds_every_mask_stop_shape() {
        assert_eq!(
            build_mask_stop_classes("mask-from", None),
            Vec::<String>::new()
        );
        assert_eq!(
            build_mask_stop_classes("mask-from", Some(&StaticSzValue::Number(12.5))),
            ["mask-from-12.5"]
        );
        assert_eq!(
            build_mask_stop_classes("mask-from", Some(&StaticSzValue::String("--at".into()))),
            ["mask-from-(--at)"]
        );
        assert_eq!(
            build_mask_stop_classes("mask-from", Some(&StaticSzValue::String("20%".into()))),
            ["mask-from-20%"]
        );

        let rich_stop = object(vec![
            property("at", StaticSzValue::Number(25.0)),
            property("color", StaticSzValue::String("--brand".into())),
            property("op", StaticSzValue::String("40%".into())),
        ]);
        let StaticSzValue::Object(rich_stop) = rich_stop else {
            unreachable!()
        };
        assert_eq!(
            build_mask_stop_classes("mask-from", Some(&StaticSzValue::Object(rich_stop))),
            ["mask-from-25", "mask-from-(color:--brand)/[40%]"]
        );

        for at in [
            StaticSzValue::String("--at".into()),
            StaticSzValue::String("30%".into()),
        ] {
            let stop = object(vec![property("at", at)]);
            let StaticSzValue::Object(stop) = stop else {
                unreachable!()
            };
            assert_eq!(
                build_mask_stop_classes("mask-from", Some(&StaticSzValue::Object(stop))).len(),
                1
            );
        }
        let numeric_op = object(vec![
            property("color", StaticSzValue::String("red-500".into())),
            property("op", StaticSzValue::Number(50.0)),
        ]);
        let StaticSzValue::Object(numeric_op) = numeric_op else {
            unreachable!()
        };
        assert_eq!(
            build_mask_stop_classes("mask-from", Some(&StaticSzValue::Object(numeric_op))),
            ["mask-from-red-500/50"]
        );

        let invalid_stop = object(vec![
            property("at", StaticSzValue::Boolean(true)),
            property("color", StaticSzValue::String("red-500".into())),
            property("op", StaticSzValue::Boolean(true)),
        ]);
        let StaticSzValue::Object(invalid_stop) = invalid_stop else {
            unreachable!()
        };
        assert_eq!(
            build_mask_stop_classes("mask-to", Some(&StaticSzValue::Object(invalid_stop))),
            ["mask-to-red-500"]
        );
        assert!(build_mask_stop_classes("mask-to", Some(&StaticSzValue::Boolean(true))).is_empty());
    }

    #[test]
    fn builds_every_mask_slot_shape() {
        let radial = StaticSzObject {
            properties: vec![
                property("at", StaticSzValue::String("top".into())),
                property("size", StaticSzValue::String("closest-side".into())),
                property("shape", StaticSzValue::String("circle".into())),
                property("from", StaticSzValue::String("0%".into())),
                property("to", StaticSzValue::String("100%".into())),
            ],
        };
        assert_eq!(
            build_mask_radial_classes(&radial),
            [
                "mask-radial-at-top",
                "mask-radial-closest-side",
                "mask-circle",
                "mask-radial-from-0%",
                "mask-radial-to-100%",
            ]
        );

        for (angle, expected) in [
            (StaticSzValue::Number(-45.0), "-mask-linear-45"),
            (StaticSzValue::Number(45.0), "mask-linear-45"),
            (
                StaticSzValue::String("--angle".into()),
                "mask-linear-(--angle)",
            ),
            (StaticSzValue::String("to-r".into()), "mask-linear-to-r"),
        ] {
            let slot = StaticSzObject {
                properties: vec![property("angle", angle)],
            };
            assert_eq!(build_mask_slot_classes("maskLinear", &slot), [expected]);
        }
        assert!(build_mask_slot_classes(
            "maskLinear",
            &StaticSzObject {
                properties: vec![property("angle", StaticSzValue::Boolean(true))],
            },
        )
        .is_empty());
        let edge_slot = StaticSzObject {
            properties: vec![property(
                "x",
                object(vec![
                    property("from", StaticSzValue::String("10%".into())),
                    property("to", StaticSzValue::String("90%".into())),
                ]),
            )],
        };
        assert_eq!(
            build_mask_slot_classes("maskLinear", &edge_slot),
            ["mask-x-from-10%", "mask-x-to-90%"]
        );
        assert_eq!(
            build_mask_slot_classes(
                "maskConic",
                &StaticSzObject {
                    properties: vec![property("angle", StaticSzValue::Number(30.0))],
                },
            ),
            ["mask-conic-30"]
        );
    }

    #[test]
    fn classifies_mask_layer_values_sizes_and_positions() {
        assert!(is_mask_layer_value("linear-from-20%"));
        assert!(is_mask_layer_value("-radial"));
        assert!(!is_mask_layer_value("linear-gradient(red,blue)"));
        assert!(!is_mask_layer_value("image"));
        assert_eq!(format_mask_size("cover"), "mask-cover");
        assert_eq!(format_mask_size("--size"), "mask-size-(--size)");
        assert_eq!(format_mask_size("20px 30px"), "mask-size-[20px_30px]");
        assert_eq!(format_mask_position("center"), "mask-center");
        assert_eq!(format_mask_position("--pos"), "mask-position-(--pos)");
        assert_eq!(
            format_mask_position("20px 30px"),
            "mask-position-[20px_30px]"
        );

        let direct = StaticSzObject {
            properties: vec![
                property("mask", StaticSzValue::String("linear".into())),
                property(
                    "bgImg",
                    StaticSzValue::String("linear-gradient(red, blue)".into()),
                ),
            ],
        };
        assert_eq!(
            lower_static_sz_object(&direct),
            ["bg-[linear-gradient(red,_blue)]"]
        );
    }

    #[test]
    fn lowers_background_size_and_content_special_cases() {
        let object = StaticSzObject {
            properties: vec![property(
                "before",
                StaticSzValue::Object(StaticSzObject {
                    properties: vec![
                        property("bgSize", StaticSzValue::String("24px 24px".to_string())),
                        property("bgRepeat", StaticSzValue::String("no-repeat".to_string())),
                        property("content", StaticSzValue::String("''".to_string())),
                    ],
                }),
            )],
        };

        assert_eq!(
            lower_static_sz_object(&object),
            [
                "before:bg-[length:24px_24px]",
                "before:bg-no-repeat",
                "before:content-['']"
            ]
        );
    }

    #[test]
    fn lowers_display_position_visibility_to_bare_utilities() {
        let object = StaticSzObject {
            properties: vec![
                property("display", StaticSzValue::String("flex".to_string())),
                property("position", StaticSzValue::String("absolute".to_string())),
                property("visibility", StaticSzValue::String("visible".to_string())),
                property("isolation", StaticSzValue::String("isolate".to_string())),
            ],
        };
        assert_eq!(
            lower_static_sz_object(&object),
            ["flex", "absolute", "visible", "isolate"]
        );
    }

    #[test]
    fn lowers_display_none_and_visibility_hidden_to_aliases() {
        let object = StaticSzObject {
            properties: vec![
                property("display", StaticSzValue::String("none".to_string())),
                property("visibility", StaticSzValue::String("hidden".to_string())),
                property("display", StaticSzValue::String("inline-flex".to_string())),
            ],
        };
        assert_eq!(
            lower_static_sz_object(&object),
            ["hidden", "invisible", "inline-flex"]
        );
    }

    fn color_op(prop: &str, color: &str, op: Option<StaticSzValue>) -> Vec<String> {
        let mut props = vec![property("color", StaticSzValue::String(color.to_string()))];
        if let Some(op) = op {
            props.push(property("op", op));
        }
        let object = StaticSzObject {
            properties: vec![property(
                prop,
                StaticSzValue::Object(StaticSzObject { properties: props }),
            )],
        };
        lower_static_sz_object(&object)
    }

    #[test]
    fn lowers_color_opacity_objects() {
        assert_eq!(
            color_op("bg", "blue-500", Some(StaticSzValue::Number(20.0))),
            ["bg-blue-500/20"]
        );
        assert_eq!(
            color_op("bg", "--my-color", Some(StaticSzValue::Number(50.0))),
            ["bg-(--my-color)/50"]
        );
        assert_eq!(
            color_op("bg", "#0d0d12", Some(StaticSzValue::Number(90.0))),
            ["bg-[#0d0d12]/90"]
        );
        assert_eq!(
            color_op("bg", "black", Some(StaticSzValue::Number(0.05))),
            ["bg-black/[0.05%]"]
        );
        assert_eq!(
            color_op(
                "bg",
                "pink-500",
                Some(StaticSzValue::String("78%".to_string()))
            ),
            ["bg-pink-500/[78%]"]
        );
        // `color` maps to the `text` utility, mirroring the property map.
        assert_eq!(
            color_op("color", "white", Some(StaticSzValue::Number(70.0))),
            ["text-white/70"]
        );
        // No `op` member → plain color utility, no slash.
        assert_eq!(color_op("bg", "white", None), ["bg-white"]);
    }

    #[test]
    fn lowers_shadow_family_var_colors_with_color_hint() {
        // Object form: a bare `(--c)` after a shadow-family prefix would set
        // the shadow VALUE, so the lowering adds the `color:` hint.
        assert_eq!(
            color_op("shadowColor", "--c", Some(StaticSzValue::Number(50.0))),
            ["shadow-(color:--c)/50"]
        );
        assert_eq!(
            color_op("insetShadowColor", "--c", Some(StaticSzValue::Number(30.0))),
            ["inset-shadow-(color:--c)/30"]
        );
        assert_eq!(
            color_op("textShadowColor", "--c", Some(StaticSzValue::Number(25.0))),
            ["text-shadow-(color:--c)/25"]
        );
        assert_eq!(
            color_op("dropShadowColor", "--c", Some(StaticSzValue::Number(40.0))),
            ["drop-shadow-(color:--c)/40"]
        );
        // Fractional half-step opacity stays bare (Tailwind 4.3.3 supports
        // fractional modifiers on shadow utilities).
        assert_eq!(
            color_op("shadowColor", "--c", Some(StaticSzValue::Number(12.5))),
            ["shadow-(color:--c)/12.5"]
        );
        // Non-shadow color prefixes keep the bare paren form.
        assert_eq!(color_op("bg", "--c", None), ["bg-(--c)"]);

        // String form routes through the generic CSS-var type hints.
        for (key, expected) in [
            ("shadowColor", "shadow-(color:--c)"),
            ("insetShadowColor", "inset-shadow-(color:--c)"),
            ("textShadowColor", "text-shadow-(color:--c)"),
            ("dropShadowColor", "drop-shadow-(color:--c)"),
        ] {
            let object = StaticSzObject {
                properties: vec![property(key, StaticSzValue::String("--c".into()))],
            };
            assert_eq!(lower_static_sz_object(&object), [expected]);
        }
    }

    #[cfg(feature = "native-engine")]
    #[test]
    fn collects_dead_spacing_steps() {
        let object = StaticSzObject {
            properties: vec![
                property("p", StaticSzValue::Number(1.4)),
                property("m", StaticSzValue::Number(1.5)),
                property("gap", StaticSzValue::String("1.1".into())),
                property("mx", StaticSzValue::String("1.5".into())),
                property("w", StaticSzValue::String("1.4rem".into())),
                property("leading", StaticSzValue::Number(1.4)),
                property("hidden", StaticSzValue::Boolean(true)),
                property(
                    "hover",
                    StaticSzValue::Object(StaticSzObject {
                        properties: vec![property("p", StaticSzValue::Number(2.3))],
                    }),
                ),
            ],
        };
        let mut out: Vec<(String, f64, u32)> = Vec::new();
        super::collect_dead_spacing_steps(&object, &mut out);
        let keys: Vec<(&str, f64)> = out.iter().map(|(k, v, _)| (k.as_str(), *v)).collect();
        // 1.5 is a quarter step, "1.4rem" carries a unit, and leading falls
        // back to the unitless-ratio bracket — none of those warn.
        assert_eq!(keys, [("p", 1.4), ("gap", 1.1), ("p", 2.3)]);
    }

    #[cfg(feature = "native-engine")]
    #[test]
    fn collects_property_object_values() {
        let color_op = StaticSzValue::Object(StaticSzObject {
            properties: vec![
                property("color", StaticSzValue::String("blue-500".into())),
                property("op", StaticSzValue::Number(50.0)),
            ],
        });
        let object = StaticSzObject {
            properties: vec![
                // Property key with a stray object → reported with nested keys.
                property(
                    "p",
                    StaticSzValue::Object(StaticSzObject {
                        properties: vec![property("bg", StaticSzValue::String("red-500".into()))],
                    }),
                ),
                // Color-op form on a property key is documented — silent.
                property("bg", color_op),
                // Variant nesting is legit, but the walk descends into it.
                property(
                    "hover",
                    StaticSzValue::Object(StaticSzObject {
                        properties: vec![property(
                            "shadow",
                            StaticSzValue::Object(StaticSzObject {
                                properties: vec![property("op", StaticSzValue::Number(12.5))],
                            }),
                        )],
                    }),
                ),
                // Parametric variants own their nested shape — silent.
                property(
                    "data",
                    StaticSzValue::Object(StaticSzObject {
                        properties: vec![property("active", StaticSzValue::Boolean(true))],
                    }),
                ),
            ],
        };
        let mut out: Vec<(String, Vec<String>, u32)> = Vec::new();
        super::collect_property_object_values(&object, &mut out);
        let found: Vec<(&str, String)> = out
            .iter()
            .map(|(k, n, _)| (k.as_str(), n.join(", ")))
            .collect();
        assert_eq!(
            found,
            [("p", "bg".to_string()), ("shadow", "op".to_string())]
        );
    }

    #[test]
    fn lowers_named_scope_markers() {
        // { group: 'item' } is the marker CLASS (group/item), not a variant —
        // the generic kebab fallthrough would wrongly emit group-item.
        for (key, value, expected) in [
            ("group", "item", "group/item"),
            ("peer", "form", "peer/form"),
        ] {
            let object = StaticSzObject {
                properties: vec![property(key, StaticSzValue::String(value.into()))],
            };
            assert_eq!(lower_static_sz_object(&object), [expected]);
        }
    }

    #[test]
    fn kebab_cases_unknown_keys() {
        let object = StaticSzObject {
            properties: vec![property("breakWord", StaticSzValue::Boolean(true))],
        };
        assert_eq!(lower_static_sz_object(&object), ["break-word"]);
    }

    /// A key holding an object is spelled as the runtime spells it: a
    /// project variant in camelCase becomes kebab-case, an arbitrary variant
    /// loses its spaces, a container query keeps its own name.
    #[test]
    fn spells_an_object_key_variant_as_the_runtime_does() {
        let nested = |key: &str| {
            property(
                key,
                StaticSzValue::Object(StaticSzObject {
                    properties: vec![property("p", StaticSzValue::Number(1.0))],
                }),
            )
        };
        let object = StaticSzObject {
            properties: vec![
                nested("tabletLarge"),
                nested("hover"),
                nested("[& > li]"),
                nested("@maxSm"),
                nested("@fooBar"),
                nested("desktop-sm"),
            ],
        };
        assert_eq!(
            lower_static_sz_object(&object),
            [
                "tablet-large:p-1",
                "hover:p-1",
                "[&>li]:p-1",
                "@max-sm:p-1",
                "@fooBar:p-1",
                "desktop-sm:p-1",
            ]
        );
    }

    /// A slash opacity is written as given on every key, the colour utility
    /// Tailwind serves on every v4.
    #[test]
    fn writes_a_slash_opacity_string_as_given_on_every_key() {
        let string = |key: &str, value: &str| property(key, StaticSzValue::String(value.into()));
        let object = StaticSzObject {
            properties: vec![
                string("bg", "red-500/50"),
                string("fill", "red-500/50"),
                string("text", "red-500/50"),
                string("decoration", "red-500/50"),
                string("p", "red-500/50"),
            ],
        };
        assert_eq!(
            lower_static_sz_object(&object),
            [
                "bg-red-500/50",
                "fill-red-500/50",
                "text-red-500/50",
                "decoration-red-500/50",
                "p-red-500/50"
            ]
        );
    }

    /// Tailwind gives an untyped variable to the prefix's default utility, so
    /// a key that sets another property writes its type in front, in every
    /// spelling of a variable; a key whose prefix default is its own type, or
    /// a value that is not a lone variable, is left alone.
    #[test]
    fn spells_a_variable_with_the_type_its_key_takes() {
        let string = |key: &str, value: &str| property(key, StaticSzValue::String(value.into()));
        let object = StaticSzObject {
            properties: vec![
                string("bgPos", "var(--x, 50% 50%)"),
                string("bgSize", "--x"),
                string("bgImg", "var(--x)"),
                string("border", "--x"),
                string("borderT", "--x"),
                string("fromPos", "--x"),
                string("shadowColor", "var(--x)!"),
                string("bg", "var(--x)"),
                string("p", "--x"),
                string("text", "(--x)y"),
                string("text", "(--x(1))"),
                string("text", "(a--x)"),
            ],
        };
        assert_eq!(
            lower_static_sz_object(&object),
            [
                "bg-[position:var(--x,_50%_50%)]",
                "bg-(length:--x)",
                "bg-[image:var(--x)]",
                "border-(length:--x)",
                "border-t-(length:--x)",
                "from-(length:--x)",
                "shadow-[color:var(--x)]!",
                "bg-[var(--x)]",
                "p-(--x)",
                "text-(--x)y",
                "text-(--x(1))",
                "text-(a--x)",
            ]
        );
    }

    /// A gradient layer on `mask` emits nothing and is collected, bang removed,
    /// under every variant and parametric variant, as the lowering reaches it.
    #[cfg(feature = "native-engine")]
    #[test]
    fn collects_gradient_layers_written_on_mask() {
        let string = |key: &str, value: &str| property(key, StaticSzValue::String(value.into()));
        let object = StaticSzObject {
            properties: vec![
                string("mask", "linear-45!"),
                string("mask", "url(/m.png)"),
                string("maskSize", "linear"),
                property(
                    "hover",
                    StaticSzValue::Object(StaticSzObject {
                        properties: vec![string("mask", "-radial")],
                    }),
                ),
                property(
                    "data",
                    StaticSzValue::Object(StaticSzObject {
                        properties: vec![property(
                            "state=open",
                            StaticSzValue::Object(StaticSzObject {
                                properties: vec![string("mask", "conic-from-10")],
                            }),
                        )],
                    }),
                ),
            ],
        };
        let mut found = Vec::new();
        collect_mask_layer_values(&object, &mut found);
        assert_eq!(
            found
                .iter()
                .map(|(value, key, _)| (value.as_str(), *key))
                .collect::<Vec<_>>(),
            [
                ("linear-45", "maskLinear"),
                ("-radial", "maskRadial"),
                ("conic-from-10", "maskConic"),
            ]
        );
        assert_eq!(super::mask_layer_key("linearish"), None);
    }

    /// Background size uses the `length:` hint every Tailwind v4 serves.
    #[test]
    fn spells_background_size_with_the_length_hint() {
        let string = |value: &str| property("bgSize", StaticSzValue::String(value.into()));
        let object = StaticSzObject {
            properties: vec![string("cover"), string("8px 8px"), string("--x")],
        };
        assert_eq!(
            lower_static_sz_object(&object),
            ["bg-cover", "bg-[length:8px_8px]", "bg-(length:--x)"]
        );
    }

    /// `bg-(--x)` is a background colour, so a custom property on `bgPos`
    /// takes the `position:` hint every Tailwind v4 serves.
    #[test]
    fn spells_a_background_position_variable_with_the_position_hint() {
        let string = |value: &str| property("bgPos", StaticSzValue::String(value.into()));
        let object = StaticSzObject {
            properties: vec![string("center"), string("--x"), string("--y!")],
        };
        assert_eq!(
            lower_static_sz_object(&object),
            ["bg-center", "bg-(position:--x)", "bg-(position:--y)!"]
        );
    }

    #[test]
    fn lowers_bare_fractions_native_or_arbitrary() {
        let supported = StaticSzObject {
            properties: vec![
                property("w", StaticSzValue::String("1/2".to_string())),
                property("basis", StaticSzValue::String("1/3".to_string())),
            ],
        };
        assert_eq!(lower_static_sz_object(&supported), ["w-1/2", "basis-1/3"]);

        // A spacing key with no fraction utilities writes the bare class a
        // Tailwind author would (reported as `off-scale-value`); any other key
        // keeps the bracket, where it is valid CSS.
        let spacing = StaticSzObject {
            properties: vec![property("p", StaticSzValue::String("1/2".to_string()))],
        };
        assert_eq!(lower_static_sz_object(&spacing), ["p-1/2"]);
        let arbitrary = StaticSzObject {
            properties: vec![property("row", StaticSzValue::String("1/3".to_string()))],
        };
        assert_eq!(lower_static_sz_object(&arbitrary), ["row-[1/3]"]);
    }

    #[test]
    fn escapes_spaces_in_arbitrary_values() {
        let object = StaticSzObject {
            properties: vec![property(
                "gridCols",
                StaticSzValue::String("280px minmax(0,1fr)".to_string()),
            )],
        };
        assert_eq!(
            lower_static_sz_object(&object),
            ["grid-cols-[280px_minmax(0,1fr)]"]
        );
    }

    #[test]
    fn variant_string_prefix_mirrors_the_typescript_predicate() {
        // Shape-for-shape with `variantStringPrefix` in transform-core.ts —
        // the pinned contract is that a build.parser flip cannot change which
        // keys colon-join a string value.
        assert_eq!(variant_string_prefix("hover").as_deref(), Some("hover"));
        assert_eq!(
            variant_string_prefix("[& > li]").as_deref(),
            Some("[&>li]"),
            "arbitrary variants collapse whitespace"
        );
        assert_eq!(
            variant_string_prefix("data-[open]").as_deref(),
            Some("data-[open]")
        );
        assert_eq!(
            variant_string_prefix("min-[900px]").as_deref(),
            Some("min-[900px]")
        );
        assert_eq!(
            variant_string_prefix("group-hover").as_deref(),
            Some("group-hover")
        );
        assert_eq!(
            variant_string_prefix("aria-checked").as_deref(),
            Some("aria-checked")
        );
        assert_eq!(
            variant_string_prefix("data-open").as_deref(),
            Some("data-open")
        );
    }

    /// A variant key takes the runtime for a value only the runtime knows; a
    /// property key, or an unknown one, keeps its own lane.
    #[cfg(feature = "native-engine")]
    #[test]
    fn is_variant_key_names_variants_by_table_shape_or_stem() {
        for key in [
            "hover",
            "md",
            "dark",
            "[&>li]",
            "@md",
            "data",
            "group",
            "supports",
            // The project's own namespace: no table claims these.
            "tablet",
            "desktop-sm",
            "1280",
            "xyzzy",
        ] {
            assert!(super::is_variant_key(key), "{key}");
        }
        // An ARIA state name keeps the lane it had for a runtime value; that a
        // scalar on it is an unknown key is `collect_unknown_sz_keys`' answer.
        for key in [
            "p",
            "bg",
            "maskLinear",
            "--brand",
            "container",
            "truncate",
            "expanded",
            "hidden",
        ] {
            assert!(!super::is_variant_key(key), "{key}");
        }
    }

    #[test]
    fn variant_string_prefix_rejects_non_variants() {
        // A typo'd key must keep reaching the unknown-property path; silently
        // minting a variant would hide the typo forever.
        assert_eq!(variant_string_prefix("foo-[bar]"), None);
        assert_eq!(
            variant_string_prefix("not-italic"),
            None,
            "not-italic is the font-style utility, not a variant chain"
        );
        assert_eq!(
            variant_string_prefix("aria-foo"),
            None,
            "unknown aria attributes need the bracket form"
        );
        for key in ["translateX", "p", "bg", "foo", "50"] {
            assert_eq!(variant_string_prefix(key), None, "{key}");
        }
    }

    #[test]
    fn string_value_under_a_variant_key_colon_joins() {
        let object = StaticSzObject {
            properties: vec![property(
                "data-[ending-style]",
                StaticSzValue::String("translate-x-full".to_string()),
            )],
        };
        assert_eq!(
            lower_static_sz_object(&object),
            vec!["data-[ending-style]:translate-x-full".to_string()]
        );
    }

    #[test]
    fn lowers_negative_and_skips_false_booleans() {
        // A `false` value emits nothing. The italic/antialiased `false` aliases
        // were removed with the boolean sugar — use { fontStyle: 'normal' }.
        let object = StaticSzObject {
            properties: vec![
                property("m", StaticSzValue::Number(-2.0)),
                property("grow", StaticSzValue::Boolean(false)),
                property("fontStyle", StaticSzValue::String("normal".to_string())),
            ],
        };

        assert_eq!(lower_static_sz_object(&object), ["-m-2", "not-italic"]);
    }

    #[test]
    fn drops_removed_boolean_sugar_and_keeps_flex_shorthand() {
        // { flex: true } (removed display sugar) emits nothing; { flex: 1 }
        // (flex-grow shorthand) is untouched.
        let removed = StaticSzObject {
            properties: vec![
                property("flex", StaticSzValue::Boolean(true)),
                property("absolute", StaticSzValue::Boolean(true)),
                property("italic", StaticSzValue::Boolean(true)),
                property("p", StaticSzValue::Number(4.0)),
            ],
        };
        assert_eq!(lower_static_sz_object(&removed), ["p-4"]);

        let shorthand = StaticSzObject {
            properties: vec![property("flex", StaticSzValue::Number(1.0))],
        };
        assert_eq!(lower_static_sz_object(&shorthand), ["flex-1"]);
    }

    #[test]
    fn lowers_canonical_single_property_typography() {
        let object = StaticSzObject {
            properties: vec![
                property(
                    "textTransform",
                    StaticSzValue::String("uppercase".to_string()),
                ),
                property("decoration", StaticSzValue::String("underline".to_string())),
                property(
                    "fontSmoothing",
                    StaticSzValue::String("grayscale".to_string()),
                ),
                property("textTransform", StaticSzValue::String("none".to_string())),
            ],
        };
        // Source order preserved; textTransform appears twice (last is the reset).
        assert_eq!(
            lower_static_sz_object(&object),
            ["uppercase", "underline", "antialiased", "normal-case"]
        );
    }

    #[test]
    fn brackets_arbitrary_values_and_writes_slash_opacity_as_given() {
        let object = StaticSzObject {
            properties: vec![
                property("w", StaticSzValue::String("12px".to_string())),
                property("bg", StaticSzValue::String("red-500/50".to_string())),
            ],
        };

        assert_eq!(
            lower_static_sz_object(&object),
            ["w-[12px]", "bg-red-500/50"]
        );
    }

    #[test]
    fn lowers_source_ir_classes_in_source_order() {
        let ir = SourceIr {
            filename: "/repo/src/App.tsx".to_string(),
            source_span: TextSpan::new(0, 80).expect("valid span"),
            sz_attributes: vec![SzAttributeIr {
                attribute_span: TextSpan::new(10, 26).expect("valid span"),
                value_span: TextSpan::new(14, 25).expect("valid span"),
                object: StaticSzObject {
                    properties: vec![StaticSzProperty {
                        key: "start".to_string(),
                        span: TextSpan::new(17, 25).expect("valid span"),
                        value: StaticSzValue::Number(4.0),
                    }],
                },
                literal_class_name: None,
                rewrites_empty_class: false,
                ternaries: Vec::new(),
                array_parts: Vec::new(),
                runtime_fallback: false,
                runtime_fallback_spread: false,
                candidate_classes: Vec::new(),
                runtime_fallback_diagnostic: None,
                dynamic_css_vars: Vec::new(),
                dropped_dynamic_keys: Vec::new(),
                folded_attribute_spans: Vec::new(),
            }],
            unsupported_sz_attribute_spans: Vec::new(),
            class_attributes: vec![ClassAttributeIr {
                attribute_span: TextSpan::new(28, 46).expect("valid span"),
                value_span: TextSpan::new(39, 44).expect("valid span"),
                value: "block".to_string(),
                expression_span: None,
            }],
            extracted_classes: Vec::new(),
            site_fallbacks: Vec::new(),
            szr_import_rewrite: None,
            szv_replacements: Vec::new(),
            szv_table_insertions: Vec::new(),
            uses_szv_pick: false,
            uses_szv_pick1: false,
            style_attributes: Vec::new(),
            recovery_attributes: Vec::new(),
            unsupported_recovery_attributes: Vec::new(),
            jsx_opening_elements: Vec::new(),
            szs_attributes: Vec::new(),
            szs_diagnostics: Vec::new(),
            catalog_sz_objects: Vec::new(),
            duplicate_sz_attributes: Vec::new(),
            spread_split_classes: Vec::new(),
            omitted_sz_objects: Vec::new(),
            dynamic_group_conflicts: Vec::new(),
            deferred_variant_keys: Vec::new(),
        };

        let lowered = lower_source_ir_classes(&ir);

        assert_eq!(lowered.classes, ["start-4"]);
        assert_eq!(lowered.raw_class_names, ["block"]);
    }

    #[cfg(feature = "native-engine")]
    fn mask_member_hits(object: &StaticSzObject) -> Vec<(String, String)> {
        let mut out = Vec::new();
        super::collect_unknown_mask_slot_members(object, &mut out);
        out.into_iter()
            .map(|(owner, member, _allowed, _offset)| (owner, member))
            .collect()
    }

    #[cfg(feature = "native-engine")]
    fn color_member_hits(object: &StaticSzObject) -> Vec<(String, String)> {
        let mut out = Vec::new();
        super::collect_unknown_color_object_members(object, &mut out);
        out.into_iter()
            .map(|(owner, member, allowed, _offset)| {
                assert_eq!(allowed, ["color", "op"]);
                (owner, member)
            })
            .collect()
    }

    /// A colour object reads `color` and `op`; any other member is named, at
    /// any depth, and only on a colour object: a mask stop, `bgImg` and an
    /// object whose `color` is not a string are not one. Mirrors the
    /// TypeScript check in `collectObjectProperty`.
    #[cfg(feature = "native-engine")]
    #[test]
    fn names_a_colour_object_member_it_does_not_read() {
        let color = || property("color", StaticSzValue::String("rose-500".into()));
        let named = StaticSzObject {
            properties: vec![
                property(
                    "ring",
                    object(vec![property("width", StaticSzValue::Number(2.0)), color()]),
                ),
                property(
                    "hover",
                    object(vec![property(
                        "bg",
                        object(vec![color(), property("op", StaticSzValue::Number(50.0))]),
                    )]),
                ),
            ],
        };
        assert_eq!(
            color_member_hits(&named),
            [("ring".to_string(), "width".to_string())]
        );

        let silent = StaticSzObject {
            properties: vec![
                property(
                    "maskLinear",
                    object(vec![property(
                        "from",
                        object(vec![
                            property("at", StaticSzValue::String("20%".into())),
                            color(),
                        ]),
                    )]),
                ),
                property(
                    "bgImg",
                    object(vec![
                        property("gradient", StaticSzValue::String("linear".into())),
                        color(),
                    ]),
                ),
                property(
                    "bg",
                    object(vec![
                        property("color", StaticSzValue::Number(5.0)),
                        property("size", StaticSzValue::String("x".into())),
                    ]),
                ),
            ],
        };
        assert_eq!(color_member_hits(&silent), Vec::<(String, String)>::new());
    }

    #[cfg(feature = "native-engine")]
    #[test]
    fn flags_an_unknown_member_of_each_slot() {
        // A typo inside a slot emits NOTHING at lowering, so the collector is
        // the only thing standing between the author and a silently missing
        // mask. Mirrors the TypeScript `warnUnknownField` allowlists.
        let linear = StaticSzObject {
            properties: vec![property(
                "maskLinear",
                object(vec![property("form", StaticSzValue::String("20%".into()))]),
            )],
        };
        assert_eq!(
            mask_member_hits(&linear),
            [("maskLinear".to_string(), "form".to_string())]
        );

        let conic = StaticSzObject {
            properties: vec![property(
                "maskConic",
                object(vec![property(
                    "t",
                    object(vec![property("from", StaticSzValue::String("0%".into()))]),
                )]),
            )],
        };
        // Sides belong to the linear slot only.
        assert_eq!(
            mask_member_hits(&conic),
            [("maskConic".to_string(), "t".to_string())]
        );

        let radial = StaticSzObject {
            properties: vec![property(
                "maskRadial",
                object(vec![
                    property("bogus", StaticSzValue::Number(1.0)),
                    property("at", StaticSzValue::String("top".into())),
                ]),
            )],
        };
        assert_eq!(
            mask_member_hits(&radial),
            [("maskRadial".to_string(), "bogus".to_string())]
        );
    }

    #[cfg(feature = "native-engine")]
    #[test]
    fn flags_an_unknown_member_inside_a_linear_edge() {
        let branch = StaticSzObject {
            properties: vec![property(
                "maskLinear",
                object(vec![property(
                    "b",
                    object(vec![
                        property("from", StaticSzValue::String("0%".into())),
                        property("form", StaticSzValue::String("50%".into())),
                    ]),
                )]),
            )],
        };
        assert_eq!(
            mask_member_hits(&branch),
            [("maskLinear.b".to_string(), "form".to_string())]
        );
    }

    #[cfg(feature = "native-engine")]
    #[test]
    fn stays_silent_for_legal_slots_and_descends_through_variants() {
        let legal = StaticSzObject {
            properties: vec![property(
                "maskLinear",
                object(vec![
                    property("angle", StaticSzValue::Number(45.0)),
                    property(
                        "b",
                        object(vec![property("from", StaticSzValue::String("0%".into()))]),
                    ),
                ]),
            )],
        };
        assert!(mask_member_hits(&legal).is_empty());

        let scalar_edge = StaticSzObject {
            properties: vec![property(
                "maskLinear",
                object(vec![property("b", StaticSzValue::String("20%".into()))]),
            )],
        };
        assert!(mask_member_hits(&scalar_edge).is_empty());

        // A slot nested under a variant is still reached — the walk descends
        // through any object that is not itself a slot.
        let nested = StaticSzObject {
            properties: vec![property(
                "hover",
                object(vec![property(
                    "maskRadial",
                    object(vec![property(
                        "shpe",
                        StaticSzValue::String("circle".into()),
                    )]),
                )]),
            )],
        };
        assert_eq!(
            mask_member_hits(&nested),
            [("maskRadial".to_string(), "shpe".to_string())]
        );

        // A non-object slot value carries no members to check.
        let scalar = StaticSzObject {
            properties: vec![property("maskLinear", StaticSzValue::Number(45.0))],
        };
        assert!(mask_member_hits(&scalar).is_empty());
    }

    #[cfg(feature = "native-engine")]
    #[test]
    fn reports_the_allowed_member_list_for_the_message() {
        let branch = StaticSzObject {
            properties: vec![property(
                "maskLinear",
                object(vec![property("nope", StaticSzValue::Boolean(true))]),
            )],
        };
        let mut out = Vec::new();
        super::collect_unknown_mask_slot_members(&branch, &mut out);
        assert_eq!(out[0].2.join(", "), "angle, from, to, t, r, b, l, x, y");
    }
    #[cfg(feature = "native-engine")]
    #[test]
    fn removed_sugar_is_collected_under_a_variant_but_not_a_property_namespace() {
        // Sugar nested in a variant still lowers to a dead class, so the walk
        // has to descend. A property namespace is the opposite case: inside
        // `p: { ... }` the members are values of `p`, and a key that happens to
        // spell a removed sugar name there is not that sugar.
        let object = StaticSzObject {
            properties: vec![
                property(
                    "hover",
                    object(vec![property("flex", StaticSzValue::Boolean(true))]),
                ),
                property(
                    "p",
                    object(vec![property("absolute", StaticSzValue::Boolean(true))]),
                ),
            ],
        };
        let mut out = Vec::new();
        super::collect_removed_boolean_sugar(&object, &mut out);
        let hits: Vec<(&str, &str, &str)> = out
            .iter()
            .map(|(key, canonical, value, _)| (key.as_str(), *canonical, *value))
            .collect();
        assert_eq!(hits, [("flex", "display", "flex")]);
    }

    /// What the recorded lowering records, read the plain way: a mark per
    /// lowered property, each class owned by the last property marked at or
    /// before it, a leading class folded into its text size dropped with its
    /// key, and the prefix on every kept class.
    fn recorded_by_marks(object: &StaticSzObject) -> (Vec<String>, Option<MergeGroup>) {
        let mut classes = Vec::new();
        let mut marks: Vec<(usize, usize)> = Vec::new();
        super::lower_object_into_marked(object, "", &mut classes, &mut |index, len| {
            marks.push((index, len));
        });
        if classes.is_empty() {
            return (Vec::new(), None);
        }
        let mut owners = Vec::new();
        for (position, &(index, start)) in marks.iter().enumerate() {
            let end = marks.get(position + 1).map_or(classes.len(), |next| next.1);
            owners.extend((start..end).map(|_| &object.properties[index]));
        }
        let consumed = super::fuse_text_size_and_leading(&mut classes);
        let mut group = MergeGroup {
            keys: Vec::new(),
            key_starts: Vec::new(),
            classes: Vec::new(),
        };
        for (index, (owner, class_name)) in owners.into_iter().zip(classes).enumerate() {
            if !consumed.get(index).copied().unwrap_or(false) {
                group.keys.push(owner.key.clone());
                group.key_starts.push(owner.span.start);
                group.classes.push(super::with_class_prefix(class_name));
            }
        }
        (group.classes.clone(), Some(group))
    }

    /// A random object over keys that fold (`text` and `leading`), nest
    /// (`hover`, `md`), are dropped (`padding`), lower to nothing
    /// (`borderT: 'dashed'`) or reset others (`nums`).
    fn random_object(rng: &mut Rng, depth: usize) -> StaticSzObject {
        let leaves: [(&str, &[&str]); 9] = [
            ("p", &["4", "8"]),
            ("m", &["2"]),
            ("text", &["sm", "lg", "red-500"]),
            ("leading", &["tight", "6"]),
            ("bg", &["red-500"]),
            ("padding", &["4"]),
            ("borderT", &["dashed", "2"]),
            ("nums", &["normal"]),
            ("numSpacing", &["tabular"]),
        ];
        let len = rng.below(7);
        let mut properties = Vec::with_capacity(len);
        for index in 0..len {
            let start = u32::try_from(index * 7 + depth).expect("small");
            let span = TextSpan {
                start,
                end: start + 3,
            };
            if depth < 2 && rng.below(5) == 0 {
                properties.push(StaticSzProperty {
                    key: (*rng.pick(&["hover", "md"])).to_string(),
                    span,
                    value: StaticSzValue::Object(random_object(rng, depth + 1)),
                });
                continue;
            }
            let (key, values) = *rng.pick(&leaves);
            properties.push(StaticSzProperty {
                key: key.to_string(),
                span,
                value: StaticSzValue::String((*rng.pick(values)).to_string()),
            });
        }
        StaticSzObject { properties }
    }

    /// The recorded lowering records and returns what the plain reading of
    /// its marks says, with and without a Tailwind prefix.
    #[test]
    fn a_recorded_object_keeps_the_key_behind_each_class() {
        let mut rng = Rng::new(0x5eed_0a01);
        for case in 0..3000 {
            let object = random_object(&mut rng, 0);
            let prefix = (case % 2 == 0).then_some("tw");
            let _prefix = ClassPrefixScope::enter(prefix);
            let (expected_classes, expected_group) = {
                let scope = MergeGroupScope::enter(true);
                let paused = GroupsPaused::enter();
                let expected = recorded_by_marks(&object);
                drop(paused);
                drop(scope);
                expected
            };
            let scope = MergeGroupScope::enter(true);
            let classes = lower_static_sz_object(&object);
            let lists = scope.finish();
            assert_eq!(classes, expected_classes, "{object:?} {prefix:?}");
            let recorded: Vec<MergeGroup> = lists
                .groups
                .into_iter()
                .chain(lists.single_class_groups)
                .collect();
            assert_eq!(
                recorded,
                expected_group.into_iter().collect::<Vec<_>>(),
                "{object:?}"
            );
        }
    }
}
