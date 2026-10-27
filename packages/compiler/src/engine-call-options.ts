/**
 * The one shape every single-file engine call takes: the subject, then one
 * options object.
 *
 * It renders from the browser module through `renderThrown`, as every error
 * the engine entries raise does, so `./engine` and `./internal` load no Node
 * words for it, and from the export of its own form, so they carry none of
 * the other forms' words either.
 *
 * @module engine-call-options
 */

import { OPTIONS_OBJECT_REQUIRED__ENGINE_CALL } from './diagnostic-browser.generated.js';
import { CsszyxError } from './errors.js';
import { renderThrown } from './thrown-words.js';

/**
 * The options object an engine call takes, refusing the positional shape the
 * call had before: a string or `null` where the object goes, or a third
 * argument.
 *
 * @param call - The function's name, as the error words it.
 * @param options - What the caller passed where the options go.
 * @param rest - What the caller passed after them.
 * @param required - A key the call cannot run without, such as `filename`.
 * @returns The options.
 * @throws {CsszyxError} `options-object-required`, form `engine-call`.
 */
export function engineCallOptions<T extends object>(
    call: string,
    options: T,
    rest: readonly unknown[],
    required?: keyof T & string,
): T {
    if (
        rest.length > 0 ||
        typeof options !== 'object' ||
        options === null ||
        (required !== undefined && typeof options[required] !== 'string')
    ) {
        const args = { form: 'engine-call', call } as const;
        throw new CsszyxError({
            code: 'options-object-required',
            args,
            message: renderThrown(OPTIONS_OBJECT_REQUIRED__ENGINE_CALL, args),
        });
    }
    return options;
}
