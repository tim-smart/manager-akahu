import { fileURLToPath } from "node:url"
import { defineConfig } from "vite-plus"

const domainSrcPath = fileURLToPath(new URL("../domain/src", import.meta.url))

export default defineConfig({
  resolve: {
    alias: {
      "@app/domain": domainSrcPath,
    },
  },
  pack: {
    dts: {
      tsgo: true,
    },
    exports: true,
  },
  lint: {
    options: {
      typeAware: true,
      typeCheck: true,
    },
  },
  fmt: {},
})
