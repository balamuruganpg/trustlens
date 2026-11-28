import tailwindcss from '@tailwindcss/vite'
import react from '@vitejs/plugin-react'
import { defineConfig } from 'vite'

// Browser calls same-origin /api. Vite forwards them to the FastAPI server.
export default defineConfig({
  plugins: [tailwindcss(), react()],
  server: {
    allowedHosts: ['.trycloudflare.com'],
    proxy: {
      '/api': 'http://localhost:8000',
    },
  },
})
