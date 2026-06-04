import { Effect } from "effect"
import type {
  Api4PaymentBatchParams,
  Api4ReceiptBatchParams,
  BusinessObjectsResourceOfPayment,
  BusinessObjectsResourceOfReceipt,
  Client,
  ItemOfPayment,
  ItemOfReceipt,
} from "./ManagerClient.ts"

export const managerBatchReadDefaultPageSize = 100

export interface ManagerBankOrCashAccountBatchReadInput {
  readonly bankOrCashAccountKey: string
  readonly business?: string | undefined
}

export type ManagerReceiptBatchClient = Pick<Client, "GET/api4/receipt-batch">
export type ManagerPaymentBatchClient = Pick<Client, "GET/api4/payment-batch">
export type ManagerBankOrCashAccountSyncReadClient = ManagerReceiptBatchClient &
  ManagerPaymentBatchClient

export type ManagerExistingFdxTransactionIdEntry =
  | {
      readonly _tag: "receipt"
      readonly fdxTransactionId: string
      readonly key: string
      readonly receipt: ItemOfReceipt
    }
  | {
      readonly _tag: "payment"
      readonly fdxTransactionId: string
      readonly key: string
      readonly payment: ItemOfPayment
    }

export interface ManagerBankOrCashAccountSyncRead {
  readonly receipts: ReadonlyArray<ItemOfReceipt>
  readonly payments: ReadonlyArray<ItemOfPayment>
  readonly existingFdxTransactionIdEntries: ReadonlyArray<ManagerExistingFdxTransactionIdEntry>
  readonly existingFdxTransactionIdIndex: ReadonlyMap<
    string,
    ReadonlyArray<ManagerExistingFdxTransactionIdEntry>
  >
}

const buildManagerReceiptBatchParams = (
  input: ManagerBankOrCashAccountBatchReadInput,
  skip: number,
  pageSize: number,
): Api4ReceiptBatchParams => ({
  BankOrCashAccount: input.bankOrCashAccountKey,
  Business: input.business,
  Skip: skip,
  PageSize: pageSize,
})

const buildManagerPaymentBatchParams = (
  input: ManagerBankOrCashAccountBatchReadInput,
  skip: number,
  pageSize: number,
): Api4PaymentBatchParams => ({
  BankOrCashAccount: input.bankOrCashAccountKey,
  Business: input.business,
  Skip: skip,
  PageSize: pageSize,
})

const fetchAllManagerBatchItems = <Params, Page, Item, Error, Requirements>(options: {
  readonly input: ManagerBankOrCashAccountBatchReadInput
  readonly fetchPage: (params: Params) => Effect.Effect<Page, Error, Requirements>
  readonly buildParams: (
    input: ManagerBankOrCashAccountBatchReadInput,
    skip: number,
    pageSize: number,
  ) => Params
  readonly getItems: (page: Page) => ReadonlyArray<Item> | null | undefined
}): Effect.Effect<Array<Item>, Error, Requirements> =>
  Effect.gen(function* () {
    const pageSize = managerBatchReadDefaultPageSize
    const items: Array<Item> = []

    for (let skip = 0; ; skip += pageSize) {
      const page = yield* options.fetchPage(options.buildParams(options.input, skip, pageSize))
      const pageItems = options.getItems(page) ?? []
      items.push(...pageItems)

      if (pageItems.length < pageSize) {
        return items
      }
    }
  })

const appendExistingFdxTransactionIdEntry = (
  index: Map<string, Array<ManagerExistingFdxTransactionIdEntry>>,
  entry: ManagerExistingFdxTransactionIdEntry,
) => {
  const entries = index.get(entry.fdxTransactionId)
  if (entries === undefined) {
    index.set(entry.fdxTransactionId, [entry])
    return
  }

  entries.push(entry)
}

const buildManagerExistingFdxTransactionIdRead = (
  receipts: ReadonlyArray<ItemOfReceipt>,
  payments: ReadonlyArray<ItemOfPayment>,
): Pick<
  ManagerBankOrCashAccountSyncRead,
  "existingFdxTransactionIdEntries" | "existingFdxTransactionIdIndex"
> => {
  const entries: Array<ManagerExistingFdxTransactionIdEntry> = []
  const mutableIndex = new Map<string, Array<ManagerExistingFdxTransactionIdEntry>>()

  for (const receipt of receipts) {
    const fdxTransactionId = receipt.item.fdxTransactionId
    if (fdxTransactionId === undefined || fdxTransactionId === null || fdxTransactionId === "") {
      continue
    }

    const entry: ManagerExistingFdxTransactionIdEntry = {
      _tag: "receipt",
      fdxTransactionId,
      key: receipt.key,
      receipt,
    }
    entries.push(entry)
    appendExistingFdxTransactionIdEntry(mutableIndex, entry)
  }

  for (const payment of payments) {
    const fdxTransactionId = payment.item.fdxTransactionId
    if (fdxTransactionId === undefined || fdxTransactionId === null || fdxTransactionId === "") {
      continue
    }

    const entry: ManagerExistingFdxTransactionIdEntry = {
      _tag: "payment",
      fdxTransactionId,
      key: payment.key,
      payment,
    }
    entries.push(entry)
    appendExistingFdxTransactionIdEntry(mutableIndex, entry)
  }

  return {
    existingFdxTransactionIdEntries: entries,
    existingFdxTransactionIdIndex: new Map(mutableIndex),
  }
}

export const fetchAllManagerReceiptsForBankOrCashAccount = Effect.fn(
  "fetchAllManagerReceiptsForBankOrCashAccount",
)(function* (client: ManagerReceiptBatchClient, input: ManagerBankOrCashAccountBatchReadInput) {
  return yield* fetchAllManagerBatchItems({
    input,
    fetchPage: client["GET/api4/receipt-batch"],
    buildParams: buildManagerReceiptBatchParams,
    getItems: (page: BusinessObjectsResourceOfReceipt) => page.items,
  })
})

export const fetchAllManagerPaymentsForBankOrCashAccount = Effect.fn(
  "fetchAllManagerPaymentsForBankOrCashAccount",
)(function* (client: ManagerPaymentBatchClient, input: ManagerBankOrCashAccountBatchReadInput) {
  return yield* fetchAllManagerBatchItems({
    input,
    fetchPage: client["GET/api4/payment-batch"],
    buildParams: buildManagerPaymentBatchParams,
    getItems: (page: BusinessObjectsResourceOfPayment) => page.items,
  })
})

export const fetchManagerBankOrCashAccountSyncRead = Effect.fn(
  "fetchManagerBankOrCashAccountSyncRead",
)(function* (
  client: ManagerBankOrCashAccountSyncReadClient,
  input: ManagerBankOrCashAccountBatchReadInput,
) {
  const { receipts, payments } = yield* Effect.all(
    {
      receipts: fetchAllManagerReceiptsForBankOrCashAccount(client, input),
      payments: fetchAllManagerPaymentsForBankOrCashAccount(client, input),
    },
    { concurrency: "unbounded" },
  )
  const existingFdxTransactionIdRead = buildManagerExistingFdxTransactionIdRead(receipts, payments)

  return {
    receipts,
    payments,
    ...existingFdxTransactionIdRead,
  }
})
