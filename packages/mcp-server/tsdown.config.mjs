import { fileURLToPath } from 'node:url';

import { base } from '../../tsdown.base.mjs';

// The package root, whichever directory tsdown is run from.
const root = fileURLToPath(new URL('.', import.meta.url));

export default {
    ...base,
    entry: { index: 'src/index.ts' },
    format: ['esm'],
    // The `csszyx-mcp` binary: an MCP server spoken to over stdio by Node.
    platform: 'node',
    hooks: {
        async 'build:done'() {
            // Copy llms-full.txt from apps/docs/public so the MCP server can
            // ship the full csszyx reference docs alongside the binary.
            const fs = await import('node:fs/promises');
            const path = await import('node:path');
            const src = path.resolve(root, '../../apps/docs/public/llms-full.txt');
            const dest = path.resolve(root, 'llms-full.txt');
            try {
                await fs.copyFile(src, dest);
            } catch {
                // Silently skip if docs build hasn't generated llms-full yet.
            }
        },
    },
};
