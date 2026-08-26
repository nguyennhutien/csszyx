// A platform package that reports itself missing with the ESM resolver's code
// rather than the CJS one. Node uses ERR_MODULE_NOT_FOUND when the failure
// comes from an ESM resolution inside the package, and the loader has to read
// that as "not installed" too, not as an unexpected crash.
throw Object.assign(new Error(`Cannot find module ${__filename}`), {
    code: 'ERR_MODULE_NOT_FOUND',
});
