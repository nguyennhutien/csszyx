/**
 * Compiler types for csszyx.
 *
 * This module defines types used during compilation and build phases.
 */

import type { RecoveryMode } from './runtime.js';

/**
 * Build phase identifiers.
 */
export type BuildPhase =
    | 'type_generation'
    | 'jsx_transform'
    | 'tailwind_jit'
    | 'global_mangling'
    | 'output_emit';

/**
 * Build phase status.
 */
export type BuildPhaseStatus = 'pending' | 'running' | 'completed' | 'failed' | 'skipped';

/**
 * Build phase result.
 */
export interface BuildPhaseResult {
    /**
     * Phase identifier
     */
    phase: BuildPhase;

    /**
     * Phase status
     */
    status: BuildPhaseStatus;

    /**
     * Time taken in milliseconds
     */
    duration?: number;

    /**
     * Error if phase failed
     */
    error?: Error;

    /**
     * Output artifacts from this phase
     */
    artifacts?: string[];
}

/**
 * Compiler options.
 */
export interface CompilerOptions {
    /**
     * Build ID (git hash or timestamp)
     */
    buildId?: string;

    /**
     * Enable development mode features
     */
    development?: boolean;

    /**
     * Strict mode - fail build on warnings
     */
    strictMode?: boolean;

    /**
     * Enable debug output
     */
    debug?: boolean;

    /**
     * Source root directory
     */
    sourceRoot?: string;

    /**
     * Output directory
     */
    outDir?: string;
}

/**
 * Transform options for JSX transformation.
 */
export interface TransformOptions {
    /**
     * File path being transformed
     */
    filePath: string;

    /**
     * Build ID
     */
    buildId: string;

    /**
     * Whether to inject recovery tokens
     */
    injectRecovery: boolean;

    /**
     * Development mode
     */
    development: boolean;
}

/**
 * Token metadata for compiler.
 */
export interface TokenMetadata {
    /**
     * Recovery mode
     */
    mode: RecoveryMode;

    /**
     * Component name
     */
    component: string;

    /**
     * Absolute file path
     */
    filePath: string;

    /**
     * Line number in source
     */
    line: number;

    /**
     * Column number in source
     */
    column: number;

    /**
     * Build ID
     */
    buildId: string;
}

/**
 * Generated recovery token with metadata.
 */
export interface GeneratedToken {
    /**
     * The token string
     */
    token: string;

    /**
     * Token metadata
     */
    metadata: TokenMetadata;
}

/**
 * Compilation result for a single file.
 */
export interface FileCompilationResult {
    /**
     * File path
     */
    filePath: string;

    /**
     * Transformed code
     */
    code: string;

    /**
     * Source map (optional)
     */
    map?: string;

    /**
     * Generated tokens
     */
    tokens: GeneratedToken[];

    /**
     * Extracted class names
     */
    classNames: string[];

    /**
     * Whether file was cached
     */
    cached: boolean;
}

/**
 * Build statistics.
 */
export interface BuildStatistics {
    /**
     * Total files processed
     */
    filesProcessed: number;

    /**
     * Files from cache
     */
    filesCached: number;

    /**
     * Total class names found
     */
    totalClasses: number;

    /**
     * Unique class names
     */
    uniqueClasses: number;

    /**
     * Recovery tokens generated
     */
    tokensGenerated: number;

    /**
     * Total build time (ms)
     */
    totalTime: number;

    /**
     * Phase durations
     */
    phaseTimes: Partial<Record<BuildPhase, number>>;

    /**
     * Memory usage (bytes)
     */
    memoryUsage?: number;
}

/**
 * Build result.
 */
export interface BuildResult {
    /**
     * Success flag
     */
    success: boolean;

    /**
     * Build statistics
     */
    stats: BuildStatistics;

    /**
     * Phase results
     */
    phases: BuildPhaseResult[];

    /**
     * Errors encountered
     */
    errors: Error[];

    /**
     * Warnings generated
     */
    warnings: string[];

    /**
     * Output artifacts
     */
    artifacts: Record<string, string>;
}

/**
 * Mangle map entry.
 */
export interface MangleMapEntry {
    /**
     * Original class name
     */
    original: string;

    /**
     * Mangled class name
     */
    mangled: string;

    /**
     * Usage count
     */
    usageCount: number;

    /**
     * First seen at file
     */
    firstSeenIn?: string;
}

/**
 * Collision detection result.
 */
export interface CollisionResult {
    /**
     * Whether a collision was detected
     */
    hasCollision: boolean;

    /**
     * Colliding class names
     */
    collisions?: Array<{
        className: string;
        hash: string;
        conflictsWith: string;
    }>;
}

/**
 * AST node location.
 */
export interface NodeLocation {
    /**
     * Line number
     */
    line: number;

    /**
     * Column number
     */
    column: number;

    /**
     * File path
     */
    filePath: string;
}

/**
 * Validation error.
 */
export interface ValidationError {
    /**
     * Error type
     */
    type: 'syntax' | 'semantic' | 'type' | 'warning';

    /**
     * Error message
     */
    message: string;

    /**
     * Location where error occurred
     */
    location?: NodeLocation;

    /**
     * Suggestions for fixing
     */
    suggestions?: string[];
}

/**
 * Validation result.
 */
export interface ValidationResult {
    /**
     * Whether validation passed
     */
    valid: boolean;

    /**
     * Validation errors
     */
    errors: ValidationError[];

    /**
     * Warnings
     */
    warnings: ValidationError[];
}

/**
 * Plugin interface for extending compiler.
 */
export interface CompilerPlugin {
    /**
     * Plugin name
     */
    name: string;

    /**
     * Plugin version
     */
    version?: string;

    /**
     * Setup hook - called once at initialization
     */
    setup?: (compiler: CompilerContext) => void | Promise<void>;

    /**
     * Transform hook - called for each file
     */
    transform?: (
        code: string,
        filePath: string,
        options: TransformOptions,
    ) => string | Promise<string>;

    /**
     * Post-process hook - called after all transformations
     */
    postProcess?: (result: BuildResult) => BuildResult | Promise<BuildResult>;
}

/**
 * Compiler context passed to plugins.
 */
export interface CompilerContext {
    /**
     * Compiler options
     */
    options: CompilerOptions;

    /**
     * Build statistics (read-only)
     */
    readonly stats: BuildStatistics;

    /**
     * Register a new file for processing
     */
    addFile: (filePath: string) => void;

    /**
     * Get compilation result for a file
     */
    getFileResult: (filePath: string) => FileCompilationResult | undefined;

    /**
     * Emit a warning
     */
    warn: (message: string, location?: NodeLocation) => void;

    /**
     * Emit an error
     */
    error: (message: string, location?: NodeLocation) => void;
}

/**
 * Cache entry for incremental builds.
 */
export interface CacheEntry {
    /**
     * File path
     */
    filePath: string;

    /**
     * Content hash
     */
    contentHash: string;

    /**
     * Compilation result
     */
    result: FileCompilationResult;

    /**
     * Timestamp when cached
     */
    timestamp: number;

    /**
     * Build ID when cached
     */
    buildId: string;
}

/**
 * Cache manager interface.
 */
export interface CacheManager {
    /**
     * Get cached result for a file
     */
    get: (filePath: string, contentHash: string) => CacheEntry | undefined;

    /**
     * Set cache entry for a file
     */
    set: (filePath: string, contentHash: string, result: FileCompilationResult) => void;

    /**
     * Clear cache for a file
     */
    clear: (filePath: string) => void;

    /**
     * Clear all cache entries
     */
    clearAll: () => void;

    /**
     * Get cache statistics
     */
    getStats: () => {
        entries: number;
        totalSize: number;
        hitRate: number;
    };
}
