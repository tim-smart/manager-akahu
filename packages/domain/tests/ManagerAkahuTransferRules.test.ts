import { expect, test } from "@effect/vitest"
import {
  buildLinkedAccountTransferRules,
  matchesAkahuTransferRuleDescription,
  type ManagerAkahuTransferRuleAccountMetadata,
  parseAkahuTransferRules,
} from "../src/Manager/AkahuCustomFields.ts"

const checkingAccount: ManagerAkahuTransferRuleAccountMetadata = {
  key: "manager-checking",
  name: "Manager Checking",
  currency: null,
  canHavePendingTransactions: true,
}

const savingsAccount: ManagerAkahuTransferRuleAccountMetadata = {
  key: "manager-savings",
  name: "Manager Savings",
  currency: "NZD",
  canHavePendingTransactions: false,
}

const managerAccountsByKey: ReadonlyMap<string, ManagerAkahuTransferRuleAccountMetadata> = new Map([
  [checkingAccount.key, checkingAccount],
  [savingsAccount.key, savingsAccount],
])

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

test("builds linked-account transfer rules with source and destination metadata", () => {
  const result = buildLinkedAccountTransferRules({
    sourceAccount: checkingAccount,
    rawValue: "  Coffee   Shop  ,  manager-savings  ",
    managerAccountsByKey,
  })

  expect(result.warnings).toEqual([])
  expect(result.skippedRules).toEqual([])
  expect(result.rules).toMatchObject([
    {
      sourceAccountKey: "manager-checking",
      sourceAccountName: "Manager Checking",
      sourceAccountCurrency: null,
      sourceAccountCanHavePendingTransactions: true,
      keyword: "Coffee   Shop",
      normalizedKeyword: "coffee shop",
      destinationAccountKey: "manager-savings",
      destinationAccountName: "Manager Savings",
      destinationAccountCurrency: "NZD",
      destinationAccountCanHavePendingTransactions: false,
    },
  ])
})

test("skips linked-account transfer rules with invalid destination keys", () => {
  const result = buildLinkedAccountTransferRules({
    sourceAccount: checkingAccount,
    rawValue: "Rent,manager-missing",
    managerAccountsByKey,
  })

  expect(result.rules).toEqual([])
  expect(result.warnings).toEqual([
    'Transfer rule "Rent" targets unknown Manager bank/cash account key manager-missing and was skipped.',
  ])
  expect(result.skippedRules).toMatchObject([
    {
      reason: "unknownDestinationAccountKey",
      warning:
        'Transfer rule "Rent" targets unknown Manager bank/cash account key manager-missing and was skipped.',
      rule: {
        keyword: "Rent",
        normalizedKeyword: "rent",
        destinationAccountKey: "manager-missing",
      },
    },
  ])
})

test("skips linked-account transfer rules targeting the source account", () => {
  const result = buildLinkedAccountTransferRules({
    sourceAccount: checkingAccount,
    rawValue: "Self,manager-checking",
    managerAccountsByKey,
  })

  expect(result.rules).toEqual([])
  expect(result.warnings).toEqual([
    'Transfer rule "Self" targets its own Manager bank/cash account and was skipped.',
  ])
  expect(result.skippedRules).toMatchObject([
    {
      reason: "selfTarget",
      warning: 'Transfer rule "Self" targets its own Manager bank/cash account and was skipped.',
      rule: {
        keyword: "Self",
        normalizedKeyword: "self",
        destinationAccountKey: "manager-checking",
      },
    },
  ])
})

test("de-duplicates linked-account transfer rules by normalized keyword and exact destination key", () => {
  const result = buildLinkedAccountTransferRules({
    sourceAccount: checkingAccount,
    rawValue: [
      "Coffee Shop,manager-savings",
      " coffee   shop ,manager-savings",
      "COFFEE SHOP,MANAGER-SAVINGS",
    ].join("\n"),
    managerAccountsByKey,
  })

  expect(result.warnings).toEqual([
    'Transfer rule "COFFEE SHOP" targets unknown Manager bank/cash account key MANAGER-SAVINGS and was skipped.',
  ])
  expect(result.rules.map((rule) => rule.destinationAccountKey)).toEqual(["manager-savings"])
})

test("preserves linked-account transfer rule warning text", () => {
  const result = buildLinkedAccountTransferRules({
    sourceAccount: checkingAccount,
    rawValue: ["missing comma", "  ,manager-savings", "Coffee,  "].join("\n"),
    managerAccountsByKey,
  })

  expect(result.rules).toEqual([])
  expect(result.warnings).toEqual([
    "Transfer rule line 1 must use keyword,destination account key and was skipped.",
    "Transfer rule line 2 has a blank keyword and was skipped.",
    "Transfer rule line 3 has a blank destination account key and was skipped.",
  ])
})
