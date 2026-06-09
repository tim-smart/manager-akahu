import { BigDecimal, DateTime } from "effect"
import { expect, test } from "@effect/vitest"
import { LinkedAccountTransferRule } from "@app/domain/Manager/AkahuCustomFields"
import type {
  ManagerInterAccountTransferItem,
  ManagerPaymentItem,
  ManagerReceiptItem,
} from "../src/index.ts"
import {
  addManagerAkahuSyncSummaryCounts,
  buildAkahuPendingTransactionFingerprint,
  buildAkahuPendingTransferFingerprint,
  buildManagerAkahuInterAccountTransferPayload,
  buildManagerBankOrCashAccountSyncRead,
  classifyManagerAkahuInterAccountTransfer,
  classifyManagerAkahuSuspenseImport,
  decidePendingExactFingerprint,
  decidePendingToSettledMatch,
  decideSettledDuplicateByAkahuTransactionId,
  decideStalePendingEntries,
  emptyManagerAkahuSyncSummaryCounts,
  incrementManagerAkahuSyncSummaryCount,
  managerAkahuPendingFingerprintPrefix,
  managerAkahuTransferPendingFingerprintPrefix,
  managerAkahuSyncSummaryCountKeys,
  matchManagerAkahuTransferRule,
  normalizeAkahuTransactionDescription,
  normalizeManagerAkahuAmount,
  ManagerBankAccountClearStatusValue,
} from "../src/index.ts"

const bankOrCashAccountKey = "bank-1"

const noExcludedFdxTransactionIds = (): ReadonlySet<string> => new Set()

const transferRule = (input: Partial<LinkedAccountTransferRule> = {}): LinkedAccountTransferRule =>
  new LinkedAccountTransferRule({
    sourceAccountKey: input.sourceAccountKey ?? bankOrCashAccountKey,
    sourceAccountName: input.sourceAccountName ?? "Source Account",
    sourceAccountCurrency: input.sourceAccountCurrency ?? null,
    sourceAccountCanHavePendingTransactions: input.sourceAccountCanHavePendingTransactions ?? true,
    keyword: input.keyword ?? "Transfer",
    normalizedKeyword: input.normalizedKeyword ?? "transfer",
    destinationAccountKey: input.destinationAccountKey ?? "bank-2",
    destinationAccountName: input.destinationAccountName ?? "Destination Account",
    destinationAccountCurrency: input.destinationAccountCurrency ?? null,
    destinationAccountCanHavePendingTransactions:
      input.destinationAccountCanHavePendingTransactions ?? true,
  })

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
  readonly interAccountTransfers?: ReadonlyArray<ManagerInterAccountTransferItem>
}) =>
  buildManagerBankOrCashAccountSyncRead({
    bankOrCashAccountKey,
    receipts: input.receipts ?? [],
    payments: input.payments ?? [],
    interAccountTransfers: input.interAccountTransfers ?? [],
  })

const interAccountTransferItem = (
  key: string,
  item: ManagerInterAccountTransferItem["item"],
): ManagerInterAccountTransferItem => ({
  key,
  item,
  _links: null,
  _actions: null,
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
    date: DateTime.makeUnsafe("2026-06-04"),
    signedAmount: "12.345",
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
    date: DateTime.makeUnsafe("2026-06-04"),
    signedAmount: "-9.994",
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
      date: DateTime.makeUnsafe("2026-06-04"),
      signedAmount: "0.00",
      description: "Zero",
      fdxTransactionId: "tx-zero",
      clearance: { _tag: "settled" },
      importabilityDecision: { _tag: "import" },
    }),
  ).toEqual({ _tag: "zero", signedNormalizedAmount: "0.00" })

  expect(
    classifyManagerAkahuSuspenseImport({
      bankOrCashAccountKey: "bank-1",
      date: DateTime.makeUnsafe("2026-06-04"),
      signedAmount: "12.34",
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
      date: DateTime.makeZonedUnsafe("2026-06-05T00:30:00.000+13:00"),
      amount: "12.340",
      description: "  Coffee\nSHOP  ",
    }),
  ).toEqual({
    _tag: "fingerprint",
    fingerprint: "akahu-pending:v1:akahu-account-1:2026-06-04:12.34:coffee shop",
    date: "2026-06-04",
    normalizedAmount: "12.34",
    normalizedDescription: "coffee shop",
  })

  expect(
    buildAkahuPendingTransactionFingerprint({
      akahuAccountId: "akahu-account-1",
      date: DateTime.makeZonedUnsafe("2026-06-05T00:30:00.000+13:00"),
      amount: "not-a-decimal",
      description: "Unsupported pending",
    }),
  ).toEqual({ _tag: "unsupported", warning: "Unsupported pending amount: not-a-decimal" })
})

test("matches transfer rules against normalized Akahu descriptions in field order", () => {
  const first = transferRule({ keyword: "Coffee Shop", normalizedKeyword: "coffee shop" })
  const ignored = transferRule({
    keyword: "Shop",
    normalizedKeyword: "shop",
    destinationAccountKey: "bank-3",
    destinationAccountName: "Other Account",
  })

  expect(
    matchManagerAkahuTransferRule({
      rules: [first, ignored],
      description: "  Paid at COFFEE\nSHOP today  ",
    }),
  ).toEqual({
    _tag: "match",
    normalizedDescription: "paid at coffee shop today",
    rule: first,
    ignoredRules: [ignored],
    overlapMatch: {
      sourceAccountKey: bankOrCashAccountKey,
      selectedRule: first,
      ignoredRules: [ignored],
      aggregationKey: JSON.stringify({
        sourceAccountKey: bankOrCashAccountKey,
        selectedRule: {
          normalizedKeyword: "coffee shop",
          destinationAccountKey: "bank-2",
        },
        ignoredRules: [
          {
            normalizedKeyword: "shop",
            destinationAccountKey: "bank-3",
          },
        ],
      }),
    },
  })

  expect(
    matchManagerAkahuTransferRule({ rules: [first], description: "unrelated transaction" }),
  ).toEqual({ _tag: "noMatch", normalizedDescription: "unrelated transaction" })
})

test("builds settled inter-account transfer payloads for negative and positive directions", () => {
  const rule = transferRule()

  expect(
    buildManagerAkahuInterAccountTransferPayload({
      rule,
      date: "2026-06-04",
      signedNormalizedAmount: "-25.01",
      description: "Transfer out",
      fdxTransactionId: "settled-negative",
      clearance: { _tag: "settled" },
    }),
  ).toEqual({
    value: {
      date: "2026-06-04",
      description: "Transfer out",
      paidFrom: bankOrCashAccountKey,
      receivedIn: "bank-2",
      creditAmount: "25.01",
      debitAmount: "25.01",
      creditClearStatus: ManagerBankAccountClearStatusValue.onSameDate,
      debitClearStatus: ManagerBankAccountClearStatusValue.onSameDate,
      fdxCreditTransactionId: "settled-negative",
    },
  })

  expect(
    buildManagerAkahuInterAccountTransferPayload({
      rule,
      date: "2026-06-04",
      signedNormalizedAmount: "18.20",
      description: "Transfer in",
      fdxTransactionId: "settled-positive",
      clearance: { _tag: "settled" },
    }),
  ).toEqual({
    value: {
      date: "2026-06-04",
      description: "Transfer in",
      paidFrom: "bank-2",
      receivedIn: bankOrCashAccountKey,
      creditAmount: "18.20",
      debitAmount: "18.20",
      creditClearStatus: ManagerBankAccountClearStatusValue.onSameDate,
      debitClearStatus: ManagerBankAccountClearStatusValue.onSameDate,
      fdxDebitTransactionId: "settled-positive",
    },
  })
})

test("classifies pending transfers with pending clear statuses when both accounts support pending", () => {
  const decision = classifyManagerAkahuInterAccountTransfer({
    rule: transferRule(),
    date: DateTime.makeUnsafe("2026-06-04"),
    signedAmount: "-12.345",
    description: "Pending transfer",
    fdxTransactionId: "pending-transfer",
    clearance: { _tag: "pending" },
  })

  expect(decision._tag).toBe("transfer")
  if (decision._tag !== "transfer") {
    throw new Error(`Expected transfer, got ${decision._tag}`)
  }
  expect(decision.signedNormalizedAmount).toBe("-12.35")
  expect(decision.absoluteNormalizedAmount).toBe("12.35")
  expect(decision.sourceTransferSide).toBe("credit")
  expect(decision.payload).toEqual({
    value: {
      date: "2026-06-04",
      description: "Pending transfer",
      paidFrom: bankOrCashAccountKey,
      receivedIn: "bank-2",
      creditAmount: "12.35",
      debitAmount: "12.35",
      creditClearStatus: ManagerBankAccountClearStatusValue.onLaterDate,
      debitClearStatus: ManagerBankAccountClearStatusValue.onLaterDate,
      fdxCreditTransactionId: "pending-transfer",
    },
  })
  expect("creditClearDate" in decision.payload.value).toBe(false)
  expect("debitClearDate" in decision.payload.value).toBe(false)
})

test("generates transfer-specific pending fingerprints with transfer rule context", () => {
  const decision = buildAkahuPendingTransferFingerprint({
    akahuAccountId: "akahu-account-1",
    date: DateTime.makeZonedUnsafe("2026-06-05T00:30:00.000+13:00"),
    amount: "-20.005",
    description: "  Loan\nPayment  ",
    rule: transferRule({ normalizedKeyword: "loan" }),
  })

  expect(decision).toEqual({
    _tag: "fingerprint",
    fingerprint:
      "akahu-transfer-pending:v1:akahu-account-1:bank-1:bank-2:2026-06-04:-20.01:loan%20payment:loan",
    date: "2026-06-04",
    normalizedAmount: "-20.01",
    normalizedDescription: "loan payment",
    normalizedKeyword: "loan",
    sourceAccountKey: bankOrCashAccountKey,
    destinationAccountKey: "bank-2",
  })
  if (decision._tag !== "fingerprint") {
    throw new Error(`Expected fingerprint, got ${decision._tag}`)
  }
  expect(decision.fingerprint.startsWith(managerAkahuTransferPendingFingerprintPrefix)).toBe(true)
  expect(decision.fingerprint.startsWith(managerAkahuPendingFingerprintPrefix)).toBe(false)

  expect(
    buildAkahuPendingTransferFingerprint({
      akahuAccountId: "akahu-account-1",
      date: DateTime.makeUnsafe("2026-06-04"),
      amount: "not-a-decimal",
      description: "Unsupported transfer",
      rule: transferRule(),
    }),
  ).toEqual({ _tag: "unsupported", warning: "Unsupported pending transfer amount: not-a-decimal" })
})

test("encodes transfer pending fingerprint components so separators cannot collide", () => {
  const commonInput = {
    akahuAccountId: "akahu-account-1",
    date: DateTime.makeUnsafe("2026-06-04"),
    amount: "1.00",
  }

  const descriptionContainsSeparator = buildAkahuPendingTransferFingerprint({
    ...commonInput,
    description: "alpha:beta",
    rule: transferRule({ keyword: "Gamma", normalizedKeyword: "gamma" }),
  })
  const keywordContainsSeparator = buildAkahuPendingTransferFingerprint({
    ...commonInput,
    description: "alpha",
    rule: transferRule({ keyword: "Beta Gamma", normalizedKeyword: "beta:gamma" }),
  })

  expect(descriptionContainsSeparator._tag).toBe("fingerprint")
  expect(keywordContainsSeparator._tag).toBe("fingerprint")
  if (
    descriptionContainsSeparator._tag !== "fingerprint" ||
    keywordContainsSeparator._tag !== "fingerprint"
  ) {
    throw new Error("Expected supported transfer fingerprints")
  }
  expect(descriptionContainsSeparator.fingerprint).toBe(
    "akahu-transfer-pending:v1:akahu-account-1:bank-1:bank-2:2026-06-04:1.00:alpha%3Abeta:gamma",
  )
  expect(keywordContainsSeparator.fingerprint).toBe(
    "akahu-transfer-pending:v1:akahu-account-1:bank-1:bank-2:2026-06-04:1.00:alpha:beta%3Agamma",
  )
  expect(descriptionContainsSeparator.fingerprint).not.toBe(keywordContainsSeparator.fingerprint)
})

test("skips transfer imports for zero amounts, invalid amounts, foreign destinations, and pending capability gaps", () => {
  const input = {
    rule: transferRule(),
    date: DateTime.makeUnsafe("2026-06-04"),
    description: "Transfer",
    fdxTransactionId: "tx-1",
    clearance: { _tag: "settled" } as const,
  }

  expect(classifyManagerAkahuInterAccountTransfer({ ...input, signedAmount: "0.004" })).toEqual({
    _tag: "zero",
    signedNormalizedAmount: "0.00",
  })
  expect(classifyManagerAkahuInterAccountTransfer({ ...input, signedAmount: "bad" })).toEqual({
    _tag: "unsupported",
    warning: "Unsupported transfer amount: bad",
  })
  expect(
    classifyManagerAkahuInterAccountTransfer({
      ...input,
      rule: transferRule({ destinationAccountCurrency: "USD" }),
      signedAmount: "10.00",
    }),
  ).toEqual({
    _tag: "unsupported",
    warning:
      "Skipping transfer to Destination Account: foreign-currency Manager transfer imports are not verified yet (USD).",
  })
  expect(
    classifyManagerAkahuInterAccountTransfer({
      ...input,
      rule: transferRule({ sourceAccountCanHavePendingTransactions: false }),
      signedAmount: "10.00",
      clearance: { _tag: "pending" },
    }),
  ).toEqual({
    _tag: "unsupported",
    warning:
      "Skipping pending transfer from Source Account: Manager account does not support pending transactions.",
  })
  expect(
    classifyManagerAkahuInterAccountTransfer({
      ...input,
      rule: transferRule({ destinationAccountCanHavePendingTransactions: false }),
      signedAmount: "10.00",
      clearance: { _tag: "pending" },
    }),
  ).toEqual({
    _tag: "unsupported",
    warning:
      "Skipping pending transfer to Destination Account: Manager account does not support pending transactions.",
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

test("decides pending exact fingerprint matches from receipt/payment FDX entries only", () => {
  const fingerprint = `${managerAkahuPendingFingerprintPrefix}acc:2026-06-04:12.34:transfer coffee`
  const transfer = interAccountTransferItem("transfer-1", {
    paidFrom: bankOrCashAccountKey,
    receivedIn: "bank-2",
    fdxCreditTransactionId: fingerprint,
  })
  const transferOnly = managerSyncRead({ interAccountTransfers: [transfer] })

  expect(decidePendingExactFingerprint(transferOnly, fingerprint)).toEqual({
    _tag: "create",
    fingerprint,
  })

  const receiptAndTransfer = managerSyncRead({
    receipts: [pendingReceipt("receipt-1", { fdxTransactionId: fingerprint })],
    interAccountTransfers: [transfer],
  })
  const decision = decidePendingExactFingerprint(receiptAndTransfer, fingerprint)
  expect(decision._tag).toBe("update")
  if (decision._tag !== "update") {
    throw new Error(`Expected update, got ${decision._tag}`)
  }
  expect(decision.entry.key).toBe("receipt-1")
})

test("decides stale Akahu-created pending entries absent from current pending results", () => {
  const currentFingerprint = `${managerAkahuPendingFingerprintPrefix}acc:2026-06-04:12.34:current coffee`
  const processedFingerprint = `${managerAkahuPendingFingerprintPrefix}acc:2026-06-04:15.00:processed lunch`
  const staleReceiptFingerprint = `${managerAkahuPendingFingerprintPrefix}acc:2026-06-04:8.50:stale receipt`
  const stalePaymentFingerprint = `${managerAkahuPendingFingerprintPrefix}acc:2026-06-04:-9.99:stale payment`
  const staleTransferFingerprint = `${managerAkahuPendingFingerprintPrefix}acc:2026-06-04:-20.00:stale transfer`
  const syncRead = managerSyncRead({
    receipts: [
      receiptItem("receipt-settled", { fdxTransactionId: "akahu-settled-1" }),
      pendingReceipt("receipt-current", { fdxTransactionId: currentFingerprint }),
      pendingReceipt("receipt-processed", { fdxTransactionId: processedFingerprint }),
      pendingReceipt("receipt-stale", { fdxTransactionId: staleReceiptFingerprint }),
    ],
    payments: [pendingPayment("payment-stale", { fdxTransactionId: stalePaymentFingerprint })],
    interAccountTransfers: [
      interAccountTransferItem("transfer-stale", {
        paidFrom: bankOrCashAccountKey,
        receivedIn: "bank-2",
        fdxCreditTransactionId: staleTransferFingerprint,
      }),
    ],
  })

  expect(
    decideStalePendingEntries({
      syncRead,
      currentPendingFdxTransactionIds: new Set([currentFingerprint]),
      processedFdxTransactionIds: new Set([processedFingerprint]),
    }).map((entry) => entry.key),
  ).toEqual(["receipt-stale", "payment-stale"])
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
    settledDate: DateTime.makeUnsafe("2026-06-04"),
    settledSignedAmount: "12.34",
    settledDescription: "coffee shop",
    excludedFdxTransactionIds: noExcludedFdxTransactionIds(),
  })
  expect(decision._tag).toBe("match")
  if (decision._tag !== "match") {
    throw new Error(`Expected match, got ${decision._tag}`)
  }
  expect(decision.entry.key).toBe("receipt-1")
})

test("matches pending to settled from receipt/payment FDX entries only", () => {
  const fingerprint = `${managerAkahuPendingFingerprintPrefix}acc:2026-06-04:12.34:coffee shop`
  const transfer = interAccountTransferItem("transfer-1", {
    paidFrom: bankOrCashAccountKey,
    receivedIn: "bank-2",
    date: "2026-06-04",
    debitAmount: "12.34",
    creditAmount: "12.34",
    description: "Coffee Shop",
    fdxCreditTransactionId: fingerprint,
  })

  expect(
    decidePendingToSettledMatch({
      syncRead: managerSyncRead({ interAccountTransfers: [transfer] }),
      settledDate: DateTime.makeUnsafe("2026-06-04"),
      settledSignedAmount: "12.34",
      settledDescription: "coffee shop",
      excludedFdxTransactionIds: noExcludedFdxTransactionIds(),
    }),
  ).toEqual({ _tag: "none" })

  const decision = decidePendingToSettledMatch({
    syncRead: managerSyncRead({
      receipts: [pendingReceipt("receipt-1", { fdxTransactionId: fingerprint })],
      interAccountTransfers: [transfer],
    }),
    settledDate: DateTime.makeUnsafe("2026-06-04"),
    settledSignedAmount: "12.34",
    settledDescription: "coffee shop",
    excludedFdxTransactionIds: noExcludedFdxTransactionIds(),
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
      settledDate: DateTime.makeUnsafe("2026-06-04"),
      settledSignedAmount: "12.34",
      settledDescription: "coffee shop",
      excludedFdxTransactionIds: new Set([excludedFingerprint]),
    }),
  ).toEqual({ _tag: "none" })

  expect(
    decidePendingToSettledMatch({
      syncRead,
      settledDate: DateTime.makeUnsafe("2026-06-04"),
      settledSignedAmount: "12.34",
      settledDescription: "coffee shop",
      excludedFdxTransactionIds: new Set(["other-fingerprint"]),
    })._tag,
  ).toBe("match")
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
