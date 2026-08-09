// Cross-module provider for the Turbopack loader route. Carries no csszyx
// marker of its own — it is read only because the page imports it, through the
// `@/` alias Next declares in tsconfig rather than in any bundler alias table.
export const turboCardSz = { p: 7, tracking: 'widest' };
