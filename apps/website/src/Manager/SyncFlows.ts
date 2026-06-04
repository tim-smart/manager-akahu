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
  let counts = emptyManagerAkahuSyncSummaryCounts()
  const warnings: Array<string> = []
  const errors: Array<string> = []

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

  const importabilityDecision = getManagerBankAccountCurrencyImportDecision(account)
  const createdFdxTransactionIds = new Set<string>()
  let existingSettledOverlapCount = 0

  const transactionsResult = yield* input
    .fetchSettledTransactions({
      akahuAppToken: input.tokens.akahuAppToken,
      akahuUserToken: input.tokens.akahuUserToken,
      accountId: account.akahuAccount._id,
    })
    .pipe(
      Stream.runForEachWhile((transaction) =>
        Effect.gen(function* () {
          counts = incrementManagerAkahuSyncSummaryCount(counts, "settledFetched")

          const duplicateDecision = decideSettledDuplicateByAkahuTransactionId(
            syncReadResult.syncRead,
            transaction._id,
          )
          if (duplicateDecision._tag === "duplicate") {
            counts = incrementManagerAkahuSyncSummaryCount(counts, "duplicatesSkipped")
            existingSettledOverlapCount += 1
            return existingSettledOverlapCount < 5
          }

          if (createdFdxTransactionIds.has(transaction._id)) {
            counts = incrementManagerAkahuSyncSummaryCount(counts, "duplicatesSkipped")
            return true
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
              const writeResult = yield* input.client["POST/api4/receipt"](
                classification.managerDecision.payload,
              ).pipe(
                Effect.as({ _tag: "created" as const }),
                Effect.catch((error) =>
                  Effect.succeed({ _tag: "error" as const, error: formatSyncError(error) }),
                ),
              )
              if (writeResult._tag === "error") {
                errors.push(writeResult.error)
                counts = incrementManagerAkahuSyncSummaryCount(counts, "errors")
                return true
              }
              createdFdxTransactionIds.add(transaction._id)
              counts = incrementManagerAkahuSyncSummaryCount(counts, "receiptsCreated")
              return true
            }
            case "payment": {
              const writeResult = yield* input.client["POST/api4/payment"](
                classification.managerDecision.payload,
              ).pipe(
                Effect.as({ _tag: "created" as const }),
                Effect.catch((error) =>
                  Effect.succeed({ _tag: "error" as const, error: formatSyncError(error) }),
                ),
              )
              if (writeResult._tag === "error") {
                errors.push(writeResult.error)
                counts = incrementManagerAkahuSyncSummaryCount(counts, "errors")
                return true
              }
              createdFdxTransactionIds.add(transaction._id)
              counts = incrementManagerAkahuSyncSummaryCount(counts, "paymentsCreated")
              return true
            }
            case "zero": {
              counts = incrementManagerAkahuSyncSummaryCount(counts, "zeroAmountSkipped")
              return true
            }
            case "unsupported": {
              warnings.push(classification.warning)
              counts = incrementManagerAkahuSyncSummaryCount(counts, "unsupportedSkipped")
              counts = incrementManagerAkahuSyncSummaryCount(counts, "warnings")
              return true
            }
          }
        }),
      ),
      Effect.as({ _tag: "processed" as const }),
      Effect.catch((error) =>
        Effect.succeed({ _tag: "error" as const, error: formatSyncError(error) }),
      ),
    )

  if (transactionsResult._tag === "error") {
    return buildManagerAkahuSettledSyncAccountErrorSummary(account, transactionsResult.error)
  }

  return {
    account,
    counts,
    warnings,
    errors,
  }
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
