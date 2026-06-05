/* eslint-disable jsdoc/require-param-description */
import { createHash } from 'node:crypto';

import { type SourceTransformResult, transform } from '@csszyx/compiler';

import type { NextSafelistShardInput } from './next-safelist-state.js';

/** Metadata extracted from one compiler source transform result. */
export interface NextTransformMetadata {
    sourcePath: string;
    sourceHash: string;
    classes: string[];
    rawClassNames: string[];
    recoveryTokenCount: number;
    cssVariableCount: number;
}

/**
 * Extract metadata needed by the future Next watcher/loader state layer.
 *
 * @param result Compiler transform result.
 * @param source Original source code.
 * @param sourcePath Absolute or normalized source file path.
 * @returns Metadata with deterministic class ordering.
 */
export function collectNextTransformMetadata(
    result: SourceTransformResult,
    source: string,
    sourcePath: string,
): NextTransformMetadata {
    const classes = new Set(result.classes);
    collectRuntimeStaticClasses(result, classes);
    return {
        sourcePath,
        sourceHash: createHash('sha256').update(source).digest('hex'),
        classes: [...classes].sort(),
        rawClassNames: [...result.rawClassNames].sort(),
        recoveryTokenCount: result.recoveryTokens.size,
        cssVariableCount: result.cssVariableMap.size,
    };
}

/**
 * Convert transform metadata into a per-file safelist shard input.
 *
 * @param metadata Transform metadata.
 * @param cacheKey Optional content cache key for deterministic shard naming.
 * @returns Safelist shard input.
 */
export function createNextSafelistShardFromMetadata(
    metadata: NextTransformMetadata,
    cacheKey?: string,
): NextSafelistShardInput {
    return {
        cacheKey,
        sourcePath: metadata.sourcePath,
        sourceHash: metadata.sourceHash,
        classes: metadata.classes,
    };
}

/**
 *
 * @param result
 * @param discoveredClasses
 */
function collectRuntimeStaticClasses(
    result: SourceTransformResult,
    discoveredClasses: Set<string>,
): void {
    if (!result.usesRuntime) {
        return;
    }
    const szCallRe = /_sz\(\s*\{/g;
    for (const szMatch of result.code.matchAll(szCallRe)) {
        let depth = 1;
        let index = (szMatch.index ?? 0) + szMatch[0].length;
        while (index < result.code.length && depth > 0) {
            if (result.code[index] === '{') {
                depth++;
            } else if (result.code[index] === '}') {
                depth--;
            }
            index++;
        }
        const objectSource = result.code.slice((szMatch.index ?? 0) + szMatch[0].length, index - 1);
        collectRuntimeStringClasses(objectSource, discoveredClasses);
        collectRuntimeNumberClasses(objectSource, discoveredClasses);
        collectRuntimeBooleanClasses(objectSource, discoveredClasses);
    }
}

/**
 *
 * @param objectSource
 * @param discoveredClasses
 */
function collectRuntimeStringClasses(objectSource: string, discoveredClasses: Set<string>): void {
    const stringKeyValue = /(\w+)\s*:\s*(?:"([^"]*)"|'([^']*)')/g;
    for (const match of objectSource.matchAll(stringKeyValue)) {
        try {
            collectTransformClasses(
                transform({ [match[1]]: match[2] ?? match[3] }),
                discoveredClasses,
            );
        } catch {
            // Invalid static runtime fragments are ignored.
        }
    }
}

/**
 *
 * @param objectSource
 * @param discoveredClasses
 */
function collectRuntimeNumberClasses(objectSource: string, discoveredClasses: Set<string>): void {
    const numberKeyValue = /(\w+)\s*:\s*(-?\d+(?:\.\d+)?)\s*(?=[,}\n])/g;
    for (const match of objectSource.matchAll(numberKeyValue)) {
        try {
            collectTransformClasses(
                transform({ [match[1]]: Number.parseFloat(match[2]) }),
                discoveredClasses,
            );
        } catch {
            // Invalid static runtime fragments are ignored.
        }
    }
}

/**
 *
 * @param objectSource
 * @param discoveredClasses
 */
function collectRuntimeBooleanClasses(objectSource: string, discoveredClasses: Set<string>): void {
    const booleanKeyValue = /(\w+)\s*:\s*(true|false)\s*(?=[,}\n])/g;
    for (const match of objectSource.matchAll(booleanKeyValue)) {
        try {
            collectTransformClasses(
                transform({ [match[1]]: match[2] === 'true' }),
                discoveredClasses,
            );
        } catch {
            // Invalid static runtime fragments are ignored.
        }
    }
}

/**
 *
 * @param result
 * @param discoveredClasses
 */
function collectTransformClasses(
    result: ReturnType<typeof transform>,
    discoveredClasses: Set<string>,
): void {
    for (const className of result.className.split(/\s+/).filter(Boolean)) {
        discoveredClasses.add(className);
    }
}
