/* eslint-disable jsdoc/require-param-description */
import { createHash } from 'node:crypto';

import { CLASS_LIST_SPACE, type SourceTransformResult, transform } from '@csszyx/compiler';
import { collectMergeCallClassNames, lexicalRegionEnd } from './authored-class-scanner.js';
import { emittedClassSites } from './dead-class.js';
import type {
    NextSafelistShardInput,
    NextShardClassSite,
    NextShardUnderscoreSite,
} from './next-safelist-state.js';
import { sortStrings } from './sort.js';
import { underscoreFactsOf } from './underscore-space.js';
/** Metadata extracted from one compiler source transform result. */
export interface NextTransformMetadata {
    sourcePath: string;
    sourceHash: string;
    classes: string[];
    rawClassNames: string[];
    /** String literals written inside `szcn(...)` calls, as the merge will see them. */
    mergeLiterals: string[];
    /**
     * Where the first pass placed each emitted class, by class: the line,
     * column and key a `dead-class` line names.
     */
    classSites: NextShardClassSite[];
    /** Each `_` the source writes in an `sz` value, at its key. */
    underscoreSites: NextShardUnderscoreSite[];
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
    const placed = emittedClassSites(result);
    const sorted = sortStrings(classes);
    return {
        sourcePath,
        sourceHash: createHash('sha256').update(source).digest('hex'),
        classes: sorted,
        rawClassNames: sortStrings(result.rawClassNames),
        mergeLiterals: sortStrings(collectMergeCallClassNames(source)),
        classSites: sorted.flatMap(className => {
            const site = placed.get(className);
            return site === undefined ? [] : [{ className, ...site }];
        }),
        underscoreSites: underscoreFactsOf(result),
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
        authoredClasses: metadata.rawClassNames,
        mergeLiterals: metadata.mergeLiterals,
        classSites: metadata.classSites,
        underscoreSites: metadata.underscoreSites,
    };
}

/**
 * Add the static classes inside the generated `_sz({...})` runtime calls of a
 * transform result to a class sink, so the safelist names them. Values the
 * runtime resolves stay out: only string, number and boolean literals are read.
 *
 * @param result - The compiler result.
 * @param discoveredClasses - The sz-generated class sink.
 */
export function collectRuntimeStaticClasses(
    result: SourceTransformResult,
    discoveredClasses: Set<string>,
): void {
    if (!result.usesRuntime) {
        return;
    }
    const szCallRe = /_sz\(\s*\{/g;
    for (const szMatch of result.code.matchAll(szCallRe)) {
        const objectSource = topLevelOf(result.code, szMatch.index + szMatch[0].length);
        collectRuntimeStringClasses(objectSource, discoveredClasses);
        collectRuntimeNumberClasses(objectSource, discoveredClasses);
        collectRuntimeBooleanClasses(objectSource, discoveredClasses);
    }
}

/**
 * The top level of the object that opens just before `start`, up to its
 * closing brace, with every nested object, array and call blanked out. A key
 * inside `hover: { p: 4 }` lowers under its variant, which the engine reports
 * itself, so read on its own it would name a class the source never asked
 * for. Strings, templates, comments and regular expressions are stepped over
 * whole by the scanner the authored-class pass uses, so a brace or a quote
 * inside one neither nests, closes nor opens anything. Only a quoted string
 * at the top level stays visible, because it is a value the collectors read.
 *
 * @param code - The transformed source.
 * @param start - The index just past the object's opening brace.
 * @returns The object's top-level text, everything else replaced by spaces.
 */
function topLevelOf(code: string, start: number): string {
    const scan: TopLevelScan = { depth: 0, out: '' };
    let cursor = start;
    while (cursor < code.length) {
        const regionEnd = lexicalRegionEnd(code, cursor);
        if (regionEnd !== cursor) {
            keepRegion(scan, code.slice(cursor, regionEnd));
            cursor = regionEnd;
        } else if (!keepCode(scan, code.charAt(cursor++))) break;
    }
    return scan.out;
}

/** Where {@link topLevelOf} is: how deep it has nested, and what it kept. */
interface TopLevelScan {
    depth: number;
    out: string;
}

/**
 * Append a string, template, comment or regular expression: a quoted string
 * at the top level as written, anything else blanked.
 *
 * @param scan - The scan to append to.
 * @param region - The region's source text.
 */
function keepRegion(scan: TopLevelScan, region: string): void {
    scan.out += scan.depth === 0 && QUOTES.has(region.charAt(0)) ? region : blank(region);
}

/**
 * Append one character of ordinary code, tracking how deep it nests.
 *
 * @param scan - The scan to append to.
 * @param ch - The character.
 * @returns `false` at the brace that closes the object, `true` otherwise.
 */
function keepCode(scan: TopLevelScan, ch: string): boolean {
    if (CLOSERS.has(ch)) {
        if (scan.depth === 0) return false;
        scan.depth--;
        scan.out += ' ';
        return true;
    }
    if (OPENERS.has(ch)) scan.depth++;
    scan.out += scan.depth === 0 ? ch : ' ';
    return true;
}

const OPENERS = new Set(['{', '[', '(']);
const CLOSERS = new Set(['}', ']', ')']);
const QUOTES = new Set(['"', "'"]);

/**
 * Replace text with spaces, keeping its line breaks, so a key the collectors
 * read after a blanked line comment still ends at a newline.
 *
 * @param text - The text to hide.
 * @returns Spaces and newlines of the same length.
 */
function blank(text: string): string {
    return text.replaceAll(/[^\n]/g, ' ');
}

/**
 *
 * @param objectSource
 * @param discoveredClasses
 */
function collectRuntimeStringClasses(objectSource: string, discoveredClasses: Set<string>): void {
    const stringKeyValue = /\b(\w+)\s*:\s*(?:"([^"]*)"|'([^']*)')/g;
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
    const numberKeyValue = /\b(\w+)\s*:\s*(-?\d+(?:\.\d+)?)\s*(?=[,}\n]|$)/g;
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
    const booleanKeyValue = /\b(\w+)\s*:\s*(true|false)\s*(?=[,}\n]|$)/g;
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
    for (const className of result.className.split(CLASS_LIST_SPACE).filter(Boolean)) {
        discoveredClasses.add(className);
    }
}
