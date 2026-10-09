/**
 * `@csszyx/unplugin/diagnostics` — the diagnostic policy and the config file
 * it is read from, for every consumer outside the bundler plugins: `csszyx
 * check`, `csszyx next prebuild`/`watch`, and later the Turbopack loader and
 * jest.
 *
 * @module
 */
export {
    CSSZYX_CONFIG_FILE_NAMES,
    DIAGNOSTIC_POLICY_STATE_FILE,
    diagnosticPolicyStatePath,
    type FoundConfigFile,
    findCsszyxConfigFile,
    type LoadedDiagnosticPolicy,
    loadDiagnosticPolicy,
    type ModuleImporter,
    readDiagnosticPolicyState,
    writeDiagnosticPolicyState,
} from './csszyx-config-file.js';
export {
    createDiagnosticPolicy,
    DIAGNOSTIC_POLICY_FORMAT,
    type DiagnosticConfigProblem,
    type DiagnosticPolicy,
    type DiagnosticPolicyState,
    type DiagnosticSubject,
    diagnosticConfigProblemsMessage,
    isAtLeastLevel,
    type NormalizedDiagnosticsConfig,
    type ReadFileConfig,
    readCsszyxFileConfig,
    SZ_DIAGNOSTIC_LEVELS,
    SZ_DIAGNOSTIC_PASS_IDS,
    SZ_DIAGNOSTIC_PRESETS,
    SZ_DIAGNOSTIC_RULE_IDS,
} from './diagnostic-policy.js';
