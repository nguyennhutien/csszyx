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
    // The bin runs `cli.parse()` when loaded. Left to choose, Rolldown puts
    // a helper the bin shares with a command into `bin.mjs` and has the
    // command import it from there, so the library entry, which loads the
    // check pass for the MCP tools, would print the CLI's help into the
    // server's stdout. Strict entry signatures keep shared code out of it.
    inputOptions: { preserveEntrySignatures: 'strict' },
});
