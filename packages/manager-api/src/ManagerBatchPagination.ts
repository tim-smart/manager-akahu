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
  readonly pageSize?: number | undefined
}

export type ManagerReceiptBatchClient = Pick<Client, "GET/api4/receipt-batch">
export type ManagerPaymentBatchClient = Pick<Client, "GET/api4/payment-batch">

const normalizeManagerBatchPageSize = (pageSize: number | undefined): number => {
  if (pageSize === undefined || !Number.isFinite(pageSize)) {
    return managerBatchReadDefaultPageSize
  }

  return Math.max(1, Math.trunc(pageSize))
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

export const fetchAllManagerReceiptsForBankOrCashAccount = Effect.fn(
  "fetchAllManagerReceiptsForBankOrCashAccount",
)(function* (client: ManagerReceiptBatchClient, input: ManagerBankOrCashAccountBatchReadInput) {
  const pageSize = normalizeManagerBatchPageSize(input.pageSize)
  const receipts: Array<ItemOfReceipt> = []

  for (let skip = 0; ; skip += pageSize) {
    const page: BusinessObjectsResourceOfReceipt = yield* client["GET/api4/receipt-batch"](
      buildManagerReceiptBatchParams(input, skip, pageSize),
    )
    const items = page.items ?? []
    receipts.push(...items)

    if (items.length < pageSize) {
      return receipts
    }
  }
})

export const fetchAllManagerPaymentsForBankOrCashAccount = Effect.fn(
  "fetchAllManagerPaymentsForBankOrCashAccount",
)(function* (client: ManagerPaymentBatchClient, input: ManagerBankOrCashAccountBatchReadInput) {
  const pageSize = normalizeManagerBatchPageSize(input.pageSize)
  const payments: Array<ItemOfPayment> = []

  for (let skip = 0; ; skip += pageSize) {
    const page: BusinessObjectsResourceOfPayment = yield* client["GET/api4/payment-batch"](
      buildManagerPaymentBatchParams(input, skip, pageSize),
    )
    const items = page.items ?? []
    payments.push(...items)

    if (items.length < pageSize) {
      return payments
    }
  }
})
