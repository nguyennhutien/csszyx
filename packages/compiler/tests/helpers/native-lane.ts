/**
 * Whether a suite may run without the native addon.
 *
 * Every CI job that runs these suites builds the host addon first, so a
 * missing or stale one there means the build step failed, and a suite that
 * dropped the lane would pass on the wasm artifact alone. On a developer's
 * machine the addon may simply not be built.
 *
 * @module
 */

/** Set to `1` to require the native lane outside CI too. */
export const REQUIRE_NATIVE_ENV = 'CSSZYX_REQUIRE_NATIVE';

/**
 * Whether this run must have the native lane.
 *
 * @param env - The environment to read `CI` and {@link REQUIRE_NATIVE_ENV} from.
 * @returns True under CI, or when the flag is `1`.
 */
export function nativeLaneRequired(env: NodeJS.ProcessEnv): boolean {
    return Boolean(env.CI) || env[REQUIRE_NATIVE_ENV] === '1';
}

/**
 * The native lane, or none: a lane that did not load fails the suite where
 * the lane is required, and is skipped with a warning elsewhere.
 *
 * @param suite - The suite's name, for the message.
 * @param lane - The lane, or why it did not load.
 * @param env - The environment, read by {@link nativeLaneRequired}.
 * @param warn - Where the skip is said.
 * @returns The lane, or undefined when it is skipped.
 */
export function settleNativeLane<T>(
    suite: string,
    lane: T | string,
    env: NodeJS.ProcessEnv,
    warn: (message: string) => void = console.warn,
): T | undefined {
    if (typeof lane !== 'string') return lane;
    if (nativeLaneRequired(env)) {
        throw new Error(
            `${suite}: the native lane is required here (\`CI\` or \`${REQUIRE_NATIVE_ENV}=1\`), ` +
                `but ${lane}. Build it with \`pnpm --filter @csszyx/core native:build -- --native-engine\`.`,
        );
    }
    warn(
        `${suite}: native lane skipped — ${lane}. This run compares the wasm artifact only; ` +
            `set \`${REQUIRE_NATIVE_ENV}=1\` to fail instead.`,
    );
    return undefined;
}
