import { dirname, resolve } from "node:path"
import { fileURLToPath } from "node:url"
import { defineConfig } from "vitest/config"

const root = resolve(dirname(fileURLToPath(import.meta.url)), "../..")

export default defineConfig({
  resolve: {
    alias: {
      "@app/domain": resolve(root, "packages/domain/src"),
    },
  },
  test: {
    include: ["tests/**/*.test.ts"],
  },
})
