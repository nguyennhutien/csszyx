/**
 * `@csszyx/unplugin/diagnostics` — the diagnostic policy and the config file
 * it is read from, for every consumer outside the bundler plugins: `csszyx
 * check` and `csszyx next prebuild`/`watch` — with the dead-class report and
 * the dedupe and cap the Next commands print it through.
 *
 * @module
 */
export {
    CSSZYX_CONFIG_FILE_NAMES,
    csszyxConfigFileNameFor,
    DIAGNOSTIC_POLICY_STATE_FILE,
    diagnosticPolicyStatePath,
    type FoundConfigFile,
    findCsszyxConfigFile,
    isLegacyInitTemplate,
    type LoadedDiagnosticPolicy,
    loadDiagnosticPolicy,
    type ModuleImporter,
    readDiagnosticPolicyState,
    writeDiagnosticPolicyState,
} from './csszyx-config-file.js';
export {
    type DeadClassFinding,
    type DeadClassSite,
    deadClassMessage,
    reportDeadSzClasses,
} from './dead-class.js';
export {
    capOverflowMessage,
    createDiagnosticLimiter,
    type DiagnosticLimiter,
} from './diagnostic-limiter.js';
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
export {
    type QuietMode,
    resolveQuietMode,
    shouldHoldAdvisories,
    suppressedAdvisoryMessage,
} from './transform-diagnostics.js';
