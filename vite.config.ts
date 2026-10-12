import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
import tailwind from "@tailwindcss/vite";
import { VitePWA } from "vite-plugin-pwa";
export default defineConfig({
  base: process.env.VITE_BASE_PATH || "./",
  plugins: [
    react(),
    tailwind(),
    VitePWA({
      registerType: "prompt",
      includeAssets: ["icons/*.png", "splash/*.png"],
      manifest: {
        name: "私记 · 本地记录",
        short_name: "私记",
        description: "只留在你设备里的私人照片与时间记录",
        lang: "zh-CN",
        start_url: "./",
        scope: "./",
        display: "standalone",
        background_color: "#f6f7f9",
        theme_color: "#f6f7f9",
        icons: [
          {
            src: "icons/icon-192.png",
            sizes: "192x192",
            type: "image/png",
            purpose: "any",
          },
          {
            src: "icons/icon-512.png",
            sizes: "512x512",
            type: "image/png",
            purpose: "any",
          },
          {
            src: "icons/maskable-512.png",
            sizes: "512x512",
            type: "image/png",
            purpose: "maskable",
          },
        ],
      },
      workbox: {
        globPatterns: ["**/*.{js,css,html,png,webmanifest}"],
        maximumFileSizeToCacheInBytes: 8 * 1024 * 1024,
        cleanupOutdatedCaches: true,
        runtimeCaching: [],
        navigateFallback: "index.html",
      },
    }),
  ],
  build: { target: "es2022", chunkSizeWarningLimit: 1600 },
});
