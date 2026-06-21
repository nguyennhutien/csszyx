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
            z ^= z.wrapping_add((z ^ (z >> 7)).wrapping_mul(z | 61));
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
        // NOTE: object nesting is deliberately capped at a modest depth here.
        // Source nested hundreds of levels deep (e.g. `{hover:{hover:…}}`)
        // overflows the parser/transform recursion — a real build-time DoS that
        // a fatal stack overflow (NOT a catchable panic) makes invisible to
        // `catch_unwind`. That needs a dedicated pre-parse depth guard and is
        // tracked separately; this fuzz lane guards the panic/unwrap class only.
        let nested_variants = format!("<div sz={{{}1{}}} />", "{hover:".repeat(48), "}".repeat(48));
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
        let alphabet: &[u8] =
            b"sz={}[]()<>/\\\"'`;:.,*&|-_ \t\n\r0129divclassNamehoverfocusmdpwbg";
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
}
