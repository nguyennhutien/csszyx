/**
 * Valid recovery modes for szRecover attribute.
 */
export type RecoveryMode = 'csr' | 'dev-only';

/**
 * Metadata for a recovery token.
 */
export interface TokenMetadata {
    /**
     * The recovery mode ('csr' or 'dev-only')
     */
    mode: RecoveryMode;

    /**
     * Component name where szRecover is used
     */
    component: string;

    /**
     * Absolute file path
     */
    filePath: string;

    /**
     * Line number in source file
     */
    line: number;

    /**
     * Column number in source file
     */
    column: number;

    /**
     * Build ID (git hash or timestamp)
     */
    buildId: string;
}

/**
 * Generated recovery token with metadata.
 */
export interface RecoveryToken {
    /**
     * The generated token string
     */
    token: string;

    /**
     * Token metadata
     */
    metadata: TokenMetadata;
}

/**
 * Validates if a value is a valid recovery mode.
 *
 * @param {unknown} value - The value to validate
 * @returns {value is RecoveryMode} True if valid recovery mode
 *
 * @example
 * ```typescript
 * isValidRecoveryMode('csr') // true
 * isValidRecoveryMode('dev-only') // true
 * isValidRecoveryMode('invalid') // false
 * ```
 */
export function isValidRecoveryMode(value: unknown): value is RecoveryMode {
    return value === 'csr' || value === 'dev-only';
}

/**
 * Generates a cryptographic token for a recovery declaration using WASM.
 *
 * @param {TokenMetadata} metadata - Token metadata
 * @returns {string} The generated token (Base62 format)
 */
export function generateRecoveryToken(metadata: TokenMetadata): string {
    // A deterministic hash: the token only has to be stable for its input.
    const key = `${metadata.component}:${metadata.filePath}:${metadata.line}:${metadata.column}:${metadata.mode}:${metadata.buildId}`;
    let hash = 0;
    for (const character of key) {
        // A string iterator never yields an empty string, so there is a code point.
        hash = foldRecoveryCodePoint(hash, character.codePointAt(0) as number);
    }
    return Math.abs(hash).toString(16).padStart(12, '0').slice(0, 12);
}

/**
 * Fold one UTF-16 code unit into the signed-int32 recovery hash.
 *
 * @param hash Current signed-int32 hash.
 * @param codeUnit UTF-16 code unit to append.
 * @returns Updated signed-int32 hash.
 */
function foldRecoveryHash(hash: number, codeUnit: number): number {
    return Math.imul(Math.imul(hash, 31) + codeUnit, 1);
}

/**
 * Fold a Unicode code point as the one or two UTF-16 units the hash reads.
 *
 * @param hash Current signed-int32 hash.
 * @param codePoint Unicode code point to append.
 * @returns Updated signed-int32 hash.
 */
function foldRecoveryCodePoint(hash: number, codePoint: number): number {
    if (codePoint <= 0xffff) {
        return foldRecoveryHash(hash, codePoint);
    }
    const supplementary = codePoint - 0x10000;
    const highSurrogate = Math.floor(supplementary / 0x400) + 0xd800;
    const lowSurrogate = (supplementary % 0x400) + 0xdc00;
    return foldRecoveryHash(foldRecoveryHash(hash, highSurrogate), lowSurrogate);
}

/**
 * Creates a recovery token with full metadata.
 *
 * @param {Omit<TokenMetadata, 'buildId'>} metadata - Token metadata without buildId
 * @param {string} buildId - Build ID to use
 * @returns {RecoveryToken} The generated token with metadata
 *
 * @example
 * ```typescript
 * const recovery = createRecoveryToken({
 *     mode: 'csr',
 *     component: 'Button',
 *     filePath: '/app/Button.tsx',
 *     line: 10,
 *     column: 5
 * }, 'build-123');
 * ```
 */
export function createRecoveryToken(
    metadata: Omit<TokenMetadata, 'buildId'>,
    buildId: string,
): RecoveryToken {
    const fullMetadata: TokenMetadata = {
        ...metadata,
        buildId,
    };

    const token = generateRecoveryToken(fullMetadata);

    return {
        token,
        metadata: fullMetadata,
    };
}

/**
 * Validates szRecover attribute value.
 *
 * Ensures the value is a static literal 'csr' or 'dev-only'.
 * Runtime expressions are not allowed.
 *
 * @param {unknown} value - The attribute value to validate
 * @param {string} componentName - Component name for error messages
 * @returns {{ valid: boolean; error?: string }} Validation result
 *
 * @example
 * ```typescript
 * validateSzRecover('csr', 'MyComponent')
 * // Returns: { valid: true }
 *
 * validateSzRecover('invalid', 'MyComponent')
 * // Returns: { valid: false, error: '...' }
 * ```
 */
export function validateSzRecover(
    value: unknown,
    componentName: string,
): { valid: boolean; error?: string } {
    if (!isValidRecoveryMode(value)) {
        return {
            valid: false,
            error: `szRecover in ${componentName} must be static literal "csr" or "dev-only", got: ${JSON.stringify(value)}`,
        };
    }

    return { valid: true };
}

/**
 * Injects recovery token into JSX attributes.
 *
 * Adds the data-sz-recovery-token attribute with the generated token.
 *
 * @param {Record<string, unknown>} attributes - JSX attributes object
 * @param {string} token - The recovery token to inject
 * @returns {Record<string, unknown>} Updated attributes with token
 *
 * @example
 * ```typescript
 * const attrs = { szRecover: 'csr', className: 'foo' };
 * const updated = injectRecoveryToken(attrs, 'abc123');
 * // Returns: { szRecover: 'csr', className: 'foo', 'data-sz-recovery-token': 'abc123' }
 * ```
 */
export function injectRecoveryToken(
    attributes: Record<string, unknown>,
    token: string,
): Record<string, unknown> {
    return {
        ...attributes,
        'data-sz-recovery-token': token,
    };
}
