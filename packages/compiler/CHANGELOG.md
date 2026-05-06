# Changelog

## [0.7.0](https://github.com/nguyennhutien/csszyx/compare/v0.6.0...v0.7.0) (2026-05-06)


### ⚠ BREAKING CHANGES

* **types:** DevelopmentConfig.autoInjectRecovery and DevelopmentConfig.allowCSRRecovery have been removed. Recovery is now controlled per-element via the szRecover JSX attribute. The runtime-level allowCSRRecovery option in RuntimeConfig (initRuntime) remains available.

### Features

* **compiler:** AST budget guard at 50k nodes per file ([e1cf9d0](https://github.com/nguyennhutien/csszyx/commit/e1cf9d04bd2a5d102b8a174619a4299e1a7ee677))
* **compiler:** emit recovery tokens from szRecover JSX attributes ([9c29e80](https://github.com/nguyennhutien/csszyx/commit/9c29e80f07022677024ca554832c5208241eaf2d))
* **compiler:** make AST budget configurable via build.astBudgetLimit ([b12f1bb](https://github.com/nguyennhutien/csszyx/commit/b12f1bb7faa030ba2db30ff7d08136ebccec4489))
* **types:** remove legacy autoInjectRecovery + allowCSRRecovery from DevelopmentConfig ([e74c409](https://github.com/nguyennhutien/csszyx/commit/e74c40917d8b960530822f4ddb17643f38914dd3))
* **unplugin:** aggregate recovery tokens + inject SSR manifest ([6a687d2](https://github.com/nguyennhutien/csszyx/commit/6a687d2672b36c47e139df56cd9db399ef4fe60e))

## [0.6.0](https://github.com/nguyennhutien/csszyx/compare/compiler-0.5.0...compiler-0.6.0) (2026-05-06)


### ⚠ BREAKING CHANGES

* **types:** DevelopmentConfig.autoInjectRecovery and DevelopmentConfig.allowCSRRecovery have been removed. Recovery is now controlled per-element via the szRecover JSX attribute. The runtime-level allowCSRRecovery option in RuntimeConfig (initRuntime) remains available.

### Features

* **compiler:** AST budget guard at 50k nodes per file ([e1cf9d0](https://github.com/nguyennhutien/csszyx/commit/e1cf9d04bd2a5d102b8a174619a4299e1a7ee677))
* **compiler:** emit recovery tokens from szRecover JSX attributes ([9c29e80](https://github.com/nguyennhutien/csszyx/commit/9c29e80f07022677024ca554832c5208241eaf2d))
* **compiler:** make AST budget configurable via build.astBudgetLimit ([b12f1bb](https://github.com/nguyennhutien/csszyx/commit/b12f1bb7faa030ba2db30ff7d08136ebccec4489))
* **types:** remove legacy autoInjectRecovery + allowCSRRecovery from DevelopmentConfig ([e74c409](https://github.com/nguyennhutien/csszyx/commit/e74c40917d8b960530822f4ddb17643f38914dd3))
* **unplugin:** aggregate recovery tokens + inject SSR manifest ([6a687d2](https://github.com/nguyennhutien/csszyx/commit/6a687d2672b36c47e139df56cd9db399ef4fe60e))
