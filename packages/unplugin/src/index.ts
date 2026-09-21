/**
 * Main unplugin entry point.
 *
 * Every name here is part of the package's public surface, so they are listed
 * rather than re-exported wholesale: `export *` from an implementation file
 * makes each helper in it a name semver has to keep, whether or not anything
 * documents it. A lane's own surface stays in that lane's entry
 * (`./css-mangler`, `./next`, `./next-prebuild`, `./jest`, `./postcss`, …).
 */
// The CLI and the MCP server read a project's `@theme` blocks through these;
// the rest of the scanner is the plugin's own business.
export { hasTokens, type ParsedTheme, parseThemeBlocks } from './theme-scanner';
// Default export for convenience
export {
    esbuildPlugin,
    rollupPlugin,
    unplugin,
    unplugin as default,
    vitePlugin,
    webpackPlugin,
} from './unplugin';
