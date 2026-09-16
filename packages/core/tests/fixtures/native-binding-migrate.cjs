// A binding new enough to carry the migrate entry points and the module-link
// scan. `native-binding.cjs` deliberately carries neither, so the pair covers
// both sides of each version check.
exports.transformBatch = files => files.map(() => ({ code: '', classes: [] }));
exports.migrateBatch = (files, options) => ({ called: 'migrateBatch', files, options });
exports.migrateHtml = (source, options) => ({ called: 'migrateHtml', source, options });
exports.migrateClassName = (className, customMapJson) =>
    JSON.stringify({ called: 'migrateClassName', className, customMapJson });
exports.migrateParseClass = className =>
    JSON.stringify({ called: 'migrateParseClass', className });
exports.scanModuleLinks = files => files.map(file => ({ called: 'scanModuleLinks', filename: file.filename }));
