/**
 * Asks a project's own Tailwind whether a class name produces CSS.
 *
 * Every surface that judges a class name — `csszyx check`, the repository's
 * emitted-class gate, and the editor and dev-server diagnostics — asks this
 * one oracle, so none of them carries a second copy of Tailwind's grammar.
 * The design system comes from the Tailwind the PROJECT installed, resolved
 * against the project's own `package.json`, because a table compiled by a
 * different Tailwind version answers for a vocabulary the project does not
 * have.
 *
 * @module
 */
export {
    createEmittedClassOracle,
    type EmittedClassOracle,
    findTailwindCssEntries,
    type OracleOptions,
    type OracleSkipKind,
    type StylesheetFacts,
    type TailwindLoader,
    type TailwindModule,
    tailwindEntriesAmong,
} from './emitted-class-oracle.js';
export {
    findSiblingKeywordValues,
    type KeywordOracle,
    type SiblingKeywordFinding,
    type SzValuePair,
    szValuePairs,
    type ThemeNamespace,
} from './sibling-keyword.js';
export {
    type CollisionOracle,
    type DeclaredToken,
    findThemeCollisions,
    type ThemeCollisionFinding,
} from './theme-collision.js';
