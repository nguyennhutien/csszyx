/* @ts-self-types="./csszyx_core.d.ts" */

/**
 * WASM bindings for JavaScript interop
 */
class WasmCollisionDetector {
    __destroy_into_raw() {
        const ptr = this.__wbg_ptr;
        this.__wbg_ptr = 0;
        WasmCollisionDetectorFinalization.unregister(this);
        return ptr;
    }
    free() {
        const ptr = this.__destroy_into_raw();
        wasm.__wbg_wasmcollisiondetector_free(ptr, 0);
    }
    /**
     * Adds a CSS value and returns its variable name (WASM binding).
     *
     * # Arguments
     *
     * * `value` - CSS value to hash
     *
     * # Returns
     *
     * Variable name (e.g., "--v-abc123" or "--v-abc123-def456")
     * @param {string} value
     * @returns {string}
     */
    add(value) {
        let deferred2_0;
        let deferred2_1;
        try {
            const ptr0 = passStringToWasm0(value, wasm.__wbindgen_malloc, wasm.__wbindgen_realloc);
            const len0 = WASM_VECTOR_LEN;
            const ret = wasm.wasmcollisiondetector_add(this.__wbg_ptr, ptr0, len0);
            deferred2_0 = ret[0];
            deferred2_1 = ret[1];
            return getStringFromWasm0(ret[0], ret[1]);
        } finally {
            wasm.__wbindgen_free(deferred2_0, deferred2_1, 1);
        }
    }
    /**
     * Gets the total number of variables (WASM binding).
     *
     * # Returns
     *
     * Number of unique CSS values
     * @returns {number}
     */
    count() {
        const ret = wasm.wasmcollisiondetector_count(this.__wbg_ptr);
        return ret >>> 0;
    }
    /**
     * Checks if any collision occurred (WASM binding).
     *
     * # Returns
     *
     * `true` if collision detected
     * @returns {boolean}
     */
    has_collision() {
        const ret = wasm.wasmcollisiondetector_has_collision(this.__wbg_ptr);
        return ret !== 0;
    }
    /**
     * Creates a new collision detector (WASM binding).
     */
    constructor() {
        const ret = wasm.wasmcollisiondetector_new();
        this.__wbg_ptr = ret >>> 0;
        WasmCollisionDetectorFinalization.register(this, this.__wbg_ptr, this);
        return this;
    }
}
if (Symbol.dispose) WasmCollisionDetector.prototype[Symbol.dispose] = WasmCollisionDetector.prototype.free;
exports.WasmCollisionDetector = WasmCollisionDetector;

/**
 * Computes a deterministic SHA-256 checksum for a mangle map.
 *
 * The checksum is designed to be:
 * 1. **Deterministic**: Same map always produces same checksum
 * 2. **Collision-resistant**: Different maps produce different checksums
 * 3. **Compact**: 16-character hex string (64 bits of SHA-256)
 *
 * # Algorithm
 *
 * 1. Sort all entries by original class name (determinism)
 * 2. Create canonical string: "orig1:mangle1|orig2:mangle2|..."
 * 3. Compute SHA-256 hash
 * 4. Take first 16 hex characters (64 bits, ~1.8e19 possible values)
 *
 * # Arguments
 *
 * * `map` - The mangle map to checksum
 *
 * # Returns
 *
 * A 16-character hex string checksum
 *
 * # Performance
 *
 * - Time complexity: O(n log n) for sorting + O(n) for hashing
 * - Space complexity: O(n) for canonical string
 * - Typical runtime: ~10-50µs for 1000 entries (10-15x faster than JS)
 *
 * # Security
 *
 * While we only use 64 bits of SHA-256, this provides sufficient collision
 * resistance for our use case (detecting accidental mismatches, not
 * cryptographic attacks). Birthday paradox gives us ~4 billion hashes
 * before 50% collision probability.
 *
 * # Examples
 *
 * ```
 * use csszyx_core::mangle::{compute_mangle_checksum, MangleMap};
 * use std::collections::HashMap;
 *
 * let mut map = HashMap::new();
 * map.insert("p-4".to_string(), "a".to_string());
 * map.insert("bg-red-500".to_string(), "b".to_string());
 *
 * let checksum = compute_mangle_checksum(&map);
 * assert_eq!(checksum.len(), 16);
 *
 * // Same map produces same checksum
 * let checksum2 = compute_mangle_checksum(&map);
 * assert_eq!(checksum, checksum2);
 * ```
 * @param {any} map
 * @returns {string}
 */
function compute_mangle_checksum(map) {
    let deferred2_0;
    let deferred2_1;
    try {
        const ret = wasm.compute_mangle_checksum(map);
        var ptr1 = ret[0];
        var len1 = ret[1];
        if (ret[3]) {
            ptr1 = 0; len1 = 0;
            throw takeFromExternrefTable0(ret[2]);
        }
        deferred2_0 = ptr1;
        deferred2_1 = len1;
        return getStringFromWasm0(ptr1, len1);
    } finally {
        wasm.__wbindgen_free(deferred2_0, deferred2_1, 1);
    }
}
exports.compute_mangle_checksum = compute_mangle_checksum;

/**
 * Encodes an index to a reversed tier-based Base62 string.
 *
 * # Arguments
 *
 * * `index` - The zero-based index to encode
 *
 * # Returns
 *
 * A Base62 encoded string following tier-based rules with reversed sequence
 *
 * # Performance
 *
 * - Time complexity: O(log n)
 * - Space complexity: O(log n)
 * - Average: ~5ns per encoding (measured on x86_64)
 *
 * # Examples
 *
 * ```
 * use csszyx_core::encoder::encode;
 *
 * // Tier 1: Single letters (reversed)
 * assert_eq!(encode(0), "z");
 * assert_eq!(encode(25), "a");
 * assert_eq!(encode(26), "Z");
 * assert_eq!(encode(51), "A");
 *
 * // Tier 2: Letter + digit (both reversed)
 * assert_eq!(encode(52), "z9");
 * assert_eq!(encode(53), "z8");
 * assert_eq!(encode(571), "A0");
 *
 * // Tier 3: Two letters (both reversed)
 * assert_eq!(encode(572), "zz");
 * assert_eq!(encode(573), "zy");
 * ```
 * @param {number} index
 * @returns {string}
 */
function encode(index) {
    let deferred1_0;
    let deferred1_1;
    try {
        const ret = wasm.encode(index);
        deferred1_0 = ret[0];
        deferred1_1 = ret[1];
        return getStringFromWasm0(ret[0], ret[1]);
    } finally {
        wasm.__wbindgen_free(deferred1_0, deferred1_1, 1);
    }
}
exports.encode = encode;

/**
 * Generates a cryptographic token for a recovery declaration.
 *
 * # Arguments
 *
 * * `component` - Component name
 * * `path` - Absolute file path
 * * `line` - Line number in source
 * * `column` - Column number in source
 * * `mode` - Recovery mode ('csr' or 'dev-only')
 * * `build_id` - Build identifier (git hash or timestamp)
 *
 * # Returns
 *
 * A 12-character Base62 encoded token (first 12 chars of SHA-256 hash)
 *
 * # Security
 *
 * - Uses SHA-256 for cryptographic strength
 * - Includes source location for uniqueness
 * - Build ID ensures different builds have different tokens
 * - Base62 encoding for URL safety
 *
 * # Examples
 *
 * ```
 * use csszyx_core::token::generate_token;
 *
 * let token = generate_token(
 *     "DataTable",
 *     "/src/components/DataTable.tsx",
 *     42,
 *     8,
 *     "csr",
 *     "abc123def456"
 * );
 *
 * assert_eq!(token.len(), 12);
 * ```
 * @param {string} component
 * @param {string} path
 * @param {number} line
 * @param {number} column
 * @param {string} mode
 * @param {string} build_id
 * @returns {string}
 */
function generate_token(component, path, line, column, mode, build_id) {
    let deferred5_0;
    let deferred5_1;
    try {
        const ptr0 = passStringToWasm0(component, wasm.__wbindgen_malloc, wasm.__wbindgen_realloc);
        const len0 = WASM_VECTOR_LEN;
        const ptr1 = passStringToWasm0(path, wasm.__wbindgen_malloc, wasm.__wbindgen_realloc);
        const len1 = WASM_VECTOR_LEN;
        const ptr2 = passStringToWasm0(mode, wasm.__wbindgen_malloc, wasm.__wbindgen_realloc);
        const len2 = WASM_VECTOR_LEN;
        const ptr3 = passStringToWasm0(build_id, wasm.__wbindgen_malloc, wasm.__wbindgen_realloc);
        const len3 = WASM_VECTOR_LEN;
        const ret = wasm.generate_token(ptr0, len0, ptr1, len1, line, column, ptr2, len2, ptr3, len3);
        deferred5_0 = ret[0];
        deferred5_1 = ret[1];
        return getStringFromWasm0(ret[0], ret[1]);
    } finally {
        wasm.__wbindgen_free(deferred5_0, deferred5_1, 1);
    }
}
exports.generate_token = generate_token;

/**
 * Initializes the WASM module.
 *
 * Should be called once before using any functions.
 *
 * # Examples
 *
 * ```javascript
 * import init, { encode } from 'csszyx-core';
 *
 * await init();
 * const id = encode(42);
 * ```
 */
function init() {
    wasm.init();
}
exports.init = init;

/**
 * Transforms a csszyx sz object into a Tailwind CSS className string in Rust for maximum performance.
 *
 * Phase 3 Enhancements:
 * - Handles nested variants (hover, focus, md, etc.)
 * - Handles negative values (m: -4 -> -m-4)
 * - Handles boolean flags
 * @param {any} val
 * @returns {string}
 */
function transform_sz(val) {
    let deferred2_0;
    let deferred2_1;
    try {
        const ret = wasm.transform_sz(val);
        var ptr1 = ret[0];
        var len1 = ret[1];
        if (ret[3]) {
            ptr1 = 0; len1 = 0;
            throw takeFromExternrefTable0(ret[2]);
        }
        deferred2_0 = ptr1;
        deferred2_1 = len1;
        return getStringFromWasm0(ptr1, len1);
    } finally {
        wasm.__wbindgen_free(deferred2_0, deferred2_1, 1);
    }
}
exports.transform_sz = transform_sz;

/**
 * WASM-exposed checksum verification.
 *
 * # Arguments
 *
 * * `map` - JavaScript object representing the mangle map
 * * `expected_checksum` - The expected checksum string
 *
 * # Returns
 *
 * `true` if checksum matches, `false` otherwise
 * @param {any} map
 * @param {string} expected_checksum
 * @returns {boolean}
 */
function verify_mangle_checksum(map, expected_checksum) {
    const ptr0 = passStringToWasm0(expected_checksum, wasm.__wbindgen_malloc, wasm.__wbindgen_realloc);
    const len0 = WASM_VECTOR_LEN;
    const ret = wasm.verify_mangle_checksum(map, ptr0, len0);
    if (ret[2]) {
        throw takeFromExternrefTable0(ret[1]);
    }
    return ret[0] !== 0;
}
exports.verify_mangle_checksum = verify_mangle_checksum;

/**
 * Verifies a token against component information.
 *
 * # Arguments
 *
 * * `token` - Token to verify
 * * `component` - Component name
 * * `path` - File path
 * * `line` - Line number
 * * `column` - Column number
 * * `mode` - Recovery mode
 * * `build_id` - Build identifier
 *
 * # Returns
 *
 * `true` if token matches, `false` otherwise
 * @param {string} token
 * @param {string} component
 * @param {string} path
 * @param {number} line
 * @param {number} column
 * @param {string} mode
 * @param {string} build_id
 * @returns {boolean}
 */
function verify_token(token, component, path, line, column, mode, build_id) {
    const ptr0 = passStringToWasm0(token, wasm.__wbindgen_malloc, wasm.__wbindgen_realloc);
    const len0 = WASM_VECTOR_LEN;
    const ptr1 = passStringToWasm0(component, wasm.__wbindgen_malloc, wasm.__wbindgen_realloc);
    const len1 = WASM_VECTOR_LEN;
    const ptr2 = passStringToWasm0(path, wasm.__wbindgen_malloc, wasm.__wbindgen_realloc);
    const len2 = WASM_VECTOR_LEN;
    const ptr3 = passStringToWasm0(mode, wasm.__wbindgen_malloc, wasm.__wbindgen_realloc);
    const len3 = WASM_VECTOR_LEN;
    const ptr4 = passStringToWasm0(build_id, wasm.__wbindgen_malloc, wasm.__wbindgen_realloc);
    const len4 = WASM_VECTOR_LEN;
    const ret = wasm.verify_token(ptr0, len0, ptr1, len1, ptr2, len2, line, column, ptr3, len3, ptr4, len4);
    return ret !== 0;
}
exports.verify_token = verify_token;

/**
 * Gets the version of csszyx-core.
 *
 * # Returns
 *
 * Version string
 * @returns {string}
 */
function version() {
    let deferred1_0;
    let deferred1_1;
    try {
        const ret = wasm.version();
        deferred1_0 = ret[0];
        deferred1_1 = ret[1];
        return getStringFromWasm0(ret[0], ret[1]);
    } finally {
        wasm.__wbindgen_free(deferred1_0, deferred1_1, 1);
    }
}
exports.version = version;

function __wbg_get_imports() {
    const import0 = {
        __proto__: null,
        __wbg_Error_8c4e43fe74559d73: function(arg0, arg1) {
            const ret = Error(getStringFromWasm0(arg0, arg1));
            return ret;
        },
        __wbg_String_8f0eb39a4a4c2f66: function(arg0, arg1) {
            const ret = String(arg1);
            const ptr1 = passStringToWasm0(ret, wasm.__wbindgen_malloc, wasm.__wbindgen_realloc);
            const len1 = WASM_VECTOR_LEN;
            getDataViewMemory0().setInt32(arg0 + 4 * 1, len1, true);
            getDataViewMemory0().setInt32(arg0 + 4 * 0, ptr1, true);
        },
        __wbg___wbindgen_bigint_get_as_i64_8fcf4ce7f1ca72a2: function(arg0, arg1) {
            const v = arg1;
            const ret = typeof(v) === 'bigint' ? v : undefined;
            getDataViewMemory0().setBigInt64(arg0 + 8 * 1, isLikeNone(ret) ? BigInt(0) : ret, true);
            getDataViewMemory0().setInt32(arg0 + 4 * 0, !isLikeNone(ret), true);
        },
        __wbg___wbindgen_boolean_get_bbbb1c18aa2f5e25: function(arg0) {
            const v = arg0;
            const ret = typeof(v) === 'boolean' ? v : undefined;
            return isLikeNone(ret) ? 0xFFFFFF : ret ? 1 : 0;
        },
        __wbg___wbindgen_debug_string_0bc8482c6e3508ae: function(arg0, arg1) {
            const ret = debugString(arg1);
            const ptr1 = passStringToWasm0(ret, wasm.__wbindgen_malloc, wasm.__wbindgen_realloc);
            const len1 = WASM_VECTOR_LEN;
            getDataViewMemory0().setInt32(arg0 + 4 * 1, len1, true);
            getDataViewMemory0().setInt32(arg0 + 4 * 0, ptr1, true);
        },
        __wbg___wbindgen_in_47fa6863be6f2f25: function(arg0, arg1) {
            const ret = arg0 in arg1;
            return ret;
        },
        __wbg___wbindgen_is_bigint_31b12575b56f32fc: function(arg0) {
            const ret = typeof(arg0) === 'bigint';
            return ret;
        },
        __wbg___wbindgen_is_function_0095a73b8b156f76: function(arg0) {
            const ret = typeof(arg0) === 'function';
            return ret;
        },
        __wbg___wbindgen_is_object_5ae8e5880f2c1fbd: function(arg0) {
            const val = arg0;
            const ret = typeof(val) === 'object' && val !== null;
            return ret;
        },
        __wbg___wbindgen_jsval_eq_11888390b0186270: function(arg0, arg1) {
            const ret = arg0 === arg1;
            return ret;
        },
        __wbg___wbindgen_jsval_loose_eq_9dd77d8cd6671811: function(arg0, arg1) {
            const ret = arg0 == arg1;
            return ret;
        },
        __wbg___wbindgen_number_get_8ff4255516ccad3e: function(arg0, arg1) {
            const obj = arg1;
            const ret = typeof(obj) === 'number' ? obj : undefined;
            getDataViewMemory0().setFloat64(arg0 + 8 * 1, isLikeNone(ret) ? 0 : ret, true);
            getDataViewMemory0().setInt32(arg0 + 4 * 0, !isLikeNone(ret), true);
        },
        __wbg___wbindgen_string_get_72fb696202c56729: function(arg0, arg1) {
            const obj = arg1;
            const ret = typeof(obj) === 'string' ? obj : undefined;
            var ptr1 = isLikeNone(ret) ? 0 : passStringToWasm0(ret, wasm.__wbindgen_malloc, wasm.__wbindgen_realloc);
            var len1 = WASM_VECTOR_LEN;
            getDataViewMemory0().setInt32(arg0 + 4 * 1, len1, true);
            getDataViewMemory0().setInt32(arg0 + 4 * 0, ptr1, true);
        },
        __wbg___wbindgen_throw_be289d5034ed271b: function(arg0, arg1) {
            throw new Error(getStringFromWasm0(arg0, arg1));
        },
        __wbg_call_389efe28435a9388: function() { return handleError(function (arg0, arg1) {
            const ret = arg0.call(arg1);
            return ret;
        }, arguments); },
        __wbg_done_57b39ecd9addfe81: function(arg0) {
            const ret = arg0.done;
            return ret;
        },
        __wbg_entries_58c7934c745daac7: function(arg0) {
            const ret = Object.entries(arg0);
            return ret;
        },
        __wbg_get_9b94d73e6221f75c: function(arg0, arg1) {
            const ret = arg0[arg1 >>> 0];
            return ret;
        },
        __wbg_get_b3ed3ad4be2bc8ac: function() { return handleError(function (arg0, arg1) {
            const ret = Reflect.get(arg0, arg1);
            return ret;
        }, arguments); },
        __wbg_instanceof_ArrayBuffer_c367199e2fa2aa04: function(arg0) {
            let result;
            try {
                result = arg0 instanceof ArrayBuffer;
            } catch (_) {
                result = false;
            }
            const ret = result;
            return ret;
        },
        __wbg_instanceof_Map_53af74335dec57f4: function(arg0) {
            let result;
            try {
                result = arg0 instanceof Map;
            } catch (_) {
                result = false;
            }
            const ret = result;
            return ret;
        },
        __wbg_instanceof_Uint8Array_9b9075935c74707c: function(arg0) {
            let result;
            try {
                result = arg0 instanceof Uint8Array;
            } catch (_) {
                result = false;
            }
            const ret = result;
            return ret;
        },
        __wbg_isArray_d314bb98fcf08331: function(arg0) {
            const ret = Array.isArray(arg0);
            return ret;
        },
        __wbg_isSafeInteger_bfbc7332a9768d2a: function(arg0) {
            const ret = Number.isSafeInteger(arg0);
            return ret;
        },
        __wbg_iterator_6ff6560ca1568e55: function() {
            const ret = Symbol.iterator;
            return ret;
        },
        __wbg_length_32ed9a279acd054c: function(arg0) {
            const ret = arg0.length;
            return ret;
        },
        __wbg_length_35a7bace40f36eac: function(arg0) {
            const ret = arg0.length;
            return ret;
        },
        __wbg_new_dd2b680c8bf6ae29: function(arg0) {
            const ret = new Uint8Array(arg0);
            return ret;
        },
        __wbg_next_3482f54c49e8af19: function() { return handleError(function (arg0) {
            const ret = arg0.next();
            return ret;
        }, arguments); },
        __wbg_next_418f80d8f5303233: function(arg0) {
            const ret = arg0.next;
            return ret;
        },
        __wbg_prototypesetcall_bdcdcc5842e4d77d: function(arg0, arg1, arg2) {
            Uint8Array.prototype.set.call(getArrayU8FromWasm0(arg0, arg1), arg2);
        },
        __wbg_value_0546255b415e96c1: function(arg0) {
            const ret = arg0.value;
            return ret;
        },
        __wbindgen_cast_0000000000000001: function(arg0) {
            // Cast intrinsic for `I64 -> Externref`.
            const ret = arg0;
            return ret;
        },
        __wbindgen_cast_0000000000000002: function(arg0, arg1) {
            // Cast intrinsic for `Ref(String) -> Externref`.
            const ret = getStringFromWasm0(arg0, arg1);
            return ret;
        },
        __wbindgen_cast_0000000000000003: function(arg0) {
            // Cast intrinsic for `U64 -> Externref`.
            const ret = BigInt.asUintN(64, arg0);
            return ret;
        },
        __wbindgen_init_externref_table: function() {
            const table = wasm.__wbindgen_externrefs;
            const offset = table.grow(4);
            table.set(0, undefined);
            table.set(offset + 0, undefined);
            table.set(offset + 1, null);
            table.set(offset + 2, true);
            table.set(offset + 3, false);
        },
    };
    return {
        __proto__: null,
        "./csszyx_core_bg.js": import0,
    };
}

const WasmCollisionDetectorFinalization = (typeof FinalizationRegistry === 'undefined')
    ? { register: () => {}, unregister: () => {} }
    : new FinalizationRegistry(ptr => wasm.__wbg_wasmcollisiondetector_free(ptr >>> 0, 1));

function addToExternrefTable0(obj) {
    const idx = wasm.__externref_table_alloc();
    wasm.__wbindgen_externrefs.set(idx, obj);
    return idx;
}

function debugString(val) {
    // primitive types
    const type = typeof val;
    if (type == 'number' || type == 'boolean' || val == null) {
        return  `${val}`;
    }
    if (type == 'string') {
        return `"${val}"`;
    }
    if (type == 'symbol') {
        const description = val.description;
        if (description == null) {
            return 'Symbol';
        } else {
            return `Symbol(${description})`;
        }
    }
    if (type == 'function') {
        const name = val.name;
        if (typeof name == 'string' && name.length > 0) {
            return `Function(${name})`;
        } else {
            return 'Function';
        }
    }
    // objects
    if (Array.isArray(val)) {
        const length = val.length;
        let debug = '[';
        if (length > 0) {
            debug += debugString(val[0]);
        }
        for(let i = 1; i < length; i++) {
            debug += ', ' + debugString(val[i]);
        }
        debug += ']';
        return debug;
    }
    // Test for built-in
    const builtInMatches = /\[object ([^\]]+)\]/.exec(toString.call(val));
    let className;
    if (builtInMatches && builtInMatches.length > 1) {
        className = builtInMatches[1];
    } else {
        // Failed to match the standard '[object ClassName]'
        return toString.call(val);
    }
    if (className == 'Object') {
        // we're a user defined class or Object
        // JSON.stringify avoids problems with cycles, and is generally much
        // easier than looping through ownProperties of `val`.
        try {
            return 'Object(' + JSON.stringify(val) + ')';
        } catch (_) {
            return 'Object';
        }
    }
    // errors
    if (val instanceof Error) {
        return `${val.name}: ${val.message}\n${val.stack}`;
    }
    // TODO we could test for more things here, like `Set`s and `Map`s.
    return className;
}

function getArrayU8FromWasm0(ptr, len) {
    ptr = ptr >>> 0;
    return getUint8ArrayMemory0().subarray(ptr / 1, ptr / 1 + len);
}

let cachedDataViewMemory0 = null;
function getDataViewMemory0() {
    if (cachedDataViewMemory0 === null || cachedDataViewMemory0.buffer.detached === true || (cachedDataViewMemory0.buffer.detached === undefined && cachedDataViewMemory0.buffer !== wasm.memory.buffer)) {
        cachedDataViewMemory0 = new DataView(wasm.memory.buffer);
    }
    return cachedDataViewMemory0;
}

function getStringFromWasm0(ptr, len) {
    ptr = ptr >>> 0;
    return decodeText(ptr, len);
}

let cachedUint8ArrayMemory0 = null;
function getUint8ArrayMemory0() {
    if (cachedUint8ArrayMemory0 === null || cachedUint8ArrayMemory0.byteLength === 0) {
        cachedUint8ArrayMemory0 = new Uint8Array(wasm.memory.buffer);
    }
    return cachedUint8ArrayMemory0;
}

function handleError(f, args) {
    try {
        return f.apply(this, args);
    } catch (e) {
        const idx = addToExternrefTable0(e);
        wasm.__wbindgen_exn_store(idx);
    }
}

function isLikeNone(x) {
    return x === undefined || x === null;
}

function passStringToWasm0(arg, malloc, realloc) {
    if (realloc === undefined) {
        const buf = cachedTextEncoder.encode(arg);
        const ptr = malloc(buf.length, 1) >>> 0;
        getUint8ArrayMemory0().subarray(ptr, ptr + buf.length).set(buf);
        WASM_VECTOR_LEN = buf.length;
        return ptr;
    }

    let len = arg.length;
    let ptr = malloc(len, 1) >>> 0;

    const mem = getUint8ArrayMemory0();

    let offset = 0;

    for (; offset < len; offset++) {
        const code = arg.charCodeAt(offset);
        if (code > 0x7F) break;
        mem[ptr + offset] = code;
    }
    if (offset !== len) {
        if (offset !== 0) {
            arg = arg.slice(offset);
        }
        ptr = realloc(ptr, len, len = offset + arg.length * 3, 1) >>> 0;
        const view = getUint8ArrayMemory0().subarray(ptr + offset, ptr + len);
        const ret = cachedTextEncoder.encodeInto(arg, view);

        offset += ret.written;
        ptr = realloc(ptr, len, offset, 1) >>> 0;
    }

    WASM_VECTOR_LEN = offset;
    return ptr;
}

function takeFromExternrefTable0(idx) {
    const value = wasm.__wbindgen_externrefs.get(idx);
    wasm.__externref_table_dealloc(idx);
    return value;
}

let cachedTextDecoder = new TextDecoder('utf-8', { ignoreBOM: true, fatal: true });
cachedTextDecoder.decode();
function decodeText(ptr, len) {
    return cachedTextDecoder.decode(getUint8ArrayMemory0().subarray(ptr, ptr + len));
}

const cachedTextEncoder = new TextEncoder();

if (!('encodeInto' in cachedTextEncoder)) {
    cachedTextEncoder.encodeInto = function (arg, view) {
        const buf = cachedTextEncoder.encode(arg);
        view.set(buf);
        return {
            read: arg.length,
            written: buf.length
        };
    };
}

let WASM_VECTOR_LEN = 0;

const wasmPath = `${__dirname}/csszyx_core_bg.wasm`;
const wasmBytes = require('fs').readFileSync(wasmPath);
const wasmModule = new WebAssembly.Module(wasmBytes);
const wasm = new WebAssembly.Instance(wasmModule, __wbg_get_imports()).exports;
wasm.__wbindgen_start();
