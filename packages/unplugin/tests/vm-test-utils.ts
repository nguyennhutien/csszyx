import { runInNewContext } from 'node:vm';

/** Options that keep generated-code assertions bounded and isolated. */
const VM_OPTIONS = {
    timeout: 1_000,
    contextCodeGeneration: { strings: false, wasm: false },
};

/**
 * Execute generated test output in a context without host globals or code generation.
 *
 * Keeping the single VM boundary here makes every generated-script test use the
 * same timeout and prevents the tested script from compiling a second payload.
 *
 * @param source Generated JavaScript under test.
 * @param sandbox Explicit globals exposed to that script.
 * @returns The script completion value.
 */
export function runGeneratedCode(
    source: string,
    sandbox: Record<string, unknown> = Object.create(null) as Record<string, unknown>,
): unknown {
    return Reflect.apply(runInNewContext, undefined, [source, sandbox, VM_OPTIONS]);
}
