import {
  Account,
  AccountId,
  ConnectionId,
  PendingTransaction,
  Transaction,
  UserId,
} from "@app/domain/Akahu"
import {
  AkahuTokens,
  LinkedAccount,
  LinkedAccountTransferRule,
} from "@app/domain/Manager/AkahuCustomFields"
import { ManagerBankAccountClearStatusValue } from "@app/manager-api/ManagerCompatibility"
import type {
  ItemOfBankOrCashAccount,
  ItemOfInterAccountTransfer,
  ItemOfPayment,
  ItemOfReceipt,
} from "@app/manager-api/ManagerClient"
import { BigDecimal, DateTime, Effect, Redacted, Schema, Stream } from "effect"
import { expect, it } from "@effect/vitest"
import {
  syncManagerAkahuTransactions,
  type ManagerAkahuTransactionSyncManagerClient,
} from "../src/Manager/SyncFlows.ts"

const accountId = Schema.decodeSync(AccountId)("akahu-checking")
const savingsAccountId = Schema.decodeSync(AccountId)("akahu-savings")
const userId = Schema.decodeSync(UserId)("user-1")
const connectionId = Schema.decodeSync(ConnectionId)("connection-1")
const bankOrCashAccountKey = "manager-checking"
const destinationBankOrCashAccountKey = "manager-savings"
const transferRulesFieldKey = "transfer-rules-field"

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

const akahuSavingsAccount = new Account({
  _id: savingsAccountId,
  name: "Akahu Savings",
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
  transferRules: [],
  transferRuleWarnings: [],
})

const linkedAccountWithSetupTimeTransferRule = new LinkedAccount({
  ...linkedAccount,
  transferRules: [
    new LinkedAccountTransferRule({
      sourceAccountKey: bankOrCashAccountKey,
      sourceAccountName: "Manager Checking",
      sourceAccountCurrency: null,
      sourceAccountCanHavePendingTransactions: true,
      keyword: "Transfer to savings",
      normalizedKeyword: "transfer to savings",
      destinationAccountKey: destinationBankOrCashAccountKey,
      destinationAccountName: "Manager Savings",
      destinationAccountCurrency: null,
      destinationAccountCanHavePendingTransactions: true,
    }),
  ],
  transferRuleWarnings: [],
})

const linkedSavingsAccount = new LinkedAccount({
  key: destinationBankOrCashAccountKey,
  name: "Manager Savings",
  currency: null,
  canHavePendingTransactions: true,
  akahuAccount: akahuSavingsAccount,
  transferRules: [],
  transferRuleWarnings: [],
})

const unsupportedForeignCurrencyLinkedAccount = new LinkedAccount({
  key: "manager-usd-checking",
  name: "Manager USD Checking",
  currency: "USD",
  canHavePendingTransactions: true,
  akahuAccount,
  transferRules: [],
  transferRuleWarnings: [],
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

const makeSettledTransactionForAccount = (
  id: string,
  transactionAccountId: AccountId,
  amount: string,
  description = `Settled ${id}`,
) =>
  new Transaction({
    _id: id,
    _account: transactionAccountId,
    _user: userId,
    _connection: connectionId,
    date: akahuTransactionDate,
    description,
    amount: BigDecimal.fromStringUnsafe(amount),
  })

const makeSettledTransaction = (id: string, amount: string, description = `Settled ${id}`) =>
  makeSettledTransactionForAccount(id, accountId, amount, description)

const makePendingTransaction = (description: string, amount: string) =>
  new PendingTransaction({
    _account: accountId,
    _user: userId,
    _connection: connectionId,
    date: akahuTransactionDate,
    description,
    amount: BigDecimal.fromStringUnsafe(amount),
  })

const makeManagerBankOrCashAccount = (options: {
  readonly key: string
  readonly name: string
  readonly currency?: string | null | undefined
  readonly transferRules?: string | undefined
  readonly canHavePendingTransactions?: boolean | undefined
}): ItemOfBankOrCashAccount => ({
  key: options.key,
  item: {
    name: options.name,
    currency: options.currency ?? null,
    canHavePendingTransactions: options.canHavePendingTransactions ?? true,
    customFields2: {
      strings:
        options.transferRules === undefined
          ? {}
          : { [transferRulesFieldKey]: options.transferRules },
    },
  },
  _links: null,
  _actions: null,
})

const makeManagerInterAccountTransfer = (
  key: string,
  item: ItemOfInterAccountTransfer["item"],
): ItemOfInterAccountTransfer => ({
  key,
  item,
  _links: null,
  _actions: null,
})

const makeDefaultManagerAccounts = (transferRules?: string) => [
  makeManagerBankOrCashAccount({
    key: bankOrCashAccountKey,
    name: "Manager Checking",
    transferRules,
  }),
  makeManagerBankOrCashAccount({
    key: destinationBankOrCashAccountKey,
    name: "Manager Savings",
  }),
]

const makeMockClient = (options?: {
  readonly receipts?: ReadonlyArray<ItemOfReceipt>
  readonly payments?: ReadonlyArray<ItemOfPayment>
  readonly interAccountTransfers?: ReadonlyArray<ItemOfInterAccountTransfer>
  readonly managerAccounts?: ReadonlyArray<ItemOfBankOrCashAccount>
  readonly transferRulesFieldExists?: boolean
}) => {
  const receiptBatchRequests: Array<unknown> = []
  const paymentBatchRequests: Array<unknown> = []
  const interAccountTransferBatchRequests: Array<unknown> = []
  const receiptPayloads: Array<unknown> = []
  const paymentPayloads: Array<unknown> = []
  const interAccountTransferPayloads: Array<unknown> = []
  const receiptPutPayloads: Array<unknown> = []
  const paymentPutPayloads: Array<unknown> = []
  const interAccountTransferPutPayloads: Array<unknown> = []
  const managerAccounts = options?.managerAccounts ?? makeDefaultManagerAccounts()
  const receipts = options?.receipts ?? [existingZeroPendingReceipt]
  const payments = options?.payments ?? []
  let interAccountTransfers = [...(options?.interAccountTransfers ?? [])]
  const transferRulesFieldExists = options?.transferRulesFieldExists ?? true

  const client: ManagerAkahuTransactionSyncManagerClient = {
    "GET/api4/text-custom-field-batch": () =>
      Effect.succeed({
        _links: null,
        _actions: null,
        items: transferRulesFieldExists
          ? [
              {
                key: transferRulesFieldKey,
                item: { name: "Akahu Transfer Rules" },
                _links: null,
                _actions: null,
              },
            ]
          : [],
      }),
    "GET/api4/bank-or-cash-account-batch": () =>
      Effect.succeed({
        _links: null,
        _actions: null,
        items: managerAccounts,
      }),
    "GET/api4/receipt-batch": (params) => {
      receiptBatchRequests.push(params)
      const bankOrCashAccount = params?.BankOrCashAccount ?? ""
      const skip = params?.Skip ?? 0
      return Effect.succeed({
        _links: null,
        _actions: null,
        items: bankOrCashAccount === bankOrCashAccountKey && skip === 0 ? receipts : [],
      })
    },
    "GET/api4/payment-batch": (params) => {
      paymentBatchRequests.push(params)
      return Effect.succeed({
        _links: null,
        _actions: null,
        items: payments,
      })
    },
    "GET/api4/inter-account-transfer-batch": (params) => {
      interAccountTransferBatchRequests.push(params)
      return Effect.succeed({
        _links: null,
        _actions: null,
        items: params?.Skip === 0 ? interAccountTransfers : [],
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
    "POST/api4/inter-account-transfer": (payload) => {
      interAccountTransferPayloads.push(payload)
      interAccountTransfers = [
        ...interAccountTransfers,
        makeManagerInterAccountTransfer(`created-transfer-${interAccountTransferPayloads.length}`, {
          ...payload.value,
        }),
      ]
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
    "PUT/api4/inter-account-transfer": (payload) => {
      interAccountTransferPutPayloads.push(payload)
      interAccountTransfers = interAccountTransfers.map((transfer) =>
        transfer.key === payload.key
          ? makeManagerInterAccountTransfer(transfer.key, {
              ...transfer.item,
              ...payload.value,
            })
          : transfer,
      )
      return Effect.succeed(true)
    },
  }

  return {
    client,
    receiptBatchRequests,
    paymentBatchRequests,
    interAccountTransferBatchRequests,
    receiptPayloads,
    paymentPayloads,
    interAccountTransferPayloads,
    receiptPutPayloads,
    paymentPutPayloads,
    interAccountTransferPutPayloads,
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
    } = makeMockClient({
      managerAccounts: [
        makeManagerBankOrCashAccount({
          key: "manager-usd-checking",
          name: "Manager USD Checking",
          currency: "USD",
        }),
      ],
    })

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

it.effect("creates settled inter-account transfers for matching fresh transfer rules", () =>
  Effect.gen(function* () {
    const { client, interAccountTransferPayloads, paymentPayloads, receiptPayloads } =
      makeMockClient({
        receipts: [],
        managerAccounts: makeDefaultManagerAccounts("Transfer to savings, manager-savings"),
      })

    const summary = yield* syncManagerAkahuTransactions({
      accounts: [linkedAccount],
      client,
      tokens,
      fetchSettledTransactions: () =>
        Stream.fromIterable([
          makeSettledTransaction("settled-transfer-create", "-25.01", "Transfer to savings"),
        ]),
      fetchPendingTransactions: () => Stream.empty,
    })

    expect(receiptPayloads).toEqual([])
    expect(paymentPayloads).toEqual([])
    expect(interAccountTransferPayloads).toEqual([
      {
        value: {
          date: "2026-06-05",
          description: "Transfer to savings",
          paidFrom: bankOrCashAccountKey,
          receivedIn: destinationBankOrCashAccountKey,
          creditAmount: "25.01",
          debitAmount: "25.01",
          creditClearStatus: ManagerBankAccountClearStatusValue.onSameDate,
          debitClearStatus: ManagerBankAccountClearStatusValue.onSameDate,
          fdxCreditTransactionId: "settled-transfer-create",
        },
      },
    ])
    expect(summary.overall).toMatchObject({
      settledFetched: 1,
      transferRulesMatched: 1,
      transfersCreated: 1,
      paymentsCreated: 0,
      receiptsCreated: 0,
      warnings: 0,
      errors: 0,
    })
  }),
)

it.effect("does not reuse setup-time transfer rules when the Manager field was deleted", () =>
  Effect.gen(function* () {
    const { client, interAccountTransferPayloads, paymentPayloads } = makeMockClient({
      receipts: [],
      transferRulesFieldExists: false,
    })

    const summary = yield* syncManagerAkahuTransactions({
      accounts: [linkedAccountWithSetupTimeTransferRule],
      client,
      tokens,
      fetchSettledTransactions: () =>
        Stream.fromIterable([
          makeSettledTransaction("settled-field-deleted", "-25.01", "Transfer to savings"),
        ]),
      fetchPendingTransactions: () => Stream.empty,
    })

    expect(interAccountTransferPayloads).toEqual([])
    expect(paymentPayloads).toHaveLength(1)
    expect(summary.accounts[0]?.account.transferRules).toEqual([])
    expect(summary.accounts[0]?.warnings).toEqual([
      'Manager custom field "Akahu Transfer Rules" is missing; transfer rules were disabled for this sync.',
    ])
    expect(summary.overall).toMatchObject({
      settledFetched: 1,
      transferRulesMatched: 0,
      transfersCreated: 0,
      paymentsCreated: 1,
      warnings: 1,
      errors: 0,
    })
  }),
)

it.effect(
  "does not reuse setup-time transfer rules when the selected Manager account is absent",
  () =>
    Effect.gen(function* () {
      const { client, interAccountTransferPayloads, paymentPayloads } = makeMockClient({
        receipts: [],
        managerAccounts: [
          makeManagerBankOrCashAccount({
            key: destinationBankOrCashAccountKey,
            name: "Manager Savings",
          }),
        ],
      })

      const summary = yield* syncManagerAkahuTransactions({
        accounts: [linkedAccountWithSetupTimeTransferRule],
        client,
        tokens,
        fetchSettledTransactions: () =>
          Stream.fromIterable([
            makeSettledTransaction("settled-account-absent", "-25.01", "Transfer to savings"),
          ]),
        fetchPendingTransactions: () => Stream.empty,
      })

      expect(interAccountTransferPayloads).toEqual([])
      expect(paymentPayloads).toHaveLength(1)
      expect(summary.accounts[0]?.account.transferRules).toEqual([])
      expect(summary.accounts[0]?.warnings).toEqual([
        "Manager bank/cash account Manager Checking (manager-checking) was not returned by Manager during sync-start refresh; transfer rules were disabled for this sync.",
      ])
      expect(summary.overall).toMatchObject({
        settledFetched: 1,
        transferRulesMatched: 0,
        transfersCreated: 0,
        paymentsCreated: 1,
        warnings: 1,
        errors: 0,
      })
    }),
)

it.effect("skips settled transfers already imported as Manager transfers", () =>
  Effect.gen(function* () {
    const existingTransfer = makeManagerInterAccountTransfer("existing-transfer", {
      date: "2026-06-05",
      description: "Transfer to savings",
      paidFrom: bankOrCashAccountKey,
      receivedIn: destinationBankOrCashAccountKey,
      creditAmount: "25.01",
      debitAmount: "25.01",
      creditClearStatus: ManagerBankAccountClearStatusValue.onSameDate,
      debitClearStatus: ManagerBankAccountClearStatusValue.onSameDate,
      fdxCreditTransactionId: "settled-transfer-duplicate",
    })
    const { client, interAccountTransferPayloads } = makeMockClient({
      receipts: [],
      interAccountTransfers: [existingTransfer],
      managerAccounts: makeDefaultManagerAccounts("Transfer to savings, manager-savings"),
    })

    const summary = yield* syncManagerAkahuTransactions({
      accounts: [linkedAccount],
      client,
      tokens,
      fetchSettledTransactions: () =>
        Stream.fromIterable([
          makeSettledTransaction("settled-transfer-duplicate", "-25.01", "Transfer to savings"),
        ]),
      fetchPendingTransactions: () => Stream.empty,
    })

    expect(interAccountTransferPayloads).toEqual([])
    expect(summary.overall).toMatchObject({
      settledFetched: 1,
      transferRulesMatched: 1,
      transfersCreated: 0,
      duplicatesSkipped: 1,
      warnings: 0,
      errors: 0,
    })
  }),
)

it.effect("merges settled transfer mirrors into an existing Manager transfer", () =>
  Effect.gen(function* () {
    const existingTransfer = makeManagerInterAccountTransfer("existing-transfer-mirror", {
      date: "2026-06-05",
      description: "Transfer from checking",
      paidFrom: bankOrCashAccountKey,
      receivedIn: destinationBankOrCashAccountKey,
      creditAmount: "25.01",
      debitAmount: "25.01",
      creditClearStatus: ManagerBankAccountClearStatusValue.onLaterDate,
      debitClearStatus: ManagerBankAccountClearStatusValue.onSameDate,
      fdxDebitTransactionId: "settled-transfer-opposite-side",
    })
    const { client, interAccountTransferPayloads, interAccountTransferPutPayloads } =
      makeMockClient({
        receipts: [],
        interAccountTransfers: [existingTransfer],
        managerAccounts: makeDefaultManagerAccounts("Transfer to savings, manager-savings"),
      })

    const summary = yield* syncManagerAkahuTransactions({
      accounts: [linkedAccount],
      client,
      tokens,
      fetchSettledTransactions: () =>
        Stream.fromIterable([
          makeSettledTransaction("settled-transfer-current-side", "-25.01", "Transfer to savings"),
        ]),
      fetchPendingTransactions: () => Stream.empty,
    })

    expect(interAccountTransferPayloads).toEqual([])
    expect(interAccountTransferPutPayloads).toEqual([
      {
        key: "existing-transfer-mirror",
        value: {
          ...existingTransfer.item,
          creditClearStatus: ManagerBankAccountClearStatusValue.onSameDate,
          fdxCreditTransactionId: "settled-transfer-current-side",
        },
      },
    ])
    expect(summary.overall).toMatchObject({
      settledFetched: 1,
      transferRulesMatched: 1,
      transfersCreated: 0,
      transfersMerged: 1,
      duplicatesSkipped: 0,
      warnings: 0,
      errors: 0,
    })
  }),
)

it.effect("warns when a settled transfer mirror merge is ambiguous", () =>
  Effect.gen(function* () {
    const existingTransfer = makeManagerInterAccountTransfer("existing-transfer-mirror-1", {
      date: "2026-06-05",
      description: "Transfer from checking",
      paidFrom: bankOrCashAccountKey,
      receivedIn: destinationBankOrCashAccountKey,
      creditAmount: "25.01",
      debitAmount: "25.01",
      creditClearStatus: ManagerBankAccountClearStatusValue.onLaterDate,
      debitClearStatus: ManagerBankAccountClearStatusValue.onSameDate,
      fdxDebitTransactionId: "settled-transfer-opposite-side-1",
    })
    const duplicateExistingTransfer = makeManagerInterAccountTransfer(
      "existing-transfer-mirror-2",
      {
        ...existingTransfer.item,
        fdxDebitTransactionId: "settled-transfer-opposite-side-2",
      },
    )
    const { client, interAccountTransferPayloads, interAccountTransferPutPayloads } =
      makeMockClient({
        receipts: [],
        interAccountTransfers: [existingTransfer, duplicateExistingTransfer],
        managerAccounts: makeDefaultManagerAccounts("Transfer to savings, manager-savings"),
      })

    const summary = yield* syncManagerAkahuTransactions({
      accounts: [linkedAccount],
      client,
      tokens,
      fetchSettledTransactions: () =>
        Stream.fromIterable([
          makeSettledTransaction("settled-transfer-ambiguous", "-25.01", "Transfer to savings"),
        ]),
      fetchPendingTransactions: () => Stream.empty,
    })

    expect(interAccountTransferPayloads).toEqual([])
    expect(interAccountTransferPutPayloads).toEqual([])
    expect(summary.accounts[0]?.warnings).toEqual([
      "Found 2 possible mirrored Manager inter-account transfers.",
    ])
    expect(summary.overall).toMatchObject({
      settledFetched: 1,
      transferRulesMatched: 1,
      transfersCreated: 0,
      transfersMerged: 0,
      duplicatesSkipped: 1,
      warnings: 1,
      errors: 0,
    })
  }),
)

it.effect("merges settled transfer mirrors created earlier in the same sync-all run", () =>
  Effect.gen(function* () {
    const { client, interAccountTransferPayloads, interAccountTransferPutPayloads } =
      makeMockClient({
        receipts: [],
        managerAccounts: [
          makeManagerBankOrCashAccount({
            key: bankOrCashAccountKey,
            name: "Manager Checking",
            transferRules: "Transfer to savings, manager-savings",
          }),
          makeManagerBankOrCashAccount({
            key: destinationBankOrCashAccountKey,
            name: "Manager Savings",
            transferRules: "Transfer from checking, manager-checking",
          }),
        ],
      })

    const summary = yield* syncManagerAkahuTransactions({
      accounts: [linkedAccount, linkedSavingsAccount],
      client,
      tokens,
      fetchSettledTransactions: (request) =>
        request.accountId === accountId
          ? Stream.fromIterable([
              makeSettledTransactionForAccount(
                "settled-transfer-sync-all-credit",
                accountId,
                "-25.01",
                "Transfer to savings",
              ),
            ])
          : Stream.fromIterable([
              makeSettledTransactionForAccount(
                "settled-transfer-sync-all-debit",
                savingsAccountId,
                "25.01",
                "Transfer from checking",
              ),
            ]),
      fetchPendingTransactions: () => Stream.empty,
    })

    expect(interAccountTransferPayloads).toEqual([
      {
        value: {
          date: "2026-06-05",
          description: "Transfer to savings",
          paidFrom: bankOrCashAccountKey,
          receivedIn: destinationBankOrCashAccountKey,
          creditAmount: "25.01",
          debitAmount: "25.01",
          creditClearStatus: ManagerBankAccountClearStatusValue.onSameDate,
          debitClearStatus: ManagerBankAccountClearStatusValue.onSameDate,
          fdxCreditTransactionId: "settled-transfer-sync-all-credit",
        },
      },
    ])
    expect(interAccountTransferPutPayloads).toEqual([
      {
        key: "created-transfer-1",
        value: {
          date: "2026-06-05",
          description: "Transfer to savings",
          paidFrom: bankOrCashAccountKey,
          receivedIn: destinationBankOrCashAccountKey,
          creditAmount: "25.01",
          debitAmount: "25.01",
          creditClearStatus: ManagerBankAccountClearStatusValue.onSameDate,
          debitClearStatus: ManagerBankAccountClearStatusValue.onSameDate,
          fdxCreditTransactionId: "settled-transfer-sync-all-credit",
          fdxDebitTransactionId: "settled-transfer-sync-all-debit",
        },
      },
    ])
    expect(summary.accounts[0]?.counts).toMatchObject({
      transfersCreated: 1,
      transfersMerged: 0,
    })
    expect(summary.accounts[1]?.counts).toMatchObject({
      transfersCreated: 0,
      transfersMerged: 1,
    })
    expect(summary.overall).toMatchObject({
      settledFetched: 2,
      transferRulesMatched: 2,
      transfersCreated: 1,
      transfersMerged: 1,
      warnings: 0,
      errors: 0,
    })
  }),
)

it.effect("preserves existing Manager transfer fields during settled mirror merge", () =>
  Effect.gen(function* () {
    const existingTransfer = makeManagerInterAccountTransfer("existing-transfer-preserve", {
      date: "2026-06-05",
      reference: "existing-reference",
      description: "Existing transfer description",
      paidFrom: destinationBankOrCashAccountKey,
      receivedIn: bankOrCashAccountKey,
      creditAmount: "25.01",
      debitAmount: "25.01",
      creditClearStatus: ManagerBankAccountClearStatusValue.onSameDate,
      creditClearDate: "2026-06-05",
      debitClearStatus: ManagerBankAccountClearStatusValue.onLaterDate,
      debitClearDate: "2026-06-06",
      customFields: { legacy: true },
      customFields2: { strings: { note: "keep me" } },
      fdxCreditTransactionId: "settled-transfer-preserve-opposite-side",
    })
    const { client, interAccountTransferPutPayloads } = makeMockClient({
      receipts: [],
      interAccountTransfers: [existingTransfer],
      managerAccounts: makeDefaultManagerAccounts("Transfer from checking, manager-savings"),
    })

    const summary = yield* syncManagerAkahuTransactions({
      accounts: [linkedAccount],
      client,
      tokens,
      fetchSettledTransactions: () =>
        Stream.fromIterable([
          makeSettledTransaction(
            "settled-transfer-preserve-current-side",
            "25.01",
            "Transfer from checking",
          ),
        ]),
      fetchPendingTransactions: () => Stream.empty,
    })

    expect(interAccountTransferPutPayloads).toEqual([
      {
        key: "existing-transfer-preserve",
        value: {
          ...existingTransfer.item,
          debitClearStatus: ManagerBankAccountClearStatusValue.onSameDate,
          fdxDebitTransactionId: "settled-transfer-preserve-current-side",
        },
      },
    ])
    expect(summary.overall).toMatchObject({
      transfersMerged: 1,
      transfersCreated: 0,
      warnings: 0,
      errors: 0,
    })
  }),
)

it.effect("warns when settled transfer matches were already imported as receipts or payments", () =>
  Effect.gen(function* () {
    const existingReceipt: ItemOfReceipt = {
      key: "existing-receipt-transfer-id",
      item: {
        date: "2026-06-05",
        receivedIn: bankOrCashAccountKey,
        cleared: ManagerBankAccountClearStatusValue.onSameDate,
        description: "Transfer to savings",
        lines: [{ amount: "25.01", lineDescription: "Transfer to savings" }],
        fdxTransactionId: "settled-transfer-receipt-duplicate",
      },
      _links: null,
      _actions: null,
    }
    const { client, interAccountTransferPayloads, receiptPayloads } = makeMockClient({
      receipts: [existingReceipt],
      managerAccounts: makeDefaultManagerAccounts("Transfer to savings, manager-savings"),
    })

    const summary = yield* syncManagerAkahuTransactions({
      accounts: [linkedAccount],
      client,
      tokens,
      fetchSettledTransactions: () =>
        Stream.fromIterable([
          makeSettledTransaction(
            "settled-transfer-receipt-duplicate",
            "-25.01",
            "Transfer to savings",
          ),
        ]),
      fetchPendingTransactions: () => Stream.empty,
    })

    expect(receiptPayloads).toEqual([])
    expect(interAccountTransferPayloads).toEqual([])
    expect(summary.accounts[0]?.warnings).toEqual([
      "Akahu transaction settled-transfer-receipt-duplicate was already imported as a Manager receipt; skipping transfer import.",
    ])
    expect(summary.overall).toMatchObject({
      settledFetched: 1,
      transferRulesMatched: 1,
      transfersCreated: 0,
      duplicatesSkipped: 1,
      warnings: 1,
      errors: 0,
    })
  }),
)

it.effect("bypasses ordinary receipt and payment creation for settled transfer matches", () =>
  Effect.gen(function* () {
    const { client, interAccountTransferPayloads, paymentPayloads, receiptPayloads } =
      makeMockClient({
        receipts: [],
        managerAccounts: makeDefaultManagerAccounts("Savings sweep, manager-savings"),
      })

    const summary = yield* syncManagerAkahuTransactions({
      accounts: [linkedAccount],
      client,
      tokens,
      fetchSettledTransactions: () =>
        Stream.fromIterable([
          makeSettledTransaction("settled-transfer-payment", "-12.34", "Savings sweep"),
          makeSettledTransaction("settled-transfer-receipt", "56.78", "Savings sweep"),
        ]),
      fetchPendingTransactions: () => Stream.empty,
    })

    expect(receiptPayloads).toEqual([])
    expect(paymentPayloads).toEqual([])
    expect(interAccountTransferPayloads).toHaveLength(2)
    expect(summary.overall).toMatchObject({
      settledFetched: 2,
      transferRulesMatched: 2,
      transfersCreated: 2,
      receiptsCreated: 0,
      paymentsCreated: 0,
      warnings: 0,
      errors: 0,
    })
  }),
)

it.effect(
  "skips settled transactions whose matching sync-start transfer rule has an unknown destination",
  () =>
    Effect.gen(function* () {
      const { client, interAccountTransferPayloads, paymentPayloads, receiptPayloads } =
        makeMockClient({
          receipts: [],
          managerAccounts: [
            makeManagerBankOrCashAccount({
              key: bankOrCashAccountKey,
              name: "Manager Checking",
              transferRules: "Bad transfer, missing-destination",
            }),
          ],
        })

      const summary = yield* syncManagerAkahuTransactions({
        accounts: [linkedAccount],
        client,
        tokens,
        fetchSettledTransactions: () =>
          Stream.fromIterable([
            makeSettledTransaction("settled-invalid-destination", "-12.34", "Bad transfer"),
          ]),
        fetchPendingTransactions: () => Stream.empty,
      })

      expect(receiptPayloads).toEqual([])
      expect(paymentPayloads).toEqual([])
      expect(interAccountTransferPayloads).toEqual([])
      expect(summary.accounts[0]?.account.transferRules).toEqual([])
      expect(summary.accounts[0]?.warnings).toEqual([
        'Transfer rule "Bad transfer" targets unknown Manager bank/cash account key missing-destination and was skipped.',
      ])
      expect(summary.overall).toMatchObject({
        settledFetched: 1,
        transferRulesMatched: 0,
        unsupportedSkipped: 1,
        transfersCreated: 0,
        warnings: 1,
        errors: 0,
      })
    }),
)

it.effect("skips settled transactions whose matching sync-start transfer rule targets itself", () =>
  Effect.gen(function* () {
    const { client, interAccountTransferPayloads, paymentPayloads, receiptPayloads } =
      makeMockClient({
        receipts: [],
        managerAccounts: makeDefaultManagerAccounts("Self transfer, manager-checking"),
      })

    const summary = yield* syncManagerAkahuTransactions({
      accounts: [linkedAccount],
      client,
      tokens,
      fetchSettledTransactions: () =>
        Stream.fromIterable([
          makeSettledTransaction("settled-self-transfer", "-12.34", "Self transfer"),
        ]),
      fetchPendingTransactions: () => Stream.empty,
    })

    expect(receiptPayloads).toEqual([])
    expect(paymentPayloads).toEqual([])
    expect(interAccountTransferPayloads).toEqual([])
    expect(summary.accounts[0]?.account.transferRules).toEqual([])
    expect(summary.accounts[0]?.warnings).toEqual([
      'Transfer rule "Self transfer" targets its own Manager bank/cash account and was skipped.',
    ])
    expect(summary.overall).toMatchObject({
      settledFetched: 1,
      transferRulesMatched: 0,
      unsupportedSkipped: 1,
      transfersCreated: 0,
      warnings: 1,
      errors: 0,
    })
  }),
)

it.effect("skips settled transfers to foreign-currency destination accounts", () =>
  Effect.gen(function* () {
    const { client, interAccountTransferPayloads, paymentPayloads, receiptPayloads } =
      makeMockClient({
        receipts: [],
        managerAccounts: [
          makeManagerBankOrCashAccount({
            key: bankOrCashAccountKey,
            name: "Manager Checking",
            transferRules: "USD transfer, manager-usd-savings",
          }),
          makeManagerBankOrCashAccount({
            key: "manager-usd-savings",
            name: "Manager USD Savings",
            currency: "USD",
          }),
        ],
      })

    const summary = yield* syncManagerAkahuTransactions({
      accounts: [linkedAccount],
      client,
      tokens,
      fetchSettledTransactions: () =>
        Stream.fromIterable([
          makeSettledTransaction("settled-foreign-destination", "-12.34", "USD transfer"),
        ]),
      fetchPendingTransactions: () => Stream.empty,
    })

    expect(receiptPayloads).toEqual([])
    expect(paymentPayloads).toEqual([])
    expect(interAccountTransferPayloads).toEqual([])
    expect(summary.accounts[0]?.warnings).toEqual([
      "Skipping transfer to Manager USD Savings: foreign-currency Manager transfer imports are not verified yet (USD).",
    ])
    expect(summary.overall).toMatchObject({
      settledFetched: 1,
      transferRulesMatched: 1,
      unsupportedSkipped: 1,
      transfersCreated: 0,
      warnings: 1,
      errors: 0,
    })
  }),
)

it.effect("rolls settled transfer counts into account and overall summaries", () =>
  Effect.gen(function* () {
    const { client, interAccountTransferPayloads, receiptPayloads } = makeMockClient({
      receipts: [],
      managerAccounts: makeDefaultManagerAccounts("Transfer to savings, manager-savings"),
    })

    const summary = yield* syncManagerAkahuTransactions({
      accounts: [linkedAccount],
      client,
      tokens,
      fetchSettledTransactions: () =>
        Stream.fromIterable([
          makeSettledTransaction("settled-summary-transfer", "-25.01", "Transfer to savings"),
          makeSettledTransaction("settled-summary-receipt", "9.99", "Ordinary income"),
        ]),
      fetchPendingTransactions: () => Stream.empty,
    })

    expect(interAccountTransferPayloads).toHaveLength(1)
    expect(receiptPayloads).toHaveLength(1)
    expect(summary.accounts[0]?.counts).toMatchObject({
      settledFetched: 2,
      transferRulesMatched: 1,
      transfersCreated: 1,
      receiptsCreated: 1,
      paymentsCreated: 0,
      warnings: 0,
      errors: 0,
    })
    expect(summary.overall).toMatchObject(summary.accounts[0]?.counts ?? {})
  }),
)
