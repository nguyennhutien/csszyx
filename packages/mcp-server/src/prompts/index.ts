/**
 * MCP Prompts — Guided workflows for csszyx.
 *
 * Prompts are pre-defined conversation templates that guide AI agents
 * through common csszyx workflows.
 */

/**
 * Return all prompts served by this MCP server.
 * @returns Array of prompt definitions with name, description, and arguments.
 */
export function listPrompts(): Array<{
    name: string;
    description: string;
    arguments: Array<{ name: string; description: string; required: boolean }>;
}> {
    return [
        {
            name: 'migrate_component',
            description:
                'Migrate a Tailwind CSS component to use csszyx sz props. Paste your component code and get a transformed version with sz syntax.',
            arguments: [
                {
                    name: 'code',
                    description: 'The JSX/TSX component code to migrate from className to sz props',
                    required: true,
                },
            ],
        },
        {
            name: 'create_component',
            description:
                'Create a UI component using csszyx sz props. Describe the component you want and get production-ready code with proper sz syntax.',
            arguments: [
                {
                    name: 'description',
                    description:
                        'Description of the component to create (e.g., "a responsive card with hover effects")',
                    required: true,
                },
            ],
        },
    ];
}

/**
 * Get a prompt by name with arguments filled in.
 * @param name - The prompt name to retrieve.
 * @param args - Key-value map of prompt arguments supplied by the caller.
 * @returns Prompt message array with interpolated argument values.
 */
export function getPrompt(
    name: string,
    args: Record<string, string>,
): { messages: Array<{ role: 'user'; content: { type: 'text'; text: string } }> } {
    switch (name) {
        case 'migrate_component':
            return {
                messages: [
                    {
                        role: 'user' as const,
                        content: {
                            type: 'text' as const,
                            text: `I want to migrate this Tailwind CSS component to use csszyx sz props.

Here is the component code:

\`\`\`tsx
${args.code ?? '// paste your component here'}
\`\`\`

Please:
1. Use the csszyx_migrate tool to transform the className attributes to sz props
2. Review the result for any unrecognized classes
3. Explain any changes and suggest improvements
4. If there are dynamic className patterns (clsx, ternary, template literals), explain how sz handles them

Key csszyx rules:
- Numbers are bare: { p: 4 } → p-4
- Colors are strings: { bg: 'blue-500' } → bg-blue-500
- Color + opacity is an object: { bg: { color: 'blue-500', op: 50 } } → bg-blue-500/50
- Variants nest: { hover: { bg: 'blue-700' } } → hover:bg-blue-700
- Boolean sugar: { flex: true } → flex
- Fractions stay native: { w: '1/2' } → w-1/2
- Arbitrary values: { p: '5px' } → p-[5px]
- CSS variables: { p: '--my-var' } → p-(--my-var)
- Scope variants: { group: { hover: { bg: 'blue-700' } } } → group-hover:bg-blue-700 (also peer)
- Conditional/feature variants: { has: { checked: { ... } } } → has-[:checked]:…, { supports: { 'display:grid': { ... } } } → supports-[display:grid]:… (also not/data/aria)`,
                        },
                    },
                ],
            };

        case 'create_component':
            return {
                messages: [
                    {
                        role: 'user' as const,
                        content: {
                            type: 'text' as const,
                            text: `I want to create a React component using csszyx sz props.

Component description: ${args.description ?? 'a responsive card component'}

Please:
1. Generate a complete React component using sz props (NOT className/Tailwind)
2. Use the csszyx_lookup tool to verify prop names for any CSS properties
3. Include responsive breakpoints using nested variants: { md: { ... } }
4. Include hover/focus states using nested variants: { hover: { ... } }
5. Include dark mode support: { dark: { ... } }
6. Use the csszyx_expand tool to verify the generated sz objects

Key csszyx syntax:
- <div sz={{ p: 4, bg: 'blue-500', hover: { bg: 'blue-700' } }} />
- <div sz={{ flex: true, items: 'center', gap: 4 }} />
- <div sz={{ md: { gridCols: 3 }, gridCols: 1, gap: 6 }} />
- <div sz={{ dark: { bg: 'gray-900', color: 'white' } }} />
- <div sz={{ bg: { color: 'blue-500', op: 50 }, w: '1/2' }} />  (color opacity + fraction)
- <div sz={{ group: { hover: { bg: 'blue-700' } } }} />  (group/peer scope variants)`,
                        },
                    },
                ],
            };

        default:
            throw new Error(`Unknown prompt: ${name}`);
    }
}
