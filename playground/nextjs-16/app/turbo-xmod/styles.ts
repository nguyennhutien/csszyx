// Provider for the isolated cross-module fixture. Nothing marks this file as
// interesting — no `szv(`, no csszyx import — so it is read only because a file
// that authors `sz` imports from it. The importer names it through `@/`, which
// Next declares in tsconfig `paths` rather than in any bundler alias table.
//
// The padding below is part of the integration contract: the spec rewrites that
// literal and asserts the computed style that follows. Nothing else in this file
// may spell it, because the rewrite replaces the FIRST match — a mention in a
// comment would be edited instead of the value, and the spec would then wait
// forever for a change it had already made somewhere harmless.
export const xmodCardSz = { p: 7, tracking: 'widest' };
