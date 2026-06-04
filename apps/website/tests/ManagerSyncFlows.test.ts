import {
  Account,
  AccountId,
  AkahuTransactionDate,
  ConnectionId,
  Merchant,
  Transaction,
  UserId,
} from "@app/domain/Akahu"
import { AkahuTokens, LinkedAccount } from "@app/domain/Manager/AkahuCustomFields"
import type { ItemOfPayment, ItemOfReceipt } from "@app/manager-api/ManagerClient"
import type {
  ManagerSuspensePaymentPayload,
  ManagerSuspenseReceiptPayload,
} from "@app/manager-api/ManagerCompatibility"
import { BigDecimal, DateTime, Effect, Redacted, Schema, Stream } from "effect"
import { expect, it } from "@effect/vitest"
import {
  syncManagerAkahuSettledTransactions,
  type ManagerAkahuSettledSyncManagerClient,
} from "../src/Manager/SyncFlows.ts"

const accountId = Schema.decodeSync(AccountId)("akahu-checking")
const userId = Schema.decodeSync(UserId)("user-1")
const connectionId = Schema.decodeSync(ConnectionId)("connection-1")
const akahuDate = (date: string) => Schema.decodeSync(AkahuTransactionDate)(date)

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

const linkedAccount = (
  options: {
    readonly key?: string | undefined
    readonly name?: string | undefined
    readonly currency?: string | null | undefined
    readonly akahuAccount?: Account | undefined
  } = {},
) =>
  new LinkedAccount({
    key: options.key ?? "manager-checking",
    name: options.name ?? "Manager Checking",
    currency: options.currency ?? null,
    canHavePendingTransactions: false,
    akahuAccount: options.akahuAccount ?? akahuAccount,
  })

const settledTransaction = (options: {
  readonly id: string
  readonly amount: string
  readonly description?: string | undefined
  readonly merchantName?: string | undefined
  readonly account?: Account | undefined
}) =>
  new Transaction({
    _id: options.id,
    _account: options.account?._id ?? accountId,
    _user: userId,
    _connection: connectionId,
    date: akahuDate("2026-06-05T00:30:00.000+13:00"),
    description: options.description ?? "Akahu description",
    amount: BigDecimal.fromStringUnsafe(options.amount),
    merchant:
      options.merchantName === undefined ? undefined : new Merchant({ name: options.merchantName }),
  })

const receiptItem = (key: string, fdxTransactionId: string): ItemOfReceipt => ({
  key,
  item: { fdxTransactionId },
  _links: null,
  _actions: null,
})

const paymentItem = (key: string, fdxTransactionId: string): ItemOfPayment => ({
  key,
  item: { fdxTransactionId },
  _links: null,
  _actions: null,
})

const makeMockClient = (
  options: {
    readonly receiptsByAccount?: Readonly<Record<string, ReadonlyArray<ItemOfReceipt>>> | undefined
    readonly paymentsByAccount?: Readonly<Record<string, ReadonlyArray<ItemOfPayment>>> | undefined
  } = {},
) => {
  const receiptPayloads: Array<ManagerSuspenseReceiptPayload> = []
  const paymentPayloads: Array<ManagerSuspensePaymentPayload> = []
  const client: ManagerAkahuSettledSyncManagerClient = {
    "GET/api4/receipt-batch": (params) => {
      const bankOrCashAccount = params?.BankOrCashAccount ?? ""
      const skip = params?.Skip ?? 0
      return Effect.succeed({
        _links: null,
        _actions: null,
        items: skip === 0 ? (options.receiptsByAccount?.[bankOrCashAccount] ?? []) : [],
      })
    },
    "GET/api4/payment-batch": (params) => {
      const bankOrCashAccount = params?.BankOrCashAccount ?? ""
      const skip = params?.Skip ?? 0
      return Effect.succeed({
        _links: null,
        _actions: null,
        items: skip === 0 ? (options.paymentsByAccount?.[bankOrCashAccount] ?? []) : [],
      })
    },
    "POST/api4/receipt": (payload) => {
      receiptPayloads.push(payload as ManagerSuspenseReceiptPayload)
      return Effect.succeed(true)
    },
    "POST/api4/payment": (payload) => {
      paymentPayloads.push(payload as ManagerSuspensePaymentPayload)
      return Effect.succeed(true)
    },
  }

  return { client, receiptPayloads, paymentPayloads } as const
}

const runSettledSync = (options: {
  readonly accounts: ReadonlyArray<LinkedAccount>
  readonly client: ManagerAkahuSettledSyncManagerClient
  readonly transactionsByAccount: Readonly<Record<string, ReadonlyArray<Transaction>>>
}) =>
  syncManagerAkahuSettledTransactions({
    accounts: options.accounts,
    client: options.client,
    tokens,
    fetchSettledTransactions: (request) =>
      Stream.fromIterable(options.transactionsByAccount[request.accountId] ?? []),
  })

it.effect(
  "creates Manager receipt and payment payloads for settled positive and negative amounts",
  () =>
    Effect.gen(function* () {
      const managerAccount = linkedAccount()
      const { client, receiptPayloads, paymentPayloads } = makeMockClient()

      const summary = yield* runSettledSync({
        accounts: [managerAccount],
        client,
        transactionsByAccount: {
          [accountId]: [
            settledTransaction({ id: "tx-receipt", amount: "12.34", merchantName: "Coffee Shop" }),
            settledTransaction({
              id: "tx-payment",
              amount: "-9.99",
              description: "Grocery Store",
            }),
          ],
        },
      })

      expect(receiptPayloads).toEqual([
        {
          value: {
            date: "2026-06-05",
            reference: "tx-receipt",
            cleared: 0,
            description: "Coffee Shop",
            fdxTransactionId: "tx-receipt",
            lines: [{ amount: "12.34", lineDescription: "Coffee Shop" }],
            receivedIn: "manager-checking",
          },
        },
      ])
      expect(paymentPayloads).toEqual([
        {
          value: {
            date: "2026-06-05",
            reference: "tx-payment",
            cleared: 0,
            description: "Grocery Store",
            fdxTransactionId: "tx-payment",
            lines: [{ amount: "9.99", lineDescription: "Grocery Store" }],
            paidFrom: "manager-checking",
          },
        },
      ])
      expect(summary.accounts[0]?.counts).toMatchObject({
        settledFetched: 2,
        receiptsCreated: 1,
        paymentsCreated: 1,
        duplicatesSkipped: 0,
        zeroAmountSkipped: 0,
        unsupportedSkipped: 0,
        warnings: 0,
        errors: 0,
      })
      expect(summary.overall).toMatchObject(summary.accounts[0]?.counts ?? {})
    }),
)

it.effect("skips settled transactions whose fdxTransactionId already exists in Manager", () =>
  Effect.gen(function* () {
    const managerAccount = linkedAccount()
    const { client, receiptPayloads, paymentPayloads } = makeMockClient({
      receiptsByAccount: {
        "manager-checking": [receiptItem("receipt-existing", "tx-existing")],
      },
    })

    const summary = yield* runSettledSync({
      accounts: [managerAccount],
      client,
      transactionsByAccount: {
        [accountId]: [
          settledTransaction({ id: "tx-existing", amount: "12.34" }),
          settledTransaction({ id: "tx-new", amount: "4.56" }),
        ],
      },
    })

    expect(receiptPayloads.map((payload) => payload.value.fdxTransactionId)).toEqual(["tx-new"])
    expect(paymentPayloads).toEqual([])
    expect(summary.overall).toMatchObject({
      settledFetched: 2,
      receiptsCreated: 1,
      duplicatesSkipped: 1,
      errors: 0,
    })
  }),
)

it.effect("skips zero-amount settled transactions without Manager writes", () =>
  Effect.gen(function* () {
    const managerAccount = linkedAccount()
    const { client, receiptPayloads, paymentPayloads } = makeMockClient()

    const summary = yield* runSettledSync({
      accounts: [managerAccount],
      client,
      transactionsByAccount: {
        [accountId]: [settledTransaction({ id: "tx-zero", amount: "0.00" })],
      },
    })

    expect(receiptPayloads).toEqual([])
    expect(paymentPayloads).toEqual([])
    expect(summary.overall).toMatchObject({
      settledFetched: 1,
      zeroAmountSkipped: 1,
      receiptsCreated: 0,
      paymentsCreated: 0,
      errors: 0,
    })
  }),
)

it.effect("skips unsupported foreign-currency Manager accounts with warnings", () =>
  Effect.gen(function* () {
    const managerAccount = linkedAccount({ currency: "USD" })
    const { client, receiptPayloads, paymentPayloads } = makeMockClient()

    const summary = yield* runSettledSync({
      accounts: [managerAccount],
      client,
      transactionsByAccount: {
        [accountId]: [settledTransaction({ id: "tx-foreign", amount: "12.34" })],
      },
    })

    expect(receiptPayloads).toEqual([])
    expect(paymentPayloads).toEqual([])
    expect(summary.accounts[0]?.warnings).toEqual([
      "Skipping Manager Checking: foreign-currency Manager imports are not verified yet (USD).",
    ])
    expect(summary.overall).toMatchObject({
      settledFetched: 1,
      unsupportedSkipped: 1,
      warnings: 1,
      errors: 0,
    })
  }),
)

it.effect("returns per-account summaries and rolled-up overall summary counts", () =>
  Effect.gen(function* () {
    const savingsAccountId = Schema.decodeSync(AccountId)("akahu-savings")
    const savingsAkahuAccount = new Account({
      _id: savingsAccountId,
      name: "Akahu Savings",
      refreshed: {
        meta: DateTime.makeUnsafe("2026-06-05T00:00:00.000Z"),
        transactions: DateTime.makeUnsafe("2026-06-05T00:00:00.000Z"),
        party: DateTime.makeUnsafe("2026-06-05T00:00:00.000Z"),
      },
    })
    const checking = linkedAccount()
    const savings = linkedAccount({
      key: "manager-savings",
      name: "Manager Savings",
      akahuAccount: savingsAkahuAccount,
    })
    const { client } = makeMockClient({
      paymentsByAccount: {
        "manager-savings": [paymentItem("payment-existing", "tx-savings-existing")],
      },
    })

    const summary = yield* runSettledSync({
      accounts: [checking, savings],
      client,
      transactionsByAccount: {
        [accountId]: [settledTransaction({ id: "tx-checking", amount: "2.50" })],
        [savingsAccountId]: [
          settledTransaction({
            id: "tx-savings-existing",
            amount: "-3.00",
            account: savingsAkahuAccount,
          }),
          settledTransaction({
            id: "tx-savings-zero",
            amount: "0.00",
            account: savingsAkahuAccount,
          }),
        ],
      },
    })

    expect(summary.accounts.map((accountSummary) => accountSummary.account.key)).toEqual([
      "manager-checking",
      "manager-savings",
    ])
    expect(summary.accounts[0]?.counts).toMatchObject({
      settledFetched: 1,
      receiptsCreated: 1,
    })
    expect(summary.accounts[1]?.counts).toMatchObject({
      settledFetched: 2,
      duplicatesSkipped: 1,
      zeroAmountSkipped: 1,
    })
    expect(summary.overall).toMatchObject({
      settledFetched: 3,
      receiptsCreated: 1,
      paymentsCreated: 0,
      duplicatesSkipped: 1,
      zeroAmountSkipped: 1,
      unsupportedSkipped: 0,
      warnings: 0,
      errors: 0,
    })
  }),
)
