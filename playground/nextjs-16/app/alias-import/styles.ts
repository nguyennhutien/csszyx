// Provider for the aliased cross-module import fixture. Nothing in this file
// marks it as interesting — no `szv(`, no csszyx import — so it is read only
// because a file that authors `sz` imports from it. The importer names it
// through `@/`, which is declared in tsconfig `paths` and NOT in the webpack
// alias table Next hands its plugins.
export const aliasCardSz = { p: 7, tracking: 'widest' };
