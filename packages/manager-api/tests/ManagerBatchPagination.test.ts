import { Effect } from "effect"
import { expect, it } from "@effect/vitest"
import type {
  ManagerBankOrCashAccountBatchReadInput,
  ManagerBankOrCashAccountSyncReadClient,
  ManagerInterAccountTransferBatchClient,
  ManagerInterAccountTransferBatchParams,
  ManagerInterAccountTransferItem,
  ManagerPaymentBatchClient,
  ManagerPaymentBatchParams,
  ManagerPaymentItem,
  ManagerReceiptBatchClient,
  ManagerReceiptBatchParams,
  ManagerReceiptItem,
} from "../src/index.ts"
import {
  fetchAllManagerInterAccountTransfersForBankOrCashAccount,
  fetchManagerBankOrCashAccountSyncRead,
  fetchAllManagerPaymentsForBankOrCashAccount,
  fetchAllManagerReceiptsForBankOrCashAccount,
  managerBatchReadDefaultPageSize,
} from "../src/index.ts"

const bankOrCashAccountKey = "bank-1"
const business = "business-1"
const fullPageSize = managerBatchReadDefaultPageSize

const publicSyncReadInput = {
  bankOrCashAccountKey,
  business,
} satisfies ManagerBankOrCashAccountBatchReadInput

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

const interAccountTransferItem = (
  key: string,
  item: ManagerInterAccountTransferItem["item"],
): ManagerInterAccountTransferItem => ({
  key,
  item,
  _links: null,
  _actions: null,
})

const pageSkip = (pageIndex: number) => pageIndex * fullPageSize

const pageItemNumber = (pageIndex: number, pageOffset = 0) => pageSkip(pageIndex) + pageOffset + 1

const itemKey = (
  kind: "receipt" | "payment" | "inter-account-transfer",
  pageIndex: number,
  pageOffset = 0,
) => `${kind}-${pageItemNumber(pageIndex, pageOffset)}`

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

const interAccountTransferItems = (
  pageIndex: number,
  count: number,
  items: ReadonlyMap<number, ManagerInterAccountTransferItem["item"]> = new Map(),
): ReadonlyArray<ManagerInterAccountTransferItem> =>
  Array.from({ length: count }, (_, index) => {
    const keyNumber = pageItemNumber(pageIndex, index)
    return interAccountTransferItem(
      `inter-account-transfer-${keyNumber}`,
      items.get(index) ?? { paidFrom: bankOrCashAccountKey, receivedIn: "bank-other" },
    )
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

const interAccountTransferPage = (
  pageIndex: number,
  count: number,
  items: ReadonlyMap<number, ManagerInterAccountTransferItem["item"]> = new Map(),
): readonly [number, ReadonlyArray<ManagerInterAccountTransferItem>] => [
  pageSkip(pageIndex),
  interAccountTransferItems(pageIndex, count, items),
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

const expectInterAccountTransferBatchRequests = (
  requests: ReadonlyArray<ManagerInterAccountTransferBatchParams>,
  pageIndexes: ReadonlyArray<number>,
  options: { readonly business?: string } = {},
) => {
  expect(requests).toEqual(
    pageIndexes.map((pageIndex) => ({
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

const makeInterAccountTransferBatchClient = (
  pages: ReadonlyMap<number, ReadonlyArray<ManagerInterAccountTransferItem>>,
  requests: Array<ManagerInterAccountTransferBatchParams>,
): ManagerInterAccountTransferBatchClient => ({
  "GET/api4/inter-account-transfer-batch": (options) =>
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
  readonly interAccountTransferPages?: ReadonlyMap<
    number,
    ReadonlyArray<ManagerInterAccountTransferItem>
  >
  readonly interAccountTransferRequests?: Array<ManagerInterAccountTransferBatchParams>
}): ManagerBankOrCashAccountSyncReadClient => ({
  ...makeReceiptBatchClient(options.receiptPages, options.receiptRequests),
  ...makePaymentBatchClient(options.paymentPages, options.paymentRequests),
  ...makeInterAccountTransferBatchClient(
    options.interAccountTransferPages ?? new Map(),
    options.interAccountTransferRequests ?? [],
  ),
})

it.effect("fetches every Manager receipt batch page for the selected bank/cash account", () =>
  Effect.gen(function* () {
    const requests: Array<ManagerReceiptBatchParams> = []
    const pages = new Map<number, ReadonlyArray<ManagerReceiptItem>>([
      receiptPage(0, fullPageSize),
      receiptPage(1, fullPageSize, new Map([[0, "akahu-tx-existing"]])),
      receiptPage(2, 1),
    ])
    const client = makeReceiptBatchClient(pages, requests)
    const receipts = yield* fetchAllManagerReceiptsForBankOrCashAccount(client, publicSyncReadInput)
    expect(receipts).toHaveLength(totalItems(fullPageSize, fullPageSize, 1))
    expectKeyAtPageOffset(receipts, "receipt", 0)
    expectKeyAtPageOffset(receipts, "receipt", 1)
    expectKeyAtPageOffset(receipts, "receipt", 2)
    expect(receipts.some((receipt) => receipt.item.fdxTransactionId === "akahu-tx-existing")).toBe(
      true,
    )
    expectBatchRequests(requests, [0, 1, 2], { business })
  }),
)

it.effect("fetches every Manager payment batch page for the selected bank/cash account", () =>
  Effect.gen(function* () {
    const requests: Array<ManagerPaymentBatchParams> = []
    const pages = new Map<number, ReadonlyArray<ManagerPaymentItem>>([
      paymentPage(0, fullPageSize),
      paymentPage(1, fullPageSize, new Map([[0, "akahu-tx-existing"]])),
      paymentPage(2, 0),
    ])
    const client = makePaymentBatchClient(pages, requests)

    const payments = yield* fetchAllManagerPaymentsForBankOrCashAccount(client, {
      bankOrCashAccountKey,
    })
    expect(payments).toHaveLength(totalItems(fullPageSize, fullPageSize))
    expectKeyAtPageOffset(payments, "payment", 0)
    expectKeyAtPageOffset(payments, "payment", 1)
    expect(payments.some((payment) => payment.item.fdxTransactionId === "akahu-tx-existing")).toBe(
      true,
    )
    expectBatchRequests(requests, [0, 1, 2])
  }),
)

it.effect(
  "fetches every Manager inter-account transfer page and filters to the selected account",
  () =>
    Effect.gen(function* () {
      const requests: Array<ManagerInterAccountTransferBatchParams> = []
      const unrelatedTransfer = { paidFrom: "bank-unrelated-1", receivedIn: "bank-unrelated-2" }
      const pages = new Map<number, ReadonlyArray<ManagerInterAccountTransferItem>>([
        interAccountTransferPage(0, fullPageSize),
        interAccountTransferPage(
          1,
          3,
          new Map([
            [0, { paidFrom: "bank-other", receivedIn: bankOrCashAccountKey }],
            [1, unrelatedTransfer],
            [2, { paidFrom: bankOrCashAccountKey, receivedIn: "bank-other" }],
          ]),
        ),
      ])
      const client = makeInterAccountTransferBatchClient(pages, requests)

      const interAccountTransfers = yield* fetchAllManagerInterAccountTransfersForBankOrCashAccount(
        client,
        publicSyncReadInput,
      )

      expect(interAccountTransfers).toHaveLength(totalItems(fullPageSize, 2))
      expect(interAccountTransfers[0]?.key).toBe(itemKey("inter-account-transfer", 0))
      expect(interAccountTransfers.at(-2)?.item).toEqual({
        paidFrom: "bank-other",
        receivedIn: bankOrCashAccountKey,
      })
      expect(interAccountTransfers.at(-1)?.item).toEqual({
        paidFrom: bankOrCashAccountKey,
        receivedIn: "bank-other",
      })
      expect(interAccountTransfers.some((transfer) => transfer.item === unrelatedTransfer)).toBe(
        false,
      )
      expectInterAccountTransferBatchRequests(requests, [0, 1], { business })
    }),
)

it.effect(
  "fetches the canonical Manager sync read model with receipt, payment, and transfer fdx entries",
  () =>
    Effect.gen(function* () {
      const receiptRequests: Array<ManagerReceiptBatchParams> = []
      const paymentRequests: Array<ManagerPaymentBatchParams> = []
      const interAccountTransferRequests: Array<ManagerInterAccountTransferBatchParams> = []
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
      const interAccountTransfer = interAccountTransferItem("inter-account-transfer-1", {
        paidFrom: bankOrCashAccountKey,
        receivedIn: "bank-other",
        fdxCreditTransactionId: "akahu-tx-existing",
        fdxDebitTransactionId: "transfer-debit",
      })
      const interAccountTransferPages = new Map<
        number,
        ReadonlyArray<ManagerInterAccountTransferItem>
      >([
        [
          0,
          [
            interAccountTransfer,
            interAccountTransferItem("inter-account-transfer-unrelated", {
              paidFrom: "bank-unrelated-1",
              receivedIn: "bank-unrelated-2",
              fdxCreditTransactionId: "unrelated-credit",
              fdxDebitTransactionId: "unrelated-debit",
            }),
          ],
        ],
      ])
      const client = makeSyncReadClient({
        receiptPages,
        receiptRequests,
        paymentPages,
        paymentRequests,
        interAccountTransferPages,
        interAccountTransferRequests,
      })

      const syncRead = yield* fetchManagerBankOrCashAccountSyncRead(client, publicSyncReadInput)
      expect(syncRead.bankOrCashAccountKey).toBe(bankOrCashAccountKey)
      expect(syncRead.receipts).toHaveLength(totalItems(fullPageSize, 2))
      expect(syncRead.payments).toHaveLength(totalItems(fullPageSize, 2))
      expect(syncRead.interAccountTransfers).toEqual([interAccountTransfer])
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
        "akahu-tx-existing",
        "transfer-debit",
      ])
      expect(
        syncRead.existingReceiptPaymentFdxTransactionIdEntries.map(
          (entry) => entry.fdxTransactionId,
        ),
      ).toEqual([
        "receipt-first-page",
        "akahu-tx-existing",
        "receipt-last",
        "payment-first-page",
        "payment-2",
        "akahu-tx-existing",
        "payment-last",
      ])
      expect(
        syncRead.existingTransferFdxTransactionIdEntries.map((entry) => entry.fdxTransactionId),
      ).toEqual(["akahu-tx-existing", "transfer-debit"])
      expect(
        syncRead.existingReceiptPaymentFdxTransactionIdIndex.get("akahu-tx-existing"),
      ).toHaveLength(2)
      expect(syncRead.existingTransferFdxTransactionIdIndex.get("akahu-tx-existing")).toEqual([
        {
          _tag: "interAccountTransfer",
          fdxTransactionId: "akahu-tx-existing",
          key: "inter-account-transfer-1",
          transferSide: "credit",
          interAccountTransfer,
        },
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
        {
          _tag: "interAccountTransfer",
          fdxTransactionId: "akahu-tx-existing",
          key: "inter-account-transfer-1",
          transferSide: "credit",
          interAccountTransfer,
        },
      ])
      expect(syncRead.existingFdxTransactionIdIndex.get("transfer-debit")).toEqual([
        {
          _tag: "interAccountTransfer",
          fdxTransactionId: "transfer-debit",
          key: "inter-account-transfer-1",
          transferSide: "debit",
          interAccountTransfer,
        },
      ])
      expectBatchRequests(receiptRequests, [0, 1], { business })
      expectBatchRequests(paymentRequests, [0, 1], { business })
      expectInterAccountTransferBatchRequests(interAccountTransferRequests, [0], { business })
    }),
)
