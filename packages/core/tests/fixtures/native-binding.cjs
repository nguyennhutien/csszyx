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
      timings: {
        triageNs: 0,
        parseNs: 0,
        scopeNs: 0,
        irNs: 0,
        lowerNs: 0,
        recoveryNs: 0,
        diagnosticsNs: 0,
        rewriteNs: 0,
        totalNs: 0,
      },
    },
    parserPath: "fastRegex",
  }));
