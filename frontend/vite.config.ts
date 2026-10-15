import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

export default defineConfig({
  plugins: [react()],
  // Stamped into the bundle at build time so the version badge / changelog page can show exactly
  // when the running build was produced — a signal that stays accurate on its own instead of a
  // hand-maintained date someone forgets to bump.
  define: {
    __BUILD_TIME__: JSON.stringify(new Date().toISOString()),
  },
  server: {
    proxy: {
      '/api': {
        target: 'http://localhost:3000',
        changeOrigin: true,
      },
    },
  },
});
