import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
import { VitePWA } from "vite-plugin-pwa";

export default defineConfig({
  plugins: [
    react(),
    VitePWA({
      registerType: "autoUpdate",
      injectRegister: "auto",
      includeAssets: ["icon-192.png", "icon-192.svg", "icon-512.png", "icon-512.svg"],
      manifest: false, // نستخدم public/manifest.json الموجود
      workbox: {
        globPatterns: ["**/*.{js,css,html,svg,png,ico,json,woff,woff2,webp}"],
        navigateFallback: "index.html",
        navigateFallbackDenylist: [/^\/api/],
        cleanupOutdatedCaches: true,
        clientsClaim: true,
        skipWaiting: true,
        runtimeCaching: [
          {
            urlPattern: /^https:\/\/fonts\.(?:googleapis|gstatic)\.com\/.*/i,
            handler: "CacheFirst",
            options: { cacheName: "google-fonts", expiration: { maxEntries: 30, maxAgeSeconds: 60 * 60 * 24 * 365 } },
          },
        ],
      },
    }),
  ],
  publicDir: "public",
  base: "./",
  build: { outDir: "dist", assetsDir: "assets" },
  server: { port: 3000, host: true },
});
