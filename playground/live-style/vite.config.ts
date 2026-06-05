import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import csszyx from 'csszyx/vite';
import tailwindcss from '@tailwindcss/vite';

export default defineConfig({
    resolve: {
        tsconfigPaths: false,
    },
    plugins: [
        // csszyx MUST come before tailwindcss
        ...csszyx(),
        tailwindcss(),
        react(),
    ],
});
