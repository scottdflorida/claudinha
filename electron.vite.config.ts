import { defineConfig, externalizeDepsPlugin } from 'electron-vite'
import react from '@vitejs/plugin-react'
import { resolve } from 'path'

export default defineConfig({
  main: {
    plugins: [externalizeDepsPlugin()],
    define: {
      // Injected at build time from CI env var — empty string = analytics disabled
      __POSTHOG_API_KEY__: JSON.stringify(process.env.POSTHOG_API_KEY ?? ''),
      __POSTHOG_HOST__: JSON.stringify(process.env.POSTHOG_HOST ?? 'https://us.i.posthog.com')
    }
  },
  preload: {
    plugins: [externalizeDepsPlugin()]
  },
  renderer: {
    resolve: {
      alias: {
        '@renderer': resolve('src/renderer')
      }
    },
    plugins: [react()]
  }
})
