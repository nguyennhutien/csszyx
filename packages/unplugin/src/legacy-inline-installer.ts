/**
 * The executable inline `window.__csszyx` installer — ONE generator.
 *
 * Two lanes still emit this script for one migration window: the Vite HTML
 * transformer under the deprecated `html`/`both` delivery modes, and the
 * webpack layout rewrite, which has no bundle delivery yet. They used to
 * carry two byte-identical hand-written copies of the IIFE. Each lane only
 * differs in WHERE the four inputs come from (a JSON tag, a placeholder, a
 * literal), so that is the whole parameter surface.
 *
 * Deleted with the lanes that call it (see the CSP-safe delivery plan).
 *
 * @module legacy-inline-installer
 */

/** JavaScript expressions the installer evaluates for its inputs. */
export interface LegacyInlineInstallerInputs {
    /** Expression yielding the class → token map. */
    mapExpr: string;
    /** Expression yielding the CSS-variable map. */
    varMapExpr: string;
    /** Expression yielding the global-alias prefix string. */
    prefixExpr: string;
    /** Expression yielding the checksum string. */
    checksumExpr: string;
}

/**
 * The installer IIFE, without a surrounding `<script>` element.
 *
 * It builds the reverse maps and installs the historical `CsszyxDebugHelpers`
 * shape on `window.__csszyx`. ES5 on purpose: it runs before any bundle, in
 * whatever the host page supports.
 *
 * @param inputs - Where each input comes from.
 * @returns The IIFE source.
 */
export function createLegacyInlineInstaller(inputs: LegacyInlineInstallerInputs): string {
    return (
        `(function(){var m=${inputs.mapExpr};var vm=${inputs.varMapExpr};var gp=${inputs.prefixExpr};` +
        'var r={};var vr={};for(var k in m)r[m[k]]=k;' +
        'for(var vk in vm){var vv=vm[vk];var vs=Array.isArray(vv)?vv:[vv];for(var vi=0;vi<vs.length;vi++)(vr[vs[vi]]||(vr[vs[vi]]=[])).push(vk)}' +
        `window.__csszyx={mangleMap:m,varMangleMap:vm,checksum:${inputs.checksumExpr},` +
        'decode:function(c){return r[c]},encode:function(c){return m[c]},' +
        'decodeVar:function(v){return vr[v]||[]},encodeVar:function(v){return vm[v]},' +
        'decodeGlobalVar:function(v){var a=vr[v]||[];return v.indexOf(gp)===0?a[0]:void 0},' +
        'decodeAll:function(el){return(el.className||"").split(" ").map(function(c){return r[c]||c})}}})()'
    );
}
