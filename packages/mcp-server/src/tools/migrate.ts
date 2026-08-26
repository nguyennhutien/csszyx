/**
 * csszyx_migrate — Transform a JSX/TSX snippet, replacing className with sz prop.
 * Calls migrateSource() from @csszyx/cli, which runs the native engine —
 * it handles clsx, ternaries and template literals.
 * Example: '<div className="p-4 bg-blue-500" />' → '<div sz={{ p: 4, bg: "blue-500" }} />'
 *
 * Optional: pass customMap (a parsed migration-resolution map) for custom class names.
 * Optional: pass injectTodos=true to insert @sz-todo comments above unrecognized elements.
 */

import { type CsszyxTodoMap, migrateSource } from '@csszyx/cli';
import { z } from 'zod';

export const migrateSchema = z.object({
    code: z
        .string()
        .describe(
            'JSX/TSX code snippet containing className attributes to transform. Example: \'<div className="p-4 bg-blue-500" />\'',
        ),
    customMap: z
        .record(z.string(), z.unknown())
        .optional()
        .describe(
            'Parsed .csszyx-todo.json map. Values: sz object, Tailwind string, "sz:keep", "sz:remove", "sz:todo", null, or false.',
        ),
    injectTodos: z
        .boolean()
        .optional()
        .describe(
            'If true, inserts {/* @sz-todo: ... */} comments above elements with unrecognized classes.',
        ),
});

/** Validated input type for the csszyx_migrate tool. */
export type MigrateInput = z.infer<typeof migrateSchema>;

/**
 * Transform a JSX/TSX code snippet, replacing className attributes with sz props.
 * @param input - The validated input object.
 * @returns MCP tool response with transformed code and migration stats.
 */
export function handleMigrate(input: MigrateInput): {
    content: Array<{ type: 'text'; text: string }>;
} {
    const result = migrateSource(input.code, 'snippet.tsx', {
        injectTodos: input.injectTodos,
        customMap: input.customMap as CsszyxTodoMap | undefined,
    });

    return {
        content: [
            {
                type: 'text' as const,
                text: JSON.stringify(
                    {
                        code: result.code,
                        changed: result.changed,
                        stats: {
                            classNamesTransformed: result.stats.classNamesTransformed,
                            classNamesSkipped: result.stats.classNamesSkipped,
                            unrecognized:
                                result.stats.classesUnrecognized.length > 0
                                    ? result.stats.classesUnrecognized
                                    : undefined,
                        },
                        warnings: result.warnings.length > 0 ? result.warnings : undefined,
                        potentiallyUnusedImports:
                            result.potentiallyUnusedImports.length > 0
                                ? result.potentiallyUnusedImports
                                : undefined,
                    },
                    null,
                    2,
                ),
            },
        ],
    };
}
