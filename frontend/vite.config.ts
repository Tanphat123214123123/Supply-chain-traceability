import { spawn } from 'child_process'
import { existsSync } from 'fs'
import { defineConfig, Plugin } from 'vite'
import react from '@vitejs/plugin-react'

const EDGE_PATHS = [
  'C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe',
  'C:\\Program Files\\Microsoft\\Edge\\Application\\msedge.exe',
]

/**
 * Spawns Edge directly as its own OS process on server start, instead of
 * relying on a clicked terminal link — clicking the printed localhost link
 * inside VS Code can get intercepted by its built-in "Simple Browser" preview
 * instead of launching a real browser window, regardless of editor settings.
 * A direct child_process spawn bypasses that entirely.
 */
function openInEdge(): Plugin {
  return {
    name: 'open-in-edge',
    configureServer(server) {
      server.httpServer?.once('listening', () => {
        const url = `http://localhost:${server.config.server.port ?? 5173}/`
        const edgePath = EDGE_PATHS.find((p) => existsSync(p))
        if (edgePath) {
          spawn(edgePath, [url], { detached: true, stdio: 'ignore' }).unref()
        } else {
          console.warn('[open-in-edge] Could not find msedge.exe, skipping auto-open.')
        }
      })
    },
  }
}

export default defineConfig({
  plugins: [react(), openInEdge()],
  server: {
    port: 5173,
    proxy: {
      '/api': {
        target: 'http://localhost:3000',
        changeOrigin: true,
      },
      '/socket.io': {
        target: 'http://localhost:3000',
        ws: true,
        changeOrigin: true,
      },
    },
  },
})
