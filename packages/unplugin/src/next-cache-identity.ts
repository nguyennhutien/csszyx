/* eslint-disable jsdoc/require-param-description, jsdoc/require-returns */
import { createHash } from 'node:crypto';

/** JSON-compatible value used for cache identity material. */
export type JsonLike =
    | null
    | boolean
    | number
    | string
    | readonly JsonLike[]
    | { readonly [key: string]: JsonLike | undefined };

/** Inputs that define one Next csszyx generation identity. */
export interface NextCacheIdentityInput {
    root: string;
    config: JsonLike;
    env?: Record<string, string | undefined>;
    envKeys?: readonly string[];
    nextVersion: string;
    csszyxVersion: string;
    nativeVersion: string;
    mode: 'development' | 'production';
}

/** Stable identity hashes used by manifests and transform cache keys. */
export interface NextCacheIdentity {
    configHash: string;
    envHash: string;
    generation: string;
}

/**
 * Create stable config/env/generation hashes for Next Turbopack state.
 *
 * @param input Identity inputs.
 * @returns Hashes with `sha256:` prefix.
 */
export function createNextCacheIdentity(input: NextCacheIdentityInput): NextCacheIdentity {
    const configHash = hashString(stableStringify(input.config));
    const envHash = hashString(stableStringify(pickEnv(input.env ?? {}, input.envKeys ?? [])));
    const generation = hashString(
        stableStringify({
            root: input.root,
            configHash,
            envHash,
            nextVersion: input.nextVersion,
            csszyxVersion: input.csszyxVersion,
            nativeVersion: input.nativeVersion,
            mode: input.mode,
        }),
    );

    return { configHash, envHash, generation };
}

/**
 * Stable stringify that sorts object keys and rejects unsupported values.
 *
 * @param value JSON-compatible value.
 * @returns Deterministic JSON string.
 */
export function stableStringify(value: JsonLike): string {
    if (value === null || typeof value === 'boolean' || typeof value === 'string') {
        return JSON.stringify(value);
    }
    if (typeof value === 'number') {
        return Number.isFinite(value) ? JSON.stringify(value) : 'null';
    }
    if (Array.isArray(value)) {
        return `[${value.map(item => stableStringify(item)).join(',')}]`;
    }
    if (typeof value === 'object') {
        const entries = Object.entries(value)
            .filter((entry): entry is [string, JsonLike] => entry[1] !== undefined)
            .sort(([left], [right]) => left.localeCompare(right));
        return `{${entries
            .map(([key, entryValue]) => `${JSON.stringify(key)}:${stableStringify(entryValue)}`)
            .join(',')}}`;
    }
    return 'null';
}

/**
 *
 * @param env
 * @param envKeys
 */
function pickEnv(
    env: Record<string, string | undefined>,
    envKeys: readonly string[],
): Record<string, string> {
    const selected: Record<string, string> = {};
    for (const key of [...new Set(envKeys)].sort()) {
        const value = env[key];
        if (value !== undefined) {
            selected[key] = value;
        }
    }
    return selected;
}

/**
 *
 * @param value
 */
function hashString(value: string): string {
    return `sha256:${createHash('sha256').update(value).digest('hex')}`;
}
