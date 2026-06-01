import { expect, test } from "@effect/vitest"
import { managerApiPackageName } from "../src/index.ts"

test("exports the package name", () => {
  expect(managerApiPackageName).toBe("manager-api")
})
