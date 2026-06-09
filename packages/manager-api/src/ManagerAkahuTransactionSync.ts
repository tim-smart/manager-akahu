import { BigDecimal, DateTime, Option } from "effect"
import type { LinkedAccountTransferRule } from "@app/domain/Manager/AkahuCustomFields"
import {
  matchesAkahuTransferRuleDescription,
  normalizeAkahuTransferRuleText,
} from "@app/domain/Manager/AkahuCustomFields"
import {
  buildManagerSuspenseImportDecision,
  type ManagerBankAccountCurrencyImportDecision,
  type ManagerInterAccountTransferPayload,
  type ManagerImportClearance,
  type ManagerLineAmount,
  type ManagerSuspenseImportDecision,
  managerPendingInterAccountTransferClearanceFields,
  managerSettledInterAccountTransferClearanceFields,
} from "./ManagerCompatibility.ts"
import type {
  ManagerBankOrCashAccountSyncRead,
  ManagerExistingFdxTransactionIdEntry,
  ManagerExistingReceiptPaymentFdxTransactionIdEntry,
  ManagerExistingTransferFdxTransactionIdEntry,
} from "./ManagerBatchPagination.ts"
import type { PutInterAccountTransfer as ManagerPutInterAccountTransfer } from "./ManagerClient.ts"

export const managerAkahuPendingFingerprintPrefix = "akahu-pending:v1:" as const
export const managerAkahuTransferPendingFingerprintPrefix = "akahu-transfer-pending:v1:" as const

export const managerAkahuSyncSummaryCountKeys = [
  "settledFetched",
  "pendingFetched",
  "transferRulesMatched",
  "receiptsCreated",
  "paymentsCreated",
  "transfersCreated",
  "transfersUpdated",
  "transfersMerged",
  "duplicatesSkipped",
  "zeroAmountSkipped",
  "unsupportedSkipped",
  "pendingCreated",
  "pendingUpdated",
  "pendingSettled",
  "stalePendingDetected",
  "stalePendingTransfersDetected",
  "warnings",
  "errors",
] as const

export type ManagerAkahuSyncSummaryCountKey = (typeof managerAkahuSyncSummaryCountKeys)[number]

export type ManagerAkahuSyncSummaryCounts = Record<ManagerAkahuSyncSummaryCountKey, number>

export type ManagerAkahuDecimalInput = string | BigDecimal.BigDecimal

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
  readonly date: DateTime.DateTime
  readonly signedAmount: ManagerAkahuDecimalInput
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

export type ManagerAkahuTransactionStartDateEligibilityDecision =
  | { readonly _tag: "eligible" }
  | { readonly _tag: "ineligible" }

export type ManagerAkahuManagerItemDateStartDateEligibilityDecision =
  ManagerAkahuTransactionStartDateEligibilityDecision

export interface ManagerAkahuTransactionStartDateEligibilityInput {
  readonly transactionDate: DateTime.DateTime
  readonly startDate?: DateTime.Utc | undefined
}

export interface ManagerAkahuDateTimeStartDateEligibilityInput {
  readonly transactionDate: DateTime.DateTime
  readonly startDate?: DateTime.Utc | undefined
}

export interface ManagerAkahuManagerItemDateStartDateEligibilityInput {
  readonly itemDate: string | null | undefined
  readonly startDate?: DateTime.Utc | undefined
}

export interface ManagerAkahuPendingFingerprintInput {
  readonly akahuAccountId: string
  readonly date: DateTime.DateTime
  readonly amount: ManagerAkahuDecimalInput
  readonly description: string
}

export interface ManagerAkahuTransferRuleOverlapMatch {
  readonly sourceAccountKey: string
  readonly selectedRule: LinkedAccountTransferRule
  readonly ignoredRules: ReadonlyArray<LinkedAccountTransferRule>
  readonly aggregationKey: string
}

export type ManagerAkahuTransferRuleMatchDecision =
  | { readonly _tag: "noMatch"; readonly normalizedDescription: string }
  | {
      readonly _tag: "match"
      readonly normalizedDescription: string
      readonly rule: LinkedAccountTransferRule
      readonly ignoredRules: ReadonlyArray<LinkedAccountTransferRule>
      readonly overlapMatch?: ManagerAkahuTransferRuleOverlapMatch | undefined
    }

export type ManagerAkahuTransferSourceSide = "credit" | "debit"

export interface ManagerAkahuPendingTransferFingerprintInput {
  readonly akahuAccountId: string
  readonly date: DateTime.DateTime
  readonly amount: ManagerAkahuDecimalInput
  readonly description: string
  readonly rule: LinkedAccountTransferRule
}

export type ManagerAkahuPendingTransferFingerprintDecision =
  | {
      readonly _tag: "fingerprint"
      readonly fingerprint: string
      readonly date: string
      readonly normalizedAmount: ManagerLineAmount
      readonly normalizedDescription: string
      readonly normalizedKeyword: string
      readonly sourceAccountKey: string
      readonly destinationAccountKey: string
    }
  | { readonly _tag: "unsupported"; readonly warning: string }

export interface ManagerAkahuInterAccountTransferPayloadInput {
  readonly rule: LinkedAccountTransferRule
  readonly date: string
  readonly signedNormalizedAmount: ManagerLineAmount
  readonly description: string
  readonly fdxTransactionId: string
  readonly clearance: ManagerImportClearance
}

export interface ManagerAkahuInterAccountTransferClassificationInput {
  readonly rule: LinkedAccountTransferRule
  readonly date: DateTime.DateTime
  readonly signedAmount: ManagerAkahuDecimalInput
  readonly description: string
  readonly fdxTransactionId: string
  readonly clearance: ManagerImportClearance
}

export type ManagerAkahuInterAccountTransferClassification =
  | {
      readonly _tag: "transfer"
      readonly signedNormalizedAmount: ManagerLineAmount
      readonly absoluteNormalizedAmount: ManagerLineAmount
      readonly sourceTransferSide: ManagerAkahuTransferSourceSide
      readonly payload: ManagerInterAccountTransferPayload
    }
  | { readonly _tag: "zero"; readonly signedNormalizedAmount: ManagerLineAmount }
  | { readonly _tag: "unsupported"; readonly warning: string }

export type ManagerAkahuSettledDuplicateDecision =
  | {
      readonly _tag: "duplicate"
      readonly akahuTransactionId: string
      readonly entries: ReadonlyArray<ManagerExistingFdxTransactionIdEntry>
    }
  | { readonly _tag: "create"; readonly akahuTransactionId: string }

export interface ManagerAkahuTransferDuplicateDecisionInput {
  readonly syncRead: Pick<ManagerBankOrCashAccountSyncRead, "existingFdxTransactionIdIndex">
  readonly fdxTransactionId: string
  readonly sourceTransferSide: ManagerAkahuTransferSourceSide
  readonly payload: ManagerInterAccountTransferPayload
}

export type ManagerAkahuTransferDuplicateDecision =
  | { readonly _tag: "create"; readonly fdxTransactionId: string }
  | {
      readonly _tag: "duplicate"
      readonly fdxTransactionId: string
      readonly entries: ReadonlyArray<ManagerExistingTransferFdxTransactionIdEntry>
    }
  | {
      readonly _tag: "previouslyImportedAsSuspense"
      readonly fdxTransactionId: string
      readonly entries: ReadonlyArray<ManagerExistingReceiptPaymentFdxTransactionIdEntry>
      readonly warning: string
    }
  | {
      readonly _tag: "ambiguous"
      readonly fdxTransactionId: string
      readonly entries: ReadonlyArray<ManagerExistingFdxTransactionIdEntry>
      readonly warning: string
    }

export interface ManagerAkahuMirroredTransferCandidateInput {
  readonly syncRead: Pick<ManagerBankOrCashAccountSyncRead, "interAccountTransfers">
  readonly sourceTransferSide: ManagerAkahuTransferSourceSide
  readonly payload: ManagerInterAccountTransferPayload
}

export type ManagerAkahuMirroredTransferCandidateDecision =
  | { readonly _tag: "none" }
  | {
      readonly _tag: "candidate"
      readonly candidate: ManagerBankOrCashAccountSyncRead["interAccountTransfers"][number]
    }
  | {
      readonly _tag: "ambiguous"
      readonly candidates: ReadonlyArray<
        ManagerBankOrCashAccountSyncRead["interAccountTransfers"][number]
      >
      readonly warning: string
    }

export interface ManagerAkahuSettledMirroredTransferUpdatePayloadInput {
  readonly transfer: ManagerBankOrCashAccountSyncRead["interAccountTransfers"][number]
  readonly sourceTransferSide: ManagerAkahuTransferSourceSide
  readonly fdxTransactionId: string
}

export interface ManagerAkahuPendingTransferToSettledMatchInput {
  readonly syncRead: Pick<ManagerBankOrCashAccountSyncRead, "interAccountTransfers">
  readonly sourceTransferSide: ManagerAkahuTransferSourceSide
  readonly payload: ManagerInterAccountTransferPayload
  readonly excludedFdxTransactionIds: ReadonlySet<string>
  readonly dateWindowDays?: number | undefined
}

export type ManagerAkahuPendingTransferToSettledMatchDecision =
  | {
      readonly _tag: "match"
      readonly transfer: ManagerBankOrCashAccountSyncRead["interAccountTransfers"][number]
      readonly pendingFdxTransactionId: string
    }
  | { readonly _tag: "none" }
  | {
      readonly _tag: "ambiguous"
      readonly candidates: ReadonlyArray<{
        readonly transfer: ManagerBankOrCashAccountSyncRead["interAccountTransfers"][number]
        readonly pendingFdxTransactionId: string
      }>
      readonly warning: string
    }

export interface ManagerAkahuInterAccountTransferUpdatePayload extends Omit<
  ManagerPutInterAccountTransfer,
  "key" | "value"
> {
  readonly key: string
  readonly value: NonNullable<ManagerPutInterAccountTransfer["value"]>
}

export type ManagerAkahuPendingExactFingerprintDecision =
  | { readonly _tag: "create"; readonly fingerprint: string }
  | {
      readonly _tag: "update"
      readonly fingerprint: string
      readonly entry: ManagerExistingReceiptPaymentFdxTransactionIdEntry
    }
  | {
      readonly _tag: "ambiguous"
      readonly fingerprint: string
      readonly entries: ReadonlyArray<ManagerExistingReceiptPaymentFdxTransactionIdEntry>
      readonly warning: string
    }

export interface ManagerAkahuPendingToSettledMatchInput {
  readonly syncRead: Pick<
    ManagerBankOrCashAccountSyncRead,
    "bankOrCashAccountKey" | "existingReceiptPaymentFdxTransactionIdEntries"
  >
  readonly settledDate: DateTime.DateTime
  readonly settledSignedAmount: ManagerAkahuDecimalInput
  readonly settledDescription: string
  readonly excludedFdxTransactionIds: ReadonlySet<string>
  readonly startDate?: DateTime.Utc | undefined
  readonly dateWindowDays?: number | undefined
}

export type ManagerAkahuPendingToSettledMatchDecision =
  | { readonly _tag: "match"; readonly entry: ManagerExistingReceiptPaymentFdxTransactionIdEntry }
  | { readonly _tag: "none" }
  | {
      readonly _tag: "ambiguous"
      readonly candidates: ReadonlyArray<ManagerExistingReceiptPaymentFdxTransactionIdEntry>
      readonly warning: string
    }
  | { readonly _tag: "unsupported"; readonly warning: string }

export interface ManagerAkahuStalePendingEntriesInput {
  readonly syncRead: Pick<
    ManagerBankOrCashAccountSyncRead,
    "existingReceiptPaymentFdxTransactionIdEntries"
  >
  readonly currentPendingFdxTransactionIds: ReadonlySet<string>
  readonly processedFdxTransactionIds: ReadonlySet<string>
  readonly startDate?: DateTime.Utc | undefined
}

export interface ManagerAkahuStalePendingTransferEntriesInput {
  readonly syncRead: Pick<
    ManagerBankOrCashAccountSyncRead,
    "existingTransferFdxTransactionIdEntries"
  >
  readonly currentPendingFdxTransactionIds: ReadonlySet<string>
  readonly processedFdxTransactionIds: ReadonlySet<string>
  readonly startDate?: DateTime.Utc | undefined
}

export const emptyManagerAkahuSyncSummaryCounts = (): ManagerAkahuSyncSummaryCounts => ({
  settledFetched: 0,
  pendingFetched: 0,
  transferRulesMatched: 0,
  receiptsCreated: 0,
  paymentsCreated: 0,
  transfersCreated: 0,
  transfersUpdated: 0,
  transfersMerged: 0,
  duplicatesSkipped: 0,
  zeroAmountSkipped: 0,
  unsupportedSkipped: 0,
  pendingCreated: 0,
  pendingUpdated: 0,
  pendingSettled: 0,
  stalePendingDetected: 0,
  stalePendingTransfersDetected: 0,
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

const encodeAkahuPendingFingerprintComponent = (component: string): string =>
  encodeURIComponent(component)

const buildTransferRuleAggregationPart = (rule: LinkedAccountTransferRule) => ({
  normalizedKeyword: rule.normalizedKeyword,
  destinationAccountKey: rule.destinationAccountKey,
})

const buildTransferRuleOverlapAggregationKey = (
  selectedRule: LinkedAccountTransferRule,
  ignoredRules: ReadonlyArray<LinkedAccountTransferRule>,
): string =>
  JSON.stringify({
    sourceAccountKey: selectedRule.sourceAccountKey,
    selectedRule: buildTransferRuleAggregationPart(selectedRule),
    ignoredRules: ignoredRules.map(buildTransferRuleAggregationPart),
  })

export const decideManagerAkahuTransactionStartDateEligibility = (
  input: ManagerAkahuTransactionStartDateEligibilityInput,
): ManagerAkahuTransactionStartDateEligibilityDecision => {
  if (input.startDate === undefined) {
    return { _tag: "eligible" }
  }

  return DateTime.isGreaterThanOrEqualTo(input.transactionDate, input.startDate)
    ? { _tag: "eligible" }
    : { _tag: "ineligible" }
}

export const decideAkahuDateTimeStartDateEligibility = (
  input: ManagerAkahuDateTimeStartDateEligibilityInput,
): ManagerAkahuTransactionStartDateEligibilityDecision =>
  decideManagerAkahuTransactionStartDateEligibility({
    transactionDate: input.transactionDate,
    startDate: input.startDate,
  })

export const decideManagerItemDateStartDateEligibility = (
  input: ManagerAkahuManagerItemDateStartDateEligibilityInput,
): ManagerAkahuManagerItemDateStartDateEligibilityDecision => {
  if (input.startDate === undefined) {
    return { _tag: "eligible" }
  }

  const transactionDate =
    typeof input.itemDate === "string" ? DateTime.makeZoned(input.itemDate) : Option.none()
  if (Option.isNone(transactionDate)) {
    return {
      _tag: "ineligible",
    }
  }

  return decideManagerAkahuTransactionStartDateEligibility({
    transactionDate: transactionDate.value,
    startDate: input.startDate,
  })
}

export const buildAkahuPendingTransactionFingerprint = (
  input: ManagerAkahuPendingFingerprintInput,
): ManagerAkahuPendingFingerprintDecision => {
  const amount = normalizeManagerAkahuAmount(input.amount)
  if (amount._tag === "unsupported") {
    return { _tag: "unsupported", warning: `Unsupported pending amount: ${amount.input}` }
  }

  const date = DateTime.formatIsoDate(input.date)
  const normalizedDescription = normalizeAkahuTransactionDescription(input.description)
  return {
    _tag: "fingerprint",
    fingerprint: `${managerAkahuPendingFingerprintPrefix}${input.akahuAccountId}:${date}:${amount.amount}:${normalizedDescription}`,
    date,
    normalizedAmount: amount.amount,
    normalizedDescription,
  }
}

export const matchManagerAkahuTransferRule = (input: {
  readonly rules: ReadonlyArray<LinkedAccountTransferRule>
  readonly description: string
}): ManagerAkahuTransferRuleMatchDecision => {
  const normalizedDescription = normalizeAkahuTransferRuleText(input.description)
  const matches = input.rules.filter((rule) =>
    matchesAkahuTransferRuleDescription(rule, input.description),
  )
  if (matches.length === 0) {
    return { _tag: "noMatch", normalizedDescription }
  }

  const ignoredRules = matches.slice(1)
  return {
    _tag: "match",
    normalizedDescription,
    rule: matches[0],
    ignoredRules,
    overlapMatch:
      ignoredRules.length === 0
        ? undefined
        : {
            sourceAccountKey: matches[0].sourceAccountKey,
            selectedRule: matches[0],
            ignoredRules,
            aggregationKey: buildTransferRuleOverlapAggregationKey(matches[0], ignoredRules),
          },
  }
}

export const buildAkahuPendingTransferFingerprint = (
  input: ManagerAkahuPendingTransferFingerprintInput,
): ManagerAkahuPendingTransferFingerprintDecision => {
  const amount = normalizeManagerAkahuAmount(input.amount)
  if (amount._tag === "unsupported") {
    return { _tag: "unsupported", warning: `Unsupported pending transfer amount: ${amount.input}` }
  }

  const date = DateTime.formatIsoDate(input.date)
  const normalizedDescription = normalizeAkahuTransferRuleText(input.description)
  const fingerprintComponents = [
    input.akahuAccountId,
    input.rule.sourceAccountKey,
    input.rule.destinationAccountKey,
    date,
    amount.amount,
    normalizedDescription,
    input.rule.normalizedKeyword,
  ].map(encodeAkahuPendingFingerprintComponent)
  return {
    _tag: "fingerprint",
    fingerprint: `${managerAkahuTransferPendingFingerprintPrefix}${fingerprintComponents.join(":")}`,
    date,
    normalizedAmount: amount.amount,
    normalizedDescription,
    normalizedKeyword: input.rule.normalizedKeyword,
    sourceAccountKey: input.rule.sourceAccountKey,
    destinationAccountKey: input.rule.destinationAccountKey,
  }
}

export const getManagerAkahuTransferSourceSide = (
  signedNormalizedAmount: ManagerLineAmount,
): ManagerAkahuTransferSourceSide => (signedNormalizedAmount.startsWith("-") ? "credit" : "debit")

export const buildManagerAkahuInterAccountTransferPayload = (
  input: ManagerAkahuInterAccountTransferPayloadInput,
): ManagerInterAccountTransferPayload => {
  const sourceTransferSide = getManagerAkahuTransferSourceSide(input.signedNormalizedAmount)
  const amount = getAbsoluteManagerAkahuAmount(input.signedNormalizedAmount)
  const clearanceFields =
    input.clearance._tag === "pending"
      ? managerPendingInterAccountTransferClearanceFields
      : managerSettledInterAccountTransferClearanceFields

  return {
    value: {
      date: input.date,
      description: input.description,
      paidFrom:
        sourceTransferSide === "credit"
          ? input.rule.sourceAccountKey
          : input.rule.destinationAccountKey,
      receivedIn:
        sourceTransferSide === "credit"
          ? input.rule.destinationAccountKey
          : input.rule.sourceAccountKey,
      creditAmount: amount,
      debitAmount: amount,
      ...clearanceFields,
      ...(sourceTransferSide === "credit"
        ? { fdxCreditTransactionId: input.fdxTransactionId }
        : { fdxDebitTransactionId: input.fdxTransactionId }),
    },
  }
}

export const classifyManagerAkahuInterAccountTransfer = (
  input: ManagerAkahuInterAccountTransferClassificationInput,
): ManagerAkahuInterAccountTransferClassification => {
  const amount = normalizeManagerAkahuAmount(input.signedAmount)
  if (amount._tag === "unsupported") {
    return { _tag: "unsupported", warning: `Unsupported transfer amount: ${amount.input}` }
  }
  if (isZeroManagerAkahuLineAmount(amount.amount)) {
    return { _tag: "zero", signedNormalizedAmount: amount.amount }
  }
  if (isNonEmptyManagerCurrency(input.rule.destinationAccountCurrency)) {
    return {
      _tag: "unsupported",
      warning: `Skipping transfer to ${input.rule.destinationAccountName}: foreign-currency Manager transfer imports are not verified yet (${input.rule.destinationAccountCurrency}).`,
    }
  }
  if (input.clearance._tag === "pending") {
    if (!input.rule.sourceAccountCanHavePendingTransactions) {
      return {
        _tag: "unsupported",
        warning: `Skipping pending transfer from ${input.rule.sourceAccountName}: Manager account does not support pending transactions.`,
      }
    }
    if (!input.rule.destinationAccountCanHavePendingTransactions) {
      return {
        _tag: "unsupported",
        warning: `Skipping pending transfer to ${input.rule.destinationAccountName}: Manager account does not support pending transactions.`,
      }
    }
  }

  return {
    _tag: "transfer",
    signedNormalizedAmount: amount.amount,
    absoluteNormalizedAmount: getAbsoluteManagerAkahuAmount(amount.amount),
    sourceTransferSide: getManagerAkahuTransferSourceSide(amount.amount),
    payload: buildManagerAkahuInterAccountTransferPayload({
      rule: input.rule,
      date: DateTime.formatIsoDate(input.date),
      signedNormalizedAmount: amount.amount,
      description: input.description,
      fdxTransactionId: input.fdxTransactionId,
      clearance: input.clearance,
    }),
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
    date: DateTime.formatIsoDate(input.date),
    signedNormalizedAmount: amount.amount,
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

export const isAkahuTransferPendingFdxTransactionId = (fdxTransactionId: string): boolean =>
  fdxTransactionId.startsWith(managerAkahuTransferPendingFingerprintPrefix)

const getOppositeTransferSide = (
  side: ManagerAkahuTransferSourceSide,
): ManagerAkahuTransferSourceSide => (side === "credit" ? "debit" : "credit")

const getTransferSideFdxTransactionId = (
  transfer: ManagerBankOrCashAccountSyncRead["interAccountTransfers"][number],
  side: ManagerAkahuTransferSourceSide,
): string | null | undefined =>
  side === "credit" ? transfer.item.fdxCreditTransactionId : transfer.item.fdxDebitTransactionId

const getTransferPayloadSideFdxTransactionId = (
  payload: ManagerInterAccountTransferPayload,
  side: ManagerAkahuTransferSourceSide,
): string | null | undefined =>
  side === "credit" ? payload.value.fdxCreditTransactionId : payload.value.fdxDebitTransactionId

const isBlankManagerTransferFdxTransactionId = (fdxTransactionId: string | null | undefined) =>
  fdxTransactionId === undefined || fdxTransactionId === null || fdxTransactionId === ""

type ManagerInterAccountTransferReadAmount =
  ManagerBankOrCashAccountSyncRead["interAccountTransfers"][number]["item"]["creditAmount"]

const normalizeManagerInterAccountTransferReadAmount = (
  amount: ManagerInterAccountTransferReadAmount,
): ManagerLineAmount | undefined => {
  if (amount === undefined) {
    return undefined
  }

  const normalized = normalizeManagerAkahuAmount(
    typeof amount === "number" ? String(amount) : amount,
  )
  return normalized._tag === "amount" ? normalized.amount : undefined
}

export const isManagerAkahuMirroredTransferCandidate = (input: {
  readonly transfer: ManagerBankOrCashAccountSyncRead["interAccountTransfers"][number]
  readonly sourceTransferSide: ManagerAkahuTransferSourceSide
  readonly payload: ManagerInterAccountTransferPayload
}): boolean => {
  const transfer = input.transfer.item
  const payload = input.payload.value
  if (
    transfer.paidFrom !== payload.paidFrom ||
    transfer.receivedIn !== payload.receivedIn ||
    transfer.date !== payload.date
  ) {
    return false
  }

  if (
    normalizeManagerInterAccountTransferReadAmount(transfer.creditAmount) !==
      payload.creditAmount ||
    normalizeManagerInterAccountTransferReadAmount(transfer.debitAmount) !== payload.debitAmount
  ) {
    return false
  }

  if (
    !isBlankManagerTransferFdxTransactionId(
      getTransferSideFdxTransactionId(input.transfer, input.sourceTransferSide),
    )
  ) {
    return false
  }

  const oppositeSideFdxTransactionId = getTransferSideFdxTransactionId(
    input.transfer,
    getOppositeTransferSide(input.sourceTransferSide),
  )
  if (isBlankManagerTransferFdxTransactionId(oppositeSideFdxTransactionId)) {
    return false
  }

  return (
    oppositeSideFdxTransactionId !==
    getTransferPayloadSideFdxTransactionId(input.payload, input.sourceTransferSide)
  )
}

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

export const decideTransferDuplicateByFdxTransactionId = (
  input: ManagerAkahuTransferDuplicateDecisionInput,
): ManagerAkahuTransferDuplicateDecision => {
  const entries = input.syncRead.existingFdxTransactionIdIndex.get(input.fdxTransactionId) ?? []
  if (entries.length === 0) {
    return { _tag: "create", fdxTransactionId: input.fdxTransactionId }
  }
  if (entries.length > 1) {
    return {
      _tag: "ambiguous",
      fdxTransactionId: input.fdxTransactionId,
      entries,
      warning: `Found ${entries.length} existing Manager entries with FDX transaction ID ${input.fdxTransactionId}.`,
    }
  }

  const [entry] = entries
  if (entry._tag !== "interAccountTransfer") {
    return {
      _tag: "previouslyImportedAsSuspense",
      fdxTransactionId: input.fdxTransactionId,
      entries: [entry],
      warning: `Akahu transaction ${input.fdxTransactionId} was already imported as a Manager ${entry._tag}; skipping transfer import.`,
    }
  }

  return { _tag: "duplicate", fdxTransactionId: input.fdxTransactionId, entries: [entry] }
}

export const selectManagerAkahuMirroredTransferCandidate = (
  input: ManagerAkahuMirroredTransferCandidateInput,
): ManagerAkahuMirroredTransferCandidateDecision => {
  const candidates = input.syncRead.interAccountTransfers.filter((transfer) =>
    isManagerAkahuMirroredTransferCandidate({
      transfer,
      sourceTransferSide: input.sourceTransferSide,
      payload: input.payload,
    }),
  )
  if (candidates.length === 0) {
    return { _tag: "none" }
  }
  if (candidates.length === 1) {
    return { _tag: "candidate", candidate: candidates[0] }
  }

  return {
    _tag: "ambiguous",
    candidates,
    warning: `Found ${candidates.length} possible mirrored Manager inter-account transfers.`,
  }
}

export const buildManagerAkahuSettledMirroredTransferUpdatePayload = (
  input: ManagerAkahuSettledMirroredTransferUpdatePayloadInput,
): ManagerAkahuInterAccountTransferUpdatePayload => {
  const value =
    input.sourceTransferSide === "credit"
      ? {
          ...input.transfer.item,
          creditClearStatus: managerSettledInterAccountTransferClearanceFields.creditClearStatus,
          fdxCreditTransactionId: input.fdxTransactionId,
        }
      : {
          ...input.transfer.item,
          debitClearStatus: managerSettledInterAccountTransferClearanceFields.debitClearStatus,
          fdxDebitTransactionId: input.fdxTransactionId,
        }

  return {
    key: input.transfer.key,
    value,
  }
}

export const decidePendingTransferToSettledMatch = (
  input: ManagerAkahuPendingTransferToSettledMatchInput,
): ManagerAkahuPendingTransferToSettledMatchDecision => {
  const payload = input.payload.value
  const settledDay = DateTime.makeUnsafe(payload.date)
  const dateWindowDays = input.dateWindowDays ?? 3
  const settledDescription = normalizeAkahuTransferRuleText(payload.description)
  const candidates: Array<{
    readonly transfer: ManagerBankOrCashAccountSyncRead["interAccountTransfers"][number]
    readonly pendingFdxTransactionId: string
  }> = []

  for (const transfer of input.syncRead.interAccountTransfers) {
    const pendingFdxTransactionId = getTransferSideFdxTransactionId(
      transfer,
      input.sourceTransferSide,
    )
    if (pendingFdxTransactionId == null || pendingFdxTransactionId === "") {
      continue
    }
    if (!isAkahuTransferPendingFdxTransactionId(pendingFdxTransactionId)) {
      continue
    }
    if (input.excludedFdxTransactionIds.has(pendingFdxTransactionId)) {
      continue
    }

    const item = transfer.item
    if (item.paidFrom !== payload.paidFrom || item.receivedIn !== payload.receivedIn) {
      continue
    }
    if (
      normalizeManagerInterAccountTransferReadAmount(item.creditAmount) !== payload.creditAmount ||
      normalizeManagerInterAccountTransferReadAmount(item.debitAmount) !== payload.debitAmount
    ) {
      continue
    }
    if (normalizeAkahuTransferRuleText(item.description ?? "") !== settledDescription) {
      continue
    }

    const transferDate = typeof item.date === "string" ? DateTime.makeUnsafe(item.date) : undefined
    if (
      transferDate === undefined ||
      !isCalendarDateWithinInclusiveWindow(transferDate, settledDay, dateWindowDays)
    ) {
      continue
    }

    candidates.push({ transfer, pendingFdxTransactionId })
  }

  if (candidates.length === 1) {
    return { _tag: "match", ...candidates[0] }
  }
  if (candidates.length > 1) {
    return {
      _tag: "ambiguous",
      candidates,
      warning: `Found ${candidates.length} possible pending Manager inter-account transfers for settled transaction replacement.`,
    }
  }

  return { _tag: "none" }
}

export const decidePendingExactFingerprint = (
  syncRead: Pick<ManagerBankOrCashAccountSyncRead, "existingReceiptPaymentFdxTransactionIdIndex">,
  fingerprint: string,
): ManagerAkahuPendingExactFingerprintDecision => {
  const entries = syncRead.existingReceiptPaymentFdxTransactionIdIndex.get(fingerprint) ?? []
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

export const decideStalePendingEntries = (
  input: ManagerAkahuStalePendingEntriesInput,
): ReadonlyArray<ManagerExistingReceiptPaymentFdxTransactionIdEntry> =>
  input.syncRead.existingReceiptPaymentFdxTransactionIdEntries.filter(
    (entry) =>
      isAkahuPendingFdxTransactionId(entry.fdxTransactionId) &&
      !isEntryKnownBeforeManagerAkahuStartDate(entry, input.startDate) &&
      !input.currentPendingFdxTransactionIds.has(entry.fdxTransactionId) &&
      !input.processedFdxTransactionIds.has(entry.fdxTransactionId),
  )

export const decideStalePendingTransferEntries = (
  input: ManagerAkahuStalePendingTransferEntriesInput,
): ReadonlyArray<ManagerExistingTransferFdxTransactionIdEntry> =>
  input.syncRead.existingTransferFdxTransactionIdEntries.filter(
    (entry) =>
      isAkahuTransferPendingFdxTransactionId(entry.fdxTransactionId) &&
      !isEntryKnownBeforeManagerAkahuStartDate(entry, input.startDate) &&
      !input.currentPendingFdxTransactionIds.has(entry.fdxTransactionId) &&
      !input.processedFdxTransactionIds.has(entry.fdxTransactionId),
  )

const isEntryKnownBeforeManagerAkahuStartDate = (
  entry: ManagerExistingFdxTransactionIdEntry,
  startDate: DateTime.Utc | undefined,
): boolean => {
  const decision = decideManagerItemDateStartDateEligibility({
    itemDate: getEntryDate(entry),
    startDate,
  })
  return decision._tag === "ineligible"
}

const getEntryKind = (
  entry: ManagerExistingReceiptPaymentFdxTransactionIdEntry,
): ManagerAkahuTransactionKind => entry._tag

const getEntryDate = (entry: ManagerExistingFdxTransactionIdEntry) => {
  switch (entry._tag) {
    case "receipt":
      return entry.receipt.item.date
    case "payment":
      return entry.payment.item.date
    case "interAccountTransfer":
      return entry.interAccountTransfer.item.date
  }
}

const getEntryItem = (entry: ManagerExistingReceiptPaymentFdxTransactionIdEntry) =>
  entry._tag === "receipt" ? entry.receipt.item : entry.payment.item

const getEntryLineAmount = (entry: ManagerExistingReceiptPaymentFdxTransactionIdEntry): unknown =>
  getEntryItem(entry).lines?.[0]?.amount

const getEntryDescription = (entry: ManagerExistingReceiptPaymentFdxTransactionIdEntry): string => {
  const item = getEntryItem(entry)
  return item.description ?? item.lines?.[0]?.lineDescription ?? ""
}

const getEntryBankOrCashAccountKey = (
  entry: ManagerExistingReceiptPaymentFdxTransactionIdEntry,
): string | null | undefined =>
  entry._tag === "receipt" ? entry.receipt.item.receivedIn : entry.payment.item.paidFrom

const getSignedAmountKind = (amount: ManagerLineAmount): ManagerAkahuTransactionKind | "zero" => {
  if (isZeroManagerAkahuLineAmount(amount)) {
    return "zero"
  }

  return amount.startsWith("-") ? "payment" : "receipt"
}

const isZeroManagerAkahuLineAmount = (amount: ManagerLineAmount): boolean =>
  /^-?0+\.00$/.test(amount)

const isNonEmptyManagerCurrency = (currency: string | null): currency is string =>
  currency !== null && currency.trim() !== ""

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

  const dateWindowDays = input.dateWindowDays ?? 3
  const settledDescription = normalizeAkahuTransactionDescription(input.settledDescription)
  const settledAbsoluteAmount = getAbsoluteManagerAkahuAmount(settledAmount.amount)
  const candidates: Array<ManagerExistingReceiptPaymentFdxTransactionIdEntry> = []

  for (const entry of input.syncRead.existingReceiptPaymentFdxTransactionIdEntries) {
    if (input.excludedFdxTransactionIds.has(entry.fdxTransactionId)) {
      continue
    }
    if (!isAkahuPendingFdxTransactionId(entry.fdxTransactionId)) {
      continue
    }
    if (getEntryBankOrCashAccountKey(entry) !== input.syncRead.bankOrCashAccountKey) {
      continue
    }
    if (isEntryKnownBeforeManagerAkahuStartDate(entry, input.startDate)) {
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
    const entryCalendarDate =
      typeof entryDate === "string" ? DateTime.make(entryDate) : Option.none()
    if (Option.isNone(entryCalendarDate)) {
      continue
    }

    if (
      !isCalendarDateWithinInclusiveWindow(
        entryCalendarDate.value,
        input.settledDate,
        dateWindowDays,
      )
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

const isCalendarDateWithinInclusiveWindow = (
  candidate: DateTime.DateTime,
  center: DateTime.DateTime,
  windowDays: number,
): boolean => {
  const minimum = DateTime.subtract(center, { days: windowDays })
  const maximum = DateTime.add(center, { days: windowDays })
  return (
    DateTime.isGreaterThanOrEqualTo(candidate, minimum) &&
    DateTime.isLessThanOrEqualTo(candidate, maximum)
  )
}
