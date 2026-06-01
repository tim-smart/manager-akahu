import tailwindcss from "@tailwindcss/vite"
import react from "@vitejs/plugin-react"
import fs from "node:fs"
import { fileURLToPath } from "node:url"
import { defineConfig } from "vite-plus"

const srcPath = fileURLToPath(new URL("./src", import.meta.url))
const domainSrcPath = fileURLToPath(new URL("../../packages/domain/src", import.meta.url))
const managerApiSrcPath = fileURLToPath(new URL("../../packages/manager-api/src", import.meta.url))
const localhostKeyPath = fileURLToPath(new URL("./.cert/localhost-key.pem", import.meta.url))
const localhostCertPath = fileURLToPath(new URL("./.cert/localhost.pem", import.meta.url))

const readDevHttpsCertificates = () => {
  if (!fs.existsSync(localhostKeyPath) || !fs.existsSync(localhostCertPath)) {
    return undefined
  }

  return {
    key: fs.readFileSync(localhostKeyPath),
    cert: fs.readFileSync(localhostCertPath),
  }
}

export default defineConfig(({ command }) => {
  const https = command === "serve" ? readDevHttpsCertificates() : undefined

  return {
    plugins: [react(), tailwindcss()],
    resolve: {
      alias: {
        "@": srcPath,
        "@app/domain": domainSrcPath,
        "@app/manager-api": managerApiSrcPath,
      },
    },
    server: {
      ...(https === undefined ? {} : { https }),
      proxy: {
        "/rpc": {
          target: "http://localhost:3000",
          changeOrigin: true,
          ws: true,
        },
      },
    },
  }
})
