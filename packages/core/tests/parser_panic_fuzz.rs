//! Crafted-input panic fuzz for the source parser/transformer.
//!
//! `transform_batch` runs at build time over developer source. A panic there —
//! an out-of-bounds index, an `.unwrap()` on a malformed-input path, or runaway
//! recursion — would crash the bundler process: a denial of service triggered
//! by hostile or simply malformed source. This harness throws a wide range of
//! adversarial inputs at `transform_batch` and asserts it never panics. It must
//! return a value or a `TransformError`, never unwind.
//!
//! The parser lives behind the `native-engine` feature, so this only runs under
//! `cargo test --features native-engine`; plain `cargo test` compiles it to docs.

#[cfg(feature = "native-engine")]
mod parser_panic_fuzz {
    use csszyx_core::transform::{transform_batch, TransformFile};
    use std::panic::{catch_unwind, AssertUnwindSafe};

    /// Deterministic mulberry32 PRNG — no external crate, seeded so any failure
    /// reproduces exactly.
    struct Rng(u32);
    impl Rng {
        const fn next_u32(&mut self) -> u32 {
            self.0 = self.0.wrapping_add(0x6D2B_79F5);
            let mut z = self.0;
            z = (z ^ (z >> 15)).wrapping_mul(z | 1);
            z ^= z.wrapping_add((z ^ (z >> 7)).wrapping_mul(z | 0x3D));
            z ^ (z >> 14)
        }
        const fn below(&mut self, n: usize) -> usize {
            (self.next_u32() as usize) % n
        }
    }

    /// Run one input through `transform_batch`; return `true` if it did NOT panic.
    fn survives(source: &str) -> bool {
        let file = TransformFile {
            filename: "fuzz.tsx".to_string(),
            source: source.to_string(),
        };
        catch_unwind(AssertUnwindSafe(|| {
            let _ = transform_batch(std::slice::from_ref(&file));
        }))
        .is_ok()
    }

    #[test]
    fn never_panics_on_crafted_input() {
        // The inputs below are meant to be hostile; swallow their panic output
        // so a (caught) panic does not spam the test log — we assert on the
        // catch_unwind result, then restore the previous hook.
        let prev = std::panic::take_hook();
        std::panic::set_hook(Box::new(|_| {}));

        // Owned hostile strings (built once, referenced below).
        let unbalanced_open = "[".repeat(20_000);
        let unbalanced_mix = "([{".repeat(10_000);
        // `nested_variants` stays just under the pre-parse depth guard
        // (MAX_SOURCE_NESTING_DEPTH = 64) so it exercises the real recursive
        // path. `nested_guarded_*` go well past it: source nested hundreds of
        // levels deep (e.g. `{hover:{hover:…}}`) would otherwise overflow the
        // parser stack — a fatal abort (NOT a catchable panic) invisible to
        // `catch_unwind`. The guard bails before the parser, so these now
        // survive; `deep_nesting_is_guarded_not_aborted` asserts the behavior.
        let nested_variants = format!("<div sz={{{}1{}}} />", "{hover:".repeat(48), "}".repeat(48));
        let nested_guarded_200 = format!(
            "<div sz={{{}1{}}} />",
            "{hover:".repeat(200),
            "}".repeat(200)
        );
        let nested_guarded_1000 = format!(
            "<div sz={{{}1{}}} />",
            "{hover:".repeat(1_000),
            "}".repeat(1_000)
        );
        let deep_brackets = format!("<div sz={{{{ w: '{}' }}}} />", "[".repeat(2_000));
        let huge_value = format!("<div sz={{{{ p: '{}' }}}} />", "a".repeat(200_000));
        let huge_attr = format!("<div className=\"{}\" />", "x ".repeat(100_000));
        let many_props = format!("<div sz={{{{ {} }}}} />", "p:1,".repeat(20_000));
        let control_soup: String = (0u8..32).cycle().take(4_000).map(|b| b as char).collect();

        let fixed: &[&str] = &[
            "",
            " ",
            "\0",
            "\u{feff}",
            "sz",
            "<div sz={{",
            "<div sz={{}} />",
            "<div sz={{ p: '",
            "<div sz={{ css: { color: 'red;}</style><script>alert(1)//' } }} />",
            "<div sz={{ '__proto__': { p: 1 } }} />",
            "<div className=\"",
            "const x = `${unterminated",
            "/* unterminated comment",
            "<div sz />",
            "<div sz={undefined} />",
            "<>{/* */}</>",
            "\\\\\\\\\\\\",
            "<div sz={{ [`${x}`]: 1 }} />",
            &unbalanced_open,
            &unbalanced_mix,
            &nested_variants,
            &nested_guarded_200,
            &nested_guarded_1000,
            &deep_brackets,
            &huge_value,
            &huge_attr,
            &many_props,
            &control_soup,
        ];

        for source in fixed {
            let preview: String = source.chars().take(48).collect();
            assert!(
                survives(source),
                "transform_batch panicked on crafted input: {preview:?}"
            );
        }

        // Randomized inputs built from a hostile alphabet of sz-syntax tokens and
        // metacharacters, so the parser sees plausible-but-broken source shapes.
        let alphabet: &[u8] = b"sz={}[]()<>/\\\"'`;:.,*&|-_ \t\n\r0129divclassNamehoverfocusmdpwbg";
        let mut rng = Rng(0x1234_5678);
        for _ in 0..3_000 {
            let len = rng.below(512) + 1;
            let mut bytes = Vec::with_capacity(len);
            for _ in 0..len {
                bytes.push(alphabet[rng.below(alphabet.len())]);
            }
            let source = String::from_utf8_lossy(&bytes).into_owned();
            assert!(
                survives(&source),
                "transform_batch panicked on random input: {source:?}"
            );
        }

        std::panic::set_hook(prev);
    }

    #[test]
    fn deep_nesting_is_guarded_not_aborted() {
        // Source nested past the pre-parse depth guard must bail BEFORE the
        // recursive parser — a stack overflow there is a fatal process abort,
        // not a catchable panic. The engine leaves the file unchanged and emits
        // an actionable diagnostic instead of crashing the build.
        let deep = format!(
            "<div sz={{{}1{}}} />",
            "{hover:".repeat(300),
            "}".repeat(300)
        );
        let file = TransformFile {
            filename: "deep.tsx".to_string(),
            source: deep.clone(),
        };
        let results = transform_batch(std::slice::from_ref(&file)).expect("batch returns Ok");
        let result = &results[0];
        assert_eq!(
            result.code, deep,
            "deeply nested file must be left unchanged"
        );
        assert!(
            !result.metadata.transformed,
            "deeply nested file must not be marked transformed"
        );
        assert!(
            result
                .diagnostics
                .iter()
                .any(|d| d.contains("source nesting exceeded")),
            "must surface the nesting-depth diagnostic, got: {:?}",
            result.diagnostics
        );
    }

    #[test]
    fn legitimately_deep_source_below_the_guard_still_compiles() {
        // ~30 levels is comfortably under MAX_SOURCE_NESTING_DEPTH (64): a real,
        // if heavy, component must still transform normally (no false reject).
        let nested = format!(
            "<div sz={{{}{{ p: 4 }}{}}} />",
            "{hover:".repeat(30),
            "}".repeat(30)
        );
        let file = TransformFile {
            filename: "ok.tsx".to_string(),
            source: nested,
        };
        let results = transform_batch(std::slice::from_ref(&file)).expect("batch returns Ok");
        assert!(
            !results[0]
                .diagnostics
                .iter()
                .any(|d| d.contains("source nesting exceeded")),
            "source below the guard must not trip the nesting diagnostic"
        );
    }
}
