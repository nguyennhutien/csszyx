/**
 * Programmatic tokenizer harness using the SAME engine VS Code uses
 * (`vscode-textmate` + `vscode-oniguruma`).
 *
 * Mirrors VS Code's extension host wiring: grammars are registered with
 * explicit injection selectors derived from `package.json`'s
 * `contributes.grammars[].injectTo`. Without this step, Registry does NOT
 * auto-read a grammar's top-level `injectionSelector` field — injections
 * silently never fire. (This is the exact bug that kept the CSSzyx highlight
 * from applying; see the VS Code extension source for the equivalent wiring.)
 *
 * `tokenizeLine(input, scopeName)` returns an array of `{ text, scopes }`
 * entries so tests can assert exact scope stacks for specific tokens.
 */

import { readFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import * as oniguruma from 'vscode-oniguruma';
import * as tmgrammar from 'vscode-textmate';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const pkgRoot = path.resolve(__dirname, '..');
const fixturesDir = path.join(__dirname, 'fixtures');

const GRAMMAR_PATHS: Record<string, string> = {
    'source.sz.injection': path.join(pkgRoot, 'syntaxes', 'sz.tmGrammar.json'),
    'text.html.basic': path.join(fixturesDir, 'html.tmLanguage.json'),
    'text.html.derivative': path.join(fixturesDir, 'html-derivative.tmLanguage.json'),
};

// Mirror package.json `contributes.grammars[0].injectTo`.
const SZ_INJECT_TARGETS = [
    'source.tsx',
    'source.ts',
    'source.jsx',
    'source.js',
    'text.html.basic',
    'text.html.derivative',
];

let registryPromise: Promise<tmgrammar.Registry> | null = null;

/**
 * Lazy-load the Registry with oniguruma WASM initialized exactly once.
 * Registers the sz injection with explicit target scopes (= VS Code's injectTo).
 * @returns The shared Registry instance.
 */
async function getRegistry(): Promise<tmgrammar.Registry> {
    if (registryPromise) { return registryPromise; }
    registryPromise = (async (): Promise<tmgrammar.Registry> => {
        const wasm = await readFile(path.join(pkgRoot, '..', '..', 'node_modules', 'vscode-oniguruma', 'release', 'onig.wasm'));
        await oniguruma.loadWASM(wasm.buffer);
        const onigLib = Promise.resolve({
            /**
             * Create an Oniguruma scanner from pattern strings.
             * @param patterns - Array of regex pattern strings.
             * @returns An OnigScanner for the given patterns.
             */
            createOnigScanner: (patterns: string[]) => new oniguruma.OnigScanner(patterns),
            /**
             * Create an OnigString wrapper for UTF-8 text.
             * @param s - The source string to wrap.
             * @returns An OnigString instance.
             */
            createOnigString: (s: string) => new oniguruma.OnigString(s),
        });
        const registry = new tmgrammar.Registry({
            onigLib,
            /**
             * Load a grammar JSON file for the given scope name.
             * @param scopeName - The TextMate scope name to load.
             * @returns The parsed grammar, or null if the scope is unknown.
             */
            loadGrammar: async (scopeName: string) => {
                const filePath = GRAMMAR_PATHS[scopeName];
                if (!filePath) { return null; }
                const json = await readFile(filePath, 'utf8');
                return tmgrammar.parseRawGrammar(json, filePath);
            },
            /**
             * Called by the Registry to learn which scopes a grammar injects into.
             * This is the piece VS Code implements from `contributes.grammars[].injectTo`.
             * @param scopeName - The grammar's own scope name.
             * @returns Array of scope selectors this grammar injects into.
             */
            getInjections: (scopeName: string): string[] | undefined => {
                if (scopeName === 'text.html.basic' || scopeName === 'text.html.derivative'
                    || scopeName.startsWith('source.')) {
                    return SZ_INJECT_TARGETS.includes(scopeName) ? ['source.sz.injection'] : undefined;
                }
                return undefined;
            },
        });
        // Pre-load the injection so the registry resolves it when the host asks for its injections.
        await registry.loadGrammar('source.sz.injection');
        return registry;
    })();
    return registryPromise;
}

/**
 *
 */
export interface TokenAssertion {
    text: string;
    scopes: string[];
}

/**
 * Tokenize `input` as a single line under `topScopeName` (defaults to the
 * derivative HTML scope, which is what real `.html` files use).
 * @param input - The source line to tokenize (no trailing newline).
 * @param topScopeName - Grammar scope to host the injection. Defaults to text.html.derivative.
 * @returns Array of { text, scopes } pairs covering every char of `input`.
 */
export async function tokenizeLine(
    input: string,
    topScopeName: string = 'text.html.derivative',
): Promise<TokenAssertion[]> {
    const registry = await getRegistry();
    const grammar = await registry.loadGrammar(topScopeName);
    if (!grammar) { throw new Error(`Failed to load host grammar ${topScopeName}`); }

    const result = grammar.tokenizeLine(input, tmgrammar.INITIAL);
    return result.tokens.map(t => ({
        text: input.slice(t.startIndex, t.endIndex),
        scopes: t.scopes,
    }));
}

/**
 * Convenience: find the first token whose text exactly matches `needle`.
 * Throws if not found so callers can use it without null-checks or non-null
 * assertions (which are banned by the project's ESLint config).
 * @param tokens - Array of tokens from `tokenizeLine`.
 * @param needle - Exact token text to find.
 * @returns The matching token.
 */
export function findToken(
    tokens: TokenAssertion[],
    needle: string,
): TokenAssertion {
    const found = tokens.find(t => t.text === needle);
    if (!found) {
        throw new Error(`Token ${JSON.stringify(needle)} not found. Present: ${
            tokens.map(t => JSON.stringify(t.text)).join(', ')
        }`);
    }
    return found;
}
