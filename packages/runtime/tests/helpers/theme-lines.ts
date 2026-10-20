/**
 * The development lines the theme-token registry prints, spelled out from
 * the registry's words so a suite pins the bytes the user reads.
 *
 * NOT a `.test.ts` file on purpose: vitest must not collect it as a suite.
 */
import { runtimeMessage } from '../../../compiler/tests/engine-message.js';

/**
 * `theme-collision`: a token whose name a built-in also uses.
 *
 * @param name - The token.
 * @param form - What it shadows: a utility keyword (a colour) or a value.
 * @returns The line.
 */
export function themeCollisionLine(name: string, form: 'utility-keyword' | 'value'): string {
    const what = form === 'value' ? 'a built-in value' : 'a built-in utility keyword';
    return runtimeMessage(
        'theme-collision',
        `Theme token \`${name}\` shadows ${what}, so Tailwind compiles both meanings into one class, which sets the token's property and the built-in's.`,
        'help: rename the token; while it shares a built-in name, no class order or `szcn` call can fix this.',
        'note: a later class that sets only one of them does not replace it in `szcn`, so both apply and stylesheet order decides which wins; `classify` reports the built-in meaning only.',
    );
}

/**
 * `theme-token-ambiguous`: a token declared under two namespaces that share a prefix.
 *
 * @param name - The token.
 * @param form - Which pair of namespaces.
 * @returns The line.
 */
export function themeAmbiguousLine(
    name: string,
    form: 'color-text-size' | 'font-family-weight',
): string {
    const [both, cls] =
        form === 'color-text-size'
            ? ['a colour and a text size', `text-${name}`]
            : ['a font family and a font weight', `font-${name}`];
    return runtimeMessage(
        'theme-token-ambiguous',
        `Theme token \`${name}\` is defined as both ${both}, so \`classify\` cannot name the property of \`${cls}\`, and Tailwind compiles that class for only one of them.`,
        'help: rename one of the tokens.',
        'note: until then the token belongs to neither, so `szcn` keeps both classes instead of merging them.',
    );
}

/** `register-szcn-groups-ignored`: a hand registration, which no longer changes `szcn`. */
export const REGISTER_IGNORED_LINE = runtimeMessage(
    'register-szcn-groups-ignored',
    '`registerSzcnGroups` no longer changes what `szcn` merges: `szcn` merges on the CSS your Tailwind compiles, and this registry only names the property `classify` and `splitBox` read.',
    'help: declare the tokens under `@theme` (`--color-*`, `--text-*`, `--font-*`, `--font-weight-*`), delete the CSS rules you wrote for those classes, and use a csszyx integration that supplies a merge table.',
    'note: `szcn` never removes a class from `@utility`, a plugin or plain CSS; without a table it removes only exact repeats.',
);
