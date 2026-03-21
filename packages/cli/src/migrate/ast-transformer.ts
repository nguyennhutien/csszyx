/**
 * AST Transformer: Replaces className="..." with sz={...} props.
 *
 * Phase 1: Only handles static className="..." and className='...' (string literals).
 * Skips dynamic classNames (template literals, function calls, variables).
 */

import { generateSzExpression, generateSzHtmlValue } from './sz-codegen.js';
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

/** Options for HTML transformation. */
export interface HtmlTransformOptions {
    /** Wrap sz attribute value in outer { } braces (default: false). */
    braces?: boolean;
    /** Inject FOUC-prevention CSS before </head> (default: true). */
    injectFouc?: boolean;
    /** Inject runtime script before </body>: 'local' | 'cdn' | false (default: false). */
    injectRuntime?: 'local' | 'cdn' | false;
    /** CDN URL for runtime script (used when injectRuntime: 'cdn'). */
    cdnUrl?: string;
    /** Local path for runtime script (used when injectRuntime: 'local'). */
    localPath?: string;
}

const FOUC_CSS = `<style>
  /* csszyx: hide [sz] elements until runtime processes them */
  [sz] { visibility: hidden; }
  body.sz-ready [sz] { visibility: visible; }
</style>`;

/**
 * Transform an HTML source file replacing class="..." with sz="..." attributes.
 * Also optionally injects FOUC-prevention CSS and runtime script.
 * @param source - HTML source file content.
 * @param filePath - Path to the source file.
 * @param options - HTML transform options.
 * @returns {TransformResult} Transformed code and stats.
 */
export function transformHtmlSourceSimple(
    source: string,
    filePath: string,
    options: HtmlTransformOptions = {},
): TransformResult {
    const {
        braces = false,
        injectFouc = true,
        injectRuntime = false,
        cdnUrl = 'https://cdn.csszyx.com/runtime.js',
        localPath = 'csszyx-runtime.js',
    } = options;

    const warnings: string[] = [];
    let classNamesTransformed = 0;
    let classNamesSkipped = 0;
    const classesUnrecognized: string[] = [];
    let changed = false;

    // Match class="..." (double quotes) — standard HTML attribute
    let output = source.replace(/\bclass="([^"]*)"/g, (match, classStr: string) => {
        return processClassAttr(match, classStr, '"');
    });

    // Match class='...' (single quotes)
    output = output.replace(/\bclass='([^']*)'/g, (match, classStr: string) => {
        return processClassAttr(match, classStr, "'");
    });

    // Inject FOUC prevention CSS before </head>
    if (injectFouc && output.includes('</head>') && !output.includes('csszyx: hide [sz]')) {
        output = output.replace('</head>', `${FOUC_CSS}\n</head>`);
        changed = true;
    }

    // Inject runtime script before </body>
    if (injectRuntime && output.includes('</body>')) {
        const scriptSrc = injectRuntime === 'cdn' ? cdnUrl : localPath;
        const scriptTag = `<script src="${scriptSrc}"></script>`;
        if (!output.includes(scriptSrc)) {
            output = output.replace('</body>', `${scriptTag}\n</body>`);
            changed = true;
        }
    }

    /**
     * Process a single class attribute match.
     * @param match - The full regex match string.
     * @param classStr - The class attribute value.
     * @param quote - The quote character used.
     * @returns {string} Replacement string.
     */
    function processClassAttr(match: string, classStr: string, quote: string): string {
        const trimmed = classStr.trim();
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

        const szVal = generateSzHtmlValue(szObject, braces);
        changed = true;
        classNamesTransformed++;

        if (unrecognized.length > 0) {
            classesUnrecognized.push(...unrecognized);
            // Keep unrecognized classes in class attribute, migrate the rest to sz
            return `class=${quote}${unrecognized.join(' ')}${quote} sz="${szVal}"`;
        }

        return `sz="${szVal}"`;
    }

    return {
        code: output,
        changed,
        warnings,
        stats: { classNamesTransformed, classNamesSkipped, classesUnrecognized },
    };
}
