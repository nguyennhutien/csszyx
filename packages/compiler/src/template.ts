/**
 * What a template adapter needs from the compiler: lower the `sz` attributes
 * of a template file, place and report its diagnostics, and resolve the
 * framework's own parser from the project. Every template adapter imports this
 * subpath and nothing framework-specific lives here, so an adapter loads its
 * framework's parser and this kit, and a build with no template file loads
 * neither, nor the source-map writer the kit uses. Not a stable API: it
 * changes shape with the adapters.
 *
 * @module
 */

export type { SourceMap } from 'magic-string';
export { type RequirePeerInput, requirePeer } from './peer-module.js';
export {
    type LoweredTemplate,
    type LowerSzAttributesInput,
    type LowerSzAttributesOptions,
    lowerSzAttributes,
    type TemplatePreprocess,
    type TemplatePreprocessResult,
    type TemplateSzReading,
    type TemplateVitePlugin,
    type TemplateVitePluginInput,
    templateVitePlugin,
} from './template-adapter.js';
export {
    mayHoldSzAttribute,
    type PlaceTemplateDiagnosticInput,
    placeTemplateDiagnostic,
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
