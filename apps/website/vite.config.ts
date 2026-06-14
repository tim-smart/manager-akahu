import tailwindcss from "@tailwindcss/vite"
import react from "@vitejs/plugin-react"
import { execFileSync } from "node:child_process"
import fs from "node:fs"
import process from "node:process"
import { fileURLToPath } from "node:url"
import { defineConfig } from "vite-plus"

const workspacePath = fileURLToPath(new URL("../../", import.meta.url))
const websitePackageJsonPath = fileURLToPath(new URL("./package.json", import.meta.url))
const srcPath = fileURLToPath(new URL("./src", import.meta.url))
const domainSrcPath = fileURLToPath(new URL("../../packages/domain/src", import.meta.url))
const managerApiSrcPath = fileURLToPath(new URL("../../packages/manager-api/src", import.meta.url))
const localhostKeyPath = fileURLToPath(new URL("./.cert/localhost-key.pem", import.meta.url))
const localhostCertPath = fileURLToPath(new URL("./.cert/localhost.pem", import.meta.url))

const websitePackageJson = JSON.parse(fs.readFileSync(websitePackageJsonPath, "utf8")) as {
  readonly version: string
}

const normalizeRevision = (revision: string) => {
  const trimmed = revision.trim()

  return trimmed === "" ? undefined : trimmed.slice(0, 12)
}

const readGitRevision = () => {
  try {
    return normalizeRevision(
      execFileSync("git", ["rev-parse", "--short=12", "HEAD"], {
        cwd: workspacePath,
        encoding: "utf8",
        stdio: ["ignore", "pipe", "ignore"],
      }),
    )
  } catch {
    return undefined
  }
}

const readBuildRevision = () =>
  normalizeRevision(process.env.APP_BUILD_REVISION ?? process.env.GITHUB_SHA ?? "") ??
  readGitRevision()

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
  const revision = readBuildRevision()
  const buildVersion =
    revision === undefined
      ? websitePackageJson.version
      : `${websitePackageJson.version} (${revision})`

  return {
    plugins: [react(), tailwindcss()],
    define: {
      "import.meta.env.VITE_APP_BUILD_VERSION": JSON.stringify(buildVersion),
    },
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
