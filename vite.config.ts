import react from '@vitejs/plugin-react'
import { defineConfig } from 'vite'

// https://vite.dev/config/
export default defineConfig({
  plugins: [react()],
  // Relative asset paths, so the same build works at a domain root or under a
  // sub-path (GitHub Pages: /chess-harness/).
  base: './',
  // The commit the site was built from (GitHub Actions sets GITHUB_SHA), recorded in
  // submitted results so a game can be matched to the prompts and blocks it used.
  define: {
    __ARENA_VERSION__: JSON.stringify(process.env.GITHUB_SHA?.slice(0, 7) ?? 'dev'),
  },
})
