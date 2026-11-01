import { defineConfig } from 'vite';

// The Arcade's own build, served from projects.whrhs-cs-club.com by a separate
// Vercel project (see arcade/vercel.json).
export default defineConfig({
  define: {
    'import.meta.env.VITE_SITE_TARGET': JSON.stringify('arcade')
  },
  build: {
    outDir: 'arcade/dist',
    rollupOptions: {
      input: {
        projects: './projects.html',
        play: './play.html',
        arcadeAdmin: './arcade-admin.html',
        login: './login.html'
      }
    }
  }
});
