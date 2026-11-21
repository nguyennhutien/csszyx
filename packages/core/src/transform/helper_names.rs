//! The names the code compiled from `sz` calls its runtime helpers by.
//!
//! The engine writes calls to runtime helpers — `_szMerge(c, "p-4")` — and the
//! plugin imports each helper into the module. A binding of the same name in a
//! scope that holds such a call would take it, so a helper whose name the file
//! spells is called through the first `name$k` the file does not spell, and
//! the plugin imports it `as` that name. This is TypeScript's file-level
//! unique-name rule (`isFileLevelUniqueName`): it needs no scope analysis, and
//! a spelling that is no binding (a comment, a string, a member) only renames.
//!
//! A spelling counts only as a whole identifier, so `_sz` is not spelled by
//! `_szMerge` nor `__szCss` by `__szCssX`. An identifier can spell a name
//! through `\u` escapes (`\u005fszMerge`), so the names are read from the
//! text with each escape of an identifier character decoded; one in a string
//! decodes too, which only renames.
//!
//! Cost: `n` is the source length. A file without `\u` costs one scan for it;
//! one with `\u` one more pass to decode, where each escape reads only its own
//! hex digits, so an unterminated `\u{` repeated across the file stays `O(n)`. A text without `_sz` — nearly every
//! file — stops there. Otherwise each helper costs one scan per candidate,
//! and a candidate is taken only when the text spells it, so `k` candidates
//! need `k` spellings: `O(n · k)` per helper, at most `O(n²)` for a file built
//! to spell every candidate.
//!
//! The names are per transform and per thread, like the class mark, so the
//! emitters read them without every rewrite lane taking a parameter.

use std::borrow::Cow;
use std::cell::RefCell;

/// Every helper the engine's output calls by name.
pub const HELPERS: &[&str] = &[
    "_sz",
    "_szMerge",
    "_szcn",
    "_szPart",
    "__szvPick",
    "__szvPick1",
    "__szColorVar",
    "__szSpacingVar",
    "__szUnitVar",
    "__szFactorVar",
    "__szBoolClass",
    "__szCss",
];

/// The helpers one transform renames, and whether each was called.
#[derive(Default)]
struct Names {
    renamed: Vec<(&'static str, String, bool)>,
}

thread_local! {
    static NAMES: RefCell<Names> = RefCell::new(Names::default());
}

/// Whether a byte continues an identifier. A non-ASCII neighbour ends the
/// name: JS reads Unicode whitespace there as a separator, and taking a
/// non-ASCII identifier character for one only renames.
const fn continues_identifier(byte: u8) -> bool {
    byte.is_ascii_alphanumeric() || byte == b'_' || byte == b'$'
}

/// Whether `source` holds `name` as a whole identifier.
pub fn spells(source: &str, name: &str) -> bool {
    let bytes = source.as_bytes();
    source.match_indices(name).any(|(at, _)| {
        let before = at.checked_sub(1).map(|i| bytes[i]);
        let after = bytes.get(at + name.len()).copied();
        !before.is_some_and(continues_identifier) && !after.is_some_and(continues_identifier)
    })
}

/// The text identifiers are read from: `source` with each `\uXXXX` or
/// `\u{X}` escape of an ASCII identifier character decoded. Any other escape,
/// a lone surrogate among them, stays as written.
pub fn identifier_text(source: &str) -> Cow<'_, str> {
    if !source.contains("\\u") {
        return Cow::Borrowed(source);
    }
    let mut out = String::with_capacity(source.len());
    let mut rest = source;
    while let Some(at) = rest.find("\\u") {
        out.push_str(&rest[..at]);
        let after = &rest[at + 2..];
        let (digits, len) = after.strip_prefix('{').map_or_else(
            || (after.get(..4).unwrap_or(""), 4),
            |braced| {
                let end = braced
                    .bytes()
                    .position(|b| !b.is_ascii_hexdigit())
                    .unwrap_or(braced.len());
                if braced.as_bytes().get(end) == Some(&b'}') {
                    (&braced[..end], end + 2)
                } else {
                    ("", 0)
                }
            },
        );
        let decoded = u32::from_str_radix(digits, 16)
            .ok()
            .and_then(char::from_u32)
            .filter(|c| c.is_ascii_alphanumeric() || *c == '_' || *c == '$');
        if let Some(c) = decoded {
            out.push(c);
            rest = &after[len..];
        } else {
            out.push_str("\\u");
            rest = after;
        }
    }
    out.push_str(rest);
    Cow::Owned(out)
}

/// The first `helper$k` the file does not spell, for a helper it spells.
///
/// The helper's own spelling and each candidate spelled before the free one
/// start a distinct occurrence of the helper's text, so `k` is at most the
/// number of those occurrences.
fn free_name(source: &str, helper: &str) -> String {
    (1..=source.matches(helper).count())
        .map(|k| format!("{helper}${k}"))
        .find(|candidate| !spells(source, candidate))
        .expect("each candidate taken is one more occurrence of the helper")
}

/// Calls helpers by names `source` does not spell until the scope drops.
/// Dropping the scope restores the names of the transform around it.
#[must_use = "helpers keep their own names once the scope drops"]
pub struct HelperNameScope {
    previous: Names,
}

impl HelperNameScope {
    /// Choose the names for a transform of `source`.
    pub fn enter(source: &str) -> Self {
        let text = identifier_text(source);
        let renamed = if text.contains("_sz") {
            HELPERS
                .iter()
                .filter(|helper| spells(&text, helper))
                .map(|helper| (*helper, free_name(&text, helper), false))
                .collect()
        } else {
            Vec::new()
        };
        Self {
            previous: NAMES.with(|cell| cell.replace(Names { renamed })),
        }
    }

    /// The names the transform called a renamed helper by, in helper order.
    ///
    /// The receiver ties the read to a live scope: outside one the names are
    /// another transform's.
    #[allow(clippy::unused_self)]
    pub fn aliases(&self) -> Vec<String> {
        NAMES.with(|cell| {
            cell.borrow()
                .renamed
                .iter()
                .filter(|(_, _, called)| *called)
                .map(|(_, alias, _)| alias.clone())
                .collect()
        })
    }
}

impl Drop for HelperNameScope {
    fn drop(&mut self) {
        let previous = std::mem::take(&mut self.previous);
        NAMES.with(|cell| *cell.borrow_mut() = previous);
    }
}

/// The name the code calls `helper` by.
pub fn local(helper: &'static str) -> Cow<'static, str> {
    NAMES.with(|cell| {
        let mut names = cell.borrow_mut();
        match names
            .renamed
            .iter_mut()
            .find(|(renamed, _, _)| *renamed == helper)
        {
            Some((_, alias, called)) => {
                *called = true;
                Cow::Owned(alias.clone())
            }
            None => Cow::Borrowed(helper),
        }
    })
}

#[cfg(test)]
mod tests {
    use super::{identifier_text, local, spells, HelperNameScope};

    #[test]
    fn a_name_beside_unicode_whitespace_is_spelled() {
        // JS reads each of these as a separator, so the name beside it binds.
        for sep in ['\u{a0}', '\u{3000}', '\u{feff}', '\u{2028}', '\u{2029}'] {
            let source = format!("const{sep}_szMerge{sep}= 1;");
            assert!(spells(&source, "_szMerge"), "{sep:?}");
            let _scope = HelperNameScope::enter(&source);
            assert_eq!(local("_szMerge"), "_szMerge$1", "{sep:?}");
        }
    }

    /// The worst case is an unterminated `\u{` repeated across the file: each
    /// one must cost its own digit run, not a search to the next `}`.
    #[test]
    fn unterminated_braced_escapes_decode_in_linear_time() {
        fn fastest(source: &str) -> std::time::Duration {
            (0..3)
                .map(|_| {
                    let start = std::time::Instant::now();
                    std::hint::black_box(identifier_text(std::hint::black_box(source)));
                    start.elapsed()
                })
                .min()
                .unwrap_or_default()
        }
        let repeats = 100_000;
        let adversarial = format!("{}}}", "\\u{".repeat(repeats));
        let control = "\\u{73}".repeat(repeats);
        let ratio = fastest(&adversarial).as_secs_f64() / fastest(&control).as_secs_f64();
        assert!(
            ratio < 10.0,
            "unterminated escapes cost {ratio:.0}x the control"
        );
        // A run that ends in anything but `}` is no escape, wherever a `}` sits.
        assert_eq!(identifier_text("\\u{73 } \\u{zz}"), "\\u{73 } \\u{zz}");
    }

    #[test]
    fn a_name_is_spelled_only_as_a_whole_identifier() {
        assert!(spells("const _szMerge = 1;", "_szMerge"));
        assert!(spells("_szMerge", "_szMerge"));
        assert!(spells("o._szMerge()", "_szMerge"), "a member only renames");
        assert!(!spells("const _szMergeAll = 1;", "_szMerge"));
        assert!(!spells("x_szMerge", "_szMerge"));
        assert!(!spells("$_szMerge", "_szMerge"));
        assert!(!spells("_szMerge$1", "_szMerge"));
        assert!(
            spells("_szMergeé", "_szMerge"),
            "a non-ASCII neighbour only renames"
        );
        assert!(!spells("__szCss", "_sz"));
        assert!(spells("a _szMerge$1 b", "_szMerge$1"));
        assert!(!spells("_szMerge$10", "_szMerge$1"));
    }

    #[test]
    fn a_scope_renames_what_its_file_spells_and_reports_what_was_called() {
        let scope = HelperNameScope::enter("const _szMerge = 1, _szMerge$1 = 2, __szCss = 3;");
        assert_eq!(local("_sz"), "_sz");
        assert_eq!(local("_szMerge"), "_szMerge$2");
        assert_eq!(scope.aliases(), ["_szMerge$2"], "`__szCss` was not called");
        drop(scope);
        assert_eq!(local("_szMerge"), "_szMerge");
    }

    #[test]
    fn an_escaped_identifier_spells_the_name_it_decodes_to() {
        assert_eq!(identifier_text("\\u005fszMerge"), "_szMerge");
        assert_eq!(
            identifier_text("_\\u{73}zcn = \\u{5F}sz$\\u0031"),
            "_szcn = _sz$1"
        );
        // A braced escape of any length is read whole.
        assert_eq!(identifier_text("_\\u{073}zcn \\u{00005f}sz"), "_szcn _sz");
        // Escapes of anything but an identifier character stay as written.
        assert_eq!(
            identifier_text("'\\uD800 \\u00a0 \\u{zz} \\u12'"),
            "'\\uD800 \\u00a0 \\u{zz} \\u12'"
        );
        assert_eq!(identifier_text("\\u"), "\\u");
        assert_eq!(identifier_text("\\u{"), "\\u{");
    }

    #[test]
    fn an_escape_renames_only_what_it_spells_and_scopes_nest() {
        let outer = HelperNameScope::enter("const \\u005fszcn = 1, _szcn$\\u0031 = 2; '\\uD800';");
        assert_eq!(local("_szcn"), "_szcn$2");
        {
            let inner = HelperNameScope::enter("plain");
            assert_eq!(local("_szcn"), "_szcn");
            assert!(inner.aliases().is_empty());
        }
        assert_eq!(local("__szCss"), "__szCss");
        assert_eq!(outer.aliases(), ["_szcn$2"]);
    }
}
