exports.transformBatch = (files) =>
  files.map((file) => ({
    code: file.source.replace("sz={{ p: 4 }}", 'className="p-4"'),
    map: null,
    classes: ["p-4"],
    rawClassNames: [],
    diagnostics: [],
    recoveryTokens: [],
    metadata: {
      transformed: true,
      usesRuntime: false,
      usesMerge: false,
      usesColorVar: false,
      producer: "rust",
      astBudgetExceeded: false,
    },
    parserPath: "fastRegex",
  }));
