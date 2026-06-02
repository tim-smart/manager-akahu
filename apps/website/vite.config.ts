import tailwindcss from "@tailwindcss/vite"
import react from "@vitejs/plugin-react"
import { fileURLToPath } from "node:url"
import { defineConfig } from "vite-plus"
import fs from "node:fs"
import path from "node:path"

const srcPath = fileURLToPath(new URL("./src", import.meta.url))

export default defineConfig({
  plugins: [react(), tailwindcss()],
  resolve: {
    alias: {
      "@": srcPath,
    },
  },
  server: {
    https: {
      key: fs.readFileSync(path.resolve(__dirname, ".cert/localhost-key.pem")),
      cert: fs.readFileSync(path.resolve(__dirname, ".cert/localhost.pem")),
    },
    proxy: {
      "/rpc": {
        target: "http://localhost:3000",
        changeOrigin: true,
        ws: true,
      },
    },
  },
})
