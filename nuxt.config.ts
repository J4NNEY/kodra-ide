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
  // Kudo is a single-page static app: it has no route rules and never calls
  // useAppManifest, so the app-manifest experiment only adds an SSR-only
  // `#app-manifest` import that Vite's client pre-transform cannot resolve on a
  // cold dev start. Turning it off keeps the dev log clean.
  experimental: { appManifest: false },
  telemetry: false
})
