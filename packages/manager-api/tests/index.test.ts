import { expect, test } from "vite-plus/test";
import { managerApiPackageName } from "../src/index.ts";

test("exports the package name", () => {
  expect(managerApiPackageName).toBe("manager-api");
});
