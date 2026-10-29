// A binding new enough to carry the migrate entry points and the module-link
// and global-var usage scans. `native-binding.cjs` deliberately carries none, so the pair covers
// both sides of each version check.
exports.transformBatch = files =>
    files.map(() => ({ code: '', classes: [], spans: '1,0,0,0,0,' }));
exports.migrateBatch = (files, options) => ({ called: 'migrateBatch', files, options });
exports.migrateHtml = (source, options) => ({ called: 'migrateHtml', source, options });
exports.migrateClassName = (className, options) =>
    JSON.stringify({ called: 'migrateClassName', className, options });
exports.migrateParseClass = className =>
    JSON.stringify({ called: 'migrateParseClass', className });
exports.scanModuleLinks = files => files.map(file => ({ called: 'scanModuleLinks', filename: file.filename }));
exports.scanGlobalVarUsages = (files, query) =>
    files.map(file => [{ called: 'scanGlobalVarUsages', filename: file.filename, query }]);
