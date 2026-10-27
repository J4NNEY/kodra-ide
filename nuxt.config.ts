// Nuxt configuration for Kudo (desktop SPA bundled into Tauri).
export default defineNuxtConfig({
  compatibilityDate: '2025-01-01',
  srcDir: 'app',
  ssr: false,
  devtools: { enabled: false },
  css: ['~/assets/css/main.css'],
  app: {
    baseURL: '/',
    head: {
      title: 'Kudo',
      meta: [
        { charset: 'utf-8' },
        { name: 'viewport', content: 'width=device-width, initial-scale=1' },
        { name: 'color-scheme', content: 'dark light' }
      ],
      link: [{ rel: 'icon', type: 'image/png', href: '/icon.png' }]
    }
  },
  nitro: {
    preset: 'static',
    prerender: { routes: ['/'] }
  },
  vite: {
    clearScreen: false,
    server: {
      strictPort: true,
      watch: { ignored: ['**/src-tauri/**'] }
    },
    optimizeDeps: {
      exclude: ['@tauri-apps/api']
    }
  },
  typescript: { strict: true },
  telemetry: false
})
