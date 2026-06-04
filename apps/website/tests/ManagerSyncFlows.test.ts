import {
  Account,
  AccountId,
  ConnectionId,
  PendingTransaction,
  Transaction,
  UserId,
} from "@app/domain/Akahu"
import { AkahuTokens, LinkedAccount } from "@app/domain/Manager/AkahuCustomFields"
import type { ItemOfPayment, ItemOfReceipt } from "@app/manager-api/ManagerClient"
import { BigDecimal, DateTime, Effect, Redacted, Schema, Stream } from "effect"
import { expect, it } from "@effect/vitest"
import {
  syncManagerAkahuTransactions,
  type ManagerAkahuTransactionSyncManagerClient,
} from "../src/Manager/SyncFlows.ts"

const accountId = Schema.decodeSync(AccountId)("akahu-checking")
const userId = Schema.decodeSync(UserId)("user-1")
const connectionId = Schema.decodeSync(ConnectionId)("connection-1")
const bankOrCashAccountKey = "manager-checking"

const tokens = new AkahuTokens({
  akahuAppToken: Redacted.make("app-token"),
  akahuUserToken: Redacted.make("user-token"),
})

const akahuAccount = new Account({
  _id: accountId,
  name: "Akahu Checking",
  refreshed: {
    meta: DateTime.makeUnsafe("2026-06-05T00:00:00.000Z"),
    transactions: DateTime.makeUnsafe("2026-06-05T00:00:00.000Z"),
    party: DateTime.makeUnsafe("2026-06-05T00:00:00.000Z"),
  },
})

const linkedAccount = new LinkedAccount({
  key: bankOrCashAccountKey,
  name: "Manager Checking",
  currency: null,
  canHavePendingTransactions: true,
  akahuAccount,
})

const unsupportedForeignCurrencyLinkedAccount = new LinkedAccount({
  key: "manager-usd-checking",
  name: "Manager USD Checking",
  currency: "USD",
  canHavePendingTransactions: true,
  akahuAccount,
})

const importableEmptyLinkedAccount = new LinkedAccount({
  key: "manager-empty-checking",
  name: "Manager Empty Checking",
  currency: null,
  canHavePendingTransactions: true,
  akahuAccount,
})

const zeroPendingFingerprint = "akahu-pending:v1:akahu-checking:2026-06-05:0.00:zero coffee"
const akahuTransactionDate = DateTime.makeUnsafe("2026-06-05T00:00:00.000Z").pipe(
  DateTime.setZoneNamedUnsafe("Pacific/Auckland"),
)

const existingZeroPendingReceipt: ItemOfReceipt = {
  key: "receipt-existing-zero-pending",
  item: {
    date: "2026-06-05",
    reference: zeroPendingFingerprint,
    cleared: 1,
    description: "Zero Coffee",
    fdxTransactionId: zeroPendingFingerprint,
    lines: [{ amount: "0.00", lineDescription: "Zero Coffee" }],
    receivedIn: bankOrCashAccountKey,
  },
  _links: null,
  _actions: null,
}

const zeroPendingTransaction = new PendingTransaction({
  _account: accountId,
  _user: userId,
  _connection: connectionId,
  date: akahuTransactionDate,
  description: "Zero Coffee",
  amount: BigDecimal.fromStringUnsafe("0.00"),
})

const makeSettledTransaction = (id: string, amount: string) =>
  new Transaction({
    _id: id,
    _account: accountId,
    _user: userId,
    _connection: connectionId,
    date: akahuTransactionDate,
    description: `Settled ${id}`,
    amount: BigDecimal.fromStringUnsafe(amount),
  })

const makePendingTransaction = (description: string, amount: string) =>
  new PendingTransaction({
    _account: accountId,
    _user: userId,
    _connection: connectionId,
    date: akahuTransactionDate,
    description,
    amount: BigDecimal.fromStringUnsafe(amount),
  })

const makeUnsupportedAmountPendingTransaction = (description: string, amount: string) =>
  ({
    _account: accountId,
    _user: userId,
    _connection: connectionId,
    date: akahuTransactionDate,
    description,
    amount,
  }) as unknown as PendingTransaction

const makeMockClient = () => {
  const receiptBatchRequests: Array<unknown> = []
  const paymentBatchRequests: Array<unknown> = []
  const receiptPayloads: Array<unknown> = []
  const paymentPayloads: Array<unknown> = []
  const receiptPutPayloads: Array<unknown> = []
  const paymentPutPayloads: Array<unknown> = []

  const client: ManagerAkahuTransactionSyncManagerClient = {
    "GET/api4/receipt-batch": (params) => {
      receiptBatchRequests.push(params)
      const bankOrCashAccount = params?.BankOrCashAccount ?? ""
      const skip = params?.Skip ?? 0
      return Effect.succeed({
        _links: null,
        _actions: null,
        items:
          bankOrCashAccount === bankOrCashAccountKey && skip === 0
            ? [existingZeroPendingReceipt]
            : [],
      })
    },
    "GET/api4/payment-batch": (params) => {
      paymentBatchRequests.push(params)
      return Effect.succeed({
        _links: null,
        _actions: null,
        items: [] as ReadonlyArray<ItemOfPayment>,
      })
    },
    "POST/api4/receipt": (payload) => {
      receiptPayloads.push(payload)
      return Effect.succeed(true)
    },
    "POST/api4/payment": (payload) => {
      paymentPayloads.push(payload)
      return Effect.succeed(true)
    },
    "PUT/api4/receipt": (payload) => {
      receiptPutPayloads.push(payload)
      return Effect.succeed(true)
    },
    "PUT/api4/payment": (payload) => {
      paymentPutPayloads.push(payload)
      return Effect.succeed(true)
    },
  }

  return {
    client,
    receiptBatchRequests,
    paymentBatchRequests,
    receiptPayloads,
    paymentPayloads,
    receiptPutPayloads,
    paymentPutPayloads,
  }
}

it.effect("does not report fingerprinted zero-amount pending rows as stale", () =>
  Effect.gen(function* () {
    const { client, paymentPayloads, paymentPutPayloads, receiptPayloads, receiptPutPayloads } =
      makeMockClient()

    const summary = yield* syncManagerAkahuTransactions({
      accounts: [linkedAccount],
      client,
      tokens,
      fetchSettledTransactions: () => Stream.empty,
      fetchPendingTransactions: () => Stream.fromIterable([zeroPendingTransaction]),
    })

    expect(receiptPayloads).toEqual([])
    expect(paymentPayloads).toEqual([])
    expect(receiptPutPayloads).toEqual([])
    expect(paymentPutPayloads).toEqual([])
    expect(summary.accounts[0]?.warnings).toEqual([])
    expect(summary.overall).toMatchObject({
      pendingFetched: 1,
      zeroAmountSkipped: 1,
      stalePendingDetected: 0,
      warnings: 0,
      errors: 0,
    })
  }),
)

it.effect("skips unsupported foreign-currency accounts with one account warning", () =>
  Effect.gen(function* () {
    const {
      client,
      paymentBatchRequests,
      paymentPayloads,
      paymentPutPayloads,
      receiptBatchRequests,
      receiptPayloads,
      receiptPutPayloads,
    } = makeMockClient()

    const summary = yield* syncManagerAkahuTransactions({
      accounts: [unsupportedForeignCurrencyLinkedAccount],
      client,
      tokens,
      fetchSettledTransactions: () =>
        Stream.fromIterable([
          makeSettledTransaction("settled-unsupported-1", "12.34"),
          makeSettledTransaction("settled-unsupported-2", "-5.67"),
        ]),
      fetchPendingTransactions: () =>
        Stream.fromIterable([makePendingTransaction("Unsupported pending", "8.90")]),
    })

    expect(receiptBatchRequests).toEqual([])
    expect(paymentBatchRequests).toEqual([])
    expect(receiptPayloads).toEqual([])
    expect(paymentPayloads).toEqual([])
    expect(receiptPutPayloads).toEqual([])
    expect(paymentPutPayloads).toEqual([])
    expect(summary.accounts[0]?.warnings).toEqual([
      "Skipping Manager USD Checking: foreign-currency Manager imports are not verified yet (USD).",
    ])
    expect(summary.overall).toMatchObject({
      settledFetched: 2,
      pendingFetched: 1,
      unsupportedSkipped: 3,
      warnings: 1,
      errors: 0,
    })
  }),
)

it.effect("preserves per-transaction unsupported pending fingerprint warnings", () =>
  Effect.gen(function* () {
    const { client, paymentPayloads, paymentPutPayloads, receiptPayloads, receiptPutPayloads } =
      makeMockClient()

    const summary = yield* syncManagerAkahuTransactions({
      accounts: [importableEmptyLinkedAccount],
      client,
      tokens,
      fetchSettledTransactions: () => Stream.empty,
      fetchPendingTransactions: () =>
        Stream.fromIterable([
          makeUnsupportedAmountPendingTransaction("Unsupported pending", "not-a-decimal"),
        ]),
    })

    expect(receiptPayloads).toEqual([])
    expect(paymentPayloads).toEqual([])
    expect(receiptPutPayloads).toEqual([])
    expect(paymentPutPayloads).toEqual([])
    expect(summary.accounts[0]?.warnings).toEqual(["Unsupported pending amount: not-a-decimal"])
    expect(summary.overall).toMatchObject({
      pendingFetched: 1,
      unsupportedSkipped: 1,
      warnings: 1,
      errors: 0,
    })
  }),
)
