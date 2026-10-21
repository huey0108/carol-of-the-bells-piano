import { defineConfig } from 'vite';

export default defineConfig({
  base: process.env.BASE_PATH ?? '/carol-of-the-bells-piano/',
  build: { target: 'es2022', chunkSizeWarningLimit: 900 },
});
