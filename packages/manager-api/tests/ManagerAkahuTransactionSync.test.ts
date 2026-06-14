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
  decideAkahuDateTimeStartDateEligibility,
  decideManagerItemDateStartDateEligibility,
  buildAkahuPendingTransactionFingerprint,
  buildAkahuPendingTransferFingerprint,
  buildManagerAkahuInterAccountTransferPayload,
  buildManagerAkahuSettledMirroredTransferUpdatePayload,
  buildManagerBankOrCashAccountSyncRead,
  classifyManagerAkahuInterAccountTransfer,
  classifyManagerAkahuSuspenseImport,
  decideManagerAkahuTransactionStartDateEligibility,
  decidePendingExactFingerprint,
  decidePendingToSettledMatch,
  decideSettledDuplicateByAkahuTransactionId,
  decideStalePendingEntries,
  decideStalePendingTransferEntries,
  decideTransferDuplicateByFdxTransactionId,
  emptyManagerAkahuSyncSummaryCounts,
  incrementManagerAkahuSyncSummaryCount,
  isManagerAkahuMirroredTransferCandidate,
  managerAkahuPendingFingerprintPrefix,
  managerAkahuTransferPendingFingerprintPrefix,
  managerAkahuSyncSummaryCountKeys,
  matchManagerAkahuTransferRule,
  normalizeAkahuTransactionDescription,
  normalizeManagerAkahuAmount,
  selectManagerAkahuMirroredTransferCandidate,
  selectManagerAkahuSuspenseTransferDuplicateCandidate,
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

test("treats same-date transactions as eligible for configured Akahu start date", () => {
  expect(
    decideManagerAkahuTransactionStartDateEligibility({
      transactionDate: DateTime.makeZonedUnsafe("2026-06-04"),
      startDate: DateTime.makeUnsafe("2026-06-04"),
    }),
  ).toEqual({ _tag: "eligible" })
})

test("treats newer transactions as eligible for configured Akahu start date", () => {
  expect(
    decideManagerAkahuTransactionStartDateEligibility({
      transactionDate: DateTime.makeZonedUnsafe("2026-06-05"),
      startDate: DateTime.makeUnsafe("2026-06-04"),
    }),
  ).toEqual({ _tag: "eligible" })
})

test("treats older transactions as ineligible for configured Akahu start date", () => {
  expect(
    decideManagerAkahuTransactionStartDateEligibility({
      transactionDate: DateTime.makeZonedUnsafe("2026-06-03"),
      startDate: DateTime.makeUnsafe("2026-06-04"),
    }),
  ).toEqual({ _tag: "ineligible" })
})

test("preserves no-start pass-through eligibility without parsing transaction dates", () => {
  expect(
    decideManagerItemDateStartDateEligibility({
      itemDate: "not-a-manager-date",
    }),
  ).toEqual({ _tag: "eligible" })
})

test("adapts Akahu DateTime values through timezone-stable calendar formatting", () => {
  const nearMidnightAuckland = DateTime.makeUnsafe("2026-06-04T11:30:00.000Z").pipe(
    DateTime.setZoneNamedUnsafe("Pacific/Auckland"),
  )

  expect(
    buildAkahuPendingTransactionFingerprint({
      akahuAccountId: "akahu-account-1",
      date: nearMidnightAuckland,
      amount: "1.00",
      description: "Near Midnight",
    }),
  ).toMatchObject({ _tag: "fingerprint", date: "2026-06-04" })

  expect(
    decideAkahuDateTimeStartDateEligibility({
      transactionDate: nearMidnightAuckland,
      startDate: DateTime.makeUnsafe("2026-06-04"),
    }),
  ).toEqual({ _tag: "eligible" })
  expect(
    decideAkahuDateTimeStartDateEligibility({
      transactionDate: nearMidnightAuckland,
      startDate: DateTime.makeUnsafe("2026-06-05"),
    }),
  ).toEqual({ _tag: "ineligible" })
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

test("decides transfer duplicates through the common FDX index", () => {
  const payload = buildManagerAkahuInterAccountTransferPayload({
    rule: transferRule(),
    date: "2026-06-04",
    signedNormalizedAmount: "-12.34",
    description: "Transfer out",
    fdxTransactionId: "akahu-transfer-1",
    clearance: { _tag: "settled" },
  })
  const transfer = interAccountTransferItem("transfer-1", {
    ...payload.value,
    fdxCreditTransactionId: "akahu-transfer-1",
  })
  const receipt = receiptItem("receipt-1", { fdxTransactionId: "akahu-receipt-1" })

  expect(
    decideTransferDuplicateByFdxTransactionId({
      syncRead: managerSyncRead({}),
      fdxTransactionId: "new-transfer",
      sourceTransferSide: "credit",
      payload,
    }),
  ).toEqual({ _tag: "create", fdxTransactionId: "new-transfer" })

  const duplicate = decideTransferDuplicateByFdxTransactionId({
    syncRead: managerSyncRead({ interAccountTransfers: [transfer] }),
    fdxTransactionId: "akahu-transfer-1",
    sourceTransferSide: "credit",
    payload,
  })
  expect(duplicate._tag).toBe("duplicate")
  if (duplicate._tag !== "duplicate") {
    throw new Error(`Expected duplicate, got ${duplicate._tag}`)
  }
  expect(duplicate.entries[0].key).toBe("transfer-1")

  const previouslyImported = decideTransferDuplicateByFdxTransactionId({
    syncRead: managerSyncRead({ receipts: [receipt] }),
    fdxTransactionId: "akahu-receipt-1",
    sourceTransferSide: "credit",
    payload,
  })
  expect(previouslyImported).toMatchObject({
    _tag: "previouslyImportedAsSuspense",
    warning:
      "Akahu transaction akahu-receipt-1 was already imported as a Manager receipt; skipping transfer import.",
  })
})

test("reports ambiguous transfer duplicate decisions from the common FDX index", () => {
  const payload = buildManagerAkahuInterAccountTransferPayload({
    rule: transferRule(),
    date: "2026-06-04",
    signedNormalizedAmount: "-12.34",
    description: "Transfer out",
    fdxTransactionId: "ambiguous-fdx",
    clearance: { _tag: "settled" },
  })
  const syncRead = managerSyncRead({
    receipts: [receiptItem("receipt-1", { fdxTransactionId: "ambiguous-fdx" })],
    interAccountTransfers: [
      interAccountTransferItem("transfer-1", {
        ...payload.value,
        fdxCreditTransactionId: "ambiguous-fdx",
      }),
    ],
  })

  const decision = decideTransferDuplicateByFdxTransactionId({
    syncRead,
    fdxTransactionId: "ambiguous-fdx",
    sourceTransferSide: "credit",
    payload,
  })
  expect(decision._tag).toBe("ambiguous")
  if (decision._tag !== "ambiguous") {
    throw new Error(`Expected ambiguous, got ${decision._tag}`)
  }
  expect(decision.entries.map((entry) => entry.key)).toEqual(["receipt-1", "transfer-1"])
  expect(decision.warning).toBe(
    "Found 2 existing Manager entries with FDX transaction ID ambiguous-fdx.",
  )
})

test("selects safe mirrored inter-account transfer candidates only", () => {
  const payload = buildManagerAkahuInterAccountTransferPayload({
    rule: transferRule(),
    date: "2026-06-04",
    signedNormalizedAmount: "-12.34",
    description: "Transfer out",
    fdxTransactionId: "credit-side-fdx",
    clearance: { _tag: "settled" },
  })
  const safe = interAccountTransferItem("transfer-safe", {
    ...payload.value,
    fdxCreditTransactionId: null,
    fdxDebitTransactionId: "debit-side-fdx",
  })
  const safeNumericAmounts = interAccountTransferItem("transfer-safe-numeric-amounts", {
    ...payload.value,
    creditAmount: 12.34,
    debitAmount: 12.34,
    fdxCreditTransactionId: null,
    fdxDebitTransactionId: "debit-side-fdx",
  })
  const currentSideAlreadySet = interAccountTransferItem("transfer-current-set", {
    ...payload.value,
    fdxCreditTransactionId: "other-credit-side-fdx",
    fdxDebitTransactionId: "debit-side-fdx",
  })
  const oppositeSideMissing = interAccountTransferItem("transfer-opposite-missing", {
    ...payload.value,
    fdxCreditTransactionId: null,
    fdxDebitTransactionId: "",
  })
  const amountMismatch = interAccountTransferItem("transfer-amount-mismatch", {
    ...payload.value,
    creditAmount: "12.35",
    fdxCreditTransactionId: null,
    fdxDebitTransactionId: "debit-side-fdx",
  })
  const invalidAmount = interAccountTransferItem("transfer-invalid-amount", {
    ...payload.value,
    creditAmount: "invalid",
    fdxCreditTransactionId: null,
    fdxDebitTransactionId: "debit-side-fdx",
  })
  const missingAmount = interAccountTransferItem("transfer-missing-amount", {
    ...payload.value,
    debitAmount: undefined,
    fdxCreditTransactionId: null,
    fdxDebitTransactionId: "debit-side-fdx",
  })

  expect(
    isManagerAkahuMirroredTransferCandidate({
      transfer: safe,
      sourceTransferSide: "credit",
      payload,
    }),
  ).toBe(true)
  expect(
    isManagerAkahuMirroredTransferCandidate({
      transfer: safeNumericAmounts,
      sourceTransferSide: "credit",
      payload,
    }),
  ).toBe(true)
  expect(
    isManagerAkahuMirroredTransferCandidate({
      transfer: currentSideAlreadySet,
      sourceTransferSide: "credit",
      payload,
    }),
  ).toBe(false)
  expect(
    isManagerAkahuMirroredTransferCandidate({
      transfer: oppositeSideMissing,
      sourceTransferSide: "credit",
      payload,
    }),
  ).toBe(false)
  expect(
    isManagerAkahuMirroredTransferCandidate({
      transfer: amountMismatch,
      sourceTransferSide: "credit",
      payload,
    }),
  ).toBe(false)
  expect(
    isManagerAkahuMirroredTransferCandidate({
      transfer: invalidAmount,
      sourceTransferSide: "credit",
      payload,
    }),
  ).toBe(false)
  expect(
    isManagerAkahuMirroredTransferCandidate({
      transfer: missingAmount,
      sourceTransferSide: "credit",
      payload,
    }),
  ).toBe(false)
})

test("selects unique mirrored transfer candidates and reports ambiguous candidates", () => {
  const payload = buildManagerAkahuInterAccountTransferPayload({
    rule: transferRule(),
    date: "2026-06-04",
    signedNormalizedAmount: "-12.34",
    description: "Transfer out",
    fdxTransactionId: "credit-side-fdx",
    clearance: { _tag: "settled" },
  })
  const first = interAccountTransferItem("transfer-1", {
    ...payload.value,
    fdxCreditTransactionId: null,
    fdxDebitTransactionId: "debit-side-fdx-1",
  })
  const second = interAccountTransferItem("transfer-2", {
    ...payload.value,
    fdxCreditTransactionId: null,
    fdxDebitTransactionId: "debit-side-fdx-2",
  })

  expect(
    selectManagerAkahuMirroredTransferCandidate({
      syncRead: managerSyncRead({}),
      sourceTransferSide: "credit",
      payload,
    }),
  ).toEqual({ _tag: "none" })

  const unique = selectManagerAkahuMirroredTransferCandidate({
    syncRead: managerSyncRead({ interAccountTransfers: [first] }),
    sourceTransferSide: "credit",
    payload,
  })
  expect(unique._tag).toBe("candidate")
  if (unique._tag !== "candidate") {
    throw new Error(`Expected candidate, got ${unique._tag}`)
  }
  expect(unique.candidate.key).toBe("transfer-1")

  const ambiguous = selectManagerAkahuMirroredTransferCandidate({
    syncRead: managerSyncRead({ interAccountTransfers: [first, second] }),
    sourceTransferSide: "credit",
    payload,
  })
  expect(ambiguous._tag).toBe("ambiguous")
  if (ambiguous._tag !== "ambiguous") {
    throw new Error(`Expected ambiguous, got ${ambiguous._tag}`)
  }
  expect(ambiguous.candidates.map((candidate) => candidate.key)).toEqual([
    "transfer-1",
    "transfer-2",
  ])
  expect(ambiguous.warning).toBe("Found 2 possible mirrored Manager inter-account transfers.")
})

test("selects settled suspense duplicates from transfers when either side matches the account", () => {
  const matching = interAccountTransferItem("transfer-receipt-duplicate", {
    date: "2026-06-04T23:30:00+13:00",
    description: "Coffee Shop",
    paidFrom: ` ${bankOrCashAccountKey} `,
    receivedIn: "bank-2",
    creditAmount: "-1,212.34",
    debitAmount: "1,212.340",
    fdxCreditTransactionId: null,
    fdxDebitTransactionId: null,
  })
  const differentAccount = interAccountTransferItem("transfer-different-account", {
    ...matching.item,
    paidFrom: "bank-3",
    receivedIn: "bank-4",
  })
  const differentAmount = interAccountTransferItem("transfer-different-amount", {
    ...matching.item,
    creditAmount: "12.35",
    debitAmount: "12.35",
  })

  const decision = selectManagerAkahuSuspenseTransferDuplicateCandidate({
    syncRead: managerSyncRead({
      interAccountTransfers: [matching, differentAccount, differentAmount],
    }),
    bankOrCashAccountKey,
    settledDate: DateTime.makeUnsafe("2026-06-04"),
    absoluteNormalizedAmount: "1212.34",
  })
  expect(decision._tag).toBe("candidate")
  if (decision._tag !== "candidate") {
    throw new Error(`Expected candidate, got ${decision._tag}`)
  }
  expect(decision.candidate.key).toBe("transfer-receipt-duplicate")
})

test("selects payment-side settled suspense duplicates from existing transfers", () => {
  const first = interAccountTransferItem("transfer-payment-duplicate-1", {
    date: "2026-06-04",
    description: "Shop",
    paidFrom: "bank-2",
    receivedIn: bankOrCashAccountKey,
    creditAmount: "9.99",
    debitAmount: "9.99",
    fdxCreditTransactionId: null,
    fdxDebitTransactionId: null,
  })
  const second = interAccountTransferItem("transfer-payment-duplicate-2", {
    ...first.item,
  })

  const ambiguous = selectManagerAkahuSuspenseTransferDuplicateCandidate({
    syncRead: managerSyncRead({ interAccountTransfers: [first, second] }),
    bankOrCashAccountKey,
    settledDate: DateTime.makeUnsafe("2026-06-04"),
    absoluteNormalizedAmount: "9.99",
  })
  expect(ambiguous._tag).toBe("ambiguous")
  if (ambiguous._tag !== "ambiguous") {
    throw new Error(`Expected ambiguous, got ${ambiguous._tag}`)
  }
  expect(ambiguous.candidates.map((candidate) => candidate.key)).toEqual([
    "transfer-payment-duplicate-1",
    "transfer-payment-duplicate-2",
  ])
  expect(ambiguous.warning).toBe("Found 2 possible Manager inter-account transfer duplicates.")
})

test("selects captured lump sum transfer duplicate with different Akahu description", () => {
  const transfer = interAccountTransferItem("019ec343-4c86-7e2f-b24d-b8247f0109b5", {
    date: "2026-06-04T00:00:00",
    description: "To: 88248763-1005 Lump Sum Loan Payment",
    paidFrom: bankOrCashAccountKey,
    creditAmount: 30000,
    receivedIn: "bank-2",
    debitAmount: 30000,
    fdxDebitTransactionId: null,
    fdxCreditTransactionId: null,
  })

  const decision = selectManagerAkahuSuspenseTransferDuplicateCandidate({
    syncRead: managerSyncRead({ interAccountTransfers: [transfer] }),
    bankOrCashAccountKey,
    settledDate: DateTime.makeUnsafe("2026-06-04T06:25:25.000Z"),
    absoluteNormalizedAmount: "30000.00",
  })

  expect(decision._tag).toBe("candidate")
  if (decision._tag !== "candidate") {
    throw new Error(`Expected candidate, got ${decision._tag}`)
  }
  expect(decision.candidate.key).toBe("019ec343-4c86-7e2f-b24d-b8247f0109b5")
})

test("builds settled credit-side mirrored transfer update payloads without replacing unrelated fields", () => {
  const transfer = interAccountTransferItem("transfer-credit-side", {
    date: "2026-06-04",
    reference: "transfer-reference",
    description: "Existing transfer description",
    paidFrom: bankOrCashAccountKey,
    creditAmount: "12.34",
    creditClearStatus: ManagerBankAccountClearStatusValue.onLaterDate,
    creditClearDate: "2026-06-05",
    receivedIn: "bank-2",
    debitAmount: "12.34",
    debitClearStatus: ManagerBankAccountClearStatusValue.onLaterDate,
    debitClearDate: "2026-06-06",
    exchangeRate: "1.25",
    exchangeRateIsInverse: true,
    customTheme: true,
    customThemeId: "theme-1",
    automaticReference: false,
    customFields: { field: "kept" },
    fdxCreditTransactionId: null,
    fdxDebitTransactionId: "debit-side-fdx",
  })

  const payload = buildManagerAkahuSettledMirroredTransferUpdatePayload({
    transfer,
    sourceTransferSide: "credit",
    fdxTransactionId: "credit-side-settled-fdx",
  })

  expect(payload).toEqual({
    key: "transfer-credit-side",
    value: {
      ...transfer.item,
      creditClearStatus: ManagerBankAccountClearStatusValue.onSameDate,
      fdxCreditTransactionId: "credit-side-settled-fdx",
    },
  })
  expect(payload.value.debitClearStatus).toBe(ManagerBankAccountClearStatusValue.onLaterDate)
  expect(payload.value.debitClearDate).toBe("2026-06-06")
  expect(payload.value.fdxDebitTransactionId).toBe("debit-side-fdx")
})

test("builds settled debit-side mirrored transfer update payloads without replacing unrelated fields", () => {
  const transfer = interAccountTransferItem("transfer-debit-side", {
    date: "2026-06-04",
    reference: "transfer-reference",
    description: "Existing transfer description",
    paidFrom: "bank-2",
    creditAmount: "18.20",
    creditClearStatus: ManagerBankAccountClearStatusValue.onLaterDate,
    creditClearDate: "2026-06-05",
    receivedIn: bankOrCashAccountKey,
    debitAmount: "18.20",
    debitClearStatus: ManagerBankAccountClearStatusValue.onLaterDate,
    debitClearDate: "2026-06-06",
    exchangeRate: "1.25",
    exchangeRateIsInverse: true,
    customTheme: true,
    customThemeId: "theme-1",
    automaticReference: false,
    customFields: { field: "kept" },
    fdxCreditTransactionId: "credit-side-fdx",
    fdxDebitTransactionId: null,
  })

  const payload = buildManagerAkahuSettledMirroredTransferUpdatePayload({
    transfer,
    sourceTransferSide: "debit",
    fdxTransactionId: "debit-side-settled-fdx",
  })

  expect(payload).toEqual({
    key: "transfer-debit-side",
    value: {
      ...transfer.item,
      debitClearStatus: ManagerBankAccountClearStatusValue.onSameDate,
      fdxDebitTransactionId: "debit-side-settled-fdx",
    },
  })
  expect(payload.value.creditClearStatus).toBe(ManagerBankAccountClearStatusValue.onLaterDate)
  expect(payload.value.creditClearDate).toBe("2026-06-05")
  expect(payload.value.fdxCreditTransactionId).toBe("credit-side-fdx")
})

test("treats a matching opposite-side transfer FDX duplicate as a duplicate", () => {
  const payload = buildManagerAkahuInterAccountTransferPayload({
    rule: transferRule(),
    date: "2026-06-04",
    signedNormalizedAmount: "-12.34",
    description: "Transfer out",
    fdxTransactionId: "shared-fdx",
    clearance: { _tag: "settled" },
  })
  const transfer = interAccountTransferItem("transfer-1", {
    ...payload.value,
    fdxCreditTransactionId: null,
    fdxDebitTransactionId: "shared-fdx",
  })

  expect(
    isManagerAkahuMirroredTransferCandidate({
      transfer,
      sourceTransferSide: "credit",
      payload,
    }),
  ).toBe(false)

  const decision = decideTransferDuplicateByFdxTransactionId({
    syncRead: managerSyncRead({ interAccountTransfers: [transfer] }),
    fdxTransactionId: "shared-fdx",
    sourceTransferSide: "credit",
    payload,
  })
  expect(decision._tag).toBe("duplicate")
  if (decision._tag !== "duplicate") {
    throw new Error(`Expected duplicate, got ${decision._tag}`)
  }
  expect(decision.entries[0].key).toBe("transfer-1")
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

test("decides stale Akahu-created pending transfer entries absent from current pending results", () => {
  const currentFingerprint = `${managerAkahuTransferPendingFingerprintPrefix}acc:bank-1:bank-2:2026-06-04:12.34:current`
  const processedFingerprint = `${managerAkahuTransferPendingFingerprintPrefix}acc:bank-1:bank-2:2026-06-04:12.34:processed`
  const staleCreditFingerprint = `${managerAkahuTransferPendingFingerprintPrefix}acc:bank-1:bank-2:2026-06-04:12.34:stale-credit`
  const staleDebitFingerprint = `${managerAkahuTransferPendingFingerprintPrefix}acc:bank-2:bank-1:2026-06-04:-12.34:stale-debit`
  const receiptPendingPrefixTransferFingerprint = `${managerAkahuPendingFingerprintPrefix}acc:2026-06-04:12.34:old-transfer-prefix`
  const syncRead = managerSyncRead({
    interAccountTransfers: [
      interAccountTransferItem("transfer-current", {
        paidFrom: bankOrCashAccountKey,
        receivedIn: "bank-2",
        fdxCreditTransactionId: currentFingerprint,
      }),
      interAccountTransferItem("transfer-processed", {
        paidFrom: bankOrCashAccountKey,
        receivedIn: "bank-2",
        fdxCreditTransactionId: processedFingerprint,
      }),
      interAccountTransferItem("transfer-stale-credit", {
        paidFrom: bankOrCashAccountKey,
        receivedIn: "bank-2",
        fdxCreditTransactionId: staleCreditFingerprint,
      }),
      interAccountTransferItem("transfer-stale-debit", {
        paidFrom: "bank-2",
        receivedIn: bankOrCashAccountKey,
        fdxDebitTransactionId: staleDebitFingerprint,
      }),
      interAccountTransferItem("transfer-old-prefix", {
        paidFrom: bankOrCashAccountKey,
        receivedIn: "bank-2",
        fdxCreditTransactionId: receiptPendingPrefixTransferFingerprint,
      }),
    ],
  })

  expect(
    decideStalePendingTransferEntries({
      syncRead,
      currentPendingFdxTransactionIds: new Set([currentFingerprint]),
      processedFdxTransactionIds: new Set([processedFingerprint]),
    }).map((entry) => `${entry.key}:${entry.transferSide}`),
  ).toEqual(["transfer-stale-credit:credit", "transfer-stale-debit:debit"])
})

test("filters pre-start stale pending entries while keeping malformed dates conservative", () => {
  const preStartFingerprint = `${managerAkahuPendingFingerprintPrefix}acc:2026-06-03:8.50:pre start`
  const staleFingerprint = `${managerAkahuPendingFingerprintPrefix}acc:2026-06-04:8.50:stale`
  const malformedDateFingerprint = `${managerAkahuPendingFingerprintPrefix}acc:2026-06-04:8.50:bad date`
  const syncRead = managerSyncRead({
    receipts: [
      pendingReceipt("receipt-pre-start", {
        fdxTransactionId: preStartFingerprint,
        date: "2026-06-03",
        description: "Pre Start",
      }),
      pendingReceipt("receipt-stale", {
        fdxTransactionId: staleFingerprint,
        date: "2026-06-04",
        description: "Stale",
      }),
      pendingReceipt("receipt-bad-date", {
        fdxTransactionId: malformedDateFingerprint,
        date: "2026-02-30",
        description: "Bad Date",
      }),
    ],
  })

  expect(
    decideStalePendingEntries({
      syncRead,
      currentPendingFdxTransactionIds: new Set(),
      processedFdxTransactionIds: new Set(),
      startDate: DateTime.makeUnsafe("2026-06-04"),
    }).map((entry) => entry.key),
  ).toEqual(["receipt-stale"])
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

test("matches pending to settled from transfer FDX entries after Manager recategorization", () => {
  const fingerprint = `${managerAkahuPendingFingerprintPrefix}acc:2026-06-04:12.34:coffee shop`
  const transfer = interAccountTransferItem("transfer-1", {
    paidFrom: "bank-2",
    receivedIn: bankOrCashAccountKey,
    date: "2026-06-04",
    debitAmount: "12.34",
    creditAmount: "12.34",
    description: "Coffee Shop",
    fdxDebitTransactionId: fingerprint,
  })

  const transferDecision = decidePendingToSettledMatch({
    syncRead: managerSyncRead({ interAccountTransfers: [transfer] }),
    settledDate: DateTime.makeUnsafe("2026-06-04"),
    settledSignedAmount: "12.34",
    settledDescription: "coffee shop",
    excludedFdxTransactionIds: noExcludedFdxTransactionIds(),
  })
  expect(transferDecision._tag).toBe("match")
  if (transferDecision._tag !== "match") {
    throw new Error(`Expected match, got ${transferDecision._tag}`)
  }
  expect(transferDecision.entry).toMatchObject({
    _tag: "interAccountTransfer",
    key: "transfer-1",
    transferSide: "debit",
  })

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
  expect(decision._tag).toBe("ambiguous")
})

test("matches pending payment to settled from transfer FDX entries after Manager recategorization", () => {
  const fingerprint = `${managerAkahuPendingFingerprintPrefix}acc:2026-06-04:-9.99:shop`
  const transfer = interAccountTransferItem("transfer-payment", {
    paidFrom: bankOrCashAccountKey,
    receivedIn: "bank-2",
    date: "2026-06-04",
    debitAmount: "9.99",
    creditAmount: "9.99",
    description: "Shop",
    fdxCreditTransactionId: fingerprint,
  })

  const decision = decidePendingToSettledMatch({
    syncRead: managerSyncRead({ interAccountTransfers: [transfer] }),
    settledDate: DateTime.makeUnsafe("2026-06-04"),
    settledSignedAmount: "-9.99",
    settledDescription: "shop",
    excludedFdxTransactionIds: noExcludedFdxTransactionIds(),
  })
  expect(decision._tag).toBe("match")
  if (decision._tag !== "match") {
    throw new Error(`Expected match, got ${decision._tag}`)
  }
  expect(decision.entry).toMatchObject({
    _tag: "interAccountTransfer",
    key: "transfer-payment",
    transferSide: "credit",
  })
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

test("excludes pre-start pending candidates from pending-to-settled matching", () => {
  const syncRead = managerSyncRead({
    receipts: [
      pendingReceipt("receipt-pre-start", {
        date: "2026-06-03",
        amount: "12.34",
        description: "Coffee Shop",
      }),
    ],
  })
  const input = {
    syncRead,
    settledDate: DateTime.makeUnsafe("2026-06-04"),
    settledSignedAmount: "12.34",
    settledDescription: "coffee shop",
    excludedFdxTransactionIds: noExcludedFdxTransactionIds(),
  }

  expect(decidePendingToSettledMatch(input)._tag).toBe("match")
  expect(
    decidePendingToSettledMatch({
      ...input,
      startDate: DateTime.makeUnsafe("2026-06-04"),
    }),
  ).toEqual({ _tag: "none" })
})

test("matches near-midnight pending-to-settled candidates through canonical calendar dates", () => {
  const nearMidnightAuckland = DateTime.makeUnsafe("2026-06-04T11:30:00.000Z").pipe(
    DateTime.setZoneNamedUnsafe("Pacific/Auckland"),
  )
  const nearMidnightFingerprint = `${managerAkahuPendingFingerprintPrefix}acc:2026-06-04:12.34:near midnight`
  const syncRead = managerSyncRead({
    receipts: [
      pendingReceipt("receipt-near-midnight", {
        fdxTransactionId: nearMidnightFingerprint,
        date: "2026-06-04",
        amount: "12.34",
        description: "Near Midnight",
      }),
      pendingReceipt("receipt-outside-window", {
        fdxTransactionId: `${managerAkahuPendingFingerprintPrefix}acc:2026-06-08:12.34:near midnight`,
        date: "2026-06-08",
        amount: "12.34",
        description: "Near Midnight",
      }),
    ],
  })

  expect(
    buildAkahuPendingTransactionFingerprint({
      akahuAccountId: "acc",
      date: nearMidnightAuckland,
      amount: "12.34",
      description: "Near Midnight",
    }),
  ).toMatchObject({ _tag: "fingerprint", date: "2026-06-04" })

  const decision = decidePendingToSettledMatch({
    syncRead,
    settledDate: nearMidnightAuckland,
    settledSignedAmount: "12.34",
    settledDescription: "near midnight",
    excludedFdxTransactionIds: noExcludedFdxTransactionIds(),
  })

  expect(decision._tag).toBe("match")
  if (decision._tag !== "match") {
    throw new Error(`Expected match, got ${decision._tag}`)
  }
  expect(decision.entry.key).toBe("receipt-near-midnight")
})

test("accumulates all sync summary counts", () => {
  const oneEach = managerAkahuSyncSummaryCountKeys.reduce(
    (counts, key) => incrementManagerAkahuSyncSummaryCount(counts, key),
    emptyManagerAkahuSyncSummaryCounts(),
  )
  expect(oneEach).toEqual({
    settledFetched: 1,
    pendingFetched: 1,
    transferRulesMatched: 1,
    receiptsCreated: 1,
    paymentsCreated: 1,
    transfersCreated: 1,
    transfersUpdated: 1,
    transfersMerged: 1,
    duplicatesSkipped: 1,
    zeroAmountSkipped: 1,
    unsupportedSkipped: 1,
    pendingCreated: 1,
    pendingUpdated: 1,
    pendingSettled: 1,
    stalePendingDetected: 1,
    stalePendingTransfersDetected: 1,
    warnings: 1,
    errors: 1,
  })

  expect(addManagerAkahuSyncSummaryCounts(oneEach, oneEach)).toEqual({
    settledFetched: 2,
    pendingFetched: 2,
    transferRulesMatched: 2,
    receiptsCreated: 2,
    paymentsCreated: 2,
    transfersCreated: 2,
    transfersUpdated: 2,
    transfersMerged: 2,
    duplicatesSkipped: 2,
    zeroAmountSkipped: 2,
    unsupportedSkipped: 2,
    pendingCreated: 2,
    pendingUpdated: 2,
    pendingSettled: 2,
    stalePendingDetected: 2,
    stalePendingTransfersDetected: 2,
    warnings: 2,
    errors: 2,
  })
})
