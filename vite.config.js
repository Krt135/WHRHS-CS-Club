import { defineConfig } from 'vite';

export default defineConfig({
  build: {
    rollupOptions: {
      input: {
        main: './index.html',
        events: './events.html',
        login: './login.html',
        account: './account.html',
        resources: './resources.html'
      }
    }
  }
});