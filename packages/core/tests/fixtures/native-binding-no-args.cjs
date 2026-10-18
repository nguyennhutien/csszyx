// A binding from between the two 0.18 shapes: it reports `issues` but carries
// no `argsJson` on them. Only a file with a diagnostic shows it, so the first
// result here has none and the second has one.
exports.transformBatch = files =>
    files.map((_, index) => ({
        code: '',
        classes: [],
        issues: index === 0 ? [] : [{ code: 'unknown-key', start: 0 }],
        mergeGroups: [],
    }));
