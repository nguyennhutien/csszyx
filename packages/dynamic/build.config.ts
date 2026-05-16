import { defineBuildConfig } from 'unbuild';

export default defineBuildConfig({
    failOnWarn: false,
    entries: ['./src/index', './src/react'],
    declaration: 'node16',
    rollup: {
        // ESM only — dynamic is consumed by modern bundlers that prefer
        // ESM (CDN'd, code-split, etc.). Skipping CJS keeps the publish
        // surface small and avoids dual-package hazard for the React
        // re-export.
        emitCJS: false,
    },
});
