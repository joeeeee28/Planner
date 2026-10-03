import react from '@vitejs/plugin-react'
import { defineConfig } from 'vite'

// https://vite.dev/config/
export default defineConfig({
  base: './',
  plugins: [react()],
  define: {
    __APP_VERSION__: JSON.stringify('V5.0-RC'),
    __BUILD_COMMIT__: JSON.stringify(process.env.VITE_COMMIT_HASH || '37be7e7'),
  },
  server: {
    host: '0.0.0.0',
    // Allow the Arena live-preview hostname (and any other host) so the app
    // can be opened from the preview environment.
    allowedHosts: true,
  },
})
