import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'
export default defineConfig({ base: './', plugins: [react()], build: { outDir: 'native-web', rollupOptions: { input: 'native.html', output: { format: 'iife', inlineDynamicImports: true } } } })
