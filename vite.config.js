import { defineConfig } from 'vite';

export default defineConfig({
  build: {
    rollupOptions: {
      input: {
        main: './index.html',
        projects: './projects.html',
        events: './events.html',
        login: './login.html',
        account: './account.html',
        resources: './resources.html',
        sponsors: './sponsors.html',
        admin: './admin.html',
        play: './play.html'
      }
    }
  }
});
