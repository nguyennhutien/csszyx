import {
    init,
    transform_sz,
    compute_mangle_checksum,
    encode,
    generate_token
} from '../pkg/csszyx_core.js';

async function runExamples() {
    // 1. Initialize WASM (already called automatically by wasm-bindgen start)
    // init();

    // 2. Transformer Examples
    console.log('--- Transformer ---');
    const styles = {
        p: 4,
        m: -2,
        bg: 'blue-500/80',
        hover: {
            scale: 110,
            text: 'white'
        }
    };
    console.log('Input:', JSON.stringify(styles, null, 2));
    console.log('Output:', transform_sz(styles));
    // Output: p-4 -m-2 bg-blue-500/80 hover:scale-110 hover:text-white

    // 3. Encoder Examples
    console.log('\n--- Encoder ---');
    [0, 1, 25, 26, 51, 52, 572].forEach(i => {
        console.log(`Index ${i} -> ${encode(i)}`);
    });
    // Expected: z, y, a, Z, A, z9, zz

    // 4. Mangle Checksum Examples
    console.log('\n--- Mangle Checksum ---');
    const mangleMap = {
        'p-4': 'z',
        'bg-blue-500/80': 'y'
    };
    const checksum = compute_mangle_checksum(mangleMap);
    console.log('Checksum:', checksum);

    // 5. Token Generation (Recovery)
    console.log('\n--- Security Tokens ---');
    const token = generate_token(
        'DataTable',
        '/src/components/DataTable.tsx',
        42,
        8,
        'csr',
        'build-hash-123'
    );
    console.log('Recovery Token:', token);
}

runExamples().catch(console.error);
