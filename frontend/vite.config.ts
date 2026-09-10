import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

const apiPort = process.env.API_PORT ?? '4000';

export default defineConfig({
  plugins: [react()],
  server: {
    port: 5173,
    // Keeps the browser on a single origin; the API also enables CORS.
    proxy: { '/api': { target: `http://localhost:${apiPort}`, changeOrigin: true } },
  },
});
