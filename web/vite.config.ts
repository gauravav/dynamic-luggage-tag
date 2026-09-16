import { defineConfig, type Plugin } from 'vite'
import react from '@vitejs/plugin-react'

/**
 * Serves the Content-Security-Policy as a response header.
 *
 * A <meta> policy would be simpler, but it silently ignores `frame-ancestors`
 * — so the clickjacking rule would not apply at all — and it takes effect
 * mid-parse, which blocks the inline module preamble Vite injects in
 * development and leaves a blank page in browsers that enforce it strictly.
 *
 * The development policy is looser than production in exactly two places: it
 * allows that inline preamble, and it allows the HMR websocket. The build
 * emits no inline script at all, so production needs neither.
 */
function csp(): Plugin {
  const shared = [
    "default-src 'self'",
    // React sets inline style attributes, and the tag artwork computes its
    // fills, so styles need 'unsafe-inline'. Scripts do not.
    "style-src 'self' 'unsafe-inline' https://fonts.googleapis.com",
    "font-src 'self' https://fonts.gstatic.com",
    "img-src 'self' data:",
    "frame-ancestors 'none'",
    "base-uri 'none'",
    "form-action 'self'",
    "object-src 'none'",
  ]
  const development = [
    ...shared,
    "script-src 'self' 'unsafe-inline'",
    // Some browsers do not treat 'self' as covering ws: on the same origin.
    "connect-src 'self' ws://localhost:* ws://127.0.0.1:*",
  ].join('; ')
  const production = [...shared, "script-src 'self'", "connect-src 'self'"].join('; ')

  const apply = (policy: string) => (server: { middlewares: Connect }) => {
    server.middlewares.use((_request, response, next) => {
      response.setHeader('Content-Security-Policy', policy)
      response.setHeader('X-Content-Type-Options', 'nosniff')
      response.setHeader('Referrer-Policy', 'no-referrer')
      next()
    })
  }

  return {
    name: 'dlt-csp-headers',
    configureServer: apply(development),
    configurePreviewServer: apply(production),
  }
}

/** Minimal shape of the connect instance Vite exposes. */
type Connect = {
  use: (fn: (req: unknown, res: { setHeader: (k: string, v: string) => void }, next: () => void) => void) => void
}

// The dev server proxies /api to Flask rather than calling it cross-origin.
// That keeps the browser on a single origin, which is what makes
// SameSite=Strict session cookies work in development exactly as they do in
// production behind one domain — no CORS exception, no relaxed cookie policy.
export default defineConfig({
  plugins: [react(), csp()],
  server: {
    port: 5173,
    strictPort: true,
    proxy: {
      '/api': {
        target: process.env.VITE_API_TARGET ?? 'http://127.0.0.1:5001',
        // changeOrigin stays false so the Host and Origin headers still say
        // localhost:5173; the API's CSRF origin check reads them.
        changeOrigin: false,
      },
    },
  },
  build: {
    outDir: 'dist',
    sourcemap: false,
    target: 'es2022',
  },
})
