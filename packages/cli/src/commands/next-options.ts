/**
 * The option both Next safelist commands read the same way, refused in the
 * registry's words.
 *
 * @module
 */

import { registryError } from '../utils/registry-words.js';

/**
 * Read `--parser-mode`.
 *
 * @param parserMode - The value given, if any.
 * @returns The parser, or undefined for the default.
 * @throws {CsszyxError} `cli-option-invalid` for any other value.
 */
export function nextParserMode(parserMode: string | undefined): 'rust' | 'wasm' | undefined {
    if (parserMode === undefined || parserMode === 'rust' || parserMode === 'wasm') {
        return parserMode;
    }
    throw registryError('cli-option-invalid', { form: 'parser-mode', value: parserMode });
}
