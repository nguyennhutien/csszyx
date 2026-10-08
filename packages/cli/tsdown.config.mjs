import { base, defineBuild } from '../../tsdown.base.mjs';

export default defineBuild({
    ...base,
    entry: {
        index: 'src/index.ts',
        // The `csszyx` bin: keeps its `#!/usr/bin/env node` line.
        bin: 'src/bin.ts',
    },
    format: ['esm'],
    platform: 'node',
});
