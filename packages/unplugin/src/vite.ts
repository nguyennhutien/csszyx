/**
 * Vite plugin export for csszyx.
 *
 * This exports the Vite-specific plugin configuration which includes
 * both pre and post transformation phases for optimal CSS processing.
 *
 * @example
 * ```ts
 * import { defineConfig } from 'vite';
 * import csszyx from '@csszyx/unplugin/vite';
 *
 * export default defineConfig({
 *   plugins: [
 *     csszyx({
 *       development: { debug: true },
 *       production: { injectChecksum: true }
 *     })
 *   ]
 * });
 * ```
 */
import { vitePlugin } from './unplugin';

export default vitePlugin;
