import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

export default defineConfig({
  plugins: [react()],
  build: {
    // Sem mapas de código-fonte em produção: não expõe o código comentado.
    sourcemap: false,
    target: 'es2022',
  },
  server: {
    headers: {
      'X-Frame-Options': 'DENY',
      'Referrer-Policy': 'no-referrer',
    },
  },
});
