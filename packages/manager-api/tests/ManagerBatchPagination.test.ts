import { Effect } from "effect"
import { expect, test } from "vite-plus/test"
import type {
  ManagerPaymentBatchClient,
  ManagerPaymentBatchParams,
  ManagerPaymentItem,
  ManagerReceiptBatchClient,
  ManagerReceiptBatchParams,
  ManagerReceiptItem,
} from "../src/index.ts"
import {
  fetchAllManagerPaymentsForBankOrCashAccount,
  fetchAllManagerReceiptsForBankOrCashAccount,
} from "../src/index.ts"

const receiptItem = (key: string, fdxTransactionId: string): ManagerReceiptItem => ({
  key,
  item: { fdxTransactionId },
  _links: null,
  _actions: null,
})

const paymentItem = (key: string, fdxTransactionId: string): ManagerPaymentItem => ({
  key,
  item: { fdxTransactionId },
  _links: null,
  _actions: null,
})

test("fetches every Manager receipt batch page for the selected bank/cash account", () => {
  const requests: Array<ManagerReceiptBatchParams> = []
  const pages = new Map<number, ReadonlyArray<ManagerReceiptItem>>([
    [0, [receiptItem("receipt-1", "other-1"), receiptItem("receipt-2", "other-2")]],
    [2, [receiptItem("receipt-3", "akahu-tx-existing"), receiptItem("receipt-4", "other-4")]],
    [4, [receiptItem("receipt-5", "other-5")]],
  ])
  const client: ManagerReceiptBatchClient = {
    "GET/api4/receipt-batch": (options) =>
      Effect.sync(() => {
        requests.push(options ?? {})
        return {
          _links: null,
          _actions: null,
          items: pages.get(Number(options?.Skip ?? 0)) ?? [],
        }
      }),
  }

  return Effect.runPromise(
    fetchAllManagerReceiptsForBankOrCashAccount(client, {
      bankOrCashAccountKey: "bank-1",
      business: "business-1",
      pageSize: 2,
    }),
  ).then((receipts) => {
    expect(receipts.map((receipt) => receipt.key)).toEqual([
      "receipt-1",
      "receipt-2",
      "receipt-3",
      "receipt-4",
      "receipt-5",
    ])
    expect(receipts.some((receipt) => receipt.item.fdxTransactionId === "akahu-tx-existing")).toBe(
      true,
    )
    expect(requests).toEqual([
      { BankOrCashAccount: "bank-1", Business: "business-1", Skip: 0, PageSize: 2 },
      { BankOrCashAccount: "bank-1", Business: "business-1", Skip: 2, PageSize: 2 },
      { BankOrCashAccount: "bank-1", Business: "business-1", Skip: 4, PageSize: 2 },
    ])
  })
})

test("fetches every Manager payment batch page for the selected bank/cash account", () => {
  const requests: Array<ManagerPaymentBatchParams> = []
  const pages = new Map<number, ReadonlyArray<ManagerPaymentItem>>([
    [0, [paymentItem("payment-1", "other-1"), paymentItem("payment-2", "other-2")]],
    [2, [paymentItem("payment-3", "other-3"), paymentItem("payment-4", "akahu-tx-existing")]],
    [4, []],
  ])
  const client: ManagerPaymentBatchClient = {
    "GET/api4/payment-batch": (options) =>
      Effect.sync(() => {
        requests.push(options ?? {})
        return {
          _links: null,
          _actions: null,
          items: pages.get(Number(options?.Skip ?? 0)) ?? [],
        }
      }),
  }

  return Effect.runPromise(
    fetchAllManagerPaymentsForBankOrCashAccount(client, {
      bankOrCashAccountKey: "bank-1",
      pageSize: 2,
    }),
  ).then((payments) => {
    expect(payments.map((payment) => payment.key)).toEqual([
      "payment-1",
      "payment-2",
      "payment-3",
      "payment-4",
    ])
    expect(payments.some((payment) => payment.item.fdxTransactionId === "akahu-tx-existing")).toBe(
      true,
    )
    expect(requests).toEqual([
      { BankOrCashAccount: "bank-1", Business: undefined, Skip: 0, PageSize: 2 },
      { BankOrCashAccount: "bank-1", Business: undefined, Skip: 2, PageSize: 2 },
      { BankOrCashAccount: "bank-1", Business: undefined, Skip: 4, PageSize: 2 },
    ])
  })
})
