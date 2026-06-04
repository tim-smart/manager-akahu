import type {
  BankAccountClearStatus as ManagerBankAccountClearStatus,
  BankOrCashAccount as ManagerBankOrCashAccount,
  Receipt2 as ManagerReceiptCreate,
  Payment2 as ManagerPaymentCreate,
} from "./ManagerClient.ts"

export const ManagerBankAccountClearStatusValue = {
  onSameDate: 0,
  onLaterDate: 1,
} as const satisfies Record<string, ManagerBankAccountClearStatus>

export type ManagerImportClearance = { readonly _tag: "settled" } | { readonly _tag: "pending" }

export interface ManagerSuspenseImportInput {
  readonly bankOrCashAccountKey: string
  readonly date: string
  readonly amount: string
  readonly reference: string
  readonly description: string
  readonly fdxTransactionId: string
  readonly clearance: ManagerImportClearance
}

export interface ManagerSuspenseLine {
  readonly amount: string
  readonly lineDescription: string
}

export interface ManagerSuspenseReceiptValue {
  readonly date: NonNullable<ManagerReceiptCreate["date"]>
  readonly reference: NonNullable<ManagerReceiptCreate["reference"]>
  readonly receivedIn: NonNullable<ManagerReceiptCreate["receivedIn"]>
  readonly cleared: NonNullable<ManagerReceiptCreate["cleared"]>
  readonly description: NonNullable<ManagerReceiptCreate["description"]>
  readonly lines: readonly [ManagerSuspenseLine]
  readonly fdxTransactionId: NonNullable<ManagerReceiptCreate["fdxTransactionId"]>
}

export interface ManagerSuspenseReceiptPayload {
  readonly value: ManagerSuspenseReceiptValue
}

export interface ManagerSuspensePaymentValue {
  readonly date: NonNullable<ManagerPaymentCreate["date"]>
  readonly reference: NonNullable<ManagerPaymentCreate["reference"]>
  readonly paidFrom: NonNullable<ManagerPaymentCreate["paidFrom"]>
  readonly cleared: NonNullable<ManagerPaymentCreate["cleared"]>
  readonly description: NonNullable<ManagerPaymentCreate["description"]>
  readonly lines: readonly [ManagerSuspenseLine]
  readonly fdxTransactionId: NonNullable<ManagerPaymentCreate["fdxTransactionId"]>
}

export interface ManagerSuspensePaymentPayload {
  readonly value: ManagerSuspensePaymentValue
}

export type ManagerBankAccountCurrencyImportDecision =
  | { readonly _tag: "import" }
  | { readonly _tag: "skip"; readonly warning: string }

export const managerPendingClearanceFields = {
  cleared: ManagerBankAccountClearStatusValue.onLaterDate,
} as const satisfies Pick<ManagerReceiptCreate, "cleared">

export const managerSettledClearanceFields = {
  cleared: ManagerBankAccountClearStatusValue.onSameDate,
} as const satisfies Pick<ManagerReceiptCreate, "cleared">

const buildManagerSuspenseLine = (
  input: Pick<ManagerSuspenseImportInput, "amount" | "description">,
) => ({
  amount: input.amount,
  lineDescription: input.description,
})

const buildManagerClearanceFields = (clearance: ManagerImportClearance) =>
  clearance._tag === "pending" ? managerPendingClearanceFields : managerSettledClearanceFields

export const buildManagerSuspenseReceiptPayload = (
  input: ManagerSuspenseImportInput,
): ManagerSuspenseReceiptPayload => ({
  value: {
    date: input.date,
    reference: input.reference,
    receivedIn: input.bankOrCashAccountKey,
    ...buildManagerClearanceFields(input.clearance),
    description: input.description,
    lines: [buildManagerSuspenseLine(input)],
    fdxTransactionId: input.fdxTransactionId,
  },
})

export const buildManagerSuspensePaymentPayload = (
  input: ManagerSuspenseImportInput,
): ManagerSuspensePaymentPayload => ({
  value: {
    date: input.date,
    reference: input.reference,
    paidFrom: input.bankOrCashAccountKey,
    ...buildManagerClearanceFields(input.clearance),
    description: input.description,
    lines: [buildManagerSuspenseLine(input)],
    fdxTransactionId: input.fdxTransactionId,
  },
})

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
