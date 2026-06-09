import { expect, test } from "@effect/vitest"
import {
  matchesAkahuTransferRuleDescription,
  parseAkahuTransferRules,
} from "../src/Manager/AkahuCustomFields.ts"

test("skips blank transfer rule lines without reporting invalid lines", () => {
  const result = parseAkahuTransferRules("\n  \ncoffee,bank-2\n\t\n")

  expect(result.invalidLines).toEqual([])
  expect(result.rules.map((rule) => rule.keyword)).toEqual(["coffee"])
})

test("reports transfer rule lines with missing commas", () => {
  const result = parseAkahuTransferRules("coffee bank-2")

  expect(result.rules).toEqual([])
  expect(result.invalidLines).toEqual([
    { lineNumber: 1, line: "coffee bank-2", reason: "missingComma" },
  ])
})

test("reports transfer rule lines with blank keywords", () => {
  const result = parseAkahuTransferRules("  ,bank-2")

  expect(result.rules).toEqual([])
  expect(result.invalidLines).toEqual([
    { lineNumber: 1, line: "  ,bank-2", reason: "blankKeyword" },
  ])
})

test("reports transfer rule lines with blank destination account keys", () => {
  const result = parseAkahuTransferRules("coffee,  ")

  expect(result.rules).toEqual([])
  expect(result.invalidLines).toEqual([
    { lineNumber: 1, line: "coffee,  ", reason: "blankDestinationAccountKey" },
  ])
})

test("splits transfer rules on the first comma only", () => {
  const result = parseAkahuTransferRules("keyword,bank,key,with,commas")

  expect(result.invalidLines).toEqual([])
  expect(result.rules.map((rule) => rule.destinationAccountKey)).toEqual(["bank,key,with,commas"])
})

test("trims transfer rule keywords and destination account keys", () => {
  const result = parseAkahuTransferRules("  Coffee   Shop  ,  bank-2  ")

  expect(result.invalidLines).toEqual([])
  expect(result.rules).toMatchObject([
    {
      keyword: "Coffee   Shop",
      normalizedKeyword: "coffee shop",
      destinationAccountKey: "bank-2",
    },
  ])
})

test("de-duplicates valid transfer rules by normalized keyword and destination key", () => {
  const result = parseAkahuTransferRules(
    [
      "Coffee Shop,bank-2",
      " coffee   shop ,bank-2",
      "COFFEE SHOP,bank-3",
      "Coffee Shop,BANK-2",
    ].join("\n"),
  )

  expect(result.invalidLines).toEqual([])
  expect(
    result.rules.map((rule) => ({
      keyword: rule.keyword,
      normalizedKeyword: rule.normalizedKeyword,
      destinationAccountKey: rule.destinationAccountKey,
    })),
  ).toEqual([
    { keyword: "Coffee Shop", normalizedKeyword: "coffee shop", destinationAccountKey: "bank-2" },
    { keyword: "COFFEE SHOP", normalizedKeyword: "coffee shop", destinationAccountKey: "bank-3" },
    { keyword: "Coffee Shop", normalizedKeyword: "coffee shop", destinationAccountKey: "BANK-2" },
  ])
})

test("matches transfer rules against normalized transaction descriptions", () => {
  const [rule] = parseAkahuTransferRules("Coffee Shop,bank-2").rules

  expect(matchesAkahuTransferRuleDescription(rule, "Paid at COFFEE\n  SHOP today")).toBe(true)
  expect(matchesAkahuTransferRuleDescription(rule, "Paid at the coffee roaster")).toBe(false)
})
