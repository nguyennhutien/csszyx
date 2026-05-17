/**
 * Recovery Manifest Generation.
 *
 * This module handles the creation and management of the recovery manifest,
 * which maps recovery tokens to their metadata for runtime verification.
 */

import { createHash } from 'node:crypto';

import type { RecoveryMode, TokenMetadata } from './recovery.js';

/**
 * Token data stored in the manifest.
 */
export interface TokenData {
    /**
     * Recovery mode ('csr' or 'dev-only')
     */
    mode: RecoveryMode;

    /**
     * Component name
     */
    component: string;

    /**
     * File path (relative to project root)
     */
    path: string;
}

/**
 * Recovery manifest structure.
 *
 * Embedded in the build output as a JSON script tag.
 */
export interface RecoveryManifest {
    /**
     * Build ID (git hash or timestamp)
     */
    buildId: string;

    /**
     * SHA-256 checksum of the tokens object
     */
    checksum: string;

    /**
     * Map of token → token data
     */
    tokens: Record<string, TokenData>;
}

/**
 * Builder class for creating recovery manifests.
 */
export class ManifestBuilder {
    private tokens: Map<string, TokenData> = new Map();
    private buildId: string;

    /**
     * Creates a new manifest builder.
     *
     * @param {string} buildId - Build ID (git hash or timestamp)
     *
     * @example
     * ```typescript
     * const builder = new ManifestBuilder('abc123');
     * ```
     */
    constructor(buildId: string) {
        this.buildId = buildId;
    }

    /**
     * Adds a token to the manifest.
     *
     * @param {string} token - The recovery token
     * @param {TokenMetadata} metadata - Token metadata
     *
     * @example
     * ```typescript
     * builder.addToken('a94f1c2e8b3d', {
     *     mode: 'csr',
     *     component: 'Button',
     *     filePath: '/app/Button.tsx',
     *     line: 10,
     *     column: 5,
     *     buildId: 'abc123'
     * });
     * ```
     */
    addToken(token: string, metadata: TokenMetadata): void {
        // Convert absolute path to relative for manifest
        const relativePath = this.toRelativePath(metadata.filePath);

        this.tokens.set(token, {
            mode: metadata.mode,
            component: metadata.component,
            path: relativePath,
        });
    }

    /**
     * Converts absolute path to relative path.
     *
     * @param {string} absolutePath - Absolute file path
     * @returns {string} Relative path
     */
    private toRelativePath(absolutePath: string): string {
        // Simple implementation - in production, this would use
        // the project root to compute relative paths
        if (absolutePath.startsWith('/')) {
            const parts = absolutePath.split('/');
            // Return path relative to assumed project root
            const rootIndex = parts.findIndex(
                p => p === 'src' || p === 'app' || p === 'components',
            );
            if (rootIndex > 0) {
                return parts.slice(rootIndex).join('/');
            }
        }
        return absolutePath;
    }

    /**
     * Computes checksum of the tokens object.
     *
     * @param {Record<string, TokenData>} tokens - Tokens object
     * @returns {string} SHA-256 checksum
     */
    private computeChecksum(tokens: Record<string, TokenData>): string {
        // Sort tokens by key for deterministic checksum
        const sortedKeys = Object.keys(tokens).sort();
        const sortedTokens: Record<string, TokenData> = {};

        for (const key of sortedKeys) {
            sortedTokens[key] = tokens[key];
        }

        const content = JSON.stringify(sortedTokens);
        return createHash('sha256').update(content).digest('hex');
    }

    /**
     * Builds the final recovery manifest.
     *
     * @returns {RecoveryManifest} The complete recovery manifest
     *
     * @example
     * ```typescript
     * const manifest = builder.build();
     * // Returns: { buildId: 'abc123', checksum: '...', tokens: {...} }
     * ```
     */
    build(): RecoveryManifest {
        const tokensObject: Record<string, TokenData> = {};

        for (const [token, data] of this.tokens.entries()) {
            tokensObject[token] = data;
        }

        const checksum = this.computeChecksum(tokensObject);

        return {
            buildId: this.buildId,
            checksum,
            tokens: tokensObject,
        };
    }

    /**
     * Gets the number of tokens in the manifest.
     *
     * @returns {number} Token count
     */
    size(): number {
        return this.tokens.size;
    }

    /**
     * Checks if a token exists in the manifest.
     *
     * @param {string} token - Token to check
     * @returns {boolean} True if token exists
     */
    hasToken(token: string): boolean {
        return this.tokens.has(token);
    }

    /**
     * Clears all tokens from the manifest.
     */
    clear(): void {
        this.tokens.clear();
    }
}

/**
 * Serializes a recovery manifest to JSON string.
 *
 * @param {RecoveryManifest} manifest - The manifest to serialize
 * @param {boolean} pretty - Whether to pretty-print the JSON
 * @returns {string} JSON string
 *
 * @example
 * ```typescript
 * const json = serializeManifest(manifest, true);
 * ```
 */
export function serializeManifest(manifest: RecoveryManifest, pretty = false): string {
    return JSON.stringify(manifest, null, pretty ? 2 : 0);
}

/**
 * Parses a recovery manifest from JSON string.
 *
 * @param {string} json - JSON string to parse
 * @returns {RecoveryManifest} Parsed manifest
 *
 * @example
 * ```typescript
 * const manifest = parseManifest(jsonString);
 * ```
 */
export function parseManifest(json: string): RecoveryManifest {
    const parsed = JSON.parse(json);

    if (!parsed.buildId || !parsed.checksum || !parsed.tokens) {
        throw new Error('Invalid recovery manifest format');
    }

    return parsed as RecoveryManifest;
}

/**
 * Validates a recovery manifest structure.
 *
 * @param {unknown} manifest - Manifest to validate
 * @returns {{ valid: boolean; error?: string }} Validation result
 *
 * @example
 * ```typescript
 * const result = validateManifest(manifest);
 * if (!result.valid) {
 *     console.error(result.error);
 * }
 * ```
 */
export function validateManifest(manifest: unknown): {
    valid: boolean;
    error?: string;
} {
    if (!manifest || typeof manifest !== 'object') {
        return { valid: false, error: 'Manifest must be an object' };
    }

    const m = manifest as Record<string, unknown>;

    if (typeof m.buildId !== 'string') {
        return { valid: false, error: 'buildId must be a string' };
    }

    if (typeof m.checksum !== 'string') {
        return { valid: false, error: 'checksum must be a string' };
    }

    if (!m.tokens || typeof m.tokens !== 'object') {
        return { valid: false, error: 'tokens must be an object' };
    }

    return { valid: true };
}
