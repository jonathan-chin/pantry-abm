import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

export default defineConfig({
  plugins: [react()],
  base: './',
  // each map is a separate chunk of data, loaded only when that map is chosen
  build: { chunkSizeWarningLimit: 800 },
});
