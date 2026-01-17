/**
 * AST Transformer: Replaces className="..." with sz={...} props.
 *
 * Phase 1: Only handles static className="..." and className='...' (string literals).
 * Skips dynamic classNames (template literals, function calls, variables).
 */

import { generateSzExpression } from './sz-codegen.js';
import { classNameToSzObject } from './variant-parser.js';

/**
 *
 */
export interface TransformResult {
    code: string;
    changed: boolean;
    warnings: string[];
    stats: {
        classNamesTransformed: number;
        classNamesSkipped: number;
        classesUnrecognized: string[];
    };
}

/**
 * Transform source replacing className with sz props.
 * @param source - Source file content string.
 * @param filePath - Path to the source file.
 * @returns {TransformResult} Transformed code and stats.
 */
export function transformSourceSimple(source: string, filePath: string): TransformResult {
    const warnings: string[] = [];
    let classNamesTransformed = 0;
    let classNamesSkipped = 0;
    const classesUnrecognized: string[] = [];
    let changed = false;

    // Pass 1: Match className="..." (double quotes)
    const output = source.replace(/className="([^"]*)"/g, (match, classNameStr: string) => {
        return processClassNameMatch(match, classNameStr, '"');
    });

    // Pass 2: Match className='...' (single quotes)
    const output2 = output.replace(/className='([^']*)'/g, (match, classNameStr: string) => {
        return processClassNameMatch(match, classNameStr, "'");
    });

    /**
     * Process a single className match.
     * @param match - The full regex match string.
     * @param classNameStr - The className value.
     * @param quote - The quote character used.
     * @returns {string} Replacement string for match.
     */
    function processClassNameMatch(match: string, classNameStr: string, quote: string): string {
        const trimmed = classNameStr.trim();
        if (!trimmed) {
            classNamesSkipped++;
            return match;
        }

        const { szObject, unrecognized } = classNameToSzObject(trimmed);

        if (Object.keys(szObject).length === 0) {
            classNamesSkipped++;
            classesUnrecognized.push(...unrecognized);
            return match;
        }

        const szExpr = generateSzExpression(szObject);
        changed = true;
        classNamesTransformed++;

        if (unrecognized.length > 0) {
            classesUnrecognized.push(...unrecognized);
            return `className=${quote}${unrecognized.join(' ')}${quote} sz=${szExpr}`;
        }

        return `sz=${szExpr}`;
    }

    return {
        code: output2,
        changed,
        warnings,
        stats: { classNamesTransformed, classNamesSkipped, classesUnrecognized },
    };
}
