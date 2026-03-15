import { defineConfig, loadEnv } from 'vite'
import react from '@vitejs/plugin-react'
import path from 'path'

export default defineConfig(({ mode }) => {
  const env = loadEnv(mode, process.cwd(), ['VITE_', 'CF_'])
  
  return {
    plugins: [
      react(),
      {
        name: 'config-js-env',
        configureServer(server) {
          server.middlewares.use((req, res, next) => {
            if (req.url === '/config.js') {
              const config = `window.__ENV__ = {
  CF_TURNSTILE_SITE_KEY: "${env.CF_TURNSTILE_SITE_KEY || ''}"
};`
              res.setHeader('Content-Type', 'application/javascript')
              res.end(config)
              return
            }
            next()
          })
        }
      }
    ],
    envPrefix: ['VITE_', 'CF_'],
    resolve: {
      alias: {
        '@': path.resolve(__dirname, './src'),
      },
    },
    server: {
      port: parseInt(env.VITE_PORT || '3000'),
      strictPort: true,
      proxy: {
        '/api': {
          target: 'http://localhost:3001',
          changeOrigin: true,
        },
      },
      allowedHosts: ['localhost'],
    },
  }
})
