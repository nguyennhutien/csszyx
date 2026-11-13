//! Marks the class strings the engine emits, for a build that mangles.
//!
//! A mangle build renames only the class strings the compiler marks (ADR
//! 0034, the `goog.getCssName` model): each one is written as
//! `/*#__PURE__*/__szCss("…")`, and the bundle pass replaces the call with the
//! renamed string before the minifier runs. A call the pass misses still runs:
//! `__szCss` encodes through the mangle registry, or returns its argument when
//! there is none. Any other string in the bundle is left as written.
//!
//! The switch is per transform and per thread, like the class prefix, so the
//! emitters read it without every rewrite lane taking a parameter.

use std::cell::Cell;

/// The call a marked class string is wrapped in.
pub const CLASS_MARK_CALL: &str = "/*#__PURE__*/__szCss(";

#[derive(Clone, Copy, Default)]
struct MarkState {
    enabled: bool,
    emitted: bool,
}

thread_local! {
    static MARK: Cell<MarkState> = const {
        Cell::new(MarkState {
            enabled: false,
            emitted: false,
        })
    };
}

/// Marks every class string emitted on this thread until the scope drops, and
/// records whether one was. Dropping the scope restores the previous state,
/// even when the transform unwinds.
#[must_use = "class strings are marked only while the scope is alive"]
pub struct ClassMarkScope {
    previous: MarkState,
}

impl ClassMarkScope {
    /// Mark class strings when `enabled`; otherwise emit them unchanged.
    pub fn enter(enabled: bool) -> Self {
        Self {
            previous: MARK.with(|cell| {
                cell.replace(MarkState {
                    enabled,
                    emitted: false,
                })
            }),
        }
    }

    /// Whether a marked class string was emitted since the scope opened.
    ///
    /// The receiver ties the read to a live scope: outside one the state is
    /// another transform's.
    #[allow(clippy::unused_self)]
    pub fn emitted(&self) -> bool {
        MARK.with(|cell| cell.get().emitted)
    }
}

impl Drop for ClassMarkScope {
    fn drop(&mut self) {
        MARK.with(|cell| cell.set(self.previous));
    }
}

/// A quoted JavaScript string of classes, wrapped in the mark call when
/// marking is on. The empty string carries no class and stays bare.
pub fn mark_class_literal(literal: String) -> String {
    MARK.with(|cell| {
        let state = cell.get();
        if !state.enabled || literal == "\"\"" {
            return literal;
        }
        cell.set(MarkState {
            emitted: true,
            ..state
        });
        format!("{CLASS_MARK_CALL}{literal})")
    })
}

/// Whether class strings are being marked on this thread.
pub fn marking() -> bool {
    MARK.with(|cell| cell.get().enabled)
}

#[cfg(test)]
mod tests {
    use super::{mark_class_literal, marking, ClassMarkScope};

    #[test]
    fn a_literal_is_left_as_written_outside_a_marking_scope() {
        assert!(!marking());
        assert_eq!(mark_class_literal("\"p-4\"".into()), "\"p-4\"");
        let scope = ClassMarkScope::enter(false);
        assert_eq!(mark_class_literal("\"p-4\"".into()), "\"p-4\"");
        assert!(!scope.emitted());
    }

    #[test]
    fn a_marking_scope_wraps_each_class_literal_and_records_it() {
        let scope = ClassMarkScope::enter(true);
        assert!(!scope.emitted());
        assert_eq!(mark_class_literal("\"\"".into()), "\"\"");
        assert!(!scope.emitted(), "the empty string carries no class");
        assert_eq!(
            mark_class_literal("\"p-4 m-2\"".into()),
            "/*#__PURE__*/__szCss(\"p-4 m-2\")"
        );
        assert!(scope.emitted());
    }

    #[test]
    fn dropping_a_scope_restores_the_one_around_it() {
        let outer = ClassMarkScope::enter(true);
        let _ = mark_class_literal("\"p-4\"".into());
        {
            let inner = ClassMarkScope::enter(false);
            assert!(!marking());
            assert!(!inner.emitted());
        }
        assert!(marking());
        assert!(outer.emitted(), "the outer scope keeps what it recorded");
        drop(outer);
        assert!(!marking());
    }
}
