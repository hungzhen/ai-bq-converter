/// <reference types="vitest/config" />
import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import tailwindcss from '@tailwindcss/vite';

// One configuration file for both the app (Vite) and the automated tests (Vitest).
export default defineConfig({
  plugins: [react(), tailwindcss()],
  test: {
    // Tests run in Node. Screen (browser-like) tests are added in Stage 2H.
    environment: 'node',
    include: ['tests/**/*.test.ts', 'tests/**/*.test.tsx'],
    // Real documents live in tests/fixtures/private and must never be picked up as tests.
    exclude: ['node_modules', 'dist', 'tests/fixtures/private/**'],
  },
});
