#!/usr/bin/env node
/**
 * @csszyx/mcp-server — Model Context Protocol server for csszyx.
 *
 * Enables AI agents (Cursor, Windsurf, Claude Desktop, Cline) to natively
 * understand and generate csszyx sz props.
 *
 * Architecture follows Tier-1 Proxy patterns:
 * - 7 Stateless Sandbox tools (no destructive edits)
 * - 3 Reference Data Endpoints
 * - Unified Single Source of Truth via @csszyx/compiler and @csszyx/unplugin
 *
 * @module
 */

import { createRequire } from 'node:module';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import { Server } from '@modelcontextprotocol/sdk/server/index.js';
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import {
    CallToolRequestSchema,
    GetPromptRequestSchema,
    ListPromptsRequestSchema,
    ListResourcesRequestSchema,
    ListToolsRequestSchema,
    ReadResourceRequestSchema,
} from '@modelcontextprotocol/sdk/types.js';

const _require = createRequire(import.meta.url);
const packageJson = _require(path.resolve(fileURLToPath(import.meta.url), '../../package.json')) as { version: string };
const VERSION = packageJson.version;

import { getPrompt, listPrompts } from './prompts/index.js';
import { listResources, readResource } from './resources/index.js';
import { batchSchema, handleBatch } from './tools/batch.js';
import { expandSchema, handleExpand } from './tools/expand.js';
import { handleLookup, lookupSchema } from './tools/lookup.js';
import { handleMigrate, migrateSchema } from './tools/migrate.js';
import { handleReverse, reverseSchema } from './tools/reverse.js';
import { handleTheme, themeSchema } from './tools/theme.js';
import { handleValidate, validateSchema } from './tools/validate.js';

// ============================================================================
// SERVER INIT
// ============================================================================

const server = new Server(
    {
        name: 'csszyx-mcp-server',
        version: VERSION,
    },
    {
        capabilities: {
            tools: {},
            resources: {},
            prompts: {},
        },
    },
);

// ============================================================================
// TOOL DEFINITIONS
// ============================================================================

const TOOLS = [
    {
        name: 'csszyx_expand',
        description: 'Expand ONE csszyx sz object into a Tailwind CSS className string. Use this for a single component or quick lookup. For multiple objects at once, use csszyx_batch instead.',
        inputSchema: {
            type: 'object' as const,
            properties: {
                sz: {
                    type: 'object' as const,
                    description: "The sz prop object. Example: { p: 4, bg: 'blue-500', hover: { bg: 'blue-700' } }",
                },
            },
            required: ['sz'],
        },
    },
    {
        name: 'csszyx_reverse',
        description: 'Convert a Tailwind CSS class string into a csszyx sz object. Input: class string. Output: structured sz object + unrecognized classes.',
        inputSchema: {
            type: 'object' as const,
            properties: {
                classes: {
                    type: 'string' as const,
                    description: 'Tailwind CSS class string. Example: "p-4 bg-blue-500 hover:text-white"',
                },
            },
            required: ['classes'],
        },
    },
    {
        name: 'csszyx_validate',
        description: 'Validate a csszyx sz object for correctness. Detects unknown props, wrong types, deprecated CSS property names, and suggests fixes.',
        inputSchema: {
            type: 'object' as const,
            properties: {
                sz: {
                    type: 'object' as const,
                    description: 'The sz prop object to validate. Example: { padding: 4, bg: "blue-500" }',
                },
            },
            required: ['sz'],
        },
    },
    {
        name: 'csszyx_lookup',
        description: 'Look up how a CSS property maps to csszyx sz syntax. Search by CSS property name, sz key, or keyword. Returns sz key, Tailwind prefix, and usage examples.',
        inputSchema: {
            type: 'object' as const,
            properties: {
                query: {
                    type: 'string' as const,
                    description: 'CSS property name, sz key, or search term. Examples: "background-color", "bg", "padding", "flex-direction"',
                },
            },
            required: ['query'],
        },
    },
    {
        name: 'csszyx_migrate',
        description: 'Transform JSX/TSX code from Tailwind className attributes to csszyx sz props. Handles static strings, clsx/cn calls, ternary expressions, and template literals. Optionally pass a customMap (parsed .csszyx-todo.json) to resolve custom class names, and injectTodos to annotate unrecognized classes.',
        inputSchema: {
            type: 'object' as const,
            properties: {
                code: {
                    type: 'string' as const,
                    description: 'JSX/TSX code snippet. Example: \'<div className="p-4 bg-blue-500" />\'',
                },
                customMap: {
                    type: 'object' as const,
                    description: 'Parsed .csszyx-todo.json map. Values per entry: sz object | Tailwind string | "sz:keep" | "sz:remove" | "sz:todo" | null | false.',
                },
                injectTodos: {
                    type: 'boolean' as const,
                    description: 'If true, inserts {/* @sz-todo: ... */} comments above elements with unrecognized classes.',
                },
            },
            required: ['code'],
        },
    },
    {
        name: 'csszyx_batch',
        description: 'Expand MULTIPLE sz objects into Tailwind class strings in one call. Use when you need to process an array of components. For a single object, use csszyx_expand instead.',
        inputSchema: {
            type: 'object' as const,
            properties: {
                items: {
                    type: 'array' as const,
                    items: { type: 'object' as const },
                    description: "Array of sz objects. Example: [{ p: 4 }, { m: 2, bg: 'red-500' }]",
                },
            },
            required: ['items'],
        },
    },
    {
        name: 'csszyx_theme',
        description: 'Extract @theme CSS custom properties from Tailwind CSS file content. Categorizes variables by type: colors, fonts, spacing, breakpoints.',
        inputSchema: {
            type: 'object' as const,
            properties: {
                css: {
                    type: 'string' as const,
                    description: 'CSS file content containing @theme blocks',
                },
            },
            required: ['css'],
        },
    },
];

// ============================================================================
// TOOL HANDLER ROUTING
// ============================================================================

/**
 *
 */
type ToolHandler = (args: Record<string, unknown>) => ReturnType<typeof handleExpand>;

const TOOL_HANDLERS: Record<string, { schema: { parse: (a: unknown) => unknown }; handler: ToolHandler }> = {
    csszyx_expand: { schema: expandSchema, handler: handleExpand as ToolHandler },
    csszyx_reverse: { schema: reverseSchema, handler: handleReverse as ToolHandler },
    csszyx_validate: { schema: validateSchema, handler: handleValidate as ToolHandler },
    csszyx_lookup: { schema: lookupSchema, handler: handleLookup as ToolHandler },
    csszyx_migrate: { schema: migrateSchema, handler: handleMigrate as ToolHandler },
    csszyx_batch: { schema: batchSchema, handler: handleBatch as ToolHandler },
    csszyx_theme: { schema: themeSchema, handler: handleTheme as ToolHandler },
};

// ============================================================================
// REQUEST HANDLERS
// ============================================================================

// Tools
server.setRequestHandler(ListToolsRequestSchema, async () => {
    return { tools: TOOLS };
});

server.setRequestHandler(CallToolRequestSchema, async (request) => {
    const { name, arguments: args } = request.params;
    const entry = TOOL_HANDLERS[name];

    if (!entry) {
        throw new Error(`Unknown tool: ${name}. Available: ${Object.keys(TOOL_HANDLERS).join(', ')}`);
    }

    try {
        const validated = entry.schema.parse(args);
        return entry.handler(validated as Record<string, unknown>);
    } catch (error: unknown) {
        const message = error instanceof Error ? error.message : String(error);
        return {
            content: [{ type: 'text' as const, text: `Error in ${name}: ${message}` }],
            isError: true,
        };
    }
});

// Resources
server.setRequestHandler(ListResourcesRequestSchema, async () => {
    return { resources: listResources() };
});

server.setRequestHandler(ReadResourceRequestSchema, async (request) => {
    try {
        return readResource(request.params.uri);
    } catch (error: unknown) {
        const message = error instanceof Error ? error.message : String(error);
        throw new Error(`Resource error: ${message}`);
    }
});

// Prompts
server.setRequestHandler(ListPromptsRequestSchema, async () => {
    return { prompts: listPrompts() };
});

server.setRequestHandler(GetPromptRequestSchema, async (request) => {
    try {
        return getPrompt(request.params.name, (request.params.arguments ?? {}) as Record<string, string>);
    } catch (error: unknown) {
        const message = error instanceof Error ? error.message : String(error);
        throw new Error(`Prompt error: ${message}`);
    }
});

// ============================================================================
// MAIN
// ============================================================================

/**
 *
 */
async function main(): Promise<void> {
    const transport = new StdioServerTransport();
    await server.connect(transport);
    console.error(`csszyx MCP Server v${VERSION} running on stdio`);
    console.error(`  Tools: ${TOOLS.length} | Resources: ${listResources().length} | Prompts: ${listPrompts().length}`);
}

main().catch((error) => {
    console.error('Server error:', error);
    process.exit(1);
});
