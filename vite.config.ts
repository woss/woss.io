import { sveltekit } from '@sveltejs/kit/vite';
import tailwindcss from '@tailwindcss/vite';
import { defineConfig } from 'vite';
import { resolve } from 'node:path';

export default defineConfig({
  plugins: [tailwindcss(), sveltekit()],
  resolve: {
    alias: {
      $lib: resolve('./src/lib'),
    },
  },
  server: {
    host: '0.0.0.0',
  },
  ssr: {
    // noExternal: ['sv5ui'],
    // external: ['node:sqlite'],
  },
  build: {
    minify: 'oxc',
    cssMinify: 'lightningcss',
  },
});
