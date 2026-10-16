/**
 * What the csszyx packages share with one another and nobody else: the Vue
 * and Svelte adapters read markup and lower template `sz` through it, and the
 * CLI and the build plugin read the engine's output and choose an artifact
 * with it. Its shape follows the adapters and may change in any release.
 *
 * @module internal
 * @internal Not a stable API.
 */

export { type EmittedClassName, findEmittedClassName } from './emitted-class-name.js';
export {
    braceGroupEnd,
    type ClosedMarkup,
    isOpeningTag,
    type Markup,
    type MarkupSyntax,
    type MarkupTag,
    markupResume,
    rawTextEnd,
    readMarkup,
} from './markup-tags.js';
export {
    isParserMode,
    type ParserMode,
    type ResolveParserModeInput,
    type ResolveParserModeResult,
    resolveParserMode,
} from './parser-mode.js';
export {
    reportTemplateSzDiagnostics,
    rewriteTemplateSz,
    type TemplateSzAttribute,
    type TemplateSzDiagnostic,
    type TemplateSzLowering,
    type TemplateSzOptions,
    type TemplateSzReporter,
    type TemplateSzRewrite,
    type TemplateSzValue,
    transformTemplateFile,
} from './template-sz.js';
