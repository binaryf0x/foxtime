import { defineConfig } from 'vite';
import checker from 'vite-plugin-checker'

export default defineConfig({
  root: 'web',
  build: {
    outDir: '../dist',
    emptyOutDir: true,
  },
  plugins: [
    checker({
      typescript: true,
    }),
  ],
});
