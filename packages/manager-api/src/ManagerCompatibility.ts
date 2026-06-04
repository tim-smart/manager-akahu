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

export interface ManagerSuspenseImportInput {
  readonly bankOrCashAccountKey: string
  readonly date: string
  readonly amount: number | string
  readonly reference: string
  readonly description: string
  readonly fdxTransactionId: string
  readonly clearance: ManagerImportClearance
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
): ManagerPostReceipt => ({
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
): ManagerPostPayment => ({
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

export const managerSuspenseReceiptValueCanOmitPaidBy = (value: ManagerReceiptCreate): boolean =>
  value.paidBy === undefined

export const managerSuspensePaymentValueCanOmitPayee = (value: ManagerPaymentCreate): boolean =>
  value.payee === undefined

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
