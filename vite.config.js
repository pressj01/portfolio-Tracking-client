import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'

export default defineConfig({
  plugins: [react()],
  server: {
    port: 5173,
    proxy: {
      '/api': {
        target: 'http://localhost:5001',
        // Long scanner force-refresh requests (500+ tickers × yfinance
        // rate-limited batches) can take ~5–10 minutes.  Bump both timeouts
        // — `timeout` is the socket read timeout to the target, and
        // `proxyTimeout` is how long http-proxy itself waits for the
        // backend response.  If either is short the proxy returns a
        // "<!doctype" HTML error page instead of the Flask JSON.
        timeout: 900000,       // 15 min
        proxyTimeout: 900000,  // 15 min
      },
    },
  },
  base: './',
  build: {
    outDir: 'dist',
  },
})
