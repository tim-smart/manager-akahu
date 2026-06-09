import { Effect } from "effect"
import type {
  Api4InterAccountTransferBatchParams,
  Api4PaymentBatchParams,
  Api4ReceiptBatchParams,
  BusinessObjectsResourceOfInterAccountTransfer,
  BusinessObjectsResourceOfPayment,
  BusinessObjectsResourceOfReceipt,
  Client,
  ItemOfInterAccountTransfer,
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
export type ManagerInterAccountTransferBatchClient = Pick<
  Client,
  "GET/api4/inter-account-transfer-batch"
>
export type ManagerBankOrCashAccountSyncReadClient = ManagerReceiptBatchClient &
  ManagerPaymentBatchClient &
  ManagerInterAccountTransferBatchClient

export type ManagerExistingFdxTransactionIdTransferSide = "credit" | "debit"

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
  | {
      readonly _tag: "interAccountTransfer"
      readonly fdxTransactionId: string
      readonly key: string
      readonly transferSide: ManagerExistingFdxTransactionIdTransferSide
      readonly interAccountTransfer: ItemOfInterAccountTransfer
    }

export interface ManagerBankOrCashAccountSyncRead {
  readonly bankOrCashAccountKey: string
  readonly receipts: ReadonlyArray<ItemOfReceipt>
  readonly payments: ReadonlyArray<ItemOfPayment>
  readonly interAccountTransfers: ReadonlyArray<ItemOfInterAccountTransfer>
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

const buildManagerInterAccountTransferBatchParams = (
  input: ManagerBankOrCashAccountBatchReadInput,
  skip: number,
  pageSize: number,
): Api4InterAccountTransferBatchParams => ({
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

export const buildManagerBankOrCashAccountSyncRead = (input: {
  readonly bankOrCashAccountKey: string
  readonly receipts: ReadonlyArray<ItemOfReceipt>
  readonly payments: ReadonlyArray<ItemOfPayment>
  readonly interAccountTransfers?: ReadonlyArray<ItemOfInterAccountTransfer>
}): ManagerBankOrCashAccountSyncRead => {
  const entries: Array<ManagerExistingFdxTransactionIdEntry> = []
  const mutableIndex = new Map<string, Array<ManagerExistingFdxTransactionIdEntry>>()
  const interAccountTransfers = input.interAccountTransfers ?? []

  for (const receipt of input.receipts) {
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

  for (const payment of input.payments) {
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

  for (const interAccountTransfer of interAccountTransfers) {
    const fdxCreditTransactionId = interAccountTransfer.item.fdxCreditTransactionId
    if (
      fdxCreditTransactionId !== undefined &&
      fdxCreditTransactionId !== null &&
      fdxCreditTransactionId !== ""
    ) {
      const entry: ManagerExistingFdxTransactionIdEntry = {
        _tag: "interAccountTransfer",
        fdxTransactionId: fdxCreditTransactionId,
        key: interAccountTransfer.key,
        transferSide: "credit",
        interAccountTransfer,
      }
      entries.push(entry)
      appendExistingFdxTransactionIdEntry(mutableIndex, entry)
    }

    const fdxDebitTransactionId = interAccountTransfer.item.fdxDebitTransactionId
    if (
      fdxDebitTransactionId !== undefined &&
      fdxDebitTransactionId !== null &&
      fdxDebitTransactionId !== ""
    ) {
      const entry: ManagerExistingFdxTransactionIdEntry = {
        _tag: "interAccountTransfer",
        fdxTransactionId: fdxDebitTransactionId,
        key: interAccountTransfer.key,
        transferSide: "debit",
        interAccountTransfer,
      }
      entries.push(entry)
      appendExistingFdxTransactionIdEntry(mutableIndex, entry)
    }
  }

  return {
    bankOrCashAccountKey: input.bankOrCashAccountKey,
    receipts: input.receipts,
    payments: input.payments,
    interAccountTransfers,
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

export const fetchAllManagerInterAccountTransfersForBankOrCashAccount = Effect.fn(
  "fetchAllManagerInterAccountTransfersForBankOrCashAccount",
)(function* (
  client: ManagerInterAccountTransferBatchClient,
  input: ManagerBankOrCashAccountBatchReadInput,
) {
  const interAccountTransfers = yield* fetchAllManagerBatchItems({
    input,
    fetchPage: client["GET/api4/inter-account-transfer-batch"],
    buildParams: buildManagerInterAccountTransferBatchParams,
    getItems: (page: BusinessObjectsResourceOfInterAccountTransfer) => page.items,
  })

  return interAccountTransfers.filter(
    (interAccountTransfer) =>
      interAccountTransfer.item.paidFrom === input.bankOrCashAccountKey ||
      interAccountTransfer.item.receivedIn === input.bankOrCashAccountKey,
  )
})

export const fetchManagerBankOrCashAccountSyncRead = Effect.fn(
  "fetchManagerBankOrCashAccountSyncRead",
)(function* (
  client: ManagerBankOrCashAccountSyncReadClient,
  input: ManagerBankOrCashAccountBatchReadInput,
) {
  const { receipts, payments, interAccountTransfers } = yield* Effect.all(
    {
      receipts: fetchAllManagerReceiptsForBankOrCashAccount(client, input),
      payments: fetchAllManagerPaymentsForBankOrCashAccount(client, input),
      interAccountTransfers: fetchAllManagerInterAccountTransfersForBankOrCashAccount(
        client,
        input,
      ),
    },
    { concurrency: "unbounded" },
  )
  return buildManagerBankOrCashAccountSyncRead({
    bankOrCashAccountKey: input.bankOrCashAccountKey,
    receipts,
    payments,
    interAccountTransfers,
  })
})
