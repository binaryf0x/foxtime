import { defineConfig } from 'vite';
import checker from 'vite-plugin-checker'
import { resolve } from 'path'

export default defineConfig({
  root: 'web',
  build: {
    outDir: '../dist',
    emptyOutDir: true,
    rollupOptions: {
      input: {
        main: resolve(__dirname, 'web/index.html'),
        countdown: resolve(__dirname, 'web/countdown.html'),
      },
    },
  },
  plugins: [
    checker({
      typescript: true,
    }),
  ],
});
