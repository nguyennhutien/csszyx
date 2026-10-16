// A 0.17.2 binding: the scan exists, takes one argument, and answers no
// registry entries.
module.exports = {
  ...require("./native-binding.cjs"),
  scanModuleLinks: (files) => files.map(() => ({ cssImports: [], forwards: [] })),
};
