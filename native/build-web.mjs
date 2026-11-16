import { build } from 'vite'
import react from '@vitejs/plugin-react'
// Loading the config through Vite's TS bundler walks outside the repository
// and fails on online-only Dropbox package/tsconfig placeholders in ancestors.
await build({
  configFile: false,
  base: './',
  css: { postcss: { plugins: [] } },
  plugins: [react()],
  build: { outDir: 'native-web', rollupOptions: { input: 'native.html', output: { format: 'iife', inlineDynamicImports: true } } },
})
