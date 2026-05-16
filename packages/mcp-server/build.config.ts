import { defineBuildConfig } from 'unbuild';

export default defineBuildConfig({
    failOnWarn: false,
    entries: ['./src/index'],
    declaration: 'node16',
    clean: true,
    rollup: {
        emitCJS: false,
    },
    hooks: {
        async 'build:done'(ctx) {
            // Copy llms-full.txt from apps/docs/public so the MCP server can
            // ship the full csszyx reference docs alongside the binary.
            const fs = await import('node:fs/promises');
            const path = await import('node:path');
            const src = path.resolve(ctx.options.rootDir, '../../apps/docs/public/llms-full.txt');
            const dest = path.resolve(ctx.options.rootDir, 'llms-full.txt');
            try {
                await fs.copyFile(src, dest);
            } catch {
                // Silently skip if docs build hasn't generated llms-full yet.
            }
        },
    },
});
