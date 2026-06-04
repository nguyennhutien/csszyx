module.exports = function csszyxTurboProbeLoader(source) {
    const nextSource = source.replaceAll('__CSSZYX_TURBO_LOADER_PROBE__', 'probe-ok');
    if (typeof this.addDependency === 'function') {
        this.addDependency(this.resourcePath);
    }
    return nextSource;
};
