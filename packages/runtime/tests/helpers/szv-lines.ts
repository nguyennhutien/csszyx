/**
 * The development lines `szv()` and its precompiled picker print, spelled out
 * from the registry's words so a suite pins the bytes the user reads.
 *
 * NOT a `.test.ts` file on purpose: vitest must not collect it as a suite.
 */
import { runtimeMessage } from '../../../compiler/tests/engine-message.js';

/**
 * `szv-unknown-variant`: a selection naming a dimension the config lacks.
 *
 * @param key - The dimension the selection named.
 * @returns The line.
 */
export function unknownVariantLine(key: string): string {
    return runtimeMessage(
        'szv-unknown-variant',
        `The \`szv\` selection names the variant \`${key}\`, which \`variants\` does not declare, so it is ignored.`,
        `help: declare \`variants.${key}\`, or remove \`${key}\` from the selection.`,
    );
}

/**
 * `szv-unknown-variant-value`: a selection giving a dimension a value it lacks.
 *
 * @param key - The dimension.
 * @param value - The value selected, as the line names it.
 * @param allowed - The values the dimension defines; none gives the help
 *   for a dimension with no value yet.
 * @returns The line.
 */
export function unknownValueLine(key: string, value: string, allowed: readonly string[]): string {
    return runtimeMessage(
        'szv-unknown-variant-value',
        `The \`szv\` selection sets \`${key}\` to \`${value}\`, which \`variants.${key}\` does not define, so it adds no class.`,
        allowed.length > 0
            ? `help: add \`${value}\` to \`variants.${key}\`, or use one of \`${allowed.join('`, `')}\`.`
            : `help: add \`${value}\` to \`variants.${key}\`, which defines no value yet.`,
    );
}

/** The sentence and advice of each `szv-config-invalid` form, by the value described. */
const CONFIG_INVALID: Record<
    string,
    (got: string, dimension?: string, token?: string) => string[]
> = {
    config: got => [
        `The \`szv\` config is not an object (got ${got}), so \`szv\` returns an empty sz object.`,
        'help: pass an object such as `{ base: { … }, variants: { … } }`.',
    ],
    base: got => [
        `\`base\` in the \`szv\` config is not an sz object (got ${got}), so \`szv\` ignores it.`,
        'help: make `base` an sz object, such as `{ p: 4 }`.',
    ],
    variants: got => [
        `\`variants\` in the \`szv\` config is not an object (got ${got}), so \`szv\` returns only \`base\`.`,
        'help: make `variants` an object of dimensions, such as `{ size: { sm: { p: 2 } } }`.',
    ],
    'default-variants': got => [
        `\`defaultVariants\` in the \`szv\` config is not an object (got ${got}), so no variant gets a default value.`,
        "help: make `defaultVariants` an object of values, such as `{ size: 'sm' }`.",
    ],
    dimension: (got, dimension) => [
        `\`variants.${dimension}\` is not an object of values (got ${got}), so it adds no classes.`,
        `help: make \`variants.${dimension}\` an object that maps each value to an sz object.`,
    ],
    'variant-value': (got, dimension, token) => [
        `\`variants.${dimension}.${token}\` is not an sz object (got ${got}), so it is ignored.`,
        'help: make it an sz object, such as `{ p: 4 }`, or `null` to add nothing.',
    ],
};

/**
 * `szv-config-invalid`: a part of the config without the shape `szv` reads.
 *
 * @param form - Which part.
 * @param got - How the value is described (`null`, `an array`, its `typeof`).
 * @param dimension - The dimension, for the `dimension` and `variant-value` forms.
 * @param token - The value, for the `variant-value` form.
 * @returns The line.
 */
export function configInvalidLine(
    form: string,
    got: string,
    dimension?: string,
    token?: string,
): string {
    return runtimeMessage(
        'szv-config-invalid',
        ...(CONFIG_INVALID[form] as NonNullable<(typeof CONFIG_INVALID)[string]>)(
            got,
            dimension,
            token,
        ),
    );
}
