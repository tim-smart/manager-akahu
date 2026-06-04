import { ApiClient } from "@/ApiClient"
import { Manager } from "@/Manager"
import type { AkahuTokens, LinkedAccount } from "@app/domain/Manager/AkahuCustomFields"
import type { AccountId, Transaction } from "@app/domain/Akahu"
import {
  addManagerAkahuSyncSummaryCounts,
  classifyManagerAkahuSuspenseImport,
  decideSettledDuplicateByAkahuTransactionId,
  emptyManagerAkahuSyncSummaryCounts,
  incrementManagerAkahuSyncSummaryCount,
  type ManagerAkahuSyncSummaryCounts,
} from "@app/manager-api/ManagerAkahuTransactionSync"
import {
  fetchManagerBankOrCashAccountSyncRead,
  type ManagerBankOrCashAccountSyncRead,
  type ManagerBankOrCashAccountSyncReadClient,
} from "@app/manager-api/ManagerBatchPagination"
import { getManagerBankAccountCurrencyImportDecision } from "@app/manager-api/ManagerCompatibility"
import type { Client } from "@app/manager-api/ManagerClient"
import { Context, Effect, Layer, Option, Schema, Stream } from "effect"
import { AkahuTokens as AkahuTokensSchema } from "@app/domain/Manager/AkahuCustomFields"

export type ManagerAkahuSettledSyncManagerClient = ManagerBankOrCashAccountSyncReadClient &
  Pick<Client, "POST/api4/receipt" | "POST/api4/payment">

export interface ManagerAkahuSettledTransactionRequest {
  readonly akahuAppToken: AkahuTokens["akahuAppToken"]
  readonly akahuUserToken: AkahuTokens["akahuUserToken"]
  readonly accountId: AccountId
}

export interface ManagerAkahuSettledSyncInput {
  readonly accounts: ReadonlyArray<LinkedAccount>
}

export interface SyncManagerAkahuSettledTransactionsInput extends ManagerAkahuSettledSyncInput {
  readonly client: ManagerAkahuSettledSyncManagerClient
  readonly tokens: AkahuTokens
  readonly fetchSettledTransactions: (
    request: ManagerAkahuSettledTransactionRequest,
  ) => Stream.Stream<Transaction, unknown>
}

export interface ManagerAkahuSettledSyncAccountSummary {
  readonly account: LinkedAccount
  readonly counts: ManagerAkahuSyncSummaryCounts
  readonly warnings: ReadonlyArray<string>
  readonly errors: ReadonlyArray<string>
}

export interface ManagerAkahuSettledSyncSummary {
  readonly accounts: ReadonlyArray<ManagerAkahuSettledSyncAccountSummary>
  readonly overall: ManagerAkahuSyncSummaryCounts
}

export class ManagerAkahuSettledSyncConfigurationError extends Schema.TaggedErrorClass<ManagerAkahuSettledSyncConfigurationError>()(
  "ManagerAkahuSettledSyncConfigurationError",
  {
    message: Schema.String,
  },
) {}

const managerAkahuSettledExistingOverlapLimit = 5

interface ManagerAkahuSettledAccountProcessorState {
  readonly counts: ManagerAkahuSyncSummaryCounts
  readonly warnings: ReadonlyArray<string>
  readonly errors: ReadonlyArray<string>
  readonly createdFdxTransactionIds: ReadonlySet<string>
  readonly existingSettledOverlapIds: ReadonlySet<string>
}

type ManagerAkahuSettledAccountProcessorResult =
  | {
      readonly _tag: "continue"
      readonly state: ManagerAkahuSettledAccountProcessorState
    }
  | {
      readonly _tag: "stop"
      readonly state: ManagerAkahuSettledAccountProcessorState
      readonly reason: {
        readonly _tag: "existingOverlapLimitReached"
        readonly limit: number
      }
    }

interface ManagerAkahuSettledAccountProcessorInput {
  readonly account: LinkedAccount
  readonly client: ManagerAkahuSettledSyncManagerClient
  readonly syncRead: ManagerBankOrCashAccountSyncRead
  readonly importabilityDecision: ReturnType<typeof getManagerBankAccountCurrencyImportDecision>
}

export class ManagerSyncFlows extends Context.Service<
  ManagerSyncFlows,
  {
    readonly syncSettledTransactions: (
      input: ManagerAkahuSettledSyncInput,
    ) => Effect.Effect<ManagerAkahuSettledSyncSummary>
  }
>()("ManagerSyncFlows") {
  static readonly layer = Layer.effect(
    ManagerSyncFlows,
    Effect.gen(function* () {
      const client = yield* Manager
      const api = yield* ApiClient

      const syncSettledTransactions = Effect.fn("ManagerSyncFlows.syncSettledTransactions")(
        function* (input: ManagerAkahuSettledSyncInput) {
          if (input.accounts.length === 0) {
            return buildManagerAkahuSettledSyncSummary([])
          }

          const tokensResult = yield* readManagerAkahuSyncTokens(client).pipe(
            Effect.map((tokens) => ({ _tag: "tokens" as const, tokens })),
            Effect.catch((error) => Effect.succeed({ _tag: "error" as const, error })),
          )

          if (tokensResult._tag === "error") {
            return buildManagerAkahuSettledSyncSummary(
              input.accounts.map((account) =>
                buildManagerAkahuSettledSyncAccountErrorSummary(
                  account,
                  tokensResult.error.message,
                ),
              ),
            )
          }

          return yield* syncManagerAkahuSettledTransactions({
            ...input,
            client,
            tokens: tokensResult.tokens,
            fetchSettledTransactions: (request) => api("AccountTransactions", request),
          })
        },
      )

      return ManagerSyncFlows.of({ syncSettledTransactions })
    }),
  ).pipe(Layer.provide(Manager.layer))
}

export const syncManagerAkahuSettledTransactions = Effect.fn("syncManagerAkahuSettledTransactions")(
  function* (input: SyncManagerAkahuSettledTransactionsInput) {
    const accountSummaries: Array<ManagerAkahuSettledSyncAccountSummary> = []

    for (const account of input.accounts) {
      accountSummaries.push(yield* syncManagerAkahuSettledTransactionsForAccount(input, account))
    }

    return buildManagerAkahuSettledSyncSummary(accountSummaries)
  },
)

const syncManagerAkahuSettledTransactionsForAccount = Effect.fn(
  "syncManagerAkahuSettledTransactionsForAccount",
)(function* (input: SyncManagerAkahuSettledTransactionsInput, account: LinkedAccount) {
  const syncReadResult = yield* fetchManagerBankOrCashAccountSyncRead(input.client, {
    bankOrCashAccountKey: account.key,
  }).pipe(
    Effect.map((syncRead) => ({ _tag: "syncRead" as const, syncRead })),
    Effect.catch((error) =>
      Effect.succeed({ _tag: "error" as const, error: formatSyncError(error) }),
    ),
  )

  if (syncReadResult._tag === "error") {
    return buildManagerAkahuSettledSyncAccountErrorSummary(account, syncReadResult.error)
  }

  const processor: ManagerAkahuSettledAccountProcessorInput = {
    account,
    client: input.client,
    syncRead: syncReadResult.syncRead,
    importabilityDecision: getManagerBankAccountCurrencyImportDecision(account),
  }
  let processorState = initialManagerAkahuSettledAccountProcessorState()

  yield* input
    .fetchSettledTransactions({
      akahuAppToken: input.tokens.akahuAppToken,
      akahuUserToken: input.tokens.akahuUserToken,
      accountId: account.akahuAccount._id,
    })
    .pipe(
      Stream.rechunk(1),
      Stream.runForEachWhile((transaction) =>
        Effect.gen(function* () {
          const result = yield* processManagerAkahuSettledTransaction({
            processor,
            state: processorState,
            transaction,
          })
          processorState = result.state
          // With singleton chunks in the pinned Effect runtime, returning true ends the pull loop.
          return result._tag === "stop"
        }),
      ),
      Effect.catch((error) => {
        processorState = addManagerAkahuSettledAccountProcessorError(
          processorState,
          formatSyncError(error),
        )
        return Effect.void
      }),
    )

  return buildManagerAkahuSettledSyncAccountSummaryFromProcessorState(account, processorState)
})

const processManagerAkahuSettledTransaction = Effect.fn("processManagerAkahuSettledTransaction")(
  function* (input: {
    readonly processor: ManagerAkahuSettledAccountProcessorInput
    readonly state: ManagerAkahuSettledAccountProcessorState
    readonly transaction: Transaction
  }) {
    const { account, client, importabilityDecision, syncRead } = input.processor
    const transaction = input.transaction
    let state = incrementManagerAkahuSettledAccountProcessorCount(input.state, "settledFetched")

    const duplicateDecision = decideSettledDuplicateByAkahuTransactionId(syncRead, transaction._id)
    if (duplicateDecision._tag === "duplicate") {
      state = incrementManagerAkahuSettledAccountProcessorCount(state, "duplicatesSkipped")
      state = addManagerAkahuSettledAccountProcessorExistingOverlap(state, transaction._id)
      return buildManagerAkahuSettledAccountProcessorResult(state)
    }

    if (state.createdFdxTransactionIds.has(transaction._id)) {
      state = incrementManagerAkahuSettledAccountProcessorCount(state, "duplicatesSkipped")
      return continueManagerAkahuSettledAccountProcessor(state)
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
      case "receipt": {
        const writeResult = yield* client["POST/api4/receipt"](
          classification.managerDecision.payload,
        ).pipe(
          Effect.as({ _tag: "created" as const }),
          Effect.catch((error) =>
            Effect.succeed({ _tag: "error" as const, error: formatSyncError(error) }),
          ),
        )
        if (writeResult._tag === "error") {
          return continueManagerAkahuSettledAccountProcessor(
            addManagerAkahuSettledAccountProcessorError(state, writeResult.error),
          )
        }
        state = addManagerAkahuSettledAccountProcessorCreatedFdxTransactionId(
          state,
          transaction._id,
        )
        state = incrementManagerAkahuSettledAccountProcessorCount(state, "receiptsCreated")
        return continueManagerAkahuSettledAccountProcessor(state)
      }
      case "payment": {
        const writeResult = yield* client["POST/api4/payment"](
          classification.managerDecision.payload,
        ).pipe(
          Effect.as({ _tag: "created" as const }),
          Effect.catch((error) =>
            Effect.succeed({ _tag: "error" as const, error: formatSyncError(error) }),
          ),
        )
        if (writeResult._tag === "error") {
          return continueManagerAkahuSettledAccountProcessor(
            addManagerAkahuSettledAccountProcessorError(state, writeResult.error),
          )
        }
        state = addManagerAkahuSettledAccountProcessorCreatedFdxTransactionId(
          state,
          transaction._id,
        )
        state = incrementManagerAkahuSettledAccountProcessorCount(state, "paymentsCreated")
        return continueManagerAkahuSettledAccountProcessor(state)
      }
      case "zero": {
        state = incrementManagerAkahuSettledAccountProcessorCount(state, "zeroAmountSkipped")
        return continueManagerAkahuSettledAccountProcessor(state)
      }
      case "unsupported": {
        state = addManagerAkahuSettledAccountProcessorWarning(state, classification.warning)
        state = incrementManagerAkahuSettledAccountProcessorCount(state, "unsupportedSkipped")
        state = incrementManagerAkahuSettledAccountProcessorCount(state, "warnings")
        return continueManagerAkahuSettledAccountProcessor(state)
      }
    }
  },
)

const initialManagerAkahuSettledAccountProcessorState =
  (): ManagerAkahuSettledAccountProcessorState => ({
    counts: emptyManagerAkahuSyncSummaryCounts(),
    warnings: [],
    errors: [],
    createdFdxTransactionIds: new Set(),
    existingSettledOverlapIds: new Set(),
  })

const incrementManagerAkahuSettledAccountProcessorCount = (
  state: ManagerAkahuSettledAccountProcessorState,
  count: keyof ManagerAkahuSyncSummaryCounts,
): ManagerAkahuSettledAccountProcessorState => ({
  ...state,
  counts: incrementManagerAkahuSyncSummaryCount(state.counts, count),
})

const addManagerAkahuSettledAccountProcessorWarning = (
  state: ManagerAkahuSettledAccountProcessorState,
  warning: string,
): ManagerAkahuSettledAccountProcessorState => ({
  ...state,
  warnings: [...state.warnings, warning],
})

const addManagerAkahuSettledAccountProcessorError = (
  state: ManagerAkahuSettledAccountProcessorState,
  error: string,
): ManagerAkahuSettledAccountProcessorState => ({
  ...state,
  counts: incrementManagerAkahuSyncSummaryCount(state.counts, "errors"),
  errors: [...state.errors, error],
})

const addManagerAkahuSettledAccountProcessorCreatedFdxTransactionId = (
  state: ManagerAkahuSettledAccountProcessorState,
  fdxTransactionId: string,
): ManagerAkahuSettledAccountProcessorState => ({
  ...state,
  createdFdxTransactionIds: new Set(state.createdFdxTransactionIds).add(fdxTransactionId),
})

const addManagerAkahuSettledAccountProcessorExistingOverlap = (
  state: ManagerAkahuSettledAccountProcessorState,
  fdxTransactionId: string,
): ManagerAkahuSettledAccountProcessorState => ({
  ...state,
  existingSettledOverlapIds: new Set(state.existingSettledOverlapIds).add(fdxTransactionId),
})

const buildManagerAkahuSettledAccountProcessorResult = (
  state: ManagerAkahuSettledAccountProcessorState,
): ManagerAkahuSettledAccountProcessorResult =>
  state.existingSettledOverlapIds.size >= managerAkahuSettledExistingOverlapLimit
    ? {
        _tag: "stop",
        state,
        reason: {
          _tag: "existingOverlapLimitReached",
          limit: managerAkahuSettledExistingOverlapLimit,
        },
      }
    : continueManagerAkahuSettledAccountProcessor(state)

const continueManagerAkahuSettledAccountProcessor = (
  state: ManagerAkahuSettledAccountProcessorState,
): ManagerAkahuSettledAccountProcessorResult => ({
  _tag: "continue",
  state,
})

const buildManagerAkahuSettledSyncAccountSummaryFromProcessorState = (
  account: LinkedAccount,
  state: ManagerAkahuSettledAccountProcessorState,
): ManagerAkahuSettledSyncAccountSummary => ({
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
    return yield* new ManagerAkahuSettledSyncConfigurationError({
      message: "Akahu credential fields are missing from Manager Business Details.",
    })
  }

  const business = yield* client["GET/api4/business-details"]()
  const strings = business.customFields2?.strings ?? {}
  const akahuAppToken = getCredentialValue(strings[akahuAppTokenField.key])
  const akahuUserToken = getCredentialValue(strings[akahuUserTokenField.key])

  if (akahuAppToken === undefined || akahuUserToken === undefined) {
    return yield* new ManagerAkahuSettledSyncConfigurationError({
      message: "Akahu credentials are missing from Manager Business Details.",
    })
  }

  const tokens = Schema.decodeOption(AkahuTokensSchema)({
    akahuAppToken,
    akahuUserToken,
  })

  if (Option.isNone(tokens)) {
    return yield* new ManagerAkahuSettledSyncConfigurationError({
      message: "Akahu credentials are missing from Manager Business Details.",
    })
  }

  return tokens.value
})

const buildManagerAkahuSettledSyncSummary = (
  accounts: ReadonlyArray<ManagerAkahuSettledSyncAccountSummary>,
): ManagerAkahuSettledSyncSummary => ({
  accounts,
  overall: accounts.reduce(
    (overall, account) => addManagerAkahuSyncSummaryCounts(overall, account.counts),
    emptyManagerAkahuSyncSummaryCounts(),
  ),
})

const buildManagerAkahuSettledSyncAccountErrorSummary = (
  account: LinkedAccount,
  error: string,
): ManagerAkahuSettledSyncAccountSummary => ({
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
