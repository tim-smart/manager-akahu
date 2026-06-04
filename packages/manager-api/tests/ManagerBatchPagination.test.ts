import { Effect } from "effect"
import { expect, test } from "vite-plus/test"
import type {
  ManagerBankOrCashAccountBatchReadInput,
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

const bankOrCashAccountKey = "bank-1"
const business = "business-1"
const fullPageSize = managerBatchReadDefaultPageSize

type ManagerBankOrCashAccountBatchReadInputWithoutPageSize =
  Extract<keyof ManagerBankOrCashAccountBatchReadInput, "pageSize"> extends never
    ? ManagerBankOrCashAccountBatchReadInput
    : never

const publicSyncReadInput = {
  bankOrCashAccountKey,
  business,
} satisfies ManagerBankOrCashAccountBatchReadInputWithoutPageSize

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

const pageSkip = (pageIndex: number) => pageIndex * fullPageSize

const pageItemNumber = (pageIndex: number, pageOffset = 0) => pageSkip(pageIndex) + pageOffset + 1

const itemKey = (kind: "receipt" | "payment", pageIndex: number, pageOffset = 0) =>
  `${kind}-${pageItemNumber(pageIndex, pageOffset)}`

const totalItems = (...pageCounts: ReadonlyArray<number>) =>
  pageCounts.reduce((total, pageCount) => total + pageCount, 0)

const receiptItems = (
  pageIndex: number,
  count: number,
  fdxTransactionIds: ReadonlyMap<number, string> = new Map(),
): ReadonlyArray<ManagerReceiptItem> =>
  Array.from({ length: count }, (_, index) => {
    const keyNumber = pageItemNumber(pageIndex, index)
    return receiptItem(`receipt-${keyNumber}`, fdxTransactionIds.get(index) ?? "")
  })

const paymentItems = (
  pageIndex: number,
  count: number,
  fdxTransactionIds: ReadonlyMap<number, string> = new Map(),
): ReadonlyArray<ManagerPaymentItem> =>
  Array.from({ length: count }, (_, index) => {
    const keyNumber = pageItemNumber(pageIndex, index)
    return paymentItem(`payment-${keyNumber}`, fdxTransactionIds.get(index) ?? "")
  })

const receiptPage = (
  pageIndex: number,
  count: number,
  fdxTransactionIds: ReadonlyMap<number, string> = new Map(),
): readonly [number, ReadonlyArray<ManagerReceiptItem>] => [
  pageSkip(pageIndex),
  receiptItems(pageIndex, count, fdxTransactionIds),
]

const paymentPage = (
  pageIndex: number,
  count: number,
  fdxTransactionIds: ReadonlyMap<number, string> = new Map(),
): readonly [number, ReadonlyArray<ManagerPaymentItem>] => [
  pageSkip(pageIndex),
  paymentItems(pageIndex, count, fdxTransactionIds),
]

const expectKeyAtPageOffset = (
  items: ReadonlyArray<{ readonly key: string }>,
  kind: "receipt" | "payment",
  pageIndex: number,
  pageOffset = 0,
) => {
  expect(items[pageSkip(pageIndex) + pageOffset]?.key).toBe(itemKey(kind, pageIndex, pageOffset))
}

const expectBatchRequests = (
  requests: ReadonlyArray<ManagerReceiptBatchParams | ManagerPaymentBatchParams>,
  pageIndexes: ReadonlyArray<number>,
  options: { readonly business?: string } = {},
) => {
  expect(requests).toEqual(
    pageIndexes.map((pageIndex) => ({
      BankOrCashAccount: bankOrCashAccountKey,
      Business: options.business,
      Skip: pageSkip(pageIndex),
      PageSize: managerBatchReadDefaultPageSize,
    })),
  )
}

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
    receiptPage(0, fullPageSize),
    receiptPage(1, fullPageSize, new Map([[0, "akahu-tx-existing"]])),
    receiptPage(2, 1),
  ])
  const client = makeReceiptBatchClient(pages, requests)

  return Effect.runPromise(
    fetchAllManagerReceiptsForBankOrCashAccount(client, publicSyncReadInput),
  ).then((receipts) => {
    expect(receipts).toHaveLength(totalItems(fullPageSize, fullPageSize, 1))
    expectKeyAtPageOffset(receipts, "receipt", 0)
    expectKeyAtPageOffset(receipts, "receipt", 1)
    expectKeyAtPageOffset(receipts, "receipt", 2)
    expect(receipts.some((receipt) => receipt.item.fdxTransactionId === "akahu-tx-existing")).toBe(
      true,
    )
    expectBatchRequests(requests, [0, 1, 2], { business })
  })
})

test("fetches every Manager payment batch page for the selected bank/cash account", () => {
  const requests: Array<ManagerPaymentBatchParams> = []
  const pages = new Map<number, ReadonlyArray<ManagerPaymentItem>>([
    paymentPage(0, fullPageSize),
    paymentPage(1, fullPageSize, new Map([[0, "akahu-tx-existing"]])),
    paymentPage(2, 0),
  ])
  const client = makePaymentBatchClient(pages, requests)

  return Effect.runPromise(
    fetchAllManagerPaymentsForBankOrCashAccount(client, {
      bankOrCashAccountKey,
    }),
  ).then((payments) => {
    expect(payments).toHaveLength(totalItems(fullPageSize, fullPageSize))
    expectKeyAtPageOffset(payments, "payment", 0)
    expectKeyAtPageOffset(payments, "payment", 1)
    expect(payments.some((payment) => payment.item.fdxTransactionId === "akahu-tx-existing")).toBe(
      true,
    )
    expectBatchRequests(requests, [0, 1, 2])
  })
})

test("fetches the canonical Manager sync read model with receipt and payment fdxTransactionId entries", () => {
  const receiptRequests: Array<ManagerReceiptBatchParams> = []
  const paymentRequests: Array<ManagerPaymentBatchParams> = []
  const receiptPages = new Map<number, ReadonlyArray<ManagerReceiptItem>>([
    receiptPage(0, fullPageSize, new Map([[0, "receipt-first-page"]])),
    receiptPage(
      1,
      2,
      new Map([
        [0, "akahu-tx-existing"],
        [1, "receipt-last"],
      ]),
    ),
  ])
  const paymentPages = new Map<number, ReadonlyArray<ManagerPaymentItem>>([
    paymentPage(
      0,
      fullPageSize,
      new Map([
        [0, "payment-first-page"],
        [1, "payment-2"],
      ]),
    ),
    paymentPage(
      1,
      2,
      new Map([
        [0, "akahu-tx-existing"],
        [1, "payment-last"],
      ]),
    ),
  ])
  const client = makeSyncReadClient({
    receiptPages,
    receiptRequests,
    paymentPages,
    paymentRequests,
  })

  return Effect.runPromise(fetchManagerBankOrCashAccountSyncRead(client, publicSyncReadInput)).then(
    (syncRead) => {
      expect(syncRead.receipts).toHaveLength(totalItems(fullPageSize, 2))
      expect(syncRead.payments).toHaveLength(totalItems(fullPageSize, 2))
      expectKeyAtPageOffset(syncRead.receipts, "receipt", 0)
      expectKeyAtPageOffset(syncRead.receipts, "receipt", 1)
      expectKeyAtPageOffset(syncRead.payments, "payment", 0)
      expectKeyAtPageOffset(syncRead.payments, "payment", 1)
      expect(
        syncRead.existingFdxTransactionIdEntries.map((entry) => entry.fdxTransactionId),
      ).toEqual([
        "receipt-first-page",
        "akahu-tx-existing",
        "receipt-last",
        "payment-first-page",
        "payment-2",
        "akahu-tx-existing",
        "payment-last",
      ])
      expect(syncRead.existingFdxTransactionIdIndex.get("akahu-tx-existing")).toEqual([
        {
          _tag: "receipt",
          fdxTransactionId: "akahu-tx-existing",
          key: itemKey("receipt", 1),
          receipt: receiptItem(itemKey("receipt", 1), "akahu-tx-existing"),
        },
        {
          _tag: "payment",
          fdxTransactionId: "akahu-tx-existing",
          key: itemKey("payment", 1),
          payment: paymentItem(itemKey("payment", 1), "akahu-tx-existing"),
        },
      ])
      expectBatchRequests(receiptRequests, [0, 1], { business })
      expectBatchRequests(paymentRequests, [0, 1], { business })
    },
  )
})
