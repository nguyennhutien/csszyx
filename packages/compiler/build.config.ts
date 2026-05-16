import { defineBuildConfig } from 'unbuild';

export default defineBuildConfig({
    failOnWarn: false,
    entries: ['./src/index', './src/color-var'],
    declaration: 'node16',
    rollup: {
        emitCJS: true,
    },
});
