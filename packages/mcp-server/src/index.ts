#!/usr/bin/env node
import { transform } from '@csszyx/compiler';
import { Server } from '@modelcontextprotocol/sdk/server/index.js';
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import {
    CallToolRequestSchema,
    ListToolsRequestSchema,
} from '@modelcontextprotocol/sdk/types.js';
import { z } from 'zod';

const server = new Server(
    {
        name: 'csszyx-mcp-server',
        version: '0.1.0',
    },
    {
        capabilities: {
            tools: {},
        },
    },
);

const ExpandToolSchema = z.object({
    sz: z.record(z.any()).describe('The sz prop object to expand'),
});

server.setRequestHandler(ListToolsRequestSchema, async () => {
    return {
        tools: [
            {
                name: 'csszyx_expand',
                description: "Expand a csszyx 'sz' object into Tailwind CSS classes",
                inputSchema: {
                    type: 'object',
                    properties: {
                        sz: {
                            type: 'object',
                            description: "The sz prop object (e.g. { p: 4, bg: 'red-500' })",
                        },
                    },
                    required: ['sz'],
                },
            },
        ],
    };
});

server.setRequestHandler(CallToolRequestSchema, async (request) => {
    if (request.params.name === 'csszyx_expand') {
        try {
            const { sz } = ExpandToolSchema.parse(request.params.arguments);
            const result = transform(sz);

            return {
                content: [
                    {
                        type: 'text',
                        text: JSON.stringify({
                            className: result.className,
                            attributes: result.attributes,
                        }, null, 2),
                    },
                ],
            };
        } catch (error: unknown) {
            const message = error instanceof Error ? error.message : String(error);
            return {
                content: [
                    {
                        type: 'text',
                        text: `Error expanding sz object: ${message}`,
                    },
                ],
                isError: true,
            };
        }
    }

    throw new Error(`Tool not found: ${request.params.name}`);
});

/**
 *
 */
async function main(): Promise<void> {
    const transport = new StdioServerTransport();
    await server.connect(transport);
    console.error('csszyx MCP Server running on stdio');
}

main().catch((error) => {
    console.error('Server error:', error);
    process.exit(1);
});
