import { expect, test } from "@effect/vitest"
import {
  buildManagerSuspenseImportDecision,
  getManagerBankAccountCurrencyImportDecision,
  ManagerBankAccountClearStatusValue,
  managerPendingClearanceFields,
  managerSettledClearanceFields,
  type ManagerSuspenseImportDecision,
} from "../src/index.ts"

type ManagerSuspenseReceiptDecision = Extract<
  ManagerSuspenseImportDecision,
  { readonly _tag: "receipt" }
>
type ManagerSuspensePaymentDecision = Extract<
  ManagerSuspenseImportDecision,
  { readonly _tag: "payment" }
>

const expectReceiptDecision = (
  decision: ManagerSuspenseImportDecision,
): ManagerSuspenseReceiptDecision => {
  expect(decision._tag).toBe("receipt")
  if (decision._tag !== "receipt") {
    throw new Error(`Expected receipt decision, got ${decision._tag}`)
  }

  return decision
}

const expectPaymentDecision = (
  decision: ManagerSuspenseImportDecision,
): ManagerSuspensePaymentDecision => {
  expect(decision._tag).toBe("payment")
  if (decision._tag !== "payment") {
    throw new Error(`Expected payment decision, got ${decision._tag}`)
  }

  return decision
}

test("records Manager bank account clear status values behind names", () => {
  expect(ManagerBankAccountClearStatusValue).toEqual({
    onSameDate: 0,
    onLaterDate: 1,
  })
  expect(managerSettledClearanceFields).toEqual({ cleared: 0 })
  expect(managerPendingClearanceFields).toEqual({ cleared: 1 })
})

test("builds a receipt import decision for positive signed amounts", () => {
  const decision = buildManagerSuspenseImportDecision({
    bankOrCashAccountKey: "bank-1",
    date: "2026-06-04",
    signedNormalizedAmount: "12.34",
    description: "Coffee shop",
    fdxTransactionId: "akahu-tx-1",
    clearance: { _tag: "settled" },
    importabilityDecision: { _tag: "import" },
  })

  expect(decision).toEqual({
    _tag: "receipt",
    payload: {
      value: {
        date: "2026-06-04",
        receivedIn: "bank-1",
        cleared: ManagerBankAccountClearStatusValue.onSameDate,
        description: "Coffee shop",
        lines: [{ amount: "12.34", lineDescription: "Coffee shop" }],
        fdxTransactionId: "akahu-tx-1",
      },
    },
  })
  const receipt = expectReceiptDecision(decision)
  expect("paidBy" in receipt.payload.value).toBe(false)
  expect("bankClearDate" in receipt.payload.value).toBe(false)
})

test("builds a payment import decision for negative signed amounts using the absolute amount", () => {
  const decision = buildManagerSuspenseImportDecision({
    bankOrCashAccountKey: "bank-1",
    date: "2026-06-04",
    signedNormalizedAmount: "-9.99",
    description: "Shop",
    fdxTransactionId: "akahu-pending:v1:bank-1:2026-06-04:9.99:shop",
    clearance: { _tag: "pending" },
    importabilityDecision: { _tag: "import" },
  })

  expect(decision).toEqual({
    _tag: "payment",
    payload: {
      value: {
        date: "2026-06-04",
        paidFrom: "bank-1",
        cleared: ManagerBankAccountClearStatusValue.onLaterDate,
        description: "Shop",
        lines: [{ amount: "9.99", lineDescription: "Shop" }],
        fdxTransactionId: "akahu-pending:v1:bank-1:2026-06-04:9.99:shop",
      },
    },
  })
  const payment = expectPaymentDecision(decision)
  expect("payee" in payment.payload.value).toBe(false)
  expect("bankClearDate" in payment.payload.value).toBe(false)
})

test("skips zero signed amounts before receipt or payment classification", () => {
  expect(
    buildManagerSuspenseImportDecision({
      bankOrCashAccountKey: "bank-1",
      date: "2026-06-04",
      signedNormalizedAmount: "0.00",
      description: "Zero value",
      fdxTransactionId: "akahu-tx-1",
      clearance: { _tag: "settled" },
      importabilityDecision: { _tag: "import" },
    }),
  ).toEqual({ _tag: "skip", reason: { _tag: "zeroAmount", signedNormalizedAmount: "0.00" } })
})

test("returns explicit skip decisions for unsupported Manager account imports", () => {
  expect(
    buildManagerSuspenseImportDecision({
      bankOrCashAccountKey: "bank-1",
      date: "2026-06-04",
      signedNormalizedAmount: "12.34",
      description: "Coffee shop",
      fdxTransactionId: "akahu-tx-1",
      clearance: { _tag: "settled" },
      importabilityDecision: { _tag: "skip", warning: "Skipping foreign account" },
    }),
  ).toEqual({
    _tag: "skip",
    reason: { _tag: "notImportable", warning: "Skipping foreign account" },
  })
})

test("skips foreign-currency Manager accounts until write behaviour is verified", () => {
  expect(getManagerBankAccountCurrencyImportDecision({ currency: null, name: "Local" })).toEqual({
    _tag: "import",
  })
  expect(getManagerBankAccountCurrencyImportDecision({ currency: "USD", name: "Foreign" })).toEqual(
    {
      _tag: "skip",
      warning: "Skipping Foreign: foreign-currency Manager imports are not verified yet (USD).",
    },
  )
})
