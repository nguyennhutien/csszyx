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
    type CandidateScanner,
    type ContentScanner,
    loadCandidateScanner,
    loadContentScanner,
    type ScanSource,
    scanSourcesOf,
} from './candidate-scanner.js';
export {
    createEmittedClassOracle,
    type EmittedClassOracle,
    findTailwindCssEntries,
    type OracleOptions,
    type OracleSkip,
    type OracleSkipKind,
    readStylesheetRole,
    type StylesheetFacts,
    type StylesheetRole,
    type TailwindLoader,
    type TailwindModule,
    tailwindEntriesAmong,
} from './emitted-class-oracle.js';
export {
    addClassHooks,
    appliedCandidatesIn,
    type ClassAttributeMatcher,
    type ClassAttributeOperator,
    type ClassHooks,
    type ClassOrigin,
    collectClassHooks,
    collectVariantHooks,
    isHook,
    noClassHooks,
    type OriginOracle,
    styleBlockHooks,
} from './origin-oracle.js';
export type { StylesheetAlias } from './project-resolver.js';
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
