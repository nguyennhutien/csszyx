/** Size-bounded per-project plugin configuration. */
export interface PluginConfig {
    readonly enabled: boolean;
    readonly values: boolean;
    readonly themeValues: boolean;
    readonly maxEntries: number;
    readonly deadlineMs: number;
    readonly failureThreshold: number;
}

export const DEFAULT_CONFIG: PluginConfig = Object.freeze({
    enabled: true,
    values: true,
    themeValues: false,
    maxEntries: 512,
    deadlineMs: 20,
    failureThreshold: 3,
});

const boundedInteger = (value: unknown, fallback: number, min: number, max: number): number =>
    typeof value === 'number' && Number.isFinite(value)
        ? Math.min(max, Math.max(min, Math.trunc(value)))
        : fallback;

/** Parse untrusted tsconfig plugin configuration.
 * @param value - Raw configuration supplied by tsserver.
 * @returns An immutable, bounded configuration snapshot.
 */
export function parseConfig(value: unknown): PluginConfig {
    const input = value && typeof value === 'object' ? (value as Record<string, unknown>) : {};
    return Object.freeze({
        enabled: typeof input.enabled === 'boolean' ? input.enabled : DEFAULT_CONFIG.enabled,
        values: typeof input.values === 'boolean' ? input.values : DEFAULT_CONFIG.values,
        themeValues:
            typeof input.themeValues === 'boolean' ? input.themeValues : DEFAULT_CONFIG.themeValues,
        maxEntries: boundedInteger(input.maxEntries, DEFAULT_CONFIG.maxEntries, 1, 2_000),
        deadlineMs: boundedInteger(input.deadlineMs, DEFAULT_CONFIG.deadlineMs, 1, 100),
        failureThreshold: boundedInteger(
            input.failureThreshold,
            DEFAULT_CONFIG.failureThreshold,
            1,
            20,
        ),
    });
}
