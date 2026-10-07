import { base } from '../../tsdown.base.mjs';

export default {
    ...base,
    entry: {
        index: 'src/index.ts',
        react: 'src/react.ts',
    },
    // ESM only — dynamic is consumed by modern bundlers that prefer ESM
    // (CDN'd, code-split, etc.). Skipping CJS keeps the publish surface
    // small and avoids dual-package hazard for the React re-export.
    format: ['esm'],
    platform: 'neutral',
};
