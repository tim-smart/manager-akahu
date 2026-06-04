import { Effect } from "effect"
import { expect, test } from "vite-plus/test"
import type {
  ManagerBankOrCashAccountSyncReadClient,
  ManagerPaymentBatchClient,
  ManagerPaymentBatchParams,
  ManagerPaymentItem,
  ManagerReceiptBatchClient,
  ManagerReceiptBatchParams,
  ManagerReceiptItem,
} from "../src/index.ts"
import {
  fetchManagerBankOrCashAccountSyncRead,
  fetchAllManagerPaymentsForBankOrCashAccount,
  fetchAllManagerReceiptsForBankOrCashAccount,
  managerBatchReadDefaultPageSize,
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

const receiptItems = (
  firstKeyNumber: number,
  count: number,
  fdxTransactionIds: ReadonlyMap<number, string> = new Map(),
): ReadonlyArray<ManagerReceiptItem> =>
  Array.from({ length: count }, (_, index) => {
    const keyNumber = firstKeyNumber + index
    return receiptItem(`receipt-${keyNumber}`, fdxTransactionIds.get(keyNumber) ?? "")
  })

const paymentItems = (
  firstKeyNumber: number,
  count: number,
  fdxTransactionIds: ReadonlyMap<number, string> = new Map(),
): ReadonlyArray<ManagerPaymentItem> =>
  Array.from({ length: count }, (_, index) => {
    const keyNumber = firstKeyNumber + index
    return paymentItem(`payment-${keyNumber}`, fdxTransactionIds.get(keyNumber) ?? "")
  })

const makeReceiptBatchClient = (
  pages: ReadonlyMap<number, ReadonlyArray<ManagerReceiptItem>>,
  requests: Array<ManagerReceiptBatchParams>,
): ManagerReceiptBatchClient => ({
  "GET/api4/receipt-batch": (options) =>
    Effect.sync(() => {
      requests.push(options ?? {})
      return {
        _links: null,
        _actions: null,
        items: pages.get(Number(options?.Skip ?? 0)) ?? [],
      }
    }),
})

const makePaymentBatchClient = (
  pages: ReadonlyMap<number, ReadonlyArray<ManagerPaymentItem>>,
  requests: Array<ManagerPaymentBatchParams>,
): ManagerPaymentBatchClient => ({
  "GET/api4/payment-batch": (options) =>
    Effect.sync(() => {
      requests.push(options ?? {})
      return {
        _links: null,
        _actions: null,
        items: pages.get(Number(options?.Skip ?? 0)) ?? [],
      }
    }),
})

const makeSyncReadClient = (options: {
  readonly receiptPages: ReadonlyMap<number, ReadonlyArray<ManagerReceiptItem>>
  readonly receiptRequests: Array<ManagerReceiptBatchParams>
  readonly paymentPages: ReadonlyMap<number, ReadonlyArray<ManagerPaymentItem>>
  readonly paymentRequests: Array<ManagerPaymentBatchParams>
}): ManagerBankOrCashAccountSyncReadClient => ({
  ...makeReceiptBatchClient(options.receiptPages, options.receiptRequests),
  ...makePaymentBatchClient(options.paymentPages, options.paymentRequests),
})

test("fetches every Manager receipt batch page for the selected bank/cash account", () => {
  const requests: Array<ManagerReceiptBatchParams> = []
  const pages = new Map<number, ReadonlyArray<ManagerReceiptItem>>([
    [0, receiptItems(1, managerBatchReadDefaultPageSize)],
    [
      managerBatchReadDefaultPageSize,
      receiptItems(
        managerBatchReadDefaultPageSize + 1,
        managerBatchReadDefaultPageSize,
        new Map([[managerBatchReadDefaultPageSize + 1, "akahu-tx-existing"]]),
      ),
    ],
    [managerBatchReadDefaultPageSize * 2, receiptItems(managerBatchReadDefaultPageSize * 2 + 1, 1)],
  ])
  const client = makeReceiptBatchClient(pages, requests)

  return Effect.runPromise(
    fetchAllManagerReceiptsForBankOrCashAccount(client, {
      bankOrCashAccountKey: "bank-1",
      business: "business-1",
    }),
  ).then((receipts) => {
    expect(receipts).toHaveLength(managerBatchReadDefaultPageSize * 2 + 1)
    expect(receipts[0]?.key).toBe("receipt-1")
    expect(receipts[managerBatchReadDefaultPageSize]?.key).toBe(
      `receipt-${managerBatchReadDefaultPageSize + 1}`,
    )
    expect(receipts[managerBatchReadDefaultPageSize * 2]?.key).toBe(
      `receipt-${managerBatchReadDefaultPageSize * 2 + 1}`,
    )
    expect(receipts.some((receipt) => receipt.item.fdxTransactionId === "akahu-tx-existing")).toBe(
      true,
    )
    expect(requests).toEqual([
      {
        BankOrCashAccount: "bank-1",
        Business: "business-1",
        Skip: 0,
        PageSize: managerBatchReadDefaultPageSize,
      },
      {
        BankOrCashAccount: "bank-1",
        Business: "business-1",
        Skip: managerBatchReadDefaultPageSize,
        PageSize: managerBatchReadDefaultPageSize,
      },
      {
        BankOrCashAccount: "bank-1",
        Business: "business-1",
        Skip: managerBatchReadDefaultPageSize * 2,
        PageSize: managerBatchReadDefaultPageSize,
      },
    ])
  })
})

test("fetches every Manager payment batch page for the selected bank/cash account", () => {
  const requests: Array<ManagerPaymentBatchParams> = []
  const pages = new Map<number, ReadonlyArray<ManagerPaymentItem>>([
    [0, paymentItems(1, managerBatchReadDefaultPageSize)],
    [
      managerBatchReadDefaultPageSize,
      paymentItems(
        managerBatchReadDefaultPageSize + 1,
        managerBatchReadDefaultPageSize,
        new Map([[managerBatchReadDefaultPageSize + 1, "akahu-tx-existing"]]),
      ),
    ],
    [managerBatchReadDefaultPageSize * 2, []],
  ])
  const client = makePaymentBatchClient(pages, requests)

  return Effect.runPromise(
    fetchAllManagerPaymentsForBankOrCashAccount(client, {
      bankOrCashAccountKey: "bank-1",
    }),
  ).then((payments) => {
    expect(payments).toHaveLength(managerBatchReadDefaultPageSize * 2)
    expect(payments[0]?.key).toBe("payment-1")
    expect(payments[managerBatchReadDefaultPageSize]?.key).toBe(
      `payment-${managerBatchReadDefaultPageSize + 1}`,
    )
    expect(payments.some((payment) => payment.item.fdxTransactionId === "akahu-tx-existing")).toBe(
      true,
    )
    expect(requests).toEqual([
      {
        BankOrCashAccount: "bank-1",
        Business: undefined,
        Skip: 0,
        PageSize: managerBatchReadDefaultPageSize,
      },
      {
        BankOrCashAccount: "bank-1",
        Business: undefined,
        Skip: managerBatchReadDefaultPageSize,
        PageSize: managerBatchReadDefaultPageSize,
      },
      {
        BankOrCashAccount: "bank-1",
        Business: undefined,
        Skip: managerBatchReadDefaultPageSize * 2,
        PageSize: managerBatchReadDefaultPageSize,
      },
    ])
  })
})

test("fetches the canonical Manager sync read model with receipt and payment fdxTransactionId entries", () => {
  const receiptRequests: Array<ManagerReceiptBatchParams> = []
  const paymentRequests: Array<ManagerPaymentBatchParams> = []
  const receiptPages = new Map<number, ReadonlyArray<ManagerReceiptItem>>([
    [0, receiptItems(1, managerBatchReadDefaultPageSize, new Map([[1, "receipt-first-page"]]))],
    [
      managerBatchReadDefaultPageSize,
      [
        receiptItem(`receipt-${managerBatchReadDefaultPageSize + 1}`, "akahu-tx-existing"),
        receiptItem(`receipt-${managerBatchReadDefaultPageSize + 2}`, "receipt-last"),
      ],
    ],
  ])
  const paymentPages = new Map<number, ReadonlyArray<ManagerPaymentItem>>([
    [
      0,
      paymentItems(
        1,
        managerBatchReadDefaultPageSize,
        new Map([
          [1, "payment-first-page"],
          [2, "payment-2"],
        ]),
      ),
    ],
    [
      managerBatchReadDefaultPageSize,
      [
        paymentItem(`payment-${managerBatchReadDefaultPageSize + 1}`, "akahu-tx-existing"),
        paymentItem(`payment-${managerBatchReadDefaultPageSize + 2}`, "payment-last"),
      ],
    ],
  ])
  const client = makeSyncReadClient({
    receiptPages,
    receiptRequests,
    paymentPages,
    paymentRequests,
  })

  return Effect.runPromise(
    fetchManagerBankOrCashAccountSyncRead(client, {
      bankOrCashAccountKey: "bank-1",
      business: "business-1",
    }),
  ).then((syncRead) => {
    expect(syncRead.receipts).toHaveLength(managerBatchReadDefaultPageSize + 2)
    expect(syncRead.payments).toHaveLength(managerBatchReadDefaultPageSize + 2)
    expect(syncRead.receipts[0]?.key).toBe("receipt-1")
    expect(syncRead.receipts[managerBatchReadDefaultPageSize]?.key).toBe(
      `receipt-${managerBatchReadDefaultPageSize + 1}`,
    )
    expect(syncRead.payments[0]?.key).toBe("payment-1")
    expect(syncRead.payments[managerBatchReadDefaultPageSize]?.key).toBe(
      `payment-${managerBatchReadDefaultPageSize + 1}`,
    )
    expect(syncRead.existingFdxTransactionIdEntries.map((entry) => entry.fdxTransactionId)).toEqual(
      [
        "receipt-first-page",
        "akahu-tx-existing",
        "receipt-last",
        "payment-first-page",
        "payment-2",
        "akahu-tx-existing",
        "payment-last",
      ],
    )
    expect(syncRead.existingFdxTransactionIdIndex.get("akahu-tx-existing")).toEqual([
      {
        _tag: "receipt",
        fdxTransactionId: "akahu-tx-existing",
        key: `receipt-${managerBatchReadDefaultPageSize + 1}`,
        receipt: receiptItem(`receipt-${managerBatchReadDefaultPageSize + 1}`, "akahu-tx-existing"),
      },
      {
        _tag: "payment",
        fdxTransactionId: "akahu-tx-existing",
        key: `payment-${managerBatchReadDefaultPageSize + 1}`,
        payment: paymentItem(`payment-${managerBatchReadDefaultPageSize + 1}`, "akahu-tx-existing"),
      },
    ])
    expect(receiptRequests).toEqual([
      {
        BankOrCashAccount: "bank-1",
        Business: "business-1",
        Skip: 0,
        PageSize: managerBatchReadDefaultPageSize,
      },
      {
        BankOrCashAccount: "bank-1",
        Business: "business-1",
        Skip: managerBatchReadDefaultPageSize,
        PageSize: managerBatchReadDefaultPageSize,
      },
    ])
    expect(paymentRequests).toEqual([
      {
        BankOrCashAccount: "bank-1",
        Business: "business-1",
        Skip: 0,
        PageSize: managerBatchReadDefaultPageSize,
      },
      {
        BankOrCashAccount: "bank-1",
        Business: "business-1",
        Skip: managerBatchReadDefaultPageSize,
        PageSize: managerBatchReadDefaultPageSize,
      },
    ])
  })
})
