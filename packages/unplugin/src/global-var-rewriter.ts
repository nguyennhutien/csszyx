import postcss from 'postcss';
import valueParser from 'postcss-value-parser';

import { hasSiblingDeclaration, isInsideThemeAtRule } from './global-var-postcss.js';
import type {
    GlobalVarAliasEntry,
    GlobalVarCssAliasRewriteResult,
    RewriteGlobalVarCssAliasesOptions,
} from './global-var-types.js';

/**
 * Rewrites one CSS source with a validated global variable alias plan.
 *
 * This is intentionally pure M5 plumbing. It does not integrate with build
 * hooks yet; callers must provide a fail-closed plan from `planGlobalVarAliases`.
 *
 * @param options Rewrite options.
 * @returns Rewritten CSS and rewrite counters.
 */
export function rewriteGlobalVarCssAliases(
    options: RewriteGlobalVarCssAliasesOptions,
): GlobalVarCssAliasRewriteResult {
    if (options.plan.diagnostics.length > 0 || options.plan.entries.length === 0) {
        return {
            css: options.css,
            aliasDeclarations: 0,
            rewrittenReferences: 0,
            diagnostics: options.plan.diagnostics,
        };
    }

    const root = postcss.parse(options.css, { from: options.filePath });
    const aliasNames = new Set(options.plan.entries.map(entry => entry.alias));
    const referenceAliases = new Map(
        options.plan.entries
            .filter(entry => canRewriteGlobalVarReferences(entry))
            .map(entry => [entry.original, entry.alias]),
    );
    let aliasDeclarations = 0;
    let rewrittenReferences = 0;

    root.walkDecls(decl => {
        if (isInsideThemeAtRule(decl)) {
            return;
        }

        const alias = options.plan.aliases.get(decl.prop);
        if (alias && !hasSiblingDeclaration(decl, alias)) {
            decl.cloneAfter({ prop: alias, value: `var(${decl.prop})` });
            aliasDeclarations++;
        }

        if (options.plan.aliases.has(decl.prop) || aliasNames.has(decl.prop)) {
            return;
        }

        const rewrite = rewriteGlobalVarValue(decl.value, referenceAliases);
        if (rewrite.count > 0) {
            decl.value = rewrite.value;
            rewrittenReferences += rewrite.count;
        }
    });

    return {
        css: root.toString(),
        aliasDeclarations,
        rewrittenReferences,
        diagnostics: [],
    };
}

/**
 * Checks whether a planned alias is safe for broad declaration-value rewrites.
 *
 * The pure CSS pass can always emit alias declarations next to matching custom
 * property definitions. Rewriting unrelated declaration values is stricter:
 * until the build hook has a cascade-aware owned-reference proof, only tokens
 * with at least one inherited global definition scope are eligible.
 *
 * @param entry Alias plan entry.
 * @returns true when declaration values can use this alias.
 */
function canRewriteGlobalVarReferences(entry: GlobalVarAliasEntry): boolean {
    return entry.scopes.some(isInheritedGlobalAliasScope);
}

/**
 * Checks whether a scanner scope describes an inherited global declaration.
 *
 * @param scope Stable scanner scope id.
 * @returns true for rule scopes such as `:root`, `html`, or `body`.
 */
function isInheritedGlobalAliasScope(scope: string): boolean {
    const leaf = scope.split(' > ').at(-1);
    if (!leaf?.startsWith('rule:')) {
        return false;
    }
    const selector = leaf.slice('rule:'.length);
    return selector.split(',').some(part => {
        const normalized = part.trim();
        return normalized === ':root' || normalized === 'html' || normalized === 'body';
    });
}

/**
 * Rewrites `var(--token)` references inside one declaration value.
 *
 * @param value CSS declaration value.
 * @param aliases Original-to-alias custom-property names.
 * @returns Rewritten value and rewrite count.
 */
function rewriteGlobalVarValue(
    value: string,
    aliases: ReadonlyMap<string, string>,
): { value: string; count: number } {
    const parsed = valueParser(value);
    let count = 0;
    parsed.walk(node => {
        if (node.type !== 'function' || node.value.toLowerCase() !== 'var') {
            return;
        }
        const firstArgument = node.nodes.find(child => child.type !== 'space');
        if (firstArgument?.type !== 'word') {
            return;
        }
        const alias = aliases.get(firstArgument.value);
        if (!alias) {
            return;
        }
        firstArgument.value = alias;
        count++;
    });
    return { value: count > 0 ? valueParser.stringify(parsed.nodes) : value, count };
}
