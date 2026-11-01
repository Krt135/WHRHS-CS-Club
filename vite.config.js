import { defineConfig } from 'vite';

export default defineConfig({
  build: {
    rollupOptions: {
      input: {
        main: './index.html',
        about: './about.html',
        events: './events.html',
        login: './login.html',
        account: './account.html',
        resources: './resources.html',
        sponsors: './sponsors.html',
        admin: './admin.html',
        resetPassword: './reset-password.html'
      }
    }
  }
});
