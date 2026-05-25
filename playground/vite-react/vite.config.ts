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
      build: {
        parser: 'oxc',
      },
      development: {
        debug: true,
      },
      production: {
        injectChecksum: true,
        mangleVars: true,
      },
    }),
    tailwindcss(),
    react(),
  ],
});
