import { defineBuildConfig } from 'unbuild';

export default defineBuildConfig({
    failOnWarn: false,
    entries: ['./src/index', './src/bin'],
    declaration: 'node16',
    rollup: {
        emitCJS: false,
    },
});
