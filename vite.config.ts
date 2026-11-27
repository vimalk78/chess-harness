import { copyFileSync, existsSync, mkdirSync, statSync } from 'node:fs'
import { join } from 'node:path'
import react from '@vitejs/plugin-react'
import { defineConfig, type Plugin } from 'vite'

// The Stockfish engine (GPL-3.0) the "Chess engine" agents run in a Web Worker: the lite,
// single-threaded build, which needs no special server headers (GitHub Pages can't set them).
// Copied from the stockfish package into public/engine/ (not committed) on dev and build.
function stockfishEngine(): Plugin {
  const files = ['stockfish-19-lite-single.js', 'stockfish-19-lite-single.wasm', '../Copying.txt']
  return {
    name: 'stockfish-engine',
    config() {
      const from = 'node_modules/stockfish/bin'
      const to = 'public/engine'
      mkdirSync(to, { recursive: true })
      for (const f of files) {
        const src = join(from, f)
        const dest = join(to, f.replace('../', ''))
        if (!existsSync(dest) || statSync(dest).size !== statSync(src).size) copyFileSync(src, dest)
      }
    },
  }
}

// https://vite.dev/config/
export default defineConfig({
  plugins: [react(), stockfishEngine()],
  // Relative asset paths, so the same build works at a domain root or under a
  // sub-path (GitHub Pages: /chess-harness/).
  base: './',
  // The commit the site was built from (GitHub Actions sets GITHUB_SHA), recorded in
  // submitted results so a game can be matched to the prompts and blocks it used.
  define: {
    __ARENA_VERSION__: JSON.stringify(process.env.GITHUB_SHA?.slice(0, 7) ?? 'dev'),
  },
})
