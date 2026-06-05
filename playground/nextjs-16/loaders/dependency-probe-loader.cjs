const { readFileSync } = require('node:fs');
const { join } = require('node:path');

module.exports = function dependencyProbeLoader(source) {
    const dependencyPath = join(process.cwd(), 'loaders/dependency-probe.txt');
    this.addDependency?.(dependencyPath);
    const value = readFileSync(dependencyPath, 'utf8').trim();
    return source.replace('__CSSZYX_TURBO_DEPENDENCY_PROBE__', value);
};
