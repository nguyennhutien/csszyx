import assert from 'node:assert/strict';
import test from 'node:test';

import { filterRustLcov } from './filter-rust-lcov.mjs';

test('removes inline test instrumentation while preserving production coverage', () => {
    const source = [
        'fn production() {}',
        '',
        '#[cfg(test)]',
        'mod tests {',
        '    fn test_only() {}',
        '}',
    ].join('\n');
    const input = `SF:/repo/packages/core/src/example.rs
FN:1,production
FN:5,test_only
FNDA:1,production
FNDA:1,test_only
FNF:2
FNH:2
DA:1,1
DA:3,0
DA:5,1
LF:3
LH:2
BRDA:1,0,0,1
BRDA:5,0,0,1
BRF:2
BRH:2
end_of_record
`;

    const output = filterRustLcov(input, () => source);

    assert.match(output, /FN:1,production/);
    assert.doesNotMatch(output, /test_only/);
    assert.match(output, /DA:1,1/);
    assert.doesNotMatch(output, /DA:3,0/);
    assert.doesNotMatch(output, /DA:5,1/);
    assert.match(output, /FNF:1\nFNH:1\nLF:1\nLH:1\nBRF:1\nBRH:1/);
});

test('leaves non-core and files without an inline test module unchanged', () => {
    const input = `SF:/repo/packages/other/src/example.rs
DA:1,0
LF:1
LH:0
end_of_record
`;

    assert.equal(filterRustLcov(input), input);
});

test('removes only explicitly marked WASM adapters from native coverage', () => {
    const source = [
        'fn native_before() {}',
        '// coverage:wasm-only:start',
        'fn wasm_adapter() {}',
        '// coverage:wasm-only:end',
        'fn native_after() {}',
    ].join('\n');
    const input = `SF:/repo/packages/core/src/example.rs
FN:1,native_before
FN:3,wasm_adapter
FN:5,native_after
FNDA:1,native_before
FNDA:0,wasm_adapter
FNDA:1,native_after
DA:1,1
DA:3,0
DA:5,1
BRDA:3,0,0,-
end_of_record
`;

    const output = filterRustLcov(input, () => source);

    assert.match(output, /native_before/);
    assert.match(output, /native_after/);
    assert.doesNotMatch(output, /wasm_adapter/);
    assert.doesNotMatch(output, /DA:3,0/);
    assert.match(output, /FNF:2\nFNH:2\nLF:2\nLH:2\nBRF:0\nBRH:0/);
});

test('fails closed when WASM coverage markers are unbalanced', () => {
    const source = ['fn native() {}', '// coverage:wasm-only:start', 'fn still_native() {}'].join(
        '\n',
    );
    const input = `SF:/repo/packages/core/src/example.rs
DA:1,1
DA:3,0
LF:2
LH:1
end_of_record
`;

    assert.equal(
        filterRustLcov(input, () => source),
        input,
    );
});

test('names the stale-report cause when a covered source file is gone', () => {
    const input = `SF:/elsewhere/csszyx/packages/core/src/example.rs
DA:1,1
LF:1
LH:1
end_of_record
`;
    const missing = () => {
        throw Object.assign(new Error('ENOENT'), { code: 'ENOENT' });
    };

    assert.throws(
        () => filterRustLcov(input, missing),
        error =>
            /\/elsewhere\/csszyx\/packages\/core\/src\/example\.rs/.test(error.message) &&
            /target\/llvm-cov-target/.test(error.message),
    );
});
