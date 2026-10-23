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

use std::cell::{Cell, RefCell};
use std::collections::{HashMap, HashSet};
use std::hash::{BuildHasherDefault, Hasher};
use std::sync::Arc;

use serde::{Deserialize, Serialize};

/// The table format this engine reads.
///
/// The plugin writes the format it produced beside the table. The two are
/// separate numbers on purpose: an engine and a plugin from different releases
/// can meet in one install, and a table the engine would misread is refused
/// rather than merged on. It is not the runtime's format either — the runtime
/// reads the table it is shipped, the engine the one it is handed per file.
pub use super::generated::diagnostic_codes::MERGE_TABLE_FORMAT;

/// Which classes cover which, for the classes of one file.
#[derive(Debug, Deserialize)]
pub struct MergeTable {
    format: u32,
    /// Class name, as emitted (prefix included), to its signature id.
    signatures: HashMap<String, u32>,
    /// For each signature id, the ids whose CSS it covers.
    coverage: Vec<Vec<u32>>,
}

/// One static object's classes, merged later over earlier, and where each
/// came from. Serialized in the spelling `@csszyx/compiler` reads
/// (`keyStarts`).
#[derive(Debug, Clone, PartialEq, Eq, Hash, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct MergeGroup {
    /// The key each class was lowered from, index-parallel to `classes`: a
    /// variant key owns every class its object lowers to.
    pub keys: Vec<String>,
    /// Byte offset in the source of the key each class was lowered from,
    /// index-parallel to `keys`, so a report places a removed class on its
    /// own key's line rather than on the object's.
    pub key_starts: Vec<u32>,
    /// The classes, as emitted.
    pub classes: Vec<String>,
}

/// A static class name and the `sz` classes beside it on one element: the
/// class name loses what the `sz` classes cover, and nothing else.
#[derive(Debug, Clone, PartialEq, Eq, Hash, Serialize, Deserialize)]
pub struct MergeOverride {
    /// Byte offset of the class-name attribute in the source.
    pub start: u32,
    /// The class name's classes, as written.
    pub base: Vec<String>,
    /// The `sz` classes, as emitted.
    pub over: Vec<String>,
}

/// What a pass without a table would merge, for the plugin to check.
#[derive(Debug, Default, PartialEq, Eq)]
pub struct MergeLists {
    /// Each static object's classes, merged later over earlier: objects of two
    /// classes or more.
    pub groups: Vec<MergeGroup>,
    /// Each static object of one class, which merges with nothing: kept apart
    /// from `groups` so a merge reads what it always read, and recorded so the
    /// class still has a key and an offset to be reported at.
    pub single_class_groups: Vec<MergeGroup>,
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
    /// Whether lowering records no group while a pass collects: set while the
    /// engine rewrites objects its class report already recorded.
    static GROUPS_PAUSED: Cell<bool> = const { Cell::new(false) };
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
    /// The parser lowers some objects while it reads them and the class report
    /// lowers them again, so a list can arrive twice; the rewrite records
    /// nothing ([`GroupsPaused`]).
    pub fn finish(mut self) -> MergeLists {
        self.finished = true;
        let previous = self.previous.take();
        let lists = MERGE_GROUPS
            .with(|cell| cell.replace(previous))
            .unwrap_or_default();
        MergeLists {
            groups: first_of_each(lists.groups, group_place),
            single_class_groups: first_of_each(lists.single_class_groups, group_place),
            overrides: first_of_each(lists.overrides, |pair| u64::from(pair.start)),
        }
    }
}

/// The first of each distinct item, in order.
///
/// Items are bucketed by `place` — where they are written, which two copies of
/// one item share — and compared whole only inside a bucket: a group holds
/// every class and key of its object, and hashing those cost more than the
/// lowering that produced them. Two different items in one bucket both
/// survive.
///
/// `O(n)` expected time for `n` items in distinct places; items sharing a
/// place are compared pairwise, `O(k²)` for `k` of them.
fn first_of_each<T: Eq>(items: Vec<T>, place: impl Fn(&T) -> u64) -> Vec<T> {
    let first: Vec<bool> = {
        let mut seen: HashMap<u64, Vec<usize>, BuildHasherDefault<PlaceHasher>> =
            HashMap::with_capacity_and_hasher(items.len(), BuildHasherDefault::default());
        (0..items.len())
            .map(|index| {
                let bucket = seen.entry(place(&items[index])).or_default();
                let fresh = bucket.iter().all(|&held| items[held] != items[index]);
                if fresh {
                    bucket.push(index);
                }
                fresh
            })
            .collect()
    };
    items
        .into_iter()
        .zip(first)
        .filter_map(|(item, first)| first.then_some(item))
        .collect()
}

/// Where a group is written: its keys' offsets, folded FNV-1a style. Any
/// function equal groups share would do; this one costs no SipHash round.
fn group_place(group: &MergeGroup) -> u64 {
    group
        .key_starts
        .iter()
        .fold(0xcbf2_9ce4_8422_2325_u64, |hash, &start| {
            (hash ^ u64::from(start)).wrapping_mul(0x0000_0100_0000_01b3)
        })
}

/// The hasher of [`first_of_each`]'s buckets. A place is already a hash, or
/// an offset, so the map spreads it with one multiply instead of a SipHash
/// round; equality still decides what a bucket holds.
#[derive(Default)]
struct PlaceHasher(u64);

impl Hasher for PlaceHasher {
    fn finish(&self) -> u64 {
        self.0
    }

    fn write(&mut self, bytes: &[u8]) {
        for &byte in bytes {
            self.0 = (self.0 ^ u64::from(byte)).wrapping_mul(0x0000_0100_0000_01b3);
        }
    }

    fn write_u64(&mut self, value: u64) {
        // Spread a small offset into the high bits the table reads too.
        self.0 = value.wrapping_mul(0x9e37_79b9_7f4a_7c15);
    }
}

/// No lowering records a group while it lives, though a pass collects.
///
/// For a lowering that repeats one already recorded: the engine rewrites the
/// objects its class report lowered from the same IR, and recording them a
/// second time cost as much as the first, only to be dropped again by
/// [`MergeGroupScope::finish`]. Class-name pairs ([`apply_over_active`]) are
/// still recorded: only the rewrite sees them. Dropping it restores the
/// previous state even when the rewrite unwinds.
#[must_use = "groups are paused only while the scope is alive"]
pub struct GroupsPaused {
    previous: bool,
}

impl GroupsPaused {
    /// Pause group recording on this thread until the scope drops.
    pub fn enter() -> Self {
        Self {
            previous: GROUPS_PAUSED.with(|cell| cell.replace(true)),
        }
    }
}

impl Drop for GroupsPaused {
    fn drop(&mut self) {
        GROUPS_PAUSED.with(|cell| cell.set(self.previous));
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
pub fn decode(json: &str) -> Result<Arc<MergeTable>, TableProblem> {
    let table: MergeTable =
        serde_json::from_str(json).map_err(|error| TableProblem::Unreadable(error.to_string()))?;
    if table.format != MERGE_TABLE_FORMAT {
        return Err(TableProblem::Format(table.format));
    }
    Ok(Arc::new(table))
}

/// Why a merge table was refused.
#[derive(Debug, Clone, PartialEq, Eq)]
pub enum TableProblem {
    /// It is not JSON this engine reads; the reader's own message.
    Unreadable(String),
    /// It is in another format than [`MERGE_TABLE_FORMAT`].
    Format(u32),
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

/// [`apply`] with the table of the file being transformed, if it has one.
pub(crate) fn apply_active(classes: Vec<String>) -> Vec<String> {
    MERGE_TABLE.with(|cell| match cell.borrow().as_deref() {
        Some(table) => {
            MERGE_REMOVED.with(|removed| apply_recording(classes, table, &mut removed.borrow_mut()))
        }
        None => classes,
    })
}

/// Whether a pass is collecting the lists a merge would read.
///
/// Only a pass without a table collects, so a collecting pass merges nothing:
/// the caller records the object with [`record_group`] instead of applying.
pub(crate) fn collecting() -> bool {
    MERGE_GROUPS.with(|lists| lists.borrow().is_some())
}

/// Whether a lowering records its object: a pass is collecting and no
/// [`GroupsPaused`] is alive.
pub(crate) fn recording_groups() -> bool {
    !GROUPS_PAUSED.with(Cell::get) && collecting()
}

/// Record one object's classes for the plugin to check, when a pass is
/// collecting them.
///
/// A one-class object merges with nothing, so it goes to its own list: a
/// merge reads only `groups`, and the one-class list is where the class's key
/// and offset travel, so a dead class the build reports is named at its key.
pub(crate) fn record_group(group: MergeGroup) {
    MERGE_GROUPS.with(|lists| {
        if let Some(lists) = lists.borrow_mut().as_mut() {
            if group.classes.len() < 2 {
                lists.single_class_groups.push(group);
            } else {
                lists.groups.push(group);
            }
        }
    });
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
pub(crate) fn apply_over_active(start: u32, base: Vec<String>, over: &[String]) -> Vec<String> {
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
                    start,
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
        apply, apply_active, apply_over, apply_over_active, collecting, decode, first_of_each,
        record_group, recording_groups, GroupsPaused, MergeGroup, MergeGroupScope, MergeOverride,
        MergeTableScope,
    };
    use crate::transform::test_rng::Rng;

    /// A group at offset 0 whose keys are its classes.
    fn group(names: &[&str]) -> MergeGroup {
        MergeGroup {
            keys: classes(names),
            key_starts: vec![0; names.len()],
            classes: classes(names),
        }
    }

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
    fn a_pass_without_a_table_collects_each_list_once_and_one_class_lists_apart() {
        let groups = MergeGroupScope::enter(true);
        assert!(collecting());
        record_group(group(&["pb-2", "p-4"]));
        record_group(group(&["m-2"]));
        record_group(group(&["pb-2", "p-4"]));
        record_group(group(&["m-2"]));
        let lists = groups.finish();
        assert_eq!(lists.groups, [group(&["pb-2", "p-4"])]);
        // A one-class object is kept apart, once.
        assert_eq!(lists.single_class_groups, [group(&["m-2"])]);
        // Finished: nothing collects any more.
        let after = MergeGroupScope::enter(false);
        assert!(!collecting());
        record_group(group(&["a", "b"]));
        assert_eq!(after.finish(), super::MergeLists::default());
    }

    #[test]
    fn one_object_at_two_places_is_two_groups() {
        let groups = MergeGroupScope::enter(true);
        record_group(group(&["pb-2", "p-4"]));
        let elsewhere = MergeGroup {
            key_starts: vec![9, 16],
            ..group(&["pb-2", "p-4"])
        };
        record_group(elsewhere.clone());
        assert_eq!(groups.finish().groups, [group(&["pb-2", "p-4"]), elsewhere]);
    }

    #[test]
    fn two_groups_at_one_place_both_survive_once() {
        let groups = MergeGroupScope::enter(true);
        record_group(group(&["pb-2", "p-4"]));
        record_group(group(&["m-2", "p-4"]));
        record_group(group(&["pb-2", "p-4"]));
        assert_eq!(
            groups.finish().groups,
            [group(&["pb-2", "p-4"]), group(&["m-2", "p-4"])]
        );
    }

    #[test]
    fn a_paused_scope_stops_lowering_from_recording_until_it_drops() {
        let groups = MergeGroupScope::enter(true);
        assert!(recording_groups());
        {
            let _paused = GroupsPaused::enter();
            assert!(collecting());
            assert!(!recording_groups());
            {
                let _nested = GroupsPaused::enter();
            }
            assert!(!recording_groups(), "a nested pause restores the outer one");
            // Class-name pairs are recorded through a pause.
            let _ = apply_over_active(3, classes(&["pb-2"]), &classes(&["p-4"]));
        }
        assert!(recording_groups());
        assert_eq!(groups.finish().overrides.len(), 1);
        assert!(
            !recording_groups(),
            "nothing records outside a collecting pass"
        );
    }

    #[test]
    fn a_dropped_group_scope_stops_collecting() {
        {
            let _groups = MergeGroupScope::enter(true);
        }
        let probe = MergeGroupScope::enter(false);
        record_group(group(&["a", "b"]));
        assert_eq!(probe.finish(), super::MergeLists::default());
        let outer = MergeGroupScope::enter(true);
        {
            let _inner = MergeGroupScope::enter(false);
            record_group(group(&["c", "d"]));
        }
        record_group(group(&["e", "f"]));
        assert_eq!(outer.finish().groups, [group(&["e", "f"])]);
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
        assert_eq!(error, super::TableProblem::Format(2));
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
            apply_over_active(5, classes(&["pb-2"]), &classes(&["p-4"])),
            ["pb-2"]
        );
        // Nothing to compare: no record.
        let _ = apply_over_active(0, Vec::new(), &classes(&["p-4"]));
        let _ = apply_over_active(0, classes(&["pb-2"]), &[]);
        let lists = scope.finish();
        assert!(lists.groups.is_empty());
        assert_eq!(
            lists.overrides,
            [MergeOverride {
                start: 5,
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
            apply_over_active(0, classes(&["pb-2", "card"]), &classes(&["p-4"])),
            ["card"]
        );
        assert!(lists.finish().overrides.is_empty());
    }

    /// `first_of_each` against the plain reading of its contract: walk the
    /// items in order and keep one unless an earlier kept item equals it.
    /// Equal items always share a place; unequal ones share one often under
    /// `a % 3` and always under `0`, so a bucket holding different items is
    /// drawn as often as a clean one.
    #[test]
    fn first_of_each_keeps_what_a_pairwise_scan_keeps() {
        type Place = fn(&(u8, u8)) -> u64;
        let places: [Place; 3] = [
            |item| u64::from(item.0),
            |item| u64::from(item.0 % 3),
            |_| 0,
        ];
        let mut rng = Rng::new(0x5eed_0b01);
        for _ in 0..3000 {
            let len = rng.below(24);
            let items: Vec<(u8, u8)> = (0..len)
                .map(|_| (*rng.pick(&[0, 1, 2, 3, 4, 5]), *rng.pick(&[0, 1, 2])))
                .collect();
            let mut expected: Vec<(u8, u8)> = Vec::new();
            for item in &items {
                if !expected.contains(item) {
                    expected.push(*item);
                }
            }
            for place in places {
                assert_eq!(first_of_each(items.clone(), place), expected, "{items:?}");
            }
        }
    }

    /// Two groups whose keys sit at the same offsets are told apart by their
    /// classes: both survive, and only the repeat of the first goes.
    #[test]
    fn different_groups_written_at_the_same_offsets_both_survive() {
        let scope = MergeGroupScope::enter(true);
        record_group(group(&["p-4", "m-2"]));
        record_group(group(&["p-8", "m-2"]));
        record_group(group(&["p-4", "m-2"]));
        assert_eq!(
            scope.finish().groups,
            [group(&["p-4", "m-2"]), group(&["p-8", "m-2"])]
        );
    }

    /// A group's place is its keys' offsets in order: groups at the same
    /// offsets meet, and a different offset, one more or one fewer, or the
    /// same offsets in another order each move it.
    #[test]
    fn a_group_place_follows_its_key_offsets() {
        let at = |starts: &[u32]| {
            super::group_place(&MergeGroup {
                keys: Vec::new(),
                key_starts: starts.to_vec(),
                classes: Vec::new(),
            })
        };
        assert_eq!(at(&[4, 9]), at(&[4, 9]));
        let distinct = [
            at(&[]),
            at(&[0]),
            at(&[1]),
            at(&[2]),
            at(&[0, 0]),
            at(&[1, 2]),
            at(&[2, 1]),
        ];
        for (index, place) in distinct.iter().enumerate() {
            assert!(
                !distinct[index + 1..].contains(place),
                "place {index} repeats"
            );
        }
    }

    /// The bucket hasher reads any key, not only a place: bytes fold
    /// FNV-style, so equal keys meet and a one-byte change moves the hash.
    #[test]
    fn the_place_hasher_hashes_bytes_as_well_as_places() {
        use std::hash::{BuildHasher, BuildHasherDefault};
        let build = BuildHasherDefault::<super::PlaceHasher>::default();
        assert_eq!(build.hash_one("p-4"), build.hash_one("p-4"));
        assert_ne!(build.hash_one("p-4"), build.hash_one("p-5"));
        assert_ne!(build.hash_one(1_u64), build.hash_one(2_u64));
    }
}
