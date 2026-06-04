import { ApiClient } from "@/ApiClient"
import { Manager } from "@/Manager"
import type { AkahuTokens, LinkedAccount } from "@app/domain/Manager/AkahuCustomFields"
import type { AccountId, PendingTransaction, Transaction } from "@app/domain/Akahu"
import {
  addManagerAkahuSyncSummaryCounts,
  buildAkahuPendingTransactionFingerprint,
  classifyManagerAkahuSuspenseImport,
  decidePendingExactFingerprint,
  decidePendingToSettledMatch,
  decideSettledDuplicateByAkahuTransactionId,
  emptyManagerAkahuSyncSummaryCounts,
  incrementManagerAkahuSyncSummaryCount,
  type ManagerAkahuSuspenseImportClassification,
  type ManagerAkahuSyncSummaryCounts,
} from "@app/manager-api/ManagerAkahuTransactionSync"
import {
  buildManagerBankOrCashAccountSyncRead,
  fetchManagerBankOrCashAccountSyncRead,
  type ManagerBankOrCashAccountSyncRead,
  type ManagerBankOrCashAccountSyncReadClient,
} from "@app/manager-api/ManagerBatchPagination"
import { getManagerBankAccountCurrencyImportDecision } from "@app/manager-api/ManagerCompatibility"
import type { Client } from "@app/manager-api/ManagerClient"
import { Context, Effect, Layer, Option, Schema, Stream } from "effect"
import { AkahuTokens as AkahuTokensSchema } from "@app/domain/Manager/AkahuCustomFields"

export type ManagerAkahuTransactionSyncManagerClient = ManagerBankOrCashAccountSyncReadClient &
  Pick<Client, "POST/api4/receipt" | "POST/api4/payment" | "PUT/api4/receipt" | "PUT/api4/payment">

export interface ManagerAkahuSettledTransactionRequest {
  readonly akahuAppToken: AkahuTokens["akahuAppToken"]
  readonly akahuUserToken: AkahuTokens["akahuUserToken"]
  readonly accountId: AccountId
}

export interface ManagerAkahuPendingTransactionRequest {
  readonly akahuAppToken: AkahuTokens["akahuAppToken"]
  readonly akahuUserToken: AkahuTokens["akahuUserToken"]
  readonly accountId: AccountId
}

export interface ManagerAkahuTransactionSyncInput {
  readonly accounts: ReadonlyArray<LinkedAccount>
}

export interface SyncManagerAkahuTransactionsInput extends ManagerAkahuTransactionSyncInput {
  readonly client: ManagerAkahuTransactionSyncManagerClient
  readonly tokens: AkahuTokens
  readonly fetchSettledTransactions: (
    request: ManagerAkahuSettledTransactionRequest,
  ) => Stream.Stream<Transaction, unknown>
  readonly fetchPendingTransactions: (
    request: ManagerAkahuPendingTransactionRequest,
  ) => Stream.Stream<PendingTransaction, unknown>
}

export interface ManagerAkahuTransactionSyncAccountSummary {
  readonly account: LinkedAccount
  readonly counts: ManagerAkahuSyncSummaryCounts
  readonly warnings: ReadonlyArray<string>
  readonly errors: ReadonlyArray<string>
}

export interface ManagerAkahuTransactionSyncSummary {
  readonly accounts: ReadonlyArray<ManagerAkahuTransactionSyncAccountSummary>
  readonly overall: ManagerAkahuSyncSummaryCounts
}

export class ManagerAkahuTransactionSyncConfigurationError extends Schema.TaggedErrorClass<ManagerAkahuTransactionSyncConfigurationError>()(
  "ManagerAkahuTransactionSyncConfigurationError",
  {
    message: Schema.String,
  },
) {}

const managerAkahuSettledExistingOverlapLimit = 5

interface ManagerAkahuTransactionSyncAccountState {
  readonly counts: ManagerAkahuSyncSummaryCounts
  readonly warnings: ReadonlyArray<string>
  readonly errors: ReadonlyArray<string>
  readonly processedFdxTransactionIds: ReadonlySet<string>
}

interface ManagerAkahuSettledPhaseState {
  readonly accountState: ManagerAkahuTransactionSyncAccountState
  readonly existingSettledOverlapIds: ReadonlySet<string>
}

interface ManagerAkahuSettledPhaseStep {
  readonly state: ManagerAkahuSettledPhaseState
  readonly shouldStop: boolean
}

type ManagerAkahuTransactionCreateClassification = Extract<
  ManagerAkahuSuspenseImportClassification,
  { readonly _tag: "receipt" | "payment" }
>

interface ManagerAkahuTransactionSyncAccountContext {
  readonly account: LinkedAccount
  readonly client: ManagerAkahuTransactionSyncManagerClient
  readonly syncRead: ManagerBankOrCashAccountSyncRead
  readonly importabilityDecision: ReturnType<typeof getManagerBankAccountCurrencyImportDecision>
}

export class ManagerSyncFlows extends Context.Service<
  ManagerSyncFlows,
  {
    readonly syncTransactions: (
      input: ManagerAkahuTransactionSyncInput,
    ) => Effect.Effect<ManagerAkahuTransactionSyncSummary>
  }
>()("ManagerSyncFlows") {
  static readonly layer = Layer.effect(
    ManagerSyncFlows,
    Effect.gen(function* () {
      const client = yield* Manager
      const api = yield* ApiClient

      const syncTransactions = Effect.fn("ManagerSyncFlows.syncTransactions")(function* (
        input: ManagerAkahuTransactionSyncInput,
      ) {
        if (input.accounts.length === 0) {
          return buildManagerAkahuTransactionSyncSummary([])
        }

        const tokensResult = yield* readManagerAkahuSyncTokens(client).pipe(
          Effect.map((tokens) => ({ _tag: "tokens" as const, tokens })),
          Effect.catch((error) => Effect.succeed({ _tag: "error" as const, error })),
        )

        if (tokensResult._tag === "error") {
          return buildManagerAkahuTransactionSyncSummary(
            input.accounts.map((account) =>
              buildManagerAkahuTransactionSyncAccountErrorSummary(
                account,
                tokensResult.error.message,
              ),
            ),
          )
        }

        return yield* syncManagerAkahuTransactions({
          ...input,
          client,
          tokens: tokensResult.tokens,
          fetchSettledTransactions: (request) => api("AccountTransactions", request),
          fetchPendingTransactions: (request) => api("AccountPendingTransactions", request),
        })
      })

      return ManagerSyncFlows.of({ syncTransactions })
    }),
  ).pipe(Layer.provide(Manager.layer))
}

export const syncManagerAkahuTransactions = Effect.fn("syncManagerAkahuTransactions")(function* (
  input: SyncManagerAkahuTransactionsInput,
) {
  const accountSummaries: Array<ManagerAkahuTransactionSyncAccountSummary> = []

  for (const account of input.accounts) {
    accountSummaries.push(yield* syncManagerAkahuTransactionsForAccount(input, account))
  }

  return buildManagerAkahuTransactionSyncSummary(accountSummaries)
})

const syncManagerAkahuTransactionsForAccount = Effect.fn("syncManagerAkahuTransactionsForAccount")(
  function* (input: SyncManagerAkahuTransactionsInput, account: LinkedAccount) {
    const syncReadResult = yield* fetchManagerBankOrCashAccountSyncRead(input.client, {
      bankOrCashAccountKey: account.key,
    }).pipe(
      Effect.map((syncRead) => ({ _tag: "syncRead" as const, syncRead })),
      Effect.catch((error) =>
        Effect.succeed({ _tag: "error" as const, error: formatSyncError(error) }),
      ),
    )

    if (syncReadResult._tag === "error") {
      return buildManagerAkahuTransactionSyncAccountErrorSummary(account, syncReadResult.error)
    }

    const context: ManagerAkahuTransactionSyncAccountContext = {
      account,
      client: input.client,
      syncRead: syncReadResult.syncRead,
      importabilityDecision: getManagerBankAccountCurrencyImportDecision(account),
    }
    let accountState = initialManagerAkahuTransactionSyncAccountState()

    const settledResult = yield* syncManagerAkahuSettledTransactionPhase({
      input,
      context,
      state: accountState,
    })
    accountState = settledResult.state

    if (!settledResult.failed && account.canHavePendingTransactions) {
      accountState = yield* syncManagerAkahuPendingTransactionPhase({
        input,
        context,
        state: accountState,
      })
    }

    return buildManagerAkahuTransactionSyncAccountSummaryFromState(account, accountState)
  },
)

const syncManagerAkahuSettledTransactionPhase = Effect.fn(
  "syncManagerAkahuSettledTransactionPhase",
)(function* (input: {
  readonly input: SyncManagerAkahuTransactionsInput
  readonly context: ManagerAkahuTransactionSyncAccountContext
  readonly state: ManagerAkahuTransactionSyncAccountState
}) {
  let phaseState: ManagerAkahuSettledPhaseState = {
    accountState: input.state,
    existingSettledOverlapIds: new Set(),
  }
  let failed = false

  yield* input.input
    .fetchSettledTransactions({
      akahuAppToken: input.input.tokens.akahuAppToken,
      akahuUserToken: input.input.tokens.akahuUserToken,
      accountId: input.context.account.akahuAccount._id,
    })
    .pipe(
      Stream.takeUntilEffect((transaction) =>
        Effect.gen(function* () {
          const step = yield* processManagerAkahuSettledTransaction({
            context: input.context,
            state: phaseState,
            transaction,
          })
          phaseState = step.state
          return step.shouldStop
        }),
      ),
      Stream.runDrain,
      Effect.catch((error) => {
        failed = true
        phaseState = {
          ...phaseState,
          accountState: addManagerAkahuTransactionSyncAccountError(
            phaseState.accountState,
            formatSyncError(error),
          ),
        }
        return Effect.void
      }),
    )

  return { state: phaseState.accountState, failed } as const
})

const syncManagerAkahuPendingTransactionPhase = Effect.fn(
  "syncManagerAkahuPendingTransactionPhase",
)(function* (input: {
  readonly input: SyncManagerAkahuTransactionsInput
  readonly context: ManagerAkahuTransactionSyncAccountContext
  readonly state: ManagerAkahuTransactionSyncAccountState
}) {
  let state = input.state

  yield* input.input
    .fetchPendingTransactions({
      akahuAppToken: input.input.tokens.akahuAppToken,
      akahuUserToken: input.input.tokens.akahuUserToken,
      accountId: input.context.account.akahuAccount._id,
    })
    .pipe(
      Stream.runForEach((transaction) =>
        Effect.gen(function* () {
          state = yield* processManagerAkahuPendingTransaction({
            context: input.context,
            state,
            transaction,
          })
        }),
      ),
      Effect.catch((error) => {
        state = addManagerAkahuTransactionSyncAccountError(state, formatSyncError(error))
        return Effect.void
      }),
    )

  return state
})

const processManagerAkahuSettledTransaction = Effect.fn("processManagerAkahuSettledTransaction")(
  function* (input: {
    readonly context: ManagerAkahuTransactionSyncAccountContext
    readonly state: ManagerAkahuSettledPhaseState
    readonly transaction: Transaction
  }) {
    const { account, client, importabilityDecision, syncRead } = input.context
    const transaction = input.transaction
    let accountState = incrementManagerAkahuTransactionSyncAccountCount(
      input.state.accountState,
      "settledFetched",
    )
    let state: ManagerAkahuSettledPhaseState = { ...input.state, accountState }

    const duplicateDecision = decideSettledDuplicateByAkahuTransactionId(syncRead, transaction._id)
    if (duplicateDecision._tag === "duplicate") {
      accountState = incrementManagerAkahuTransactionSyncAccountCount(
        state.accountState,
        "duplicatesSkipped",
      )
      state = addManagerAkahuSettledPhaseExistingOverlap(
        { ...state, accountState },
        transaction._id,
      )
      return buildManagerAkahuSettledPhaseResult(state)
    }

    if (state.accountState.processedFdxTransactionIds.has(transaction._id)) {
      state = {
        ...state,
        accountState: incrementManagerAkahuTransactionSyncAccountCount(
          state.accountState,
          "duplicatesSkipped",
        ),
      }
      return continueManagerAkahuSettledPhase(state)
    }

    const classification = classifyManagerAkahuSuspenseImport({
      bankOrCashAccountKey: account.key,
      date: transaction.date,
      signedAmount: transaction.amount,
      reference: transaction._id,
      description: getAkahuTransactionDescription(transaction),
      fdxTransactionId: transaction._id,
      clearance: { _tag: "settled" },
      importabilityDecision,
    })

    switch (classification._tag) {
      case "receipt":
      case "payment":
        {
          const pendingReplacementDecision = decidePendingToSettledMatch({
            syncRead: getManagerAkahuPendingToSettledCandidateSyncRead(
              syncRead,
              state.accountState.processedFdxTransactionIds,
            ),
            settledDate: transaction.date,
            settledSignedAmount: transaction.amount,
            settledDescription: getAkahuTransactionDescription(transaction),
          })

          if (pendingReplacementDecision._tag === "match") {
            accountState = yield* updateManagerAkahuSettledPendingReplacement({
              state: state.accountState,
              client,
              fdxTransactionId: transaction._id,
              classification,
              entry: pendingReplacementDecision.entry,
            })
            return continueManagerAkahuSettledPhase({ ...state, accountState })
          }

          if (pendingReplacementDecision._tag === "ambiguous") {
            accountState = addManagerAkahuTransactionSyncAccountWarning(
              state.accountState,
              pendingReplacementDecision.warning,
            )
            state = {
              ...state,
              accountState: incrementManagerAkahuTransactionSyncAccountCount(
                accountState,
                "warnings",
              ),
            }
          }
        }

        accountState = yield* createManagerAkahuTransaction({
          state: state.accountState,
          client,
          fdxTransactionId: transaction._id,
          classification,
          successCounts: [],
        })
        return continueManagerAkahuSettledPhase({ ...state, accountState })
      case "zero": {
        state = {
          ...state,
          accountState: incrementManagerAkahuTransactionSyncAccountCount(
            state.accountState,
            "zeroAmountSkipped",
          ),
        }
        return continueManagerAkahuSettledPhase(state)
      }
      case "unsupported": {
        accountState = addManagerAkahuTransactionSyncAccountWarning(
          state.accountState,
          classification.warning,
        )
        accountState = incrementManagerAkahuTransactionSyncAccountCount(
          accountState,
          "unsupportedSkipped",
        )
        accountState = incrementManagerAkahuTransactionSyncAccountCount(accountState, "warnings")
        return continueManagerAkahuSettledPhase({ ...state, accountState })
      }
    }
  },
)

const createManagerAkahuTransaction = Effect.fn("createManagerAkahuTransaction")(function* (input: {
  readonly state: ManagerAkahuTransactionSyncAccountState
  readonly client: ManagerAkahuTransactionSyncManagerClient
  readonly fdxTransactionId: string
  readonly classification: ManagerAkahuTransactionCreateClassification
  readonly successCounts: ReadonlyArray<keyof ManagerAkahuSyncSummaryCounts>
}) {
  const write =
    input.classification._tag === "receipt"
      ? {
          createdCount: "receiptsCreated" as const,
          effect: input.client["POST/api4/receipt"](input.classification.managerDecision.payload),
        }
      : {
          createdCount: "paymentsCreated" as const,
          effect: input.client["POST/api4/payment"](input.classification.managerDecision.payload),
        }

  const writeResult = yield* write.effect.pipe(
    Effect.as({ _tag: "created" as const }),
    Effect.catch((error) =>
      Effect.succeed({ _tag: "error" as const, error: formatSyncError(error) }),
    ),
  )

  if (writeResult._tag === "error") {
    return addManagerAkahuTransactionSyncAccountError(input.state, writeResult.error)
  }

  let state = addManagerAkahuTransactionSyncAccountProcessedFdxTransactionId(
    input.state,
    input.fdxTransactionId,
  )
  state = incrementManagerAkahuTransactionSyncAccountCount(state, write.createdCount)
  for (const count of input.successCounts) {
    state = incrementManagerAkahuTransactionSyncAccountCount(state, count)
  }
  return state
})

const processManagerAkahuPendingTransaction = Effect.fn("processManagerAkahuPendingTransaction")(
  function* (input: {
    readonly context: ManagerAkahuTransactionSyncAccountContext
    readonly state: ManagerAkahuTransactionSyncAccountState
    readonly transaction: PendingTransaction
  }) {
    const { account, client, importabilityDecision, syncRead } = input.context
    const transaction = input.transaction
    const description = transaction.description
    let state = incrementManagerAkahuTransactionSyncAccountCount(input.state, "pendingFetched")

    const fingerprintDecision = buildAkahuPendingTransactionFingerprint({
      akahuAccountId: account.akahuAccount._id,
      date: transaction.date,
      amount: transaction.amount,
      description,
    })

    if (fingerprintDecision._tag === "unsupported") {
      state = addManagerAkahuTransactionSyncAccountWarning(state, fingerprintDecision.warning)
      state = incrementManagerAkahuTransactionSyncAccountCount(state, "unsupportedSkipped")
      return incrementManagerAkahuTransactionSyncAccountCount(state, "warnings")
    }

    if (state.processedFdxTransactionIds.has(fingerprintDecision.fingerprint)) {
      return incrementManagerAkahuTransactionSyncAccountCount(state, "duplicatesSkipped")
    }

    const exactFingerprintDecision = decidePendingExactFingerprint(
      syncRead,
      fingerprintDecision.fingerprint,
    )

    if (exactFingerprintDecision._tag === "ambiguous") {
      state = addManagerAkahuTransactionSyncAccountWarning(state, exactFingerprintDecision.warning)
      state = incrementManagerAkahuTransactionSyncAccountCount(state, "duplicatesSkipped")
      return incrementManagerAkahuTransactionSyncAccountCount(state, "warnings")
    }

    const classification = classifyManagerAkahuSuspenseImport({
      bankOrCashAccountKey: account.key,
      date: transaction.date,
      signedAmount: transaction.amount,
      reference: fingerprintDecision.fingerprint,
      description,
      fdxTransactionId: fingerprintDecision.fingerprint,
      clearance: { _tag: "pending" },
      importabilityDecision,
    })

    switch (classification._tag) {
      case "receipt":
      case "payment":
        return exactFingerprintDecision._tag === "create"
          ? yield* createManagerAkahuTransaction({
              state,
              client,
              fdxTransactionId: fingerprintDecision.fingerprint,
              classification,
              successCounts: ["pendingCreated"],
            })
          : yield* updateManagerAkahuPendingTransaction({
              state,
              client,
              fdxTransactionId: fingerprintDecision.fingerprint,
              classification,
              entry: exactFingerprintDecision.entry,
            })
      case "zero":
        return incrementManagerAkahuTransactionSyncAccountCount(state, "zeroAmountSkipped")
      case "unsupported":
        state = addManagerAkahuTransactionSyncAccountWarning(state, classification.warning)
        state = incrementManagerAkahuTransactionSyncAccountCount(state, "unsupportedSkipped")
        return incrementManagerAkahuTransactionSyncAccountCount(state, "warnings")
    }
  },
)

const updateManagerAkahuSettledPendingReplacement = Effect.fn(
  "updateManagerAkahuSettledPendingReplacement",
)(function* (input: {
  readonly state: ManagerAkahuTransactionSyncAccountState
  readonly client: ManagerAkahuTransactionSyncManagerClient
  readonly fdxTransactionId: string
  readonly classification: ManagerAkahuTransactionCreateClassification
  readonly entry: ManagerBankOrCashAccountSyncRead["existingFdxTransactionIdEntries"][number]
}) {
  if (input.classification._tag !== input.entry._tag) {
    let state = addManagerAkahuTransactionSyncAccountWarning(
      input.state,
      `Existing pending Manager entry ${input.entry.key} has a different transaction type than the settled Akahu transaction.`,
    )
    state = incrementManagerAkahuTransactionSyncAccountCount(state, "duplicatesSkipped")
    return incrementManagerAkahuTransactionSyncAccountCount(state, "warnings")
  }

  const write =
    input.classification._tag === "receipt"
      ? input.client["PUT/api4/receipt"]({
          key: input.entry.key,
          value: input.classification.managerDecision.payload.value,
        })
      : input.client["PUT/api4/payment"]({
          key: input.entry.key,
          value: input.classification.managerDecision.payload.value,
        })

  const writeResult = yield* write.pipe(
    Effect.as({ _tag: "updated" as const }),
    Effect.catch((error) =>
      Effect.succeed({ _tag: "error" as const, error: formatSyncError(error) }),
    ),
  )

  if (writeResult._tag === "error") {
    return addManagerAkahuTransactionSyncAccountError(input.state, writeResult.error)
  }

  let state = addManagerAkahuTransactionSyncAccountProcessedFdxTransactionId(
    input.state,
    input.entry.fdxTransactionId,
  )
  state = addManagerAkahuTransactionSyncAccountProcessedFdxTransactionId(
    state,
    input.fdxTransactionId,
  )
  return incrementManagerAkahuTransactionSyncAccountCount(state, "pendingSettled")
})

const updateManagerAkahuPendingTransaction = Effect.fn("updateManagerAkahuPendingTransaction")(
  function* (input: {
    readonly state: ManagerAkahuTransactionSyncAccountState
    readonly client: ManagerAkahuTransactionSyncManagerClient
    readonly fdxTransactionId: string
    readonly classification: ManagerAkahuTransactionCreateClassification
    readonly entry: ManagerBankOrCashAccountSyncRead["existingFdxTransactionIdEntries"][number]
  }) {
    if (input.classification._tag !== input.entry._tag) {
      let state = addManagerAkahuTransactionSyncAccountWarning(
        input.state,
        `Existing pending Manager entry ${input.entry.key} has a different transaction type than its fingerprint.`,
      )
      state = incrementManagerAkahuTransactionSyncAccountCount(state, "duplicatesSkipped")
      return incrementManagerAkahuTransactionSyncAccountCount(state, "warnings")
    }

    const write =
      input.classification._tag === "receipt"
        ? input.client["PUT/api4/receipt"]({
            key: input.entry.key,
            value: input.classification.managerDecision.payload.value,
          })
        : input.client["PUT/api4/payment"]({
            key: input.entry.key,
            value: input.classification.managerDecision.payload.value,
          })

    const writeResult = yield* write.pipe(
      Effect.as({ _tag: "updated" as const }),
      Effect.catch((error) =>
        Effect.succeed({ _tag: "error" as const, error: formatSyncError(error) }),
      ),
    )

    if (writeResult._tag === "error") {
      return addManagerAkahuTransactionSyncAccountError(input.state, writeResult.error)
    }

    const state = addManagerAkahuTransactionSyncAccountProcessedFdxTransactionId(
      input.state,
      input.fdxTransactionId,
    )
    return incrementManagerAkahuTransactionSyncAccountCount(state, "pendingUpdated")
  },
)

const initialManagerAkahuTransactionSyncAccountState =
  (): ManagerAkahuTransactionSyncAccountState => ({
    counts: emptyManagerAkahuSyncSummaryCounts(),
    warnings: [],
    errors: [],
    processedFdxTransactionIds: new Set(),
  })

const incrementManagerAkahuTransactionSyncAccountCount = (
  state: ManagerAkahuTransactionSyncAccountState,
  count: keyof ManagerAkahuSyncSummaryCounts,
): ManagerAkahuTransactionSyncAccountState => ({
  ...state,
  counts: incrementManagerAkahuSyncSummaryCount(state.counts, count),
})

const addManagerAkahuTransactionSyncAccountWarning = (
  state: ManagerAkahuTransactionSyncAccountState,
  warning: string,
): ManagerAkahuTransactionSyncAccountState => ({
  ...state,
  warnings: [...state.warnings, warning],
})

const addManagerAkahuTransactionSyncAccountError = (
  state: ManagerAkahuTransactionSyncAccountState,
  error: string,
): ManagerAkahuTransactionSyncAccountState => ({
  ...state,
  counts: incrementManagerAkahuSyncSummaryCount(state.counts, "errors"),
  errors: [...state.errors, error],
})

const addManagerAkahuTransactionSyncAccountProcessedFdxTransactionId = (
  state: ManagerAkahuTransactionSyncAccountState,
  fdxTransactionId: string,
): ManagerAkahuTransactionSyncAccountState => ({
  ...state,
  processedFdxTransactionIds: new Set(state.processedFdxTransactionIds).add(fdxTransactionId),
})

const addManagerAkahuSettledPhaseExistingOverlap = (
  state: ManagerAkahuSettledPhaseState,
  fdxTransactionId: string,
): ManagerAkahuSettledPhaseState => ({
  ...state,
  existingSettledOverlapIds: new Set(state.existingSettledOverlapIds).add(fdxTransactionId),
})

const getManagerAkahuPendingToSettledCandidateSyncRead = (
  syncRead: ManagerBankOrCashAccountSyncRead,
  processedFdxTransactionIds: ReadonlySet<string>,
): ManagerBankOrCashAccountSyncRead =>
  buildManagerBankOrCashAccountSyncRead({
    bankOrCashAccountKey: syncRead.bankOrCashAccountKey,
    receipts: syncRead.receipts.filter((receipt) =>
      shouldKeepManagerAkahuSyncReadItem(receipt.item.fdxTransactionId, processedFdxTransactionIds),
    ),
    payments: syncRead.payments.filter((payment) =>
      shouldKeepManagerAkahuSyncReadItem(payment.item.fdxTransactionId, processedFdxTransactionIds),
    ),
  })

const shouldKeepManagerAkahuSyncReadItem = (
  fdxTransactionId: string | null | undefined,
  processedFdxTransactionIds: ReadonlySet<string>,
): boolean =>
  fdxTransactionId === undefined ||
  fdxTransactionId === null ||
  !processedFdxTransactionIds.has(fdxTransactionId)

const buildManagerAkahuSettledPhaseResult = (
  state: ManagerAkahuSettledPhaseState,
): ManagerAkahuSettledPhaseStep => ({
  state,
  shouldStop: state.existingSettledOverlapIds.size >= managerAkahuSettledExistingOverlapLimit,
})

const continueManagerAkahuSettledPhase = (
  state: ManagerAkahuSettledPhaseState,
): ManagerAkahuSettledPhaseStep => ({
  state,
  shouldStop: false,
})

const buildManagerAkahuTransactionSyncAccountSummaryFromState = (
  account: LinkedAccount,
  state: ManagerAkahuTransactionSyncAccountState,
): ManagerAkahuTransactionSyncAccountSummary => ({
  account,
  counts: state.counts,
  warnings: state.warnings,
  errors: state.errors,
})

const readManagerAkahuSyncTokens = Effect.fn("readManagerAkahuSyncTokens")(function* (
  client: Pick<Client, "GET/api4/text-custom-field-batch" | "GET/api4/business-details">,
) {
  const fields = (yield* client["GET/api4/text-custom-field-batch"]()).items ?? []
  const akahuAppTokenField = fields.find((field) => field.item.name === "Akahu App Token")
  const akahuUserTokenField = fields.find((field) => field.item.name === "Akahu User Token")

  if (akahuAppTokenField === undefined || akahuUserTokenField === undefined) {
    return yield* new ManagerAkahuTransactionSyncConfigurationError({
      message: "Akahu credential fields are missing from Manager Business Details.",
    })
  }

  const business = yield* client["GET/api4/business-details"]()
  const strings = business.customFields2?.strings ?? {}
  const akahuAppToken = getCredentialValue(strings[akahuAppTokenField.key])
  const akahuUserToken = getCredentialValue(strings[akahuUserTokenField.key])

  if (akahuAppToken === undefined || akahuUserToken === undefined) {
    return yield* new ManagerAkahuTransactionSyncConfigurationError({
      message: "Akahu credentials are missing from Manager Business Details.",
    })
  }

  const tokens = Schema.decodeOption(AkahuTokensSchema)({
    akahuAppToken,
    akahuUserToken,
  })

  if (Option.isNone(tokens)) {
    return yield* new ManagerAkahuTransactionSyncConfigurationError({
      message: "Akahu credentials are missing from Manager Business Details.",
    })
  }

  return tokens.value
})

const buildManagerAkahuTransactionSyncSummary = (
  accounts: ReadonlyArray<ManagerAkahuTransactionSyncAccountSummary>,
): ManagerAkahuTransactionSyncSummary => ({
  accounts,
  overall: accounts.reduce(
    (overall, account) => addManagerAkahuSyncSummaryCounts(overall, account.counts),
    emptyManagerAkahuSyncSummaryCounts(),
  ),
})

const buildManagerAkahuTransactionSyncAccountErrorSummary = (
  account: LinkedAccount,
  error: string,
): ManagerAkahuTransactionSyncAccountSummary => ({
  account,
  counts: incrementManagerAkahuSyncSummaryCount(emptyManagerAkahuSyncSummaryCounts(), "errors"),
  warnings: [],
  errors: [error],
})

const getAkahuTransactionDescription = (transaction: Transaction): string =>
  transaction.merchant?.name ?? transaction.description

const getCredentialValue = (value: unknown): string | undefined => {
  if (typeof value !== "string") return undefined
  const trimmed = value.trim()
  return trimmed === "" ? undefined : trimmed
}

const formatSyncError = (error: unknown): string =>
  error instanceof Error ? error.message : String(error)
