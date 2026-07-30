/**
 * `csszyx/core` — string-first runtime helpers, no compiler in the bundle.
 *
 * Mirror of `@csszyx/runtime/core` so the compiler's szr-import rewrite can
 * stay inside the package the app actually depends on: an app importing from
 * `csszyx` may not resolve `@csszyx/runtime` directly under strict
 * node_modules layouts, so the rewrite maps `'csszyx'` → `'csszyx/core'` and
 * `'@csszyx/runtime'` → `'@csszyx/runtime/core'`, never across packages.
 */
export {
    __szvPick,
    _sz,
    _sz2,
    _sz3,
    _szMerge,
    _szPart,
    type SzInput,
    type SzvCompiledTable,
    type SzvPickSelection,
    szr,
} from '@csszyx/runtime/core';
