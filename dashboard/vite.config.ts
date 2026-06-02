import path from "path"
import react from "@vitejs/plugin-react"
import { defineConfig } from "vite"

export default defineConfig({
  base: './',
  plugins: [react()],
  server: {
    port: Number(process.env.TARS_DASHBOARD_PORT ?? 62025),
    strictPort: true,
    host: 'localhost',
    proxy: {
      // tudo /api/* do dashboard vai pro backend TARS (62026),
      // que por sua vez faz proxy pras pontes (Yume, Kamui).
      // NÃO removemos o prefixo: o backend serve /api/tars/* e /api/kamui/* direto.
      '/api': {
        target: `http://127.0.0.1:${process.env.TARS_BACKEND_PORT ?? 62026}`,
        changeOrigin: true,
        timeout: 300000,
        proxyTimeout: 300000,
      },
    },
  },
  resolve: {
    alias: {
      "@": path.resolve(__dirname, "./src"),
    },
  },
});
