# Changelog

## [0.6.0](https://github.com/nguyennhutien/csszyx/compare/cli-0.5.0...cli-0.6.0) (2026-05-06)


### ⚠ BREAKING CHANGES

* **types:** DevelopmentConfig.autoInjectRecovery and DevelopmentConfig.allowCSRRecovery have been removed. Recovery is now controlled per-element via the szRecover JSX attribute. The runtime-level allowCSRRecovery option in RuntimeConfig (initRuntime) remains available.

### Features

* **types:** remove legacy autoInjectRecovery + allowCSRRecovery from DevelopmentConfig ([e74c409](https://github.com/nguyennhutien/csszyx/commit/e74c40917d8b960530822f4ddb17643f38914dd3))
