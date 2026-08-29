// A binding new enough to carry the migrate entry points. `native-binding.cjs`
// deliberately does not, so the pair covers both sides of the version check.
exports.transformBatch = files => files.map(() => ({ code: '', classes: [] }));
exports.migrateBatch = (files, options) => ({ called: 'migrateBatch', files, options });
exports.migrateHtml = (source, options) => ({ called: 'migrateHtml', source, options });
exports.migrateClassName = (className, customMapJson) =>
    JSON.stringify({ called: 'migrateClassName', className, customMapJson });
exports.migrateParseClass = className =>
    JSON.stringify({ called: 'migrateParseClass', className });
