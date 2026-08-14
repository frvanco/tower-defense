import { defineConfig } from 'vite';

// @tower-defense/data and @tower-defense/sim are workspace packages that export raw .ts source
// (no build step, see their package.json "main"/"exports"). Excluding them
// from the dep optimizer avoids pre-bundling assumptions meant for published
// npm packages and lets Vite's normal transform pipeline handle the TS directly.
export default defineConfig({
  optimizeDeps: {
    exclude: ['@tower-defense/data', '@tower-defense/sim'],
  },
  server: {
    port: 5173,
  },
});
