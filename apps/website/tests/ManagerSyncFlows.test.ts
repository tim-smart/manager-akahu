import {
  Account,
  AccountId,
  AkahuTransactionDate,
  ConnectionId,
  Merchant,
  PendingTransaction,
  Transaction,
  UserId,
} from "@app/domain/Akahu"
import { AkahuTokens, LinkedAccount } from "@app/domain/Manager/AkahuCustomFields"
import type {
  ItemOfPayment,
  ItemOfReceipt,
  PutPayment,
  PutReceipt,
} from "@app/manager-api/ManagerClient"
import type {
  ManagerSuspensePaymentPayload,
  ManagerSuspenseReceiptPayload,
} from "@app/manager-api/ManagerCompatibility"
import { emptyManagerAkahuSyncSummaryCounts } from "@app/manager-api/ManagerAkahuTransactionSync"
import { BigDecimal, DateTime, Effect, Redacted, Schema, Stream } from "effect"
import { expect, it } from "@effect/vitest"
import {
  syncManagerAkahuTransactions,
  type ManagerAkahuTransactionSyncManagerClient,
} from "../src/Manager/SyncFlows.ts"
import {
  canCloseManagerAkahuSyncDialog,
  canStartManagerAkahuSyncDialog,
  closeManagerAkahuSyncDialog,
  completeManagerAkahuSyncDialog,
  initialManagerAkahuSyncDialogState,
  openManagerAkahuSyncDialog,
  startManagerAkahuSyncDialog,
} from "../src/Manager/SyncUi.ts"

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
    readonly canHavePendingTransactions?: boolean | undefined
    readonly akahuAccount?: Account | undefined
  } = {},
) =>
  new LinkedAccount({
    key: options.key ?? "manager-checking",
    name: options.name ?? "Manager Checking",
    currency: options.currency ?? null,
    canHavePendingTransactions: options.canHavePendingTransactions ?? false,
    akahuAccount: options.akahuAccount ?? akahuAccount,
  })

const settledTransaction = (options: {
  readonly id: string
  readonly amount: string
  readonly date?: string | undefined
  readonly description?: string | undefined
  readonly merchantName?: string | undefined
  readonly account?: Account | undefined
}) =>
  new Transaction({
    _id: options.id,
    _account: options.account?._id ?? accountId,
    _user: userId,
    _connection: connectionId,
    date: akahuDate(options.date ?? "2026-06-05T00:30:00.000+13:00"),
    description: options.description ?? "Akahu description",
    amount: BigDecimal.fromStringUnsafe(options.amount),
    merchant:
      options.merchantName === undefined ? undefined : new Merchant({ name: options.merchantName }),
  })

const pendingTransaction = (options: {
  readonly amount: string
  readonly description?: string | undefined
  readonly account?: Account | undefined
}) =>
  new PendingTransaction({
    _account: options.account?._id ?? accountId,
    _user: userId,
    _connection: connectionId,
    date: akahuDate("2026-06-05T00:30:00.000+13:00"),
    description: options.description ?? "Pending description",
    amount: BigDecimal.fromStringUnsafe(options.amount),
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

const pendingReceiptItem = (
  key: string,
  options: {
    readonly fdxTransactionId?: string | undefined
    readonly date?: string | undefined
    readonly amount?: string | undefined
    readonly description?: string | undefined
    readonly bankOrCashAccountKey?: string | undefined
  } = {},
): ItemOfReceipt => {
  const description = options.description ?? "Coffee Shop"
  const fdxTransactionId =
    options.fdxTransactionId ??
    `akahu-pending:v1:akahu-checking:${options.date ?? "2026-06-05"}:${
      options.amount ?? "12.34"
    }:${description.toLowerCase()}`

  return {
    key,
    item: {
      date: options.date ?? "2026-06-05",
      reference: fdxTransactionId,
      cleared: 1,
      description,
      fdxTransactionId,
      lines: [{ amount: options.amount ?? "12.34", lineDescription: description }],
      receivedIn: options.bankOrCashAccountKey ?? "manager-checking",
    },
    _links: null,
    _actions: null,
  }
}

const pendingPaymentItem = (
  key: string,
  options: {
    readonly fdxTransactionId?: string | undefined
    readonly date?: string | undefined
    readonly amount?: string | undefined
    readonly description?: string | undefined
    readonly bankOrCashAccountKey?: string | undefined
  } = {},
): ItemOfPayment => {
  const description = options.description ?? "Book Store"
  const fdxTransactionId =
    options.fdxTransactionId ??
    `akahu-pending:v1:akahu-checking:${options.date ?? "2026-06-05"}:${
      options.amount ?? "-7.89"
    }:${description.toLowerCase()}`

  return {
    key,
    item: {
      date: options.date ?? "2026-06-05",
      reference: fdxTransactionId,
      cleared: 1,
      description,
      fdxTransactionId,
      lines: [{ amount: options.amount ?? "7.89", lineDescription: description }],
      paidFrom: options.bankOrCashAccountKey ?? "manager-checking",
    },
    _links: null,
    _actions: null,
  }
}

const existingReceiptItems = (
  fdxTransactionIds: ReadonlyArray<string>,
): ReadonlyArray<ItemOfReceipt> =>
  fdxTransactionIds.map((fdxTransactionId, index) =>
    receiptItem(`receipt-existing-${index + 1}`, fdxTransactionId),
  )

const makeMockClient = (
  options: {
    readonly receiptsByAccount?: Readonly<Record<string, ReadonlyArray<ItemOfReceipt>>> | undefined
    readonly paymentsByAccount?: Readonly<Record<string, ReadonlyArray<ItemOfPayment>>> | undefined
    readonly receiptPutError?: Error | undefined
    readonly paymentPutError?: Error | undefined
  } = {},
) => {
  const receiptPayloads: Array<ManagerSuspenseReceiptPayload> = []
  const paymentPayloads: Array<ManagerSuspensePaymentPayload> = []
  const receiptPutPayloads: Array<PutReceipt> = []
  const paymentPutPayloads: Array<PutPayment> = []
  const receiptsByAccount: Record<string, Array<ItemOfReceipt>> = Object.fromEntries(
    Object.entries(options.receiptsByAccount ?? {}).map(([account, receipts]) => [
      account,
      [...receipts],
    ]),
  )
  const paymentsByAccount: Record<string, Array<ItemOfPayment>> = Object.fromEntries(
    Object.entries(options.paymentsByAccount ?? {}).map(([account, payments]) => [
      account,
      [...payments],
    ]),
  )
  const client: ManagerAkahuTransactionSyncManagerClient = {
    "GET/api4/receipt-batch": (params) => {
      const bankOrCashAccount = params?.BankOrCashAccount ?? ""
      const skip = params?.Skip ?? 0
      return Effect.succeed({
        _links: null,
        _actions: null,
        items: skip === 0 ? (receiptsByAccount[bankOrCashAccount] ?? []) : [],
      })
    },
    "GET/api4/payment-batch": (params) => {
      const bankOrCashAccount = params?.BankOrCashAccount ?? ""
      const skip = params?.Skip ?? 0
      return Effect.succeed({
        _links: null,
        _actions: null,
        items: skip === 0 ? (paymentsByAccount[bankOrCashAccount] ?? []) : [],
      })
    },
    "POST/api4/receipt": (payload) => {
      receiptPayloads.push(payload as ManagerSuspenseReceiptPayload)
      const accountKey = payload.value?.receivedIn ?? ""
      receiptsByAccount[accountKey] = [
        ...(receiptsByAccount[accountKey] ?? []),
        receiptItem(
          `receipt-created-${receiptPayloads.length}`,
          payload.value?.fdxTransactionId ?? "",
        ),
      ]
      return Effect.succeed(true)
    },
    "POST/api4/payment": (payload) => {
      paymentPayloads.push(payload as ManagerSuspensePaymentPayload)
      const accountKey = payload.value?.paidFrom ?? ""
      paymentsByAccount[accountKey] = [
        ...(paymentsByAccount[accountKey] ?? []),
        paymentItem(
          `payment-created-${paymentPayloads.length}`,
          payload.value?.fdxTransactionId ?? "",
        ),
      ]
      return Effect.succeed(true)
    },
    "PUT/api4/receipt": (payload) => {
      receiptPutPayloads.push(payload)
      if (options.receiptPutError !== undefined) {
        return Effect.fail(options.receiptPutError) as unknown as ReturnType<
          ManagerAkahuTransactionSyncManagerClient["PUT/api4/receipt"]
        >
      }
      for (const receipts of Object.values(receiptsByAccount)) {
        const index = receipts.findIndex((receipt) => receipt.key === payload.key)
        if (index >= 0 && payload.value !== undefined) {
          receipts[index] = { ...receipts[index]!, item: payload.value }
        }
      }
      return Effect.succeed(true)
    },
    "PUT/api4/payment": (payload) => {
      paymentPutPayloads.push(payload)
      if (options.paymentPutError !== undefined) {
        return Effect.fail(options.paymentPutError) as unknown as ReturnType<
          ManagerAkahuTransactionSyncManagerClient["PUT/api4/payment"]
        >
      }
      for (const payments of Object.values(paymentsByAccount)) {
        const index = payments.findIndex((payment) => payment.key === payload.key)
        if (index >= 0 && payload.value !== undefined) {
          payments[index] = { ...payments[index]!, item: payload.value }
        }
      }
      return Effect.succeed(true)
    },
  }

  return {
    client,
    receiptPayloads,
    paymentPayloads,
    receiptPutPayloads,
    paymentPutPayloads,
  } as const
}

const runTransactionSync = (options: {
  readonly accounts: ReadonlyArray<LinkedAccount>
  readonly client: ManagerAkahuTransactionSyncManagerClient
  readonly transactionsByAccount?: Readonly<Record<string, ReadonlyArray<Transaction>>> | undefined
  readonly pendingTransactionsByAccount?:
    | Readonly<Record<string, ReadonlyArray<PendingTransaction>>>
    | undefined
  readonly fetchSettledTransactions?:
    | ((request: { readonly accountId: AccountId }) => Stream.Stream<Transaction, unknown>)
    | undefined
  readonly fetchPendingTransactions?:
    | ((request: { readonly accountId: AccountId }) => Stream.Stream<PendingTransaction, unknown>)
    | undefined
}) =>
  syncManagerAkahuTransactions({
    accounts: options.accounts,
    client: options.client,
    tokens,
    fetchSettledTransactions: (request) =>
      options.fetchSettledTransactions?.(request) ??
      Stream.fromIterable(options.transactionsByAccount?.[request.accountId] ?? []),
    fetchPendingTransactions: (request) =>
      options.fetchPendingTransactions?.(request) ??
      Stream.fromIterable(options.pendingTransactionsByAccount?.[request.accountId] ?? []),
  })

it("prevents duplicate modal starts and closing while sync is running", () => {
  const confirming = openManagerAkahuSyncDialog(initialManagerAkahuSyncDialogState, [
    linkedAccount(),
  ])
  expect(confirming._tag).toBe("confirming")
  expect(canStartManagerAkahuSyncDialog(confirming)).toBe(true)

  const running = startManagerAkahuSyncDialog(confirming)
  expect(running._tag).toBe("running")
  expect(canStartManagerAkahuSyncDialog(running)).toBe(false)
  expect(startManagerAkahuSyncDialog(running)).toBe(running)
  expect(canCloseManagerAkahuSyncDialog(running)).toBe(false)
  expect(closeManagerAkahuSyncDialog(running)).toBe(running)
})

it("keeps the running modal selection when completion summary is shown", () => {
  const account = linkedAccount()
  const running = startManagerAkahuSyncDialog(
    openManagerAkahuSyncDialog(initialManagerAkahuSyncDialogState, [account]),
  )
  const summary = {
    accounts: [
      {
        account,
        counts: { ...emptyManagerAkahuSyncSummaryCounts(), receiptsCreated: 1, warnings: 1 },
        warnings: ["Foreign-currency account skipped."],
        errors: [],
      },
    ],
    overall: { ...emptyManagerAkahuSyncSummaryCounts(), receiptsCreated: 1, warnings: 1 },
  }

  const completed = completeManagerAkahuSyncDialog(running, summary)
  expect(completed._tag).toBe("completed")
  if (completed._tag !== "completed") return
  expect(completed.accounts).toEqual([account])
  expect(completed.summary.overall.receiptsCreated).toBe(1)
  expect(completed.summary.accounts[0]?.warnings).toEqual(["Foreign-currency account skipped."])
  expect(canCloseManagerAkahuSyncDialog(completed)).toBe(true)
})

it.effect(
  "creates Manager receipt and payment payloads for settled positive and negative amounts",
  () =>
    Effect.gen(function* () {
      const managerAccount = linkedAccount()
      const { client, receiptPayloads, paymentPayloads } = makeMockClient()

      const summary = yield* runTransactionSync({
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

    const summary = yield* runTransactionSync({
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

it.effect(
  "stops settled sync before importing transactions older than the fifth existing overlap",
  () =>
    Effect.gen(function* () {
      const managerAccount = linkedAccount()
      const existingOverlapIds = [
        "tx-overlap-1",
        "tx-overlap-2",
        "tx-overlap-3",
        "tx-overlap-4",
        "tx-overlap-5",
      ]
      const { client, receiptPayloads, paymentPayloads } = makeMockClient({
        receiptsByAccount: {
          "manager-checking": existingReceiptItems(existingOverlapIds),
        },
      })

      const summary = yield* runTransactionSync({
        accounts: [managerAccount],
        client,
        transactionsByAccount: {
          [accountId]: [
            ...existingOverlapIds.map((id) => settledTransaction({ id, amount: "12.34" })),
            settledTransaction({ id: "tx-older-new", amount: "4.56" }),
          ],
        },
      })

      expect(receiptPayloads).toEqual([])
      expect(paymentPayloads).toEqual([])
      expect(summary.overall).toMatchObject({
        settledFetched: 5,
        receiptsCreated: 0,
        paymentsCreated: 0,
        duplicatesSkipped: 5,
        errors: 0,
      })
    }),
)

it.effect("continues settled sync to older history past fewer than five overlaps", () =>
  Effect.gen(function* () {
    const managerAccount = linkedAccount()
    const existingOverlapIds = ["tx-overlap-1", "tx-overlap-2", "tx-overlap-3", "tx-overlap-4"]
    const { client, receiptPayloads, paymentPayloads } = makeMockClient({
      receiptsByAccount: {
        "manager-checking": existingReceiptItems(existingOverlapIds),
      },
    })

    const summary = yield* runTransactionSync({
      accounts: [managerAccount],
      client,
      transactionsByAccount: {
        [accountId]: [
          ...existingOverlapIds.map((id) => settledTransaction({ id, amount: "12.34" })),
          settledTransaction({
            id: "tx-older-new",
            amount: "4.56",
            date: "2026-04-01T00:00:00.000Z",
          }),
        ],
      },
    })

    expect(receiptPayloads).toMatchObject([
      { value: { date: "2026-04-01", fdxTransactionId: "tx-older-new" } },
    ])
    expect(paymentPayloads).toEqual([])
    expect(summary.overall).toMatchObject({
      settledFetched: 5,
      receiptsCreated: 1,
      paymentsCreated: 0,
      duplicatesSkipped: 4,
      errors: 0,
    })
  }),
)

it.effect(
  "preserves partial settled summary when the Akahu stream fails after processing a transaction",
  () =>
    Effect.gen(function* () {
      const managerAccount = linkedAccount()
      const { client, receiptPayloads, paymentPayloads } = makeMockClient()

      const summary = yield* runTransactionSync({
        accounts: [managerAccount],
        client,
        fetchSettledTransactions: () =>
          Stream.fromIterable([
            settledTransaction({ id: "tx-created", amount: "4.56" }),
            settledTransaction({ id: "tx-stream-failure", amount: "7.89" }),
          ]).pipe(
            Stream.mapEffect((transaction) =>
              transaction._id === "tx-stream-failure"
                ? Effect.fail(new Error("Akahu settled stream failed"))
                : Effect.succeed(transaction),
            ),
          ),
      })

      expect(receiptPayloads.map((payload) => payload.value.fdxTransactionId)).toEqual([
        "tx-created",
      ])
      expect(paymentPayloads).toEqual([])
      expect(summary.accounts[0]?.errors).toEqual(["Akahu settled stream failed"])
      expect(summary.overall).toMatchObject({
        settledFetched: 1,
        receiptsCreated: 1,
        duplicatesSkipped: 0,
        errors: 1,
      })
    }),
)

it.effect("does not count repeated existing settled IDs as multiple overlap slots", () =>
  Effect.gen(function* () {
    const managerAccount = linkedAccount()
    const repeatedExistingId = "tx-overlap-repeated"
    const { client, receiptPayloads, paymentPayloads } = makeMockClient({
      receiptsByAccount: {
        "manager-checking": [receiptItem("receipt-existing", repeatedExistingId)],
      },
    })

    const summary = yield* runTransactionSync({
      accounts: [managerAccount],
      client,
      transactionsByAccount: {
        [accountId]: [
          settledTransaction({ id: repeatedExistingId, amount: "12.34" }),
          settledTransaction({ id: repeatedExistingId, amount: "12.34" }),
          settledTransaction({ id: repeatedExistingId, amount: "12.34" }),
          settledTransaction({ id: repeatedExistingId, amount: "12.34" }),
          settledTransaction({ id: repeatedExistingId, amount: "12.34" }),
          settledTransaction({ id: "tx-older-new", amount: "4.56" }),
        ],
      },
    })

    expect(receiptPayloads.map((payload) => payload.value.fdxTransactionId)).toEqual([
      "tx-older-new",
    ])
    expect(paymentPayloads).toEqual([])
    expect(summary.overall).toMatchObject({
      settledFetched: 6,
      receiptsCreated: 1,
      duplicatesSkipped: 5,
      errors: 0,
    })
  }),
)

it.effect("skips zero-amount settled transactions without Manager writes", () =>
  Effect.gen(function* () {
    const managerAccount = linkedAccount()
    const { client, receiptPayloads, paymentPayloads } = makeMockClient()

    const summary = yield* runTransactionSync({
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

    const summary = yield* runTransactionSync({
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

it.effect("does not fetch pending Akahu transactions for accounts that do not support them", () =>
  Effect.gen(function* () {
    const managerAccount = linkedAccount({ canHavePendingTransactions: false })
    const { client } = makeMockClient()
    const pendingAccountIds: Array<AccountId> = []

    const summary = yield* runTransactionSync({
      accounts: [managerAccount],
      client,
      fetchPendingTransactions: (request) => {
        pendingAccountIds.push(request.accountId)
        return Stream.fromIterable([])
      },
    })

    expect(pendingAccountIds).toEqual([])
    expect(summary.overall).toMatchObject({
      settledFetched: 0,
      pendingFetched: 0,
      pendingCreated: 0,
      pendingUpdated: 0,
      errors: 0,
    })
  }),
)

it.effect("creates new pending entries and updates exact pending fingerprint matches", () =>
  Effect.gen(function* () {
    const managerAccount = linkedAccount({ canHavePendingTransactions: true })
    const existingFingerprint = "akahu-pending:v1:akahu-checking:2026-06-05:3.21:existing coffee"
    const newFingerprint = "akahu-pending:v1:akahu-checking:2026-06-05:2.50:pending coffee"
    const { client, receiptPayloads, paymentPayloads, receiptPutPayloads } = makeMockClient({
      receiptsByAccount: {
        "manager-checking": [receiptItem("receipt-existing-pending", existingFingerprint)],
      },
    })

    const summary = yield* runTransactionSync({
      accounts: [managerAccount],
      client,
      transactionsByAccount: {
        [accountId]: [settledTransaction({ id: "tx-settled-first", amount: "1.00" })],
      },
      pendingTransactionsByAccount: {
        [accountId]: [
          pendingTransaction({ amount: "3.21", description: "Existing Coffee" }),
          pendingTransaction({ amount: "2.50", description: "Pending Coffee" }),
        ],
      },
    })

    expect(receiptPayloads.map((payload) => payload.value.fdxTransactionId)).toEqual([
      "tx-settled-first",
      newFingerprint,
    ])
    expect(paymentPayloads).toEqual([])
    expect(receiptPutPayloads).toEqual([
      {
        key: "receipt-existing-pending",
        value: {
          date: "2026-06-05",
          reference: existingFingerprint,
          cleared: 1,
          description: "Existing Coffee",
          fdxTransactionId: existingFingerprint,
          lines: [{ amount: "3.21", lineDescription: "Existing Coffee" }],
          receivedIn: "manager-checking",
        },
      },
    ])
    expect(summary.overall).toMatchObject({
      settledFetched: 1,
      pendingFetched: 2,
      receiptsCreated: 2,
      paymentsCreated: 0,
      pendingCreated: 1,
      pendingUpdated: 1,
      errors: 0,
    })
  }),
)

it.effect("repeats pending sync without creating duplicate Manager entries", () =>
  Effect.gen(function* () {
    const managerAccount = linkedAccount({ canHavePendingTransactions: true })
    const { client, receiptPayloads, receiptPutPayloads } = makeMockClient()
    const pendingTransactionsByAccount = {
      [accountId]: [pendingTransaction({ amount: "4.00", description: "Repeat Coffee" })],
    }

    const firstSummary = yield* runTransactionSync({
      accounts: [managerAccount],
      client,
      pendingTransactionsByAccount,
    })
    const secondSummary = yield* runTransactionSync({
      accounts: [managerAccount],
      client,
      pendingTransactionsByAccount,
    })

    expect(receiptPayloads.map((payload) => payload.value.fdxTransactionId)).toEqual([
      "akahu-pending:v1:akahu-checking:2026-06-05:4.00:repeat coffee",
    ])
    expect(receiptPutPayloads.map((payload) => payload.key)).toEqual(["receipt-created-1"])
    expect(firstSummary.overall).toMatchObject({
      pendingFetched: 1,
      receiptsCreated: 1,
      pendingCreated: 1,
      pendingUpdated: 0,
      errors: 0,
    })
    expect(secondSummary.overall).toMatchObject({
      pendingFetched: 1,
      receiptsCreated: 0,
      pendingCreated: 0,
      pendingUpdated: 1,
      errors: 0,
    })
  }),
)

it.effect(
  "updates exact pending receipt and payment matches with canonical replacement payloads",
  () =>
    Effect.gen(function* () {
      const managerAccount = linkedAccount({ canHavePendingTransactions: true })
      const receiptFingerprint = "akahu-pending:v1:akahu-checking:2026-06-05:3.21:existing coffee"
      const paymentFingerprint = "akahu-pending:v1:akahu-checking:2026-06-05:-7.89:book store"
      const existingReceipt = pendingReceiptItem("receipt-existing-pending", {
        fdxTransactionId: receiptFingerprint,
        amount: "3.21",
        description: "User edited receipt",
      })
      const existingPayment = pendingPaymentItem("payment-existing-pending", {
        fdxTransactionId: paymentFingerprint,
        amount: "-7.89",
        description: "User edited payment",
      })
      const { client, receiptPayloads, paymentPayloads, receiptPutPayloads, paymentPutPayloads } =
        makeMockClient({
          receiptsByAccount: {
            "manager-checking": [
              {
                ...existingReceipt,
                item: {
                  ...existingReceipt.item,
                  bankClearDate: "2026-06-06",
                  customFields: { userEdited: true },
                  lines: [
                    {
                      account: "manually-categorized-account",
                      amount: "3.21",
                      lineDescription: "Manual receipt category",
                    },
                  ],
                },
              },
            ],
          },
          paymentsByAccount: {
            "manager-checking": [
              {
                ...existingPayment,
                item: {
                  ...existingPayment.item,
                  bankClearDate: "2026-06-06",
                  customFields: { userEdited: true },
                  lines: [
                    {
                      account: "manually-categorized-account",
                      amount: "7.89",
                      lineDescription: "Manual payment category",
                    },
                  ],
                },
              },
            ],
          },
        })

      const summary = yield* runTransactionSync({
        accounts: [managerAccount],
        client,
        pendingTransactionsByAccount: {
          [accountId]: [
            pendingTransaction({ amount: "3.21", description: "Existing Coffee" }),
            pendingTransaction({ amount: "-7.89", description: "Book Store" }),
          ],
        },
      })

      expect(receiptPayloads).toEqual([])
      expect(paymentPayloads).toEqual([])
      expect(receiptPutPayloads).toEqual([
        {
          key: "receipt-existing-pending",
          value: {
            date: "2026-06-05",
            reference: receiptFingerprint,
            cleared: 1,
            description: "Existing Coffee",
            fdxTransactionId: receiptFingerprint,
            lines: [{ amount: "3.21", lineDescription: "Existing Coffee" }],
            receivedIn: "manager-checking",
          },
        },
      ])
      expect(paymentPutPayloads).toEqual([
        {
          key: "payment-existing-pending",
          value: {
            date: "2026-06-05",
            reference: paymentFingerprint,
            cleared: 1,
            description: "Book Store",
            fdxTransactionId: paymentFingerprint,
            lines: [{ amount: "7.89", lineDescription: "Book Store" }],
            paidFrom: "manager-checking",
          },
        },
      ])
      expect(summary.overall).toMatchObject({
        pendingFetched: 2,
        receiptsCreated: 0,
        paymentsCreated: 0,
        pendingUpdated: 2,
        duplicatesSkipped: 0,
        errors: 0,
      })
    }),
)

it.effect("does not repeat an exact pending update for duplicate pending rows", () =>
  Effect.gen(function* () {
    const managerAccount = linkedAccount({ canHavePendingTransactions: true })
    const fingerprint = "akahu-pending:v1:akahu-checking:2026-06-05:4.00:repeat coffee"
    const { client, receiptPutPayloads } = makeMockClient({
      receiptsByAccount: {
        "manager-checking": [receiptItem("receipt-existing-pending", fingerprint)],
      },
    })

    const summary = yield* runTransactionSync({
      accounts: [managerAccount],
      client,
      pendingTransactionsByAccount: {
        [accountId]: [
          pendingTransaction({ amount: "4.00", description: "Repeat Coffee" }),
          pendingTransaction({ amount: "4.00", description: "Repeat Coffee" }),
        ],
      },
    })

    expect(receiptPutPayloads.map((payload) => payload.key)).toEqual(["receipt-existing-pending"])
    expect(summary.overall).toMatchObject({
      pendingFetched: 2,
      pendingUpdated: 1,
      duplicatesSkipped: 1,
      errors: 0,
    })
  }),
)

it.effect(
  "records exact pending update PUT failures without marking the fingerprint processed",
  () =>
    Effect.gen(function* () {
      const managerAccount = linkedAccount({ canHavePendingTransactions: true })
      const fingerprint = "akahu-pending:v1:akahu-checking:2026-06-05:4.00:retry coffee"
      const { client, receiptPutPayloads } = makeMockClient({
        receiptsByAccount: {
          "manager-checking": [receiptItem("receipt-existing-pending", fingerprint)],
        },
        receiptPutError: new Error("Manager receipt PUT failed"),
      })

      const summary = yield* runTransactionSync({
        accounts: [managerAccount],
        client,
        pendingTransactionsByAccount: {
          [accountId]: [
            pendingTransaction({ amount: "4.00", description: "Retry Coffee" }),
            pendingTransaction({ amount: "4.00", description: "Retry Coffee" }),
          ],
        },
      })

      expect(receiptPutPayloads.map((payload) => payload.key)).toEqual([
        "receipt-existing-pending",
        "receipt-existing-pending",
      ])
      expect(summary.accounts[0]?.errors).toEqual([
        "Manager receipt PUT failed",
        "Manager receipt PUT failed",
      ])
      expect(summary.overall).toMatchObject({
        pendingFetched: 2,
        pendingUpdated: 0,
        duplicatesSkipped: 0,
        errors: 2,
      })
    }),
)

it.effect(
  "replaces exactly one safe pending receipt or payment with canonical settled updates",
  () =>
    Effect.gen(function* () {
      const managerAccount = linkedAccount()
      const existingReceipt = pendingReceiptItem("receipt-existing-pending", {
        date: "2026-06-03",
        amount: "12.340",
        description: "Coffee  Shop",
      })
      const existingPayment = pendingPaymentItem("payment-existing-pending", {
        date: "2026-06-06",
        amount: "7.890",
        description: "Book  Store",
      })
      const { client, receiptPayloads, paymentPayloads, receiptPutPayloads, paymentPutPayloads } =
        makeMockClient({
          receiptsByAccount: {
            "manager-checking": [
              {
                ...existingReceipt,
                item: {
                  ...existingReceipt.item,
                  bankClearDate: "2026-06-06",
                  customFields: { userEdited: true },
                  lines: [
                    {
                      account: "manually-categorized-account",
                      amount: "12.340",
                      lineDescription: "Manual receipt category",
                    },
                  ],
                },
              },
            ],
          },
          paymentsByAccount: {
            "manager-checking": [
              {
                ...existingPayment,
                item: {
                  ...existingPayment.item,
                  bankClearDate: "2026-06-06",
                  customFields: { userEdited: true },
                  lines: [
                    {
                      account: "manually-categorized-account",
                      amount: "7.890",
                      lineDescription: "Manual payment category",
                    },
                  ],
                },
              },
            ],
          },
        })

      const summary = yield* runTransactionSync({
        accounts: [managerAccount],
        client,
        transactionsByAccount: {
          [accountId]: [
            settledTransaction({
              id: "tx-settled-coffee",
              amount: "12.34",
              merchantName: "coffee shop",
            }),
            settledTransaction({
              id: "tx-settled-book",
              amount: "-7.89",
              merchantName: "book store",
            }),
          ],
        },
      })

      expect(receiptPayloads).toEqual([])
      expect(paymentPayloads).toEqual([])
      expect(receiptPutPayloads).toEqual([
        {
          key: "receipt-existing-pending",
          value: {
            date: "2026-06-05",
            reference: "tx-settled-coffee",
            cleared: 0,
            description: "coffee shop",
            fdxTransactionId: "tx-settled-coffee",
            lines: [{ amount: "12.34", lineDescription: "coffee shop" }],
            receivedIn: "manager-checking",
          },
        },
      ])
      expect(paymentPutPayloads).toEqual([
        {
          key: "payment-existing-pending",
          value: {
            date: "2026-06-05",
            reference: "tx-settled-book",
            cleared: 0,
            description: "book store",
            fdxTransactionId: "tx-settled-book",
            lines: [{ amount: "7.89", lineDescription: "book store" }],
            paidFrom: "manager-checking",
          },
        },
      ])
      expect(summary.overall).toMatchObject({
        settledFetched: 2,
        receiptsCreated: 0,
        paymentsCreated: 0,
        pendingSettled: 2,
        warnings: 0,
        errors: 0,
      })
    }),
)

it.effect("does not reuse a pending-to-settled replacement candidate in the same account run", () =>
  Effect.gen(function* () {
    const managerAccount = linkedAccount()
    const { client, receiptPayloads, receiptPutPayloads } = makeMockClient({
      receiptsByAccount: {
        "manager-checking": [
          pendingReceiptItem("receipt-existing-pending", {
            date: "2026-06-05",
            amount: "12.34",
            description: "Coffee Shop",
          }),
        ],
      },
    })

    const summary = yield* runTransactionSync({
      accounts: [managerAccount],
      client,
      transactionsByAccount: {
        [accountId]: [
          settledTransaction({
            id: "tx-settled-first",
            amount: "12.34",
            merchantName: "Coffee Shop",
          }),
          settledTransaction({
            id: "tx-settled-second",
            amount: "12.34",
            merchantName: "Coffee Shop",
          }),
        ],
      },
    })

    expect(receiptPutPayloads.map((payload) => payload.key)).toEqual(["receipt-existing-pending"])
    expect(receiptPutPayloads.map((payload) => payload.value?.fdxTransactionId)).toEqual([
      "tx-settled-first",
    ])
    expect(receiptPayloads.map((payload) => payload.value.fdxTransactionId)).toEqual([
      "tx-settled-second",
    ])
    expect(summary.overall).toMatchObject({
      settledFetched: 2,
      receiptsCreated: 1,
      pendingSettled: 1,
      duplicatesSkipped: 0,
      warnings: 0,
      errors: 0,
    })
  }),
)

it.effect("records pending-to-settled PUT failures without marking IDs processed", () =>
  Effect.gen(function* () {
    const managerAccount = linkedAccount()
    const { client, receiptPayloads, receiptPutPayloads } = makeMockClient({
      receiptsByAccount: {
        "manager-checking": [
          pendingReceiptItem("receipt-existing-pending", {
            date: "2026-06-05",
            amount: "12.34",
            description: "Coffee Shop",
          }),
        ],
      },
      receiptPutError: new Error("Manager receipt replacement PUT failed"),
    })

    const summary = yield* runTransactionSync({
      accounts: [managerAccount],
      client,
      transactionsByAccount: {
        [accountId]: [
          settledTransaction({
            id: "tx-settled-retry",
            amount: "12.34",
            merchantName: "Coffee Shop",
          }),
          settledTransaction({
            id: "tx-settled-retry",
            amount: "12.34",
            merchantName: "Coffee Shop",
          }),
        ],
      },
    })

    expect(receiptPutPayloads.map((payload) => payload.key)).toEqual([
      "receipt-existing-pending",
      "receipt-existing-pending",
    ])
    expect(receiptPayloads).toEqual([])
    expect(summary.accounts[0]?.errors).toEqual([
      "Manager receipt replacement PUT failed",
      "Manager receipt replacement PUT failed",
    ])
    expect(summary.overall).toMatchObject({
      settledFetched: 2,
      receiptsCreated: 0,
      pendingSettled: 0,
      duplicatesSkipped: 0,
      errors: 2,
    })
  }),
)

it.effect("creates settled entries when pending candidates are ambiguous or non-matching", () =>
  Effect.gen(function* () {
    const ambiguousAccount = linkedAccount()
    const ambiguousClient = makeMockClient({
      receiptsByAccount: {
        "manager-checking": [
          pendingReceiptItem("receipt-pending-1"),
          pendingReceiptItem("receipt-pending-2", {
            fdxTransactionId: "akahu-pending:v1:akahu-checking:2026-06-04:12.34:coffee shop",
            date: "2026-06-04",
          }),
        ],
      },
    })

    const ambiguousSummary = yield* runTransactionSync({
      accounts: [ambiguousAccount],
      client: ambiguousClient.client,
      transactionsByAccount: {
        [accountId]: [
          settledTransaction({
            id: "tx-ambiguous",
            amount: "12.34",
            merchantName: "Coffee Shop",
          }),
        ],
      },
    })

    expect(ambiguousClient.receiptPutPayloads).toEqual([])
    expect(
      ambiguousClient.receiptPayloads.map((payload) => payload.value.fdxTransactionId),
    ).toEqual(["tx-ambiguous"])
    expect(ambiguousSummary.accounts[0]?.warnings).toEqual([
      "Found 2 possible pending entries for settled transaction replacement.",
    ])
    expect(ambiguousSummary.overall).toMatchObject({
      settledFetched: 1,
      receiptsCreated: 1,
      pendingSettled: 0,
      warnings: 1,
      errors: 0,
    })

    const nonMatchingClient = makeMockClient({
      receiptsByAccount: {
        "manager-checking": [
          pendingReceiptItem("receipt-non-matching", {
            amount: "9.99",
            description: "Different Shop",
          }),
        ],
      },
    })

    const nonMatchingSummary = yield* runTransactionSync({
      accounts: [linkedAccount()],
      client: nonMatchingClient.client,
      transactionsByAccount: {
        [accountId]: [
          settledTransaction({
            id: "tx-non-matching",
            amount: "12.34",
            merchantName: "Coffee Shop",
          }),
        ],
      },
    })

    expect(nonMatchingClient.receiptPutPayloads).toEqual([])
    expect(
      nonMatchingClient.receiptPayloads.map((payload) => payload.value.fdxTransactionId),
    ).toEqual(["tx-non-matching"])
    expect(nonMatchingSummary.accounts[0]?.warnings).toEqual([])
    expect(nonMatchingSummary.overall).toMatchObject({
      settledFetched: 1,
      receiptsCreated: 1,
      pendingSettled: 0,
      warnings: 0,
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

    const summary = yield* runTransactionSync({
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
