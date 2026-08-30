import react from '@vitejs/plugin-react'
import { defineConfig } from 'vite'

// https://vite.dev/config/
export default defineConfig({
  plugins: [react()],
  server: {
    host: '0.0.0.0',
    // Allow the Arena live-preview hostname (and any other host) so the app
    // can be opened from the preview environment.
    allowedHosts: true,
  },
})
