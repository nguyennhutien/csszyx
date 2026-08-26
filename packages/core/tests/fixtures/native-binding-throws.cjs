// A platform package that fails to load for a reason that is not "missing".
// A corrupt or ABI-mismatched .node file lands here, and the loader must let
// that error through rather than reporting it as an install problem.
throw Object.assign(new Error('boom: the native module could not initialise'), {
    code: 'ERR_DLOPEN_FAILED',
});
