import {
  AkahuTransactionDate,
  type AkahuTransactionDate as AkahuTransactionDateValue,
} from "@app/domain/Akahu"
import { BigDecimal, Schema } from "effect"
import { expect, test } from "@effect/vitest"
import type { ManagerPaymentItem, ManagerReceiptItem } from "../src/index.ts"
import {
  addManagerAkahuSyncSummaryCounts,
  buildAkahuPendingTransactionFingerprint,
  buildManagerBankOrCashAccountSyncRead,
  classifyManagerAkahuSuspenseImport,
  decidePendingExactFingerprint,
  decidePendingToSettledMatch,
  decideSettledDuplicateByAkahuTransactionId,
  emptyManagerAkahuSyncSummaryCounts,
  incrementManagerAkahuSyncSummaryCount,
  managerAkahuPendingFingerprintPrefix,
  managerAkahuSyncSummaryCountKeys,
  normalizeAkahuTransactionDescription,
  normalizeManagerAkahuAmount,
} from "../src/index.ts"

const bankOrCashAccountKey = "bank-1"

const akahuDate = (date: string) => Schema.decodeSync(AkahuTransactionDate)(date)

const unsafeAkahuDateForTest = (date: {
  readonly raw: string
  readonly calendarDate: string
}): AkahuTransactionDateValue => date as unknown as AkahuTransactionDateValue

const inconsistentStructuralAkahuDate: AkahuTransactionDateValue = {
  raw: "2026-06-05T00:30:00.000+13:00",
  // @ts-expect-error AkahuTransactionDate values must come from the domain decoder.
  calendarDate: "not-a-date",
}
void inconsistentStructuralAkahuDate

const receiptItem = (key: string, item: ManagerReceiptItem["item"]): ManagerReceiptItem => ({
  key,
  item,
  _links: null,
  _actions: null,
})

const paymentItem = (key: string, item: ManagerPaymentItem["item"]): ManagerPaymentItem => ({
  key,
  item,
  _links: null,
  _actions: null,
})

const managerSyncRead = (input: {
  readonly receipts?: ReadonlyArray<ManagerReceiptItem>
  readonly payments?: ReadonlyArray<ManagerPaymentItem>
}) =>
  buildManagerBankOrCashAccountSyncRead({
    bankOrCashAccountKey,
    receipts: input.receipts ?? [],
    payments: input.payments ?? [],
  })

const pendingReceipt = (
  key: string,
  options: {
    readonly fdxTransactionId?: string
    readonly date?: string
    readonly amount?: string
    readonly description?: string
    readonly bankOrCashAccountKey?: string
  } = {},
) =>
  receiptItem(key, {
    fdxTransactionId:
      options.fdxTransactionId ??
      `${managerAkahuPendingFingerprintPrefix}acc:2026-06-04:12.34:coffee shop`,
    date: options.date ?? "2026-06-04",
    receivedIn: options.bankOrCashAccountKey ?? bankOrCashAccountKey,
    description: options.description ?? "Coffee Shop",
    lines: [
      { amount: options.amount ?? "12.34", lineDescription: options.description ?? "Coffee Shop" },
    ],
  })

const pendingPayment = (
  key: string,
  options: {
    readonly fdxTransactionId?: string
    readonly date?: string
    readonly amount?: string
    readonly description?: string
    readonly bankOrCashAccountKey?: string
  } = {},
) =>
  paymentItem(key, {
    fdxTransactionId:
      options.fdxTransactionId ??
      `${managerAkahuPendingFingerprintPrefix}acc:2026-06-04:-9.99:shop`,
    date: options.date ?? "2026-06-04",
    paidFrom: options.bankOrCashAccountKey ?? bankOrCashAccountKey,
    description: options.description ?? "Shop",
    lines: [{ amount: options.amount ?? "9.99", lineDescription: options.description ?? "Shop" }],
  })

test("decoded Akahu transaction dates preserve raw strings and expose Manager calendar dates", () => {
  const offsetDate = akahuDate("2026-06-05T00:30:00.000+13:00")
  expect(offsetDate).toMatchObject({
    raw: "2026-06-05T00:30:00.000+13:00",
    calendarDate: "2026-06-05",
  })
  expect(akahuDate("2026-06-04T23:30:00.000-10:00").calendarDate).toBe("2026-06-04")
  expect(akahuDate("2026-06-05")).toMatchObject({
    raw: "2026-06-05",
    calendarDate: "2026-06-05",
  })
})

test("manager sync helpers only accept inconsistent structural Akahu dates through an explicit test escape hatch", () => {
  const inconsistent = unsafeAkahuDateForTest({
    raw: "2026-06-05T00:30:00.000+13:00",
    calendarDate: "not-a-date",
  })

  expect(inconsistent.calendarDate).toBe("not-a-date")
})

test("rejects Akahu transaction dates with invalid calendar components", () => {
  expect(() => akahuDate("2026-02-29T00:00:00.000Z")).toThrow()
  expect(() => akahuDate("2024-02-30T00:00:00.000Z")).toThrow()
  expect(() => akahuDate("2026-13-01T00:00:00.000Z")).toThrow()
})

test("normalizes decimal amounts to stable two-decimal strings without number inputs", () => {
  expect(normalizeManagerAkahuAmount("0012.3400")).toEqual({ _tag: "amount", amount: "12.34" })
  expect(normalizeManagerAkahuAmount("1.005")).toEqual({ _tag: "amount", amount: "1.01" })
  expect(normalizeManagerAkahuAmount("-1.005")).toEqual({ _tag: "amount", amount: "-1.01" })
  expect(normalizeManagerAkahuAmount("0.004")).toEqual({ _tag: "amount", amount: "0.00" })
  expect(normalizeManagerAkahuAmount(BigDecimal.fromStringUnsafe("2.5"))).toEqual({
    _tag: "amount",
    amount: "2.50",
  })
  expect(normalizeManagerAkahuAmount("not money")).toEqual({
    _tag: "unsupported",
    reason: "invalidAmount",
    input: "not money",
  })
})

test("classifies signed amounts through the Manager suspense import boundary", () => {
  const receipt = classifyManagerAkahuSuspenseImport({
    bankOrCashAccountKey: "bank-1",
    date: akahuDate("2026-06-04"),
    signedAmount: "12.345",
    reference: "tx-1",
    description: "Coffee",
    fdxTransactionId: "tx-1",
    clearance: { _tag: "settled" },
    importabilityDecision: { _tag: "import" },
  })
  expect(receipt._tag).toBe("receipt")
  if (receipt._tag !== "receipt") {
    throw new Error(`Expected receipt, got ${receipt._tag}`)
  }
  expect(receipt.signedNormalizedAmount).toBe("12.35")
  expect(receipt.managerDecision.payload.value.lines[0].amount).toBe("12.35")

  const payment = classifyManagerAkahuSuspenseImport({
    bankOrCashAccountKey: "bank-1",
    date: akahuDate("2026-06-04"),
    signedAmount: "-9.994",
    reference: "tx-2",
    description: "Shop",
    fdxTransactionId: "tx-2",
    clearance: { _tag: "pending" },
    importabilityDecision: { _tag: "import" },
  })
  expect(payment._tag).toBe("payment")
  if (payment._tag !== "payment") {
    throw new Error(`Expected payment, got ${payment._tag}`)
  }
  expect(payment.absoluteNormalizedAmount).toBe("9.99")
  expect(payment.managerDecision.payload.value.lines[0].amount).toBe("9.99")

  expect(
    classifyManagerAkahuSuspenseImport({
      bankOrCashAccountKey: "bank-1",
      date: akahuDate("2026-06-04"),
      signedAmount: "0.00",
      reference: "tx-zero",
      description: "Zero",
      fdxTransactionId: "tx-zero",
      clearance: { _tag: "settled" },
      importabilityDecision: { _tag: "import" },
    }),
  ).toEqual({ _tag: "zero", signedNormalizedAmount: "0.00" })

  expect(
    classifyManagerAkahuSuspenseImport({
      bankOrCashAccountKey: "bank-1",
      date: akahuDate("2026-06-04"),
      signedAmount: "12.34",
      reference: "tx-unsupported",
      description: "Unsupported",
      fdxTransactionId: "tx-unsupported",
      clearance: { _tag: "settled" },
      importabilityDecision: { _tag: "skip", warning: "Unsupported account" },
    }),
  ).toEqual({ _tag: "unsupported", warning: "Unsupported account" })
})

test("normalizes descriptions and generates versioned pending fingerprints", () => {
  expect(normalizeAkahuTransactionDescription("  Coffee\n  SHOP\tLtd  ")).toBe("coffee shop ltd")

  expect(
    buildAkahuPendingTransactionFingerprint({
      akahuAccountId: "akahu-account-1",
      date: akahuDate("2026-06-05T00:30:00.000+13:00"),
      amount: "12.340",
      description: "  Coffee\nSHOP  ",
    }),
  ).toEqual({
    _tag: "fingerprint",
    fingerprint: "akahu-pending:v1:akahu-account-1:2026-06-05:12.34:coffee shop",
    date: "2026-06-05",
    normalizedAmount: "12.34",
    normalizedDescription: "coffee shop",
  })
})

test("uses the canonical Manager sync-read fdxTransactionId entries and index", () => {
  const syncRead = managerSyncRead({
    receipts: [
      receiptItem("receipt-1", { fdxTransactionId: "settled-1" }),
      receiptItem("receipt-2", {}),
    ],
    payments: [paymentItem("payment-1", { fdxTransactionId: "settled-2" })],
  })

  expect(syncRead.bankOrCashAccountKey).toBe(bankOrCashAccountKey)
  expect(syncRead.existingFdxTransactionIdEntries.map((entry) => entry.fdxTransactionId)).toEqual([
    "settled-1",
    "settled-2",
  ])
  expect(syncRead.existingFdxTransactionIdIndex.get("settled-1")?.[0]?._tag).toBe("receipt")
  expect(syncRead.existingFdxTransactionIdIndex.get("settled-2")?.[0]?._tag).toBe("payment")
})

test("decides settled duplicates by Akahu settled transaction ID", () => {
  const syncRead = managerSyncRead({
    receipts: [receiptItem("receipt-1", { fdxTransactionId: "akahu-settled-1" })],
    payments: [],
  })

  expect(decideSettledDuplicateByAkahuTransactionId(syncRead, "akahu-settled-1")._tag).toBe(
    "duplicate",
  )
  expect(decideSettledDuplicateByAkahuTransactionId(syncRead, "akahu-settled-2")).toEqual({
    _tag: "create",
    akahuTransactionId: "akahu-settled-2",
  })
})

test("decides pending create, update, and ambiguous exact fingerprint matches", () => {
  const fingerprint = `${managerAkahuPendingFingerprintPrefix}acc:2026-06-04:12.34:coffee shop`
  const syncRead = managerSyncRead({
    receipts: [pendingReceipt("receipt-1", { fdxTransactionId: fingerprint })],
    payments: [],
  })
  expect(decidePendingExactFingerprint(syncRead, fingerprint)._tag).toBe("update")
  expect(decidePendingExactFingerprint(syncRead, `${fingerprint}:new`)).toEqual({
    _tag: "create",
    fingerprint: `${fingerprint}:new`,
  })

  const ambiguous = managerSyncRead({
    receipts: [pendingReceipt("receipt-1", { fdxTransactionId: fingerprint })],
    payments: [pendingPayment("payment-1", { fdxTransactionId: fingerprint })],
  })
  expect(decidePendingExactFingerprint(ambiguous, fingerprint)._tag).toBe("ambiguous")
})

test("safely matches exactly one pending candidate to a settled transaction", () => {
  const syncRead = managerSyncRead({
    receipts: [
      pendingReceipt("receipt-1", {
        date: "2026-06-02",
        amount: "12.340",
        description: "Coffee  Shop",
      }),
    ],
    payments: [pendingPayment("payment-1", { amount: "12.34", description: "Coffee Shop" })],
  })

  const decision = decidePendingToSettledMatch({
    syncRead,
    settledDate: akahuDate("2026-06-04"),
    settledSignedAmount: "12.34",
    settledDescription: "coffee shop",
  })
  expect(decision._tag).toBe("match")
  if (decision._tag !== "match") {
    throw new Error(`Expected match, got ${decision._tag}`)
  }
  expect(decision.entry.key).toBe("receipt-1")
})

test("excludes unavailable pending candidates from pending-to-settled matching", () => {
  const excludedFingerprint = `${managerAkahuPendingFingerprintPrefix}acc:2026-06-04:12.34:coffee shop`
  const syncRead = managerSyncRead({
    receipts: [
      pendingReceipt("receipt-excluded", {
        fdxTransactionId: excludedFingerprint,
        date: "2026-06-04",
        amount: "12.34",
        description: "Coffee Shop",
      }),
    ],
  })

  expect(
    decidePendingToSettledMatch({
      syncRead,
      settledDate: akahuDate("2026-06-04"),
      settledSignedAmount: "12.34",
      settledDescription: "coffee shop",
      excludedFdxTransactionIds: new Set([excludedFingerprint]),
    }),
  ).toEqual({ _tag: "none" })

  expect(
    decidePendingToSettledMatch({
      syncRead,
      settledDate: akahuDate("2026-06-04"),
      settledSignedAmount: "12.34",
      settledDescription: "coffee shop",
      excludedFdxTransactionIds: new Set(["other-fingerprint"]),
    })._tag,
  ).toBe("match")
})

test("does not match pending-to-settled candidates outside safe checks", () => {
  const matchingReceipt = pendingReceipt("receipt-1", { date: "2026-06-04" })
  const syncRead = managerSyncRead({
    receipts: [matchingReceipt],
    payments: [],
  })

  expect(
    decidePendingToSettledMatch({
      syncRead,
      settledDate: akahuDate("2026-06-10"),
      settledSignedAmount: "12.34",
      settledDescription: "coffee shop",
    }),
  ).toEqual({ _tag: "none" })

  expect(
    decidePendingToSettledMatch({
      syncRead,
      settledDate: akahuDate("2026-06-04"),
      settledSignedAmount: "-12.34",
      settledDescription: "coffee shop",
    }),
  ).toEqual({ _tag: "none" })

  expect(
    decidePendingToSettledMatch({
      syncRead: managerSyncRead({
        receipts: [pendingReceipt("receipt-other", { bankOrCashAccountKey: "bank-2" })],
      }),
      settledDate: akahuDate("2026-06-04"),
      settledSignedAmount: "12.34",
      settledDescription: "coffee shop",
    }),
  ).toEqual({ _tag: "none" })

  expect(
    decidePendingToSettledMatch({
      syncRead: managerSyncRead({
        receipts: [pendingReceipt("receipt-invalid-date", { date: "2026-02-31" })],
      }),
      settledDate: akahuDate("2026-03-01"),
      settledSignedAmount: "12.34",
      settledDescription: "coffee shop",
    }),
  ).toEqual({ _tag: "none" })

  expect(
    decidePendingToSettledMatch({
      syncRead: managerSyncRead({
        receipts: [pendingReceipt("receipt-non-exact-date", { date: "2026-06-04T00:00:00.000Z" })],
      }),
      settledDate: akahuDate("2026-06-04"),
      settledSignedAmount: "12.34",
      settledDescription: "coffee shop",
    }),
  ).toEqual({ _tag: "none" })

  expect(
    decidePendingToSettledMatch({
      syncRead: managerSyncRead({
        receipts: [pendingReceipt("receipt-invalid-month", { date: "2026-13-01" })],
      }),
      settledDate: akahuDate("2026-06-04"),
      settledSignedAmount: "12.34",
      settledDescription: "coffee shop",
    }),
  ).toEqual({ _tag: "none" })

  const ambiguous = managerSyncRead({
    receipts: [matchingReceipt, pendingReceipt("receipt-2", { date: "2026-06-05" })],
    payments: [],
  })
  expect(
    decidePendingToSettledMatch({
      syncRead: ambiguous,
      settledDate: akahuDate("2026-06-04"),
      settledSignedAmount: "12.34",
      settledDescription: "coffee shop",
    })._tag,
  ).toBe("ambiguous")
})

test("accumulates all sync summary counts", () => {
  const oneEach = managerAkahuSyncSummaryCountKeys.reduce(
    (counts, key) => incrementManagerAkahuSyncSummaryCount(counts, key),
    emptyManagerAkahuSyncSummaryCounts(),
  )
  expect(oneEach).toEqual({
    settledFetched: 1,
    pendingFetched: 1,
    receiptsCreated: 1,
    paymentsCreated: 1,
    duplicatesSkipped: 1,
    zeroAmountSkipped: 1,
    unsupportedSkipped: 1,
    pendingCreated: 1,
    pendingUpdated: 1,
    pendingSettled: 1,
    stalePendingDetected: 1,
    warnings: 1,
    errors: 1,
  })

  expect(addManagerAkahuSyncSummaryCounts(oneEach, oneEach)).toEqual({
    settledFetched: 2,
    pendingFetched: 2,
    receiptsCreated: 2,
    paymentsCreated: 2,
    duplicatesSkipped: 2,
    zeroAmountSkipped: 2,
    unsupportedSkipped: 2,
    pendingCreated: 2,
    pendingUpdated: 2,
    pendingSettled: 2,
    stalePendingDetected: 2,
    warnings: 2,
    errors: 2,
  })
})
