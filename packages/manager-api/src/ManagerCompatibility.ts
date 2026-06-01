import type {
  BankAccountClearStatus as ManagerBankAccountClearStatus,
  BankOrCashAccount as ManagerBankOrCashAccount,
  Payment2 as ManagerPaymentCreate,
  PostPayment as ManagerPostPayment,
  PostReceipt as ManagerPostReceipt,
  Receipt2 as ManagerReceiptCreate,
} from "./ManagerClient.ts"

export const ManagerBankAccountClearStatusValue = {
  onSameDate: 0,
  onLaterDate: 1,
} as const satisfies Record<string, ManagerBankAccountClearStatus>

export type ManagerImportClearance = { readonly _tag: "settled" } | { readonly _tag: "pending" }

export type ManagerLineAmount = string

export interface ManagerSuspenseImportDecisionInput {
  readonly bankOrCashAccountKey: string
  readonly date: string
  readonly signedNormalizedAmount: ManagerLineAmount
  readonly description: string
  readonly fdxTransactionId: string
  readonly clearance: ManagerImportClearance
  readonly importabilityDecision: ManagerBankAccountCurrencyImportDecision
}

type ManagerReceiptCreateLine = NonNullable<ManagerReceiptCreate["lines"]>[number]
type ManagerPaymentCreateLine = NonNullable<ManagerPaymentCreate["lines"]>[number]

export type ManagerSuspenseLine = Pick<ManagerReceiptCreateLine, "amount" | "lineDescription"> &
  Pick<ManagerPaymentCreateLine, "amount" | "lineDescription"> & {
    readonly amount: ManagerLineAmount
    readonly lineDescription: string
  }

export interface ManagerSuspenseReceiptValue extends ManagerReceiptCreate {
  readonly date: NonNullable<ManagerReceiptCreate["date"]>
  readonly receivedIn: NonNullable<ManagerReceiptCreate["receivedIn"]>
  readonly cleared: NonNullable<ManagerReceiptCreate["cleared"]>
  readonly description: NonNullable<ManagerReceiptCreate["description"]>
  readonly lines: readonly [ManagerSuspenseLine]
  readonly fdxTransactionId: NonNullable<ManagerReceiptCreate["fdxTransactionId"]>
}

// Extending the generated POST wrapper keeps this production payload boundary
// checked at build time when ManagerClient.ts changes.
export interface ManagerSuspenseReceiptPayload extends ManagerPostReceipt {
  readonly value: ManagerSuspenseReceiptValue
}

export interface ManagerSuspensePaymentValue extends ManagerPaymentCreate {
  readonly date: NonNullable<ManagerPaymentCreate["date"]>
  readonly paidFrom: NonNullable<ManagerPaymentCreate["paidFrom"]>
  readonly cleared: NonNullable<ManagerPaymentCreate["cleared"]>
  readonly description: NonNullable<ManagerPaymentCreate["description"]>
  readonly lines: readonly [ManagerSuspenseLine]
  readonly fdxTransactionId: NonNullable<ManagerPaymentCreate["fdxTransactionId"]>
}

// Extending the generated POST wrapper keeps this production payload boundary
// checked at build time when ManagerClient.ts changes.
export interface ManagerSuspensePaymentPayload extends ManagerPostPayment {
  readonly value: ManagerSuspensePaymentValue
}

export type ManagerSuspenseImportSkipReason =
  | { readonly _tag: "zeroAmount"; readonly signedNormalizedAmount: ManagerLineAmount }
  | { readonly _tag: "notImportable"; readonly warning: string }

export type ManagerSuspenseImportDecision =
  | { readonly _tag: "receipt"; readonly payload: ManagerSuspenseReceiptPayload }
  | { readonly _tag: "payment"; readonly payload: ManagerSuspensePaymentPayload }
  | { readonly _tag: "skip"; readonly reason: ManagerSuspenseImportSkipReason }

export type ManagerBankAccountCurrencyImportDecision =
  | { readonly _tag: "import" }
  | { readonly _tag: "skip"; readonly warning: string }

export const managerPendingClearanceFields = {
  cleared: ManagerBankAccountClearStatusValue.onLaterDate,
} as const satisfies Pick<ManagerReceiptCreate, "cleared">

export const managerSettledClearanceFields = {
  cleared: ManagerBankAccountClearStatusValue.onSameDate,
} as const satisfies Pick<ManagerReceiptCreate, "cleared">

const buildManagerClearanceFields = (clearance: ManagerImportClearance) =>
  clearance._tag === "pending" ? managerPendingClearanceFields : managerSettledClearanceFields

const getManagerLineAmountMagnitude = (
  signedNormalizedAmount: ManagerLineAmount,
): ManagerLineAmount => {
  if (signedNormalizedAmount.startsWith("-") || signedNormalizedAmount.startsWith("+")) {
    return signedNormalizedAmount.slice(1)
  }

  return signedNormalizedAmount
}

const isZeroManagerLineAmount = (signedNormalizedAmount: ManagerLineAmount): boolean =>
  /^0+(?:\.0+)?$/.test(getManagerLineAmountMagnitude(signedNormalizedAmount))

export const buildManagerSuspenseImportDecision = (
  input: ManagerSuspenseImportDecisionInput,
): ManagerSuspenseImportDecision => {
  if (input.importabilityDecision._tag === "skip") {
    return {
      _tag: "skip",
      reason: { _tag: "notImportable", warning: input.importabilityDecision.warning },
    }
  }

  if (isZeroManagerLineAmount(input.signedNormalizedAmount)) {
    return {
      _tag: "skip",
      reason: { _tag: "zeroAmount", signedNormalizedAmount: input.signedNormalizedAmount },
    }
  }

  const amount = getManagerLineAmountMagnitude(input.signedNormalizedAmount)
  const line = {
    amount,
    lineDescription: input.description,
  } satisfies ManagerSuspenseLine
  const baseValue = {
    date: input.date,
    ...buildManagerClearanceFields(input.clearance),
    description: input.description,
    fdxTransactionId: input.fdxTransactionId,
    lines: [line] as const,
  }

  if (input.signedNormalizedAmount.startsWith("-")) {
    return {
      _tag: "payment",
      payload: {
        value: {
          ...baseValue,
          paidFrom: input.bankOrCashAccountKey,
        },
      } satisfies ManagerSuspensePaymentPayload,
    }
  }

  return {
    _tag: "receipt",
    payload: {
      value: {
        ...baseValue,
        receivedIn: input.bankOrCashAccountKey,
      },
    } satisfies ManagerSuspenseReceiptPayload,
  }
}

export const getManagerBankAccountCurrencyImportDecision = (
  account: Pick<ManagerBankOrCashAccount, "currency" | "name">,
): ManagerBankAccountCurrencyImportDecision => {
  if (account.currency == null || account.currency.trim() === "") {
    return { _tag: "import" }
  }

  return {
    _tag: "skip",
    warning: `Skipping ${account.name ?? "Manager bank/cash account"}: foreign-currency Manager imports are not verified yet (${account.currency}).`,
  }
}
