import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

// Deployed under https://<user>.github.io/Yugioh/ — override with BASE_PATH when
// hosting elsewhere (e.g. BASE_PATH=/ for a custom domain).
const base = process.env.BASE_PATH ?? '/Yugioh/';

export default defineConfig({
  base,
  plugins: [react()],
  build: {
    target: 'es2022',
  },
});
