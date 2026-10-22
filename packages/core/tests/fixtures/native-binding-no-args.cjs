// A binding from before the spans crossed as one text: it reports `issues`
// and `mergeGroups` as objects, and no `spans`, so the installed
// `@csszyx/core` cannot read any of its results.
exports.transformBatch = files =>
    files.map((_, index) => ({
        code: '',
        classes: [],
        issues: index === 0 ? [] : [{ code: 'unknown-key', start: 0 }],
        mergeGroups: [],
    }));
