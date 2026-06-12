import { defineConfig } from 'vite';

export default defineConfig({
  build: {
    rollupOptions: {
      input: {
        main: './index.html',
        events: './events.html',
        auth: './auth.html' // Adjust path if auth.html is inside a folder
      }
    }
  }
});