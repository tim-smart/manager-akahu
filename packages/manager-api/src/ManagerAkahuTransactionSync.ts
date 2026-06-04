import { BigDecimal, Option } from "effect"
import {
  buildManagerSuspenseImportDecision,
  type ManagerBankAccountCurrencyImportDecision,
  type ManagerImportClearance,
  type ManagerLineAmount,
  type ManagerSuspenseImportDecision,
} from "./ManagerCompatibility.ts"
import type {
  ManagerBankOrCashAccountSyncRead,
  ManagerExistingFdxTransactionIdEntry,
} from "./ManagerBatchPagination.ts"

export const managerAkahuPendingFingerprintPrefix = "akahu-pending:v1:" as const

export const managerAkahuSyncSummaryCountKeys = [
  "settledFetched",
  "pendingFetched",
  "receiptsCreated",
  "paymentsCreated",
  "duplicatesSkipped",
  "zeroAmountSkipped",
  "unsupportedSkipped",
  "pendingCreated",
  "pendingUpdated",
  "pendingSettled",
  "stalePendingDetected",
  "warnings",
  "errors",
] as const

export type ManagerAkahuSyncSummaryCountKey = (typeof managerAkahuSyncSummaryCountKeys)[number]

export type ManagerAkahuSyncSummaryCounts = Record<ManagerAkahuSyncSummaryCountKey, number>

export type ManagerAkahuDecimalInput = string | BigDecimal.BigDecimal

export type ManagerAkahuDateInput =
  | { readonly _tag: "managerDate"; readonly date: string }
  | { readonly _tag: "rawAkahuDate"; readonly date: string }

export type ManagerAkahuTransactionKind = "receipt" | "payment"

export type ManagerAkahuAmountNormalizationDecision =
  | { readonly _tag: "amount"; readonly amount: ManagerLineAmount }
  | { readonly _tag: "unsupported"; readonly reason: "invalidAmount"; readonly input: string }

export type ManagerAkahuSuspenseImportClassification =
  | {
      readonly _tag: "receipt"
      readonly signedNormalizedAmount: ManagerLineAmount
      readonly absoluteNormalizedAmount: ManagerLineAmount
      readonly managerDecision: Extract<ManagerSuspenseImportDecision, { readonly _tag: "receipt" }>
    }
  | {
      readonly _tag: "payment"
      readonly signedNormalizedAmount: ManagerLineAmount
      readonly absoluteNormalizedAmount: ManagerLineAmount
      readonly managerDecision: Extract<ManagerSuspenseImportDecision, { readonly _tag: "payment" }>
    }
  | { readonly _tag: "zero"; readonly signedNormalizedAmount: ManagerLineAmount }
  | { readonly _tag: "unsupported"; readonly warning: string }

export interface ManagerAkahuSuspenseImportClassificationInput {
  readonly bankOrCashAccountKey: string
  readonly date: ManagerAkahuDateInput
  readonly signedAmount: ManagerAkahuDecimalInput
  readonly reference: string
  readonly description: string
  readonly fdxTransactionId: string
  readonly clearance: ManagerImportClearance
  readonly importabilityDecision: ManagerBankAccountCurrencyImportDecision
}

export type ManagerAkahuPendingFingerprintDecision =
  | {
      readonly _tag: "fingerprint"
      readonly fingerprint: string
      readonly date: string
      readonly normalizedAmount: ManagerLineAmount
      readonly normalizedDescription: string
    }
  | { readonly _tag: "unsupported"; readonly warning: string }

export interface ManagerAkahuPendingFingerprintInput {
  readonly akahuAccountId: string
  readonly date: ManagerAkahuDateInput
  readonly amount: ManagerAkahuDecimalInput
  readonly description: string
}

export type ManagerAkahuSettledDuplicateDecision =
  | {
      readonly _tag: "duplicate"
      readonly akahuTransactionId: string
      readonly entries: ReadonlyArray<ManagerExistingFdxTransactionIdEntry>
    }
  | { readonly _tag: "create"; readonly akahuTransactionId: string }

export type ManagerAkahuPendingExactFingerprintDecision =
  | { readonly _tag: "create"; readonly fingerprint: string }
  | {
      readonly _tag: "update"
      readonly fingerprint: string
      readonly entry: ManagerExistingFdxTransactionIdEntry
    }
  | {
      readonly _tag: "ambiguous"
      readonly fingerprint: string
      readonly entries: ReadonlyArray<ManagerExistingFdxTransactionIdEntry>
      readonly warning: string
    }

export interface ManagerAkahuPendingToSettledMatchInput {
  readonly bankOrCashAccountKey: string
  readonly syncRead: ManagerBankOrCashAccountSyncRead
  readonly settledDate: ManagerAkahuDateInput
  readonly settledSignedAmount: ManagerAkahuDecimalInput
  readonly settledDescription: string
  readonly dateWindowDays?: number | undefined
}

export type ManagerAkahuPendingToSettledMatchDecision =
  | { readonly _tag: "match"; readonly entry: ManagerExistingFdxTransactionIdEntry }
  | { readonly _tag: "none" }
  | {
      readonly _tag: "ambiguous"
      readonly candidates: ReadonlyArray<ManagerExistingFdxTransactionIdEntry>
      readonly warning: string
    }
  | { readonly _tag: "unsupported"; readonly warning: string }

export const emptyManagerAkahuSyncSummaryCounts = (): ManagerAkahuSyncSummaryCounts => ({
  settledFetched: 0,
  pendingFetched: 0,
  receiptsCreated: 0,
  paymentsCreated: 0,
  duplicatesSkipped: 0,
  zeroAmountSkipped: 0,
  unsupportedSkipped: 0,
  pendingCreated: 0,
  pendingUpdated: 0,
  pendingSettled: 0,
  stalePendingDetected: 0,
  warnings: 0,
  errors: 0,
})

export const incrementManagerAkahuSyncSummaryCount = (
  counts: ManagerAkahuSyncSummaryCounts,
  key: ManagerAkahuSyncSummaryCountKey,
  by = 1,
): ManagerAkahuSyncSummaryCounts => ({
  ...counts,
  [key]: counts[key] + by,
})

export const addManagerAkahuSyncSummaryCounts = (
  left: ManagerAkahuSyncSummaryCounts,
  right: ManagerAkahuSyncSummaryCounts,
): ManagerAkahuSyncSummaryCounts => {
  const next = emptyManagerAkahuSyncSummaryCounts()
  for (const key of managerAkahuSyncSummaryCountKeys) {
    next[key] = left[key] + right[key]
  }
  return next
}

const managerDatePattern = /^\d{4}-\d{2}-\d{2}$/

export const formatManagerAkahuDate = (input: ManagerAkahuDateInput): string => {
  const date = input.date.trim()
  if (input._tag === "managerDate") {
    if (!managerDatePattern.test(date)) {
      throw new Error(`Manager date must be yyyy-mm-dd: ${input.date}`)
    }
    return date
  }

  const match = /^(\d{4}-\d{2}-\d{2})(?:$|[T\s])/.exec(date)
  const calendarDate = match?.[1]
  if (calendarDate !== undefined) {
    return calendarDate
  }

  throw new Error(`Raw Akahu date must start with yyyy-mm-dd: ${input.date}`)
}

const toBigDecimal = (
  amount: ManagerAkahuDecimalInput,
): ManagerAkahuAmountNormalizationDecision => {
  if (BigDecimal.isBigDecimal(amount)) {
    return { _tag: "amount", amount: formatManagerAkahuDecimal(amount) }
  }

  const trimmed = amount.trim()
  const parsed = BigDecimal.fromString(trimmed)
  if (Option.isNone(parsed)) {
    return { _tag: "unsupported", reason: "invalidAmount", input: amount }
  }

  return { _tag: "amount", amount: formatManagerAkahuDecimal(parsed.value) }
}

const formatManagerAkahuDecimal = (amount: BigDecimal.BigDecimal): ManagerLineAmount => {
  const rounded = BigDecimal.scale(
    BigDecimal.round(amount, { scale: 2, mode: "half-from-zero" }),
    2,
  )
  const value = rounded.value
  const negative = value < 0n
  if (value === 0n) {
    return "0.00"
  }

  const digits = (negative ? -value : value).toString().padStart(3, "0")
  const whole = digits.slice(0, -2)
  const cents = digits.slice(-2)
  return `${negative ? "-" : ""}${whole}.${cents}`
}

export const normalizeManagerAkahuAmount = (
  amount: ManagerAkahuDecimalInput,
): ManagerAkahuAmountNormalizationDecision => toBigDecimal(amount)

export const getAbsoluteManagerAkahuAmount = (amount: ManagerLineAmount): ManagerLineAmount =>
  amount.startsWith("-") || amount.startsWith("+") ? amount.slice(1) : amount

export const normalizeAkahuTransactionDescription = (description: string): string =>
  description.trim().toLowerCase().replace(/\s+/g, " ")

export const buildAkahuPendingTransactionFingerprint = (
  input: ManagerAkahuPendingFingerprintInput,
): ManagerAkahuPendingFingerprintDecision => {
  const amount = normalizeManagerAkahuAmount(input.amount)
  if (amount._tag === "unsupported") {
    return { _tag: "unsupported", warning: `Unsupported pending amount: ${amount.input}` }
  }

  const date = formatManagerAkahuDate(input.date)
  const normalizedDescription = normalizeAkahuTransactionDescription(input.description)
  return {
    _tag: "fingerprint",
    fingerprint: `${managerAkahuPendingFingerprintPrefix}${input.akahuAccountId}:${date}:${amount.amount}:${normalizedDescription}`,
    date,
    normalizedAmount: amount.amount,
    normalizedDescription,
  }
}

export const classifyManagerAkahuSuspenseImport = (
  input: ManagerAkahuSuspenseImportClassificationInput,
): ManagerAkahuSuspenseImportClassification => {
  const amount = normalizeManagerAkahuAmount(input.signedAmount)
  if (amount._tag === "unsupported") {
    return { _tag: "unsupported", warning: `Unsupported amount: ${amount.input}` }
  }

  const managerDecision = buildManagerSuspenseImportDecision({
    bankOrCashAccountKey: input.bankOrCashAccountKey,
    date: formatManagerAkahuDate(input.date),
    signedNormalizedAmount: amount.amount,
    reference: input.reference,
    description: input.description,
    fdxTransactionId: input.fdxTransactionId,
    clearance: input.clearance,
    importabilityDecision: input.importabilityDecision,
  })

  if (managerDecision._tag === "receipt") {
    return {
      _tag: "receipt",
      signedNormalizedAmount: amount.amount,
      absoluteNormalizedAmount: getAbsoluteManagerAkahuAmount(amount.amount),
      managerDecision,
    }
  }

  if (managerDecision._tag === "payment") {
    return {
      _tag: "payment",
      signedNormalizedAmount: amount.amount,
      absoluteNormalizedAmount: getAbsoluteManagerAkahuAmount(amount.amount),
      managerDecision,
    }
  }

  if (managerDecision.reason._tag === "zeroAmount") {
    return { _tag: "zero", signedNormalizedAmount: amount.amount }
  }

  return { _tag: "unsupported", warning: managerDecision.reason.warning }
}

export const isAkahuPendingFdxTransactionId = (fdxTransactionId: string): boolean =>
  fdxTransactionId.startsWith(managerAkahuPendingFingerprintPrefix)

export const decideSettledDuplicateByAkahuTransactionId = (
  syncRead: ManagerBankOrCashAccountSyncRead,
  akahuTransactionId: string,
): ManagerAkahuSettledDuplicateDecision => {
  const entries = syncRead.existingFdxTransactionIdIndex.get(akahuTransactionId) ?? []
  if (entries.length > 0) {
    return { _tag: "duplicate", akahuTransactionId, entries }
  }

  return { _tag: "create", akahuTransactionId }
}

export const decidePendingExactFingerprint = (
  syncRead: ManagerBankOrCashAccountSyncRead,
  fingerprint: string,
): ManagerAkahuPendingExactFingerprintDecision => {
  const entries = syncRead.existingFdxTransactionIdIndex.get(fingerprint) ?? []
  if (entries.length === 0) {
    return { _tag: "create", fingerprint }
  }
  if (entries.length === 1) {
    return { _tag: "update", fingerprint, entry: entries[0] }
  }

  return {
    _tag: "ambiguous",
    fingerprint,
    entries,
    warning: `Found ${entries.length} existing pending Manager entries with fingerprint ${fingerprint}.`,
  }
}

const getEntryKind = (entry: ManagerExistingFdxTransactionIdEntry): ManagerAkahuTransactionKind =>
  entry._tag

const getEntryItem = (entry: ManagerExistingFdxTransactionIdEntry) =>
  entry._tag === "receipt" ? entry.receipt.item : entry.payment.item

const getEntryLineAmount = (entry: ManagerExistingFdxTransactionIdEntry): unknown =>
  getEntryItem(entry).lines?.[0]?.amount

const getEntryDescription = (entry: ManagerExistingFdxTransactionIdEntry): string => {
  const item = getEntryItem(entry)
  return item.description ?? item.lines?.[0]?.lineDescription ?? ""
}

const getEntryBankOrCashAccountKey = (
  entry: ManagerExistingFdxTransactionIdEntry,
): string | null | undefined =>
  entry._tag === "receipt" ? entry.receipt.item.receivedIn : entry.payment.item.paidFrom

const calendarDayNumber = (date: string): number => {
  const [year, month, day] = date.split("-").map(Number)
  return Date.UTC(year, month - 1, day) / 86_400_000
}

const getSignedAmountKind = (amount: ManagerLineAmount): ManagerAkahuTransactionKind | "zero" => {
  if (/^-?0+\.00$/.test(amount)) {
    return "zero"
  }

  return amount.startsWith("-") ? "payment" : "receipt"
}

export const decidePendingToSettledMatch = (
  input: ManagerAkahuPendingToSettledMatchInput,
): ManagerAkahuPendingToSettledMatchDecision => {
  const settledAmount = normalizeManagerAkahuAmount(input.settledSignedAmount)
  if (settledAmount._tag === "unsupported") {
    return { _tag: "unsupported", warning: `Unsupported settled amount: ${settledAmount.input}` }
  }

  const settledKind = getSignedAmountKind(settledAmount.amount)
  if (settledKind === "zero") {
    return { _tag: "unsupported", warning: "Zero settled amounts cannot match pending entries." }
  }

  const settledDate = formatManagerAkahuDate(input.settledDate)
  const settledDay = calendarDayNumber(settledDate)
  const dateWindowDays = input.dateWindowDays ?? 3
  const settledDescription = normalizeAkahuTransactionDescription(input.settledDescription)
  const settledAbsoluteAmount = getAbsoluteManagerAkahuAmount(settledAmount.amount)
  const candidates: Array<ManagerExistingFdxTransactionIdEntry> = []

  for (const entry of input.syncRead.existingFdxTransactionIdEntries) {
    if (!isAkahuPendingFdxTransactionId(entry.fdxTransactionId)) {
      continue
    }
    if (getEntryBankOrCashAccountKey(entry) !== input.bankOrCashAccountKey) {
      continue
    }
    if (getEntryKind(entry) !== settledKind) {
      continue
    }

    const entryAmount = getEntryLineAmount(entry)
    if (typeof entryAmount !== "string") {
      continue
    }

    const normalizedEntryAmount = normalizeManagerAkahuAmount(entryAmount)
    if (
      normalizedEntryAmount._tag === "unsupported" ||
      normalizedEntryAmount.amount !== settledAbsoluteAmount
    ) {
      continue
    }

    if (normalizeAkahuTransactionDescription(getEntryDescription(entry)) !== settledDescription) {
      continue
    }

    const entryDate = getEntryItem(entry).date
    if (
      entryDate === undefined ||
      Math.abs(
        calendarDayNumber(formatManagerAkahuDate({ _tag: "managerDate", date: entryDate })) -
          settledDay,
      ) > dateWindowDays
    ) {
      continue
    }

    candidates.push(entry)
  }

  if (candidates.length === 1) {
    return { _tag: "match", entry: candidates[0] }
  }
  if (candidates.length > 1) {
    return {
      _tag: "ambiguous",
      candidates,
      warning: `Found ${candidates.length} possible pending entries for settled transaction replacement.`,
    }
  }

  return { _tag: "none" }
}
