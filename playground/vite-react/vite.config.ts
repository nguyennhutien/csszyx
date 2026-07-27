import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import csszyx from 'csszyx/vite';

import tailwindcss from '@tailwindcss/vite';

export default defineConfig({
  resolve: {
    tsconfigPaths: false,
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
        ...(process.env.CSSZYX_BENCH_MAP_DELIVERY
          ? { mangleMapDelivery: process.env.CSSZYX_BENCH_MAP_DELIVERY as 'both' | 'html' | 'bundle' }
          : {}),
        mangleVars: process.env.CSSZYX_BENCH_MANGLE_VARS === '0' ? false : true,
      },
    }),
    tailwindcss(),
    react(),
  ],
});
