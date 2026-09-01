import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import csszyx from 'csszyx/vite';

import tailwindcss from '@tailwindcss/vite';

// The policy a strict deployment enforces, mirrored here so a csszyx-owned
// inline script would fail `vite preview` (and the e2e CSP project) instead of
// a consumer's pen test. `script-src 'self'` is the gate; `style-src
// 'unsafe-inline'` only covers the playground's own inline `style` attributes.
const PRODUCTION_CSP =
  "default-src 'self'; script-src 'self'; style-src 'self' 'unsafe-inline'; img-src 'self' data:; connect-src 'self'";

export default defineConfig({
  resolve: {
    tsconfigPaths: false,
  },
  preview: {
    headers: { 'Content-Security-Policy': PRODUCTION_CSP },
  },
  plugins: [
    // IMPORTANT: csszyx must run BEFORE react plugin AND tailwindcss
    // csszyx transforms sz="" to className="" BEFORE JSX transformation
    // This allows Tailwind to scan the generated className strings
    ...csszyx({
      development: {
        debug: true,
      },
      production: {
        injectChecksum: true,
        mangle: process.env.CSSZYX_BENCH_MANGLE === '0' ? false : true,
        mangleVars: process.env.CSSZYX_BENCH_MANGLE_VARS === '0' ? false : true,
      },
    }),
    tailwindcss(),
    react(),
  ],
});
