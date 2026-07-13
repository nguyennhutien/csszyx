/**
 * TypeScript declaration generator for csszyx.
 *
 * Generates strict TypeScript types from resolved Tailwind configuration
 * using declaration merging to override the base SzObject interface.
 *
 * @module generator/type-generator
 */

import { writeFileSync } from 'node:fs';
import { mkdir } from 'node:fs/promises';
import { dirname, resolve } from 'node:path';

import type { ResolvedTheme } from '../scanner/tailwind-scanner.js';
import {
    extractScreenKeys,
    extractSpacingKeys,
    flattenColors,
} from '../scanner/tailwind-scanner.js';

/**
 * Type generation options.
 */
export interface GeneratorOptions {
    /** Output file path (default: ./csszyx.d.ts) */
    output?: string;
    /** Include comments in generated file */
    includeComments?: boolean;
    /** Include deprecated/legacy properties */
    includeLegacy?: boolean;
}

/**
 * Property mapping from sz shorthand to Tailwind utility.
 */
interface PropertyMapping {
    /** Property name in sz object */
    prop: string;
    /** Tailwind utility prefix */
    prefix: string;
    /** Value type: 'colors', 'spacing', 'screens', etc. */
    valueType: string;
    /** Whether this property supports responsive variants */
    responsive?: boolean;
    /** Whether this property supports state variants (hover, focus) */
    stateful?: boolean;
    /** JSDoc description */
    description?: string;
}

/**
 * Mapping of sz properties to Tailwind utilities.
 */
export const PROPERTY_MAPPINGS: PropertyMapping[] = [
    // Layout
    {
        prop: 'display',
        prefix: '',
        valueType: 'display',
        description: 'CSS display property',
    },
    {
        prop: 'position',
        prefix: '',
        valueType: 'position',
        description: 'CSS position property',
    },
    {
        prop: 'overflow',
        prefix: 'overflow',
        valueType: 'overflow',
        description: 'CSS overflow property',
    },
    {
        prop: 'z',
        prefix: 'z',
        valueType: 'zIndex',
        description: 'CSS z-index property',
    },

    // Flexbox & Grid
    {
        prop: 'flex',
        prefix: 'flex',
        valueType: 'flex',
        description: 'Flex shorthand',
    },
    {
        prop: 'flexDir',
        prefix: 'flex',
        valueType: 'flexDirection',
        description: 'Flex direction',
    },
    {
        prop: 'justify',
        prefix: 'justify',
        valueType: 'justify',
        description: 'Justify content',
    },
    {
        prop: 'items',
        prefix: 'items',
        valueType: 'items',
        description: 'Align items',
    },
    {
        prop: 'gap',
        prefix: 'gap',
        valueType: 'spacing',
        description: 'Gap between flex/grid items',
    },
    {
        prop: 'gridCols',
        prefix: 'grid-cols',
        valueType: 'gridCols',
        description: 'Grid template columns',
    },
    {
        prop: 'gridRows',
        prefix: 'grid-rows',
        valueType: 'gridRows',
        description: 'Grid template rows',
    },
    {
        prop: 'col',
        prefix: 'col',
        valueType: 'col',
        description: 'Grid column span',
    },
    {
        prop: 'row',
        prefix: 'row',
        valueType: 'row',
        description: 'Grid row span',
    },

    // Spacing
    {
        prop: 'p',
        prefix: 'p',
        valueType: 'spacing',
        responsive: true,
        description: 'Padding (all sides)',
    },
    {
        prop: 'px',
        prefix: 'px',
        valueType: 'spacing',
        responsive: true,
        description: 'Padding horizontal',
    },
    {
        prop: 'py',
        prefix: 'py',
        valueType: 'spacing',
        responsive: true,
        description: 'Padding vertical',
    },
    {
        prop: 'pt',
        prefix: 'pt',
        valueType: 'spacing',
        responsive: true,
        description: 'Padding top',
    },
    {
        prop: 'pr',
        prefix: 'pr',
        valueType: 'spacing',
        responsive: true,
        description: 'Padding right',
    },
    {
        prop: 'pb',
        prefix: 'pb',
        valueType: 'spacing',
        responsive: true,
        description: 'Padding bottom',
    },
    {
        prop: 'pl',
        prefix: 'pl',
        valueType: 'spacing',
        responsive: true,
        description: 'Padding left',
    },
    {
        prop: 'm',
        prefix: 'm',
        valueType: 'spacing',
        responsive: true,
        description: 'Margin (all sides)',
    },
    {
        prop: 'mx',
        prefix: 'mx',
        valueType: 'spacing',
        responsive: true,
        description: 'Margin horizontal',
    },
    {
        prop: 'my',
        prefix: 'my',
        valueType: 'spacing',
        responsive: true,
        description: 'Margin vertical',
    },
    {
        prop: 'mt',
        prefix: 'mt',
        valueType: 'spacing',
        responsive: true,
        description: 'Margin top',
    },
    {
        prop: 'mr',
        prefix: 'mr',
        valueType: 'spacing',
        responsive: true,
        description: 'Margin right',
    },
    {
        prop: 'mb',
        prefix: 'mb',
        valueType: 'spacing',
        responsive: true,
        description: 'Margin bottom',
    },
    {
        prop: 'ml',
        prefix: 'ml',
        valueType: 'spacing',
        responsive: true,
        description: 'Margin left',
    },

    // Sizing
    {
        prop: 'w',
        prefix: 'w',
        valueType: 'sizing',
        responsive: true,
        description: 'Width',
    },
    {
        prop: 'h',
        prefix: 'h',
        valueType: 'sizing',
        responsive: true,
        description: 'Height',
    },
    {
        prop: 'minW',
        prefix: 'min-w',
        valueType: 'minWidth',
        description: 'Minimum width',
    },
    {
        prop: 'maxW',
        prefix: 'max-w',
        valueType: 'maxWidth',
        description: 'Maximum width',
    },
    {
        prop: 'minH',
        prefix: 'min-h',
        valueType: 'minHeight',
        description: 'Minimum height',
    },
    {
        prop: 'maxH',
        prefix: 'max-h',
        valueType: 'maxHeight',
        description: 'Maximum height',
    },

    // Colors
    {
        prop: 'bg',
        prefix: 'bg',
        valueType: 'colors',
        stateful: true,
        description: 'Background color',
    },
    {
        prop: 'color',
        prefix: 'text',
        valueType: 'colors',
        stateful: true,
        description: 'Text color',
    },
    {
        prop: 'border',
        prefix: 'border',
        valueType: 'colors',
        stateful: true,
        description: 'Border color',
    },
    {
        prop: 'ring',
        prefix: 'ring',
        valueType: 'colors',
        stateful: true,
        description: 'Ring color',
    },
    {
        prop: 'fill',
        prefix: 'fill',
        valueType: 'colors',
        description: 'SVG fill color',
    },
    {
        prop: 'stroke',
        prefix: 'stroke',
        valueType: 'colors',
        description: 'SVG stroke color',
    },

    // Typography
    {
        prop: 'weight',
        prefix: 'font',
        valueType: 'fontWeight',
        description: 'Font weight',
    },
    {
        prop: 'fontFamily',
        prefix: 'font',
        valueType: 'fontFamily',
        description: 'Font family',
    },
    {
        prop: 'text',
        prefix: 'text',
        valueType: 'fontSize',
        description: 'Font size',
    },
    {
        prop: 'leading',
        prefix: 'leading',
        valueType: 'lineHeight',
        description: 'Line height',
    },
    {
        prop: 'tracking',
        prefix: 'tracking',
        valueType: 'letterSpacing',
        description: 'Letter spacing',
    },
    {
        prop: 'textAlign',
        prefix: 'text',
        valueType: 'textAlign',
        description: 'Text alignment',
    },

    // Borders
    {
        prop: 'rounded',
        prefix: 'rounded',
        valueType: 'borderRadius',
        description: 'Border radius',
    },

    // Effects
    {
        prop: 'shadow',
        prefix: 'shadow',
        valueType: 'boxShadow',
        description: 'Box shadow',
    },
    {
        prop: 'opacity',
        prefix: 'opacity',
        valueType: 'opacity',
        description: 'Opacity',
    },

    // Transforms
    {
        prop: 'scale',
        prefix: 'scale',
        valueType: 'scale',
        description: 'Scale transform',
    },
    {
        prop: 'rotate',
        prefix: 'rotate',
        valueType: 'rotate',
        description: 'Rotate transform',
    },
    {
        prop: 'translate',
        prefix: 'translate',
        valueType: 'translate',
        description: 'Translate transform',
    },

    // Transitions
    {
        prop: 'transition',
        prefix: 'transition',
        valueType: 'transition',
        description: 'Transition property',
    },
    {
        prop: 'duration',
        prefix: 'duration',
        valueType: 'duration',
        description: 'Transition duration',
    },
    {
        prop: 'ease',
        prefix: 'ease',
        valueType: 'ease',
        description: 'Transition timing function',
    },
];

/**
 * Static value types that don't come from theme.
 */
const STATIC_VALUE_TYPES: Record<string, string[]> = {
    display: [
        'block',
        'inline-block',
        'inline',
        'flex',
        'inline-flex',
        'grid',
        'inline-grid',
        'hidden',
        'contents',
        'flow-root',
    ],
    position: ['static', 'fixed', 'absolute', 'relative', 'sticky'],
    overflow: [
        'auto',
        'hidden',
        'clip',
        'visible',
        'scroll',
        'x-auto',
        'y-auto',
        'x-hidden',
        'y-hidden',
        'x-clip',
        'y-clip',
        'x-visible',
        'y-visible',
        'x-scroll',
        'y-scroll',
    ],
    flexDirection: ['row', 'row-reverse', 'col', 'col-reverse'],
    justify: ['normal', 'start', 'end', 'center', 'between', 'around', 'evenly', 'stretch'],
    items: ['start', 'end', 'center', 'baseline', 'stretch'],
    flex: ['1', 'auto', 'initial', 'none'],
    grid: ['flow-row', 'flow-col', 'flow-dense', 'flow-row-dense', 'flow-col-dense'],
    gridCols: ['1', '2', '3', '4', '5', '6', '7', '8', '9', '10', '11', '12', 'none', 'subgrid'],
    gridRows: ['1', '2', '3', '4', '5', '6', 'none', 'subgrid'],
    col: [
        'auto',
        'span-1',
        'span-2',
        'span-3',
        'span-4',
        'span-5',
        'span-6',
        'span-7',
        'span-8',
        'span-9',
        'span-10',
        'span-11',
        'span-12',
        'span-full',
        'start-1',
        'start-2',
        'start-3',
        'start-4',
        'start-5',
        'start-6',
        'start-7',
        'start-8',
        'start-9',
        'start-10',
        'start-11',
        'start-12',
        'start-13',
        'start-auto',
        'end-1',
        'end-2',
        'end-3',
        'end-4',
        'end-5',
        'end-6',
        'end-7',
        'end-8',
        'end-9',
        'end-10',
        'end-11',
        'end-12',
        'end-13',
        'end-auto',
    ],
    row: [
        'auto',
        'span-1',
        'span-2',
        'span-3',
        'span-4',
        'span-5',
        'span-6',
        'span-full',
        'start-1',
        'start-2',
        'start-3',
        'start-4',
        'start-5',
        'start-6',
        'start-7',
        'start-auto',
        'end-1',
        'end-2',
        'end-3',
        'end-4',
        'end-5',
        'end-6',
        'end-7',
        'end-auto',
    ],
    textAlign: ['left', 'center', 'right', 'justify', 'start', 'end'],
    fontWeight: [
        'thin',
        'extralight',
        'light',
        'normal',
        'medium',
        'semibold',
        'bold',
        'extrabold',
        'black',
    ],
    transition: ['none', 'all', 'colors', 'opacity', 'shadow', 'transform'],
    ease: ['linear', 'in', 'out', 'in-out'],
};

/**
 * Generate union type string from array of values.
 *
 * @param {string[]} values - Array of string values to join
 * @returns {string} Union type string (e.g. "'val1' | 'val2'")
 */
/**
 * Escape a value for safe interpolation into a single-quoted TS string literal,
 * so a theme key cannot break out of the literal (quote/backslash) or inject a
 * newline into the generated `.d.ts`. Valid theme keys contain none of these, so
 * output is byte-identical for normal input. (Keys are emitted as union members,
 * never inside a `/* *​/` comment, so comment-terminator escaping is N/A here.)
 *
 * @param value - the raw theme key/value.
 * @returns the escaped literal body.
 */
function escapeTsString(value: string): string {
    return value
        .replace(/\\/g, '\\\\')
        .replace(/'/g, "\\'")
        .replace(/\r/g, '\\r')
        .replace(/\n/g, '\\n');
}

function generateUnionType(values: string[]): string {
    if (values.length === 0) {
        return 'string';
    }
    return values.map(v => `'${escapeTsString(v)}'`).join(' | ');
}

/**
 * Resolve configured theme keys or retain the built-in fallback set.
 *
 * @param configured Optional resolved theme section.
 * @param fallback Built-in keys used when the section is absent.
 * @returns Configured keys or the fallback set.
 */
function themeKeysOrFallback(
    configured: Record<string, unknown> | undefined,
    fallback: string[],
): string[] {
    return configured ? Object.keys(configured) : fallback;
}

/**
 * Generate TypeScript declarations from resolved Tailwind theme.
 *
 * @param {ResolvedTheme} theme - Resolved Tailwind theme
 * @param {GeneratorOptions} options - Generation options
 * @returns {string} Generated TypeScript declaration content
 */
export function generateTypeDeclarations(
    theme: ResolvedTheme,
    options: GeneratorOptions = {},
): string {
    const { includeComments = true } = options;

    // Extract values from theme
    const colors = flattenColors(theme.colors || {});
    const spacing = extractSpacingKeys(theme.spacing || {});
    const screens = extractScreenKeys(theme.screens || {});

    // Build sizing values (spacing + special values)
    const sizing = [
        ...spacing,
        'auto',
        'full',
        'screen',
        'svw',
        'lvw',
        'dvw',
        'min',
        'max',
        'fit',
        '1/2',
        '1/3',
        '2/3',
        '1/4',
        '2/4',
        '3/4',
        '1/5',
        '2/5',
        '3/5',
        '4/5',
        '1/6',
        '5/6',
    ];

    // Build value type map
    const valueTypeMap: Record<string, string[]> = {
        colors,
        spacing,
        sizing,
        screens,
        ...STATIC_VALUE_TYPES,
        // Extract from theme if available
        zIndex: themeKeysOrFallback(theme.zIndex, ['0', '10', '20', '30', '40', '50', 'auto']),
        borderRadius: themeKeysOrFallback(theme.borderRadius, [
            'none',
            'sm',
            'md',
            'lg',
            'xl',
            '2xl',
            '3xl',
            'full',
        ]),
        boxShadow: themeKeysOrFallback(theme.boxShadow, [
            'sm',
            'md',
            'lg',
            'xl',
            '2xl',
            'inner',
            'none',
        ]),
        opacity: themeKeysOrFallback(theme.opacity, [
            '0',
            '5',
            '10',
            '20',
            '25',
            '30',
            '40',
            '50',
            '60',
            '70',
            '75',
            '80',
            '90',
            '95',
            '100',
        ]),
        fontSize: themeKeysOrFallback(theme.fontSize, [
            'xs',
            'sm',
            'base',
            'lg',
            'xl',
            '2xl',
            '3xl',
            '4xl',
            '5xl',
            '6xl',
            '7xl',
            '8xl',
            '9xl',
        ]),
        fontFamily: themeKeysOrFallback(theme.fontFamily, ['sans', 'serif', 'mono']),
        lineHeight: [
            'none',
            'tight',
            'snug',
            'normal',
            'relaxed',
            'loose',
            '3',
            '4',
            '5',
            '6',
            '7',
            '8',
            '9',
            '10',
        ],
        letterSpacing: ['tighter', 'tight', 'normal', 'wide', 'wider', 'widest'],
        borderWidth: ['0', '2', '4', '8', ''],
        minWidth: ['0', 'full', 'min', 'max', 'fit'],
        maxWidth: [
            '0',
            'none',
            'xs',
            'sm',
            'md',
            'lg',
            'xl',
            '2xl',
            '3xl',
            '4xl',
            '5xl',
            '6xl',
            '7xl',
            'full',
            'min',
            'max',
            'fit',
            'prose',
            'screen-sm',
            'screen-md',
            'screen-lg',
            'screen-xl',
            'screen-2xl',
        ],
        minHeight: ['0', 'full', 'screen', 'svh', 'lvh', 'dvh', 'min', 'max', 'fit'],
        maxHeight: ['0', 'none', 'full', 'screen', 'svh', 'lvh', 'dvh', 'min', 'max', 'fit'],
        scale: ['0', '50', '75', '90', '95', '100', '105', '110', '125', '150'],
        rotate: ['0', '1', '2', '3', '6', '12', '45', '90', '180'],
        translate: spacing,
        duration: ['0', '75', '100', '150', '200', '300', '500', '700', '1000'],
    };

    // Generate properties
    const properties: string[] = [];

    for (const mapping of PROPERTY_MAPPINGS) {
        const values = valueTypeMap[mapping.valueType] || [];
        const unionType = generateUnionType(values);

        let propDef = '';

        if (includeComments && mapping.description) {
            propDef += `    /** ${mapping.description} */\n`;
        }

        // For most properties, allow string | number for arbitrary values
        propDef += `    ${mapping.prop}?: ${unionType} | (string & {}) | number;`;

        properties.push(propDef);
    }

    // Generate variant properties (hover, focus, etc.)
    const variants = [
        'hover',
        'focus',
        'active',
        'disabled',
        'visited',
        'first',
        'last',
        'odd',
        'even',
        'group-hover',
        'dark',
    ];
    const variantProps: string[] = [];

    for (const variant of variants) {
        if (includeComments) {
            variantProps.push(`    /** Styles applied on ${variant} state */`);
        }
        variantProps.push(`    ${variant}?: SzVariantObject;`);
    }

    // Generate responsive variant properties
    const responsiveProps: string[] = [];
    for (const screen of screens) {
        if (includeComments) {
            responsiveProps.push(`    /** Styles applied at ${screen} breakpoint and above */`);
        }
        responsiveProps.push(`    ${screen}?: SzVariantObject;`);
    }

    // Build the full declaration file
    const output = `/**
 * Auto-generated TypeScript declarations for csszyx.
 *
 * This file provides strict typing for the sz prop based on your
 * Tailwind CSS configuration.
 *
 * @generated by @csszyx/cli
 * @see https://github.com/nguyennhutien/csszyx
 */

import '@csszyx/types';

/**
 * Variant object type (used for hover, focus, responsive breakpoints, etc.)
 */
type SzVariantObject = Partial<StrictSzObject>;

/**
 * Strict sz object interface with typed properties.
 */
interface StrictSzObject {
${properties.join('\n')}

    // State variants
${variantProps.join('\n')}

    // Responsive variants
${responsiveProps.join('\n')}

    // Allow arbitrary properties for escape hatch
    [key: string]: string | number | boolean | SzVariantObject | undefined;
}

declare module '@csszyx/types' {
    /**
     * Override the base SzObject with strict typing.
     */
    interface SzObject extends StrictSzObject {}
}

declare module 'react' {
    interface HTMLAttributes<T> {
        /**
         * csszyx object syntax for Tailwind CSS classes.
         * Provides IntelliSense for all Tailwind utilities.
         */
        sz?: StrictSzObject;
    }

    interface SVGAttributes<T> {
        /**
         * csszyx object syntax for Tailwind CSS classes.
         */
        sz?: StrictSzObject;
    }
}

export {};
`;

    return output;
}

/**
 * Write generated declarations to file.
 *
 * @param {string} content - Generated TypeScript content
 * @param {string} outputPath - Output file path
 */
export async function writeDeclarationFile(content: string, outputPath: string): Promise<void> {
    const absolutePath = resolve(outputPath);
    const dir = dirname(absolutePath);

    // Ensure directory exists
    await mkdir(dir, { recursive: true });

    writeFileSync(absolutePath, content, 'utf-8');
}

/**
 * Generate type declarations from Tailwind theme and write to file.
 *
 * @param {ResolvedTheme} theme - Resolved Tailwind theme
 * @param {GeneratorOptions} options - Generation options
 * @returns {Promise<string>} Path to generated file
 */
export async function generateAndWriteTypes(
    theme: ResolvedTheme,
    options: GeneratorOptions = {},
): Promise<string> {
    const outputPath = options.output || './csszyx.d.ts';
    const content = generateTypeDeclarations(theme, options);

    await writeDeclarationFile(content, outputPath);

    return resolve(outputPath);
}
