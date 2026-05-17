import { hasTokens, parseThemeBlocks } from '@csszyx/unplugin';
import { z } from 'zod';

export const themeSchema = z.object({
    css: z
        .string()
        .describe(
            'CSS file content containing @theme blocks. Example: "@theme { --color-brand: #ff6b35; --font-display: \\"Cal Sans\\"; }"',
        ),
});

/** Validated input type for the csszyx_theme tool. */
export type ThemeInput = z.infer<typeof themeSchema>;

/**
 * Parse @theme CSS blocks and categorize custom design tokens.
 * @param input - The validated input object.
 * @returns MCP tool response with categorized theme variables.
 */
export function handleTheme(input: ThemeInput): { content: Array<{ type: 'text'; text: string }> } {
    const theme = parseThemeBlocks(input.css);
    const totalVars =
        theme.colors.length +
        theme.spacings.length +
        theme.fonts.length +
        theme.radii.length +
        theme.shadows.length;

    return {
        content: [
            {
                type: 'text' as const,
                text: JSON.stringify(
                    {
                        theme,
                        totalVariables: totalVars,
                        usage: hasTokens(theme)
                            ? "Use these custom values in sz props. Example: { bg: 'brand' } for --color-brand-500"
                            : 'No @theme block found in the CSS content. Make sure your CSS contains @theme { --color-*: ...; }',
                    },
                    null,
                    2,
                ),
            },
        ],
    };
}
