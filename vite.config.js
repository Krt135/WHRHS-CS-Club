import { defineConfig } from 'vite';

export default defineConfig({
  build: {
    rollupOptions: {
      input: {
        main: './index.html',
        events: './events.html',
        login: './login.html',
        signup: './sign-up.html'
      }
    }
  }
});