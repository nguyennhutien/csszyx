/**
 * The plugin routes a file to an adapter by its extension before it loads the
 * adapter, so the extension is written twice: in the plugin's adapter table
 * and in the adapter's own Vite plugin. An adapter that widened its own would
 * lower those files through Vite, and the plugin would skip them without a
 * word. This ties each table row to the adapter it loads.
 */
import { describe, expect, it } from 'vitest';

import { templateAdapterExtensions } from '../src/unplugin.js';

describe('the template adapter table', () => {
    it.each(Object.entries(templateAdapterExtensions()))(
        'routes to the %s adapter the extension it lowers',
        async (framework, routed) => {
            const adapter = (await import(`@csszyx/${framework}-adapter`)) as {
                extension?: string;
            };
            // The adapter is read from its built dist, so a dist from before
            // the export reads as undefined: say so, rather than blame the row.
            expect(
                adapter.extension,
                `@csszyx/${framework}-adapter exports no \`extension\`; rebuild it`,
            ).toBeDefined();
            expect(routed).toBe(adapter.extension);
        },
    );
});
