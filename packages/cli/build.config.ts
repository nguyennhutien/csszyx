import { defineBuildConfig } from 'unbuild';

export default defineBuildConfig({
    failOnWarn: false,
    entries: ['./src/index'],
    declaration: 'node16',
    rollup: {
        emitCJS: false,
    },
});
