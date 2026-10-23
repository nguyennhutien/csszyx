//! A seeded generator for the engine's property tests.
//!
//! mulberry32, the generator `tests/parser_panic_fuzz.rs` and the JavaScript
//! suites use: no crate, and a failure replays from the seed it prints.

/// mulberry32 over a 32-bit state.
pub struct Rng(u32);

impl Rng {
    /// A generator that starts at `seed`.
    pub const fn new(seed: u32) -> Self {
        Self(seed)
    }

    /// The next 32 bits.
    pub const fn next_u32(&mut self) -> u32 {
        self.0 = self.0.wrapping_add(0x6D2B_79F5);
        let mut z = self.0;
        z = (z ^ (z >> 15)).wrapping_mul(z | 1);
        z ^= z.wrapping_add((z ^ (z >> 7)).wrapping_mul(z | 0x3D));
        z ^ (z >> 14)
    }

    /// A number in `0..n`; `n` must not be 0.
    pub const fn below(&mut self, n: usize) -> usize {
        (self.next_u32() as usize) % n
    }

    /// One item of a non-empty slice.
    pub fn pick<'a, T>(&mut self, items: &'a [T]) -> &'a T {
        &items[self.below(items.len())]
    }
}
