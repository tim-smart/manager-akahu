import { expect, test } from "vite-plus/test"
import {
  buildManagerSuspensePaymentPayload,
  buildManagerSuspenseReceiptPayload,
  getManagerBankAccountCurrencyImportDecision,
  managerApiPackageName,
  ManagerBankAccountClearStatusValue,
  managerPendingClearanceFields,
  managerSettledClearanceFields,
  managerSuspensePaymentValueCanOmitPayee,
  managerSuspenseReceiptValueCanOmitPaidBy,
} from "../src/index.ts"

test("exports the package name", () => {
  expect(managerApiPackageName).toBe("manager-api")
})

test("records Manager bank account clear status values behind names", () => {
  expect(ManagerBankAccountClearStatusValue).toEqual({
    onSameDate: 0,
    onLaterDate: 1,
  })
  expect(managerSettledClearanceFields).toEqual({ cleared: 0 })
  expect(managerPendingClearanceFields).toEqual({ cleared: 1 })
})

test("builds a minimal suspense receipt payload without paidBy or bankClearDate", () => {
  const payload = buildManagerSuspenseReceiptPayload({
    bankOrCashAccountKey: "bank-1",
    date: "2026-06-04",
    amount: "12.34",
    reference: "akahu-tx-1",
    description: "Coffee shop",
    fdxTransactionId: "akahu-tx-1",
    clearance: { _tag: "settled" },
  })

  expect(payload).toEqual({
    value: {
      date: "2026-06-04",
      reference: "akahu-tx-1",
      receivedIn: "bank-1",
      cleared: ManagerBankAccountClearStatusValue.onSameDate,
      description: "Coffee shop",
      lines: [{ amount: "12.34", lineDescription: "Coffee shop" }],
      fdxTransactionId: "akahu-tx-1",
    },
  })
  expect(managerSuspenseReceiptValueCanOmitPaidBy(payload.value!)).toBe(true)
  expect("bankClearDate" in payload.value!).toBe(false)
})

test("builds a minimal suspense payment payload without payee or bankClearDate", () => {
  const payload = buildManagerSuspensePaymentPayload({
    bankOrCashAccountKey: "bank-1",
    date: "2026-06-04",
    amount: "9.99",
    reference: "akahu-pending:v1:bank-1:2026-06-04:9.99:shop",
    description: "Shop",
    fdxTransactionId: "akahu-pending:v1:bank-1:2026-06-04:9.99:shop",
    clearance: { _tag: "pending" },
  })

  expect(payload).toEqual({
    value: {
      date: "2026-06-04",
      reference: "akahu-pending:v1:bank-1:2026-06-04:9.99:shop",
      paidFrom: "bank-1",
      cleared: ManagerBankAccountClearStatusValue.onLaterDate,
      description: "Shop",
      lines: [{ amount: "9.99", lineDescription: "Shop" }],
      fdxTransactionId: "akahu-pending:v1:bank-1:2026-06-04:9.99:shop",
    },
  })
  expect(managerSuspensePaymentValueCanOmitPayee(payload.value!)).toBe(true)
  expect("bankClearDate" in payload.value!).toBe(false)
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
