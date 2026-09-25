//! Apply the build's merge table to the classes of one static `sz` object.
//!
//! A later key replaces an earlier one whose CSS it covers: `{ pb: 2, p: 4 }`
//! lowers to `p-4`, because `p` sets every property `pb` sets. The engine does
//! not decide that. It cannot read CSS, and a guess from key names is wrong as
//! soon as one key sets different properties by value (`border: 2` is a width,
//! `border: 'red-500'` a colour). The plugin works it out from the project's
//! compiled stylesheet and hands the engine a table; this module only applies
//! it, the same way the runtime's `szcn` applies the table it registers.
//!
//! No table, no change: a lane that cannot build one emits what it always did.

use std::cell::RefCell;
use std::collections::{HashMap, HashSet};
use std::sync::Arc;

use serde::{Deserialize, Serialize};

/// The table format this engine reads.
///
/// The plugin writes the format it produced beside the table. The two are
/// separate numbers on purpose: an engine and a plugin from different releases
/// can meet in one install, and a table the engine would misread is refused
/// rather than merged on. It is not the runtime's format either — the runtime
/// reads the table it is shipped, the engine the one it is handed per file.
pub const MERGE_TABLE_FORMAT: u32 = 1;

/// Which classes cover which, for the classes of one file.
#[derive(Debug, Deserialize)]
pub struct MergeTable {
    format: u32,
    /// Class name, as emitted (prefix included), to its signature id.
    signatures: HashMap<String, u32>,
    /// For each signature id, the ids whose CSS it covers.
    coverage: Vec<Vec<u32>>,
}

/// A static class name and the `sz` classes beside it on one element: the
/// class name loses what the `sz` classes cover, and nothing else.
#[derive(Debug, Clone, PartialEq, Eq, Hash, Serialize, Deserialize)]
pub struct MergeOverride {
    /// The class name's classes, as written.
    pub base: Vec<String>,
    /// The `sz` classes, as emitted.
    pub over: Vec<String>,
}

/// What a pass without a table would merge, for the plugin to check.
#[derive(Debug, Default, PartialEq, Eq)]
pub struct MergeLists {
    /// Each static object's classes, merged later over earlier.
    pub groups: Vec<Vec<String>>,
    /// Each static class name beside a static `sz`.
    pub overrides: Vec<MergeOverride>,
}

thread_local! {
    /// The merge table of the file being transformed on this thread.
    static MERGE_TABLE: RefCell<Option<Arc<MergeTable>>> = const { RefCell::new(None) };
    /// The lists a merge would read, while a pass without a table collects
    /// them.
    static MERGE_GROUPS: RefCell<Option<MergeLists>> = const { RefCell::new(None) };
    /// The classes the table removed while the current scope lives.
    static MERGE_REMOVED: RefCell<Vec<String>> = const { RefCell::new(Vec::new()) };
}

/// The merge table for every static object lowered while it lives.
///
/// A scope for the same reason as `ClassPrefixScope`: objects are lowered from
/// many places, and one of them skipping the table would keep a class every
/// other place removes. The engine opens one per file; dropping it restores the
/// previous table even when the transform unwinds.
#[must_use = "the table applies only while the scope is alive"]
pub struct MergeTableScope {
    previous: Option<Arc<MergeTable>>,
    previous_removed: Vec<String>,
}

impl MergeTableScope {
    /// Apply `table` to every static object lowered on this thread until the
    /// scope drops.
    pub fn enter(table: Option<Arc<MergeTable>>) -> Self {
        Self {
            previous: MERGE_TABLE.with(|cell| cell.replace(table)),
            previous_removed: MERGE_REMOVED.with(|cell| cell.replace(Vec::new())),
        }
    }

    /// Every class the table removed so far in this scope, in the order removed.
    ///
    /// They still belong in the classes a file reports: that list is what
    /// Tailwind is asked to generate, and a path that resolves at run time —
    /// an `szv` factory, a `_szPart` object — emits the class the build's merge
    /// removed. A class generated for nothing costs a rule; one missing costs
    /// the style.
    pub fn take_removed(&self) -> Vec<String> {
        MERGE_REMOVED.with(RefCell::take)
    }
}

impl Drop for MergeTableScope {
    fn drop(&mut self) {
        MERGE_TABLE.with(|cell| cell.replace(self.previous.take()));
        let previous_removed = std::mem::take(&mut self.previous_removed);
        MERGE_REMOVED.with(|cell| cell.replace(previous_removed));
    }
}

/// The class lists a merge would read, for every object lowered while it lives.
///
/// The plugin cannot see objects, only a file's classes, and two classes of one
/// file cover each other far more often than two of one object do: measured on
/// the docs app, 25 of 26 files held such a pair and none of them held it
/// inside one object. Each list here is what one [`apply`] would receive, so
/// the plugin asks for a second pass only when a pair falls inside one of them.
#[must_use = "the lists are collected only while the scope is alive"]
pub struct MergeGroupScope {
    previous: Option<MergeLists>,
    finished: bool,
}

impl MergeGroupScope {
    /// Collect the lists of every object lowered on this thread when `collect`,
    /// and none otherwise, until [`MergeGroupScope::finish`] or the drop.
    pub fn enter(collect: bool) -> Self {
        Self {
            previous: MERGE_GROUPS.with(|cell| cell.replace(collect.then(MergeLists::default))),
            finished: false,
        }
    }

    /// The lists collected, each once, restoring what was collected before
    /// the scope.
    ///
    /// The engine lowers one object on more than one path — the rewrite and
    /// the class report — so a list arrives once per path.
    pub fn finish(mut self) -> MergeLists {
        self.finished = true;
        let previous = self.previous.take();
        let mut lists = MERGE_GROUPS
            .with(|cell| cell.replace(previous))
            .unwrap_or_default();
        let mut seen = HashSet::new();
        lists.groups.retain(|group| seen.insert(group.clone()));
        let mut seen = HashSet::new();
        lists.overrides.retain(|pair| seen.insert(pair.clone()));
        lists
    }
}

impl Drop for MergeGroupScope {
    fn drop(&mut self) {
        // Also when the transform unwinds: the next file must not inherit the
        // collection.
        if !self.finished {
            let previous = self.previous.take();
            MERGE_GROUPS.with(|cell| cell.replace(previous));
        }
    }
}

/// Read the table a transform was handed.
///
/// # Errors
///
/// Returns why the table cannot be used: it is not a table, or it is written in
/// a format this engine does not read. The caller keeps every class then.
pub fn decode(json: &str) -> Result<Arc<MergeTable>, String> {
    let table: MergeTable = serde_json::from_str(json)
        .map_err(|error| format!("the merge table is not one this engine reads ({error})"))?;
    if table.format != MERGE_TABLE_FORMAT {
        return Err(format!(
            "the merge table is in format {}, and this engine reads format {MERGE_TABLE_FORMAT}",
            table.format
        ));
    }
    Ok(Arc::new(table))
}

/// What a class is merged under: its signature, or itself when it has none.
#[derive(Debug, PartialEq, Eq)]
enum Key {
    Signature(u32),
    Class(String),
}

/// Merge one object's classes, later over earlier.
///
/// Each class, in order, removes every earlier survivor it covers — its own
/// signature included, so `p-4` then `p-8` keeps `p-8` — and is appended. A
/// class with no signature is only ever its own repeat: nothing compiled has
/// shown that another class sets what it sets. This is `mergeClassToken` in
/// `packages/runtime/src/merge-classes.ts`, without the mangle codec: the
/// engine sees classes before they are mangled.
///
/// `n` is the number of classes in the object and `r` the longest coverage row.
/// Each class scans the survivors, with a linear row lookup per survivor:
/// `O(n² · (1 + r))` worst-case time, `O(n)` auxiliary space. The parser's AST
/// budget bounds input size but does not impose a small per-object class limit.
///
/// The output is a subsequence of the input, applying it twice changes
/// nothing, and a class without a signature is never removed by another.
#[must_use]
pub fn apply(classes: Vec<String>, table: &MergeTable) -> Vec<String> {
    apply_recording(classes, table, &mut Vec::new())
}

/// [`apply`], appending every class it removes to `removed`.
fn apply_recording(
    classes: Vec<String>,
    table: &MergeTable,
    removed: &mut Vec<String>,
) -> Vec<String> {
    let mut survivors: Vec<(Key, String)> = Vec::with_capacity(classes.len());
    for class_name in classes {
        let signature = table.signatures.get(&class_name).copied();
        let row: &[u32] = signature
            .and_then(|id| table.coverage.get(id as usize))
            .map_or(&[], Vec::as_slice);
        let key = signature.map_or_else(|| Key::Class(class_name.clone()), Key::Signature);
        survivors.retain(|(survivor, survivor_class)| {
            let kept =
                *survivor != key && !matches!(survivor, Key::Signature(id) if row.contains(id));
            if !kept {
                removed.push(survivor_class.clone());
            }
            kept
        });
        survivors.push((key, class_name));
    }
    survivors
        .into_iter()
        .map(|(_, class_name)| class_name)
        .collect()
}

/// [`apply`] with the table of the file being transformed, if it has one;
/// without one, the list is recorded when a pass is collecting them.
pub(crate) fn apply_active(classes: Vec<String>) -> Vec<String> {
    MERGE_TABLE.with(|cell| {
        if let Some(table) = cell.borrow().as_deref() {
            return MERGE_REMOVED
                .with(|removed| apply_recording(classes, table, &mut removed.borrow_mut()));
        }
        // One class merges with nothing.
        if classes.len() > 1 {
            MERGE_GROUPS.with(|lists| {
                if let Some(lists) = lists.borrow_mut().as_mut() {
                    lists.groups.push(classes.clone());
                }
            });
        }
        classes
    })
}

/// Remove from a class name what the `sz` classes beside it cover.
///
/// A class name's class goes when an `sz` class has its signature or covers
/// it; one with no signature goes only when an `sz` class repeats it. The class
/// name is never compared with itself: `p-8 pb-2` keeps both, as the author's
/// own stylesheet order decides between them. The `sz` classes are not touched.
///
/// `b` is the class name's length, `o` the `sz` classes' and `r` the longest
/// coverage row: `O(o · r + b)` time with hashing, `O(o · r)` space.
///
/// The output is a subsequence of `base`, and applying it twice changes
/// nothing.
#[must_use]
pub fn apply_over(base: Vec<String>, over: &[String], table: &MergeTable) -> Vec<String> {
    let names: HashSet<&str> = over.iter().map(String::as_str).collect();
    let mut covered: HashSet<u32> = HashSet::new();
    for class_name in over {
        if let Some(&id) = table.signatures.get(class_name) {
            covered.insert(id);
            if let Some(row) = table.coverage.get(id as usize) {
                covered.extend(row);
            }
        }
    }
    base.into_iter()
        .filter(|class_name| {
            !names.contains(class_name.as_str())
                && !table
                    .signatures
                    .get(class_name)
                    .is_some_and(|id| covered.contains(id))
        })
        .collect()
}

/// [`apply_over`] with the table of the file being transformed, if it has one;
/// without one, the pair is recorded when a pass is collecting them.
///
/// A class the class name loses is not reported as removed: it was written in
/// the source, so the safelist already holds it.
#[cfg_attr(not(feature = "native-engine"), allow(dead_code))]
pub(crate) fn apply_over_active(base: Vec<String>, over: &[String]) -> Vec<String> {
    if base.is_empty() || over.is_empty() {
        return base;
    }
    MERGE_TABLE.with(|cell| {
        if let Some(table) = cell.borrow().as_deref() {
            return apply_over(base, over, table);
        }
        MERGE_GROUPS.with(|lists| {
            if let Some(lists) = lists.borrow_mut().as_mut() {
                lists.overrides.push(MergeOverride {
                    base: base.clone(),
                    over: over.to_vec(),
                });
            }
        });
        base
    })
}

#[cfg(test)]
mod tests {
    use super::{
        apply, apply_active, apply_over, apply_over_active, decode, MergeGroupScope, MergeOverride,
        MergeTableScope,
    };

    fn table() -> std::sync::Arc<super::MergeTable> {
        decode(
            r#"{"format":1,"signatures":{"p-4":0,"p-8":0,"pb-2":1,"px-2":2,"p-4!":3},"coverage":[[1,2],[],[],[1,2]]}"#,
        )
        .expect("a valid table")
    }

    fn classes(list: &[&str]) -> Vec<String> {
        list.iter().map(ToString::to_string).collect()
    }

    #[test]
    fn a_later_class_removes_what_it_covers() {
        assert_eq!(apply(classes(&["pb-2", "px-2", "p-4"]), &table()), ["p-4"]);
    }

    #[test]
    fn a_later_refinement_is_kept() {
        assert_eq!(apply(classes(&["p-4", "pb-2"]), &table()), ["p-4", "pb-2"]);
    }

    #[test]
    fn the_same_signature_keeps_the_later_class() {
        assert_eq!(apply(classes(&["p-4", "p-8"]), &table()), ["p-8"]);
    }

    #[test]
    fn importance_is_its_own_signature() {
        // `p-4!` and `p-8` set the same properties, but only one of them wins
        // the cascade whatever the order, so neither may remove the other.
        assert_eq!(apply(classes(&["p-4!", "p-8"]), &table()), ["p-4!", "p-8"]);
        assert_eq!(apply(classes(&["p-8", "p-4!"]), &table()), ["p-8", "p-4!"]);
    }

    #[test]
    fn a_class_without_a_signature_is_only_its_own_repeat() {
        assert_eq!(
            apply(classes(&["card", "p-4", "card", "shadow"]), &table()),
            ["p-4", "card", "shadow"]
        );
    }

    #[test]
    fn a_row_past_the_end_of_the_table_covers_nothing() {
        let table = decode(r#"{"format":1,"signatures":{"a":7,"b":1},"coverage":[[],[]]}"#)
            .expect("a valid table");
        assert_eq!(apply(classes(&["b", "a"]), &table), ["b", "a"]);
    }

    #[test]
    fn a_scope_applies_its_table_only_while_it_lives() {
        let outer = MergeTableScope::enter(Some(table()));
        {
            let _inner = MergeTableScope::enter(None);
            assert_eq!(apply_active(classes(&["p-4", "p-8"])), ["p-4", "p-8"]);
        }
        assert_eq!(apply_active(classes(&["p-4", "p-8"])), ["p-8"]);
        drop(outer);
        assert_eq!(apply_active(classes(&["p-4", "p-8"])), ["p-4", "p-8"]);
    }

    #[test]
    fn a_pass_without_a_table_collects_each_list_of_two_or_more_once() {
        let groups = MergeGroupScope::enter(true);
        let _ = apply_active(classes(&["pb-2", "p-4"]));
        let _ = apply_active(classes(&["m-2"]));
        let _ = apply_active(classes(&["pb-2", "p-4"]));
        assert_eq!(groups.finish().groups, [classes(&["pb-2", "p-4"])]);
        // Finished: nothing collects any more.
        let after = MergeGroupScope::enter(false);
        let _ = apply_active(classes(&["a", "b"]));
        assert_eq!(after.finish(), super::MergeLists::default());
    }

    #[test]
    fn a_pass_with_a_table_collects_no_list() {
        let groups = MergeGroupScope::enter(true);
        let _table = MergeTableScope::enter(Some(table()));
        let _ = apply_active(classes(&["pb-2", "p-4"]));
        assert!(groups.finish().groups.is_empty());
    }

    #[test]
    fn a_dropped_group_scope_stops_collecting() {
        {
            let _groups = MergeGroupScope::enter(true);
        }
        let probe = MergeGroupScope::enter(false);
        let _ = apply_active(classes(&["a", "b"]));
        assert_eq!(probe.finish(), super::MergeLists::default());
        let outer = MergeGroupScope::enter(true);
        {
            let _inner = MergeGroupScope::enter(false);
            let _ = apply_active(classes(&["c", "d"]));
        }
        let _ = apply_active(classes(&["e", "f"]));
        assert_eq!(outer.finish().groups, [classes(&["e", "f"])]);
    }

    #[test]
    fn the_table_scope_reports_what_it_removed() {
        let scope = MergeTableScope::enter(Some(table()));
        assert_eq!(apply_active(classes(&["pb-2", "px-2", "p-4"])), ["p-4"]);
        assert_eq!(apply_active(classes(&["p-4", "pb-2"])), ["p-4", "pb-2"]);
        assert_eq!(scope.take_removed(), ["pb-2", "px-2"]);
        assert!(scope.take_removed().is_empty());
    }

    #[test]
    fn a_nested_table_scope_keeps_the_outer_removals() {
        let outer = MergeTableScope::enter(Some(table()));
        let _ = apply_active(classes(&["pb-2", "p-4"]));
        {
            let _inner = MergeTableScope::enter(None);
            let _ = apply_active(classes(&["px-2", "p-4"]));
        }
        assert_eq!(outer.take_removed(), ["pb-2"]);
    }

    #[test]
    fn a_table_in_another_format_is_refused() {
        let error = decode(r#"{"format":2,"signatures":{},"coverage":[]}"#)
            .expect_err("format 2 is not read");
        assert!(error.contains("format 2"), "{error}");
    }

    #[test]
    fn something_that_is_not_a_table_is_refused() {
        assert!(decode("[]").is_err());
    }

    #[test]
    fn a_class_name_loses_only_what_an_sz_class_covers() {
        // `pb-2` and `px-2` are covered by `p-4`; `card` has no signature and
        // `p-4!` is its own context.
        assert_eq!(
            apply_over(
                classes(&["card", "pb-2", "p-4!", "px-2"]),
                &classes(&["p-4"]),
                &table()
            ),
            ["card", "p-4!"]
        );
    }

    #[test]
    fn a_class_name_is_never_compared_with_itself() {
        // `p-8` would cover `pb-2` in a fold; on its own side it removes nothing.
        assert_eq!(
            apply_over(classes(&["pb-2", "p-8"]), &classes(&["px-2"]), &table()),
            ["pb-2", "p-8"]
        );
    }

    #[test]
    fn an_unsigned_class_name_goes_only_as_a_repeat() {
        assert_eq!(
            apply_over(classes(&["card", "hook"]), &classes(&["card"]), &table()),
            ["hook"]
        );
    }

    #[test]
    fn apply_over_is_idempotent() {
        let once = apply_over(classes(&["pb-2", "card"]), &classes(&["p-8"]), &table());
        assert_eq!(apply_over(once.clone(), &classes(&["p-8"]), &table()), once);
    }

    #[test]
    fn a_pass_without_a_table_records_the_class_name_and_sz_lists() {
        let scope = MergeGroupScope::enter(true);
        assert_eq!(
            apply_over_active(classes(&["pb-2"]), &classes(&["p-4"])),
            ["pb-2"]
        );
        // Nothing to compare: no record.
        let _ = apply_over_active(Vec::new(), &classes(&["p-4"]));
        let _ = apply_over_active(classes(&["pb-2"]), &[]);
        let lists = scope.finish();
        assert!(lists.groups.is_empty());
        assert_eq!(
            lists.overrides,
            [MergeOverride {
                base: classes(&["pb-2"]),
                over: classes(&["p-4"]),
            }]
        );
    }

    #[test]
    fn a_pass_with_a_table_applies_it_and_records_nothing() {
        let lists = MergeGroupScope::enter(true);
        let _table = MergeTableScope::enter(Some(table()));
        assert_eq!(
            apply_over_active(classes(&["pb-2", "card"]), &classes(&["p-4"])),
            ["card"]
        );
        assert!(lists.finish().overrides.is_empty());
    }
}
