import { ApiClient } from "@/ApiClient"
import { Manager } from "@/Manager"
import {
  buildLinkedAccountTransferRules,
  LinkedAccount,
  matchesAkahuTransferRuleDescription,
  type AkahuTokens,
  type LinkedAccountTransferRuleSkipped,
  type ManagerAkahuTransferRuleAccountMetadata,
} from "@app/domain/Manager/AkahuCustomFields"
import type { AccountId, PendingTransaction, Transaction } from "@app/domain/Akahu"
import {
  addManagerAkahuSyncSummaryCounts,
  buildAkahuPendingTransferFingerprint,
  buildAkahuPendingTransactionFingerprint,
  buildManagerAkahuSettledMirroredTransferUpdatePayload,
  buildManagerAkahuSettledTransferEndpointUpdatePayload,
  classifyManagerAkahuInterAccountTransfer,
  classifyManagerAkahuSuspenseImport,
  decideAkahuDateTimeStartDateEligibility,
  decidePendingExactFingerprint,
  decidePendingTransferToSettledMatch,
  decidePendingToSettledMatch,
  decideSettledDuplicateByAkahuTransactionId,
  decideStalePendingEntries,
  decideStalePendingTransferEntries,
  decideTransferDuplicateByFdxTransactionId,
  emptyManagerAkahuSyncSummaryCounts,
  incrementManagerAkahuSyncSummaryCount,
  matchManagerAkahuTransferRule,
  selectManagerAkahuMirroredTransferCandidate,
  selectManagerAkahuSuspenseTransferDuplicateCandidate,
  type ManagerAkahuInterAccountTransferClassification,
  type ManagerAkahuSuspenseImportClassification,
  type ManagerAkahuSyncSummaryCounts,
  type ManagerAkahuTransferRuleOverlapMatch,
} from "@app/manager-api/ManagerAkahuTransactionSync"
import {
  fetchManagerBankOrCashAccountSyncRead,
  type ManagerBankOrCashAccountSyncRead,
  type ManagerBankOrCashAccountSyncReadClient,
} from "@app/manager-api/ManagerBatchPagination"
import {
  getManagerBankAccountCurrencyImportDecision,
  type ManagerSuspensePaymentValue,
  type ManagerSuspenseReceiptValue,
} from "@app/manager-api/ManagerCompatibility"
import type { Client } from "@app/manager-api/ManagerClient"
import { Context, DateTime, Effect, Layer, Option, Schema, Stream } from "effect"
import {
  decodeManagerAkahuBusinessDetailTokens,
  findManagerAkahuCredentialFields,
} from "./AkahuCredentials"
import { managerAkahuTransferRulesFieldName } from "./Flows"

export type ManagerAkahuTransactionSyncManagerClient = ManagerBankOrCashAccountSyncReadClient &
  Pick<
    Client,
    | "GET/api4/text-custom-field-batch"
    | "GET/api4/bank-or-cash-account-batch"
    | "POST/api4/receipt"
    | "POST/api4/payment"
    | "PUT/api4/receipt"
    | "PUT/api4/payment"
    | "POST/api4/inter-account-transfer"
    | "PUT/api4/inter-account-transfer"
  >

export interface ManagerAkahuSettledTransactionRequest {
  readonly akahuAppToken: AkahuTokens["akahuAppToken"]
  readonly akahuUserToken: AkahuTokens["akahuUserToken"]
  readonly accountId: AccountId
  readonly start: DateTime.Utc | undefined
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
const managerAkahuImportCurrencyDecision = { _tag: "import" } as const

interface ManagerAkahuTransactionSyncAccountState {
  readonly counts: ManagerAkahuSyncSummaryCounts
  readonly warnings: ReadonlyArray<string>
  readonly errors: ReadonlyArray<string>
  readonly processedFdxTransactionIds: ReadonlySet<string>
  readonly transferRuleOverlapAggregationKeys: ReadonlySet<string>
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

type ManagerAkahuTransferCreateClassification = Extract<
  ManagerAkahuInterAccountTransferClassification,
  { readonly _tag: "transfer" }
>

type ManagerAkahuTransferRuleMatch = Extract<
  ReturnType<typeof matchManagerAkahuTransferRule>,
  { readonly _tag: "match" }
>

type ManagerAkahuSettledImportIntent =
  | { readonly _tag: "invalid-transfer-intent" }
  | {
      readonly _tag: "transfer"
      readonly match: ManagerAkahuTransferRuleMatch
      readonly classification: ManagerAkahuInterAccountTransferClassification
    }
  | {
      readonly _tag: "suspense"
      readonly classification: ManagerAkahuSuspenseImportClassification
    }

interface ManagerAkahuRefreshedLinkedAccount {
  readonly account: LinkedAccount
  readonly invalidTransferRuleMatchers: ReadonlyArray<LinkedAccountTransferRuleSkipped>
}

interface ManagerAkahuReceiptUpdatePayload {
  readonly key: string
  readonly value: ManagerSuspenseReceiptValue
}

interface ManagerAkahuPaymentUpdatePayload {
  readonly key: string
  readonly value: ManagerSuspensePaymentValue
}

interface ManagerAkahuTransactionSyncAccountContext {
  readonly account: LinkedAccount
  readonly client: ManagerAkahuTransactionSyncManagerClient
  readonly syncRead: ManagerBankOrCashAccountSyncRead
  readonly invalidTransferRuleMatchers: ReadonlyArray<LinkedAccountTransferRuleSkipped>
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
  if (input.accounts.length === 0) {
    return buildManagerAkahuTransactionSyncSummary([])
  }

  const refreshedAccountsResult = yield* refreshManagerAkahuTransferRuleAccounts({
    client: input.client,
    accounts: input.accounts,
  }).pipe(
    Effect.map((accounts) => ({ _tag: "accounts" as const, accounts })),
    Effect.catch((error) =>
      Effect.succeed({ _tag: "error" as const, error: formatSyncError(error) }),
    ),
  )

  if (refreshedAccountsResult._tag === "error") {
    return buildManagerAkahuTransactionSyncSummary(
      input.accounts.map((account) =>
        buildManagerAkahuTransactionSyncAccountErrorSummary(account, refreshedAccountsResult.error),
      ),
    )
  }

  const accountSummaries: Array<ManagerAkahuTransactionSyncAccountSummary> = []

  for (const account of refreshedAccountsResult.accounts) {
    accountSummaries.push(yield* syncManagerAkahuTransactionsForAccount(input, account))
  }

  return buildManagerAkahuTransactionSyncSummary(accountSummaries)
})

const syncManagerAkahuTransactionsForAccount = Effect.fn("syncManagerAkahuTransactionsForAccount")(
  function* (
    input: SyncManagerAkahuTransactionsInput,
    refreshed: ManagerAkahuRefreshedLinkedAccount,
  ) {
    const { account } = refreshed
    const importabilityDecision = getManagerBankAccountCurrencyImportDecision(account)
    if (importabilityDecision._tag === "skip") {
      return yield* syncManagerAkahuUnsupportedAccount(
        input,
        account,
        importabilityDecision.warning,
      )
    }

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
      invalidTransferRuleMatchers: refreshed.invalidTransferRuleMatchers,
    }
    let accountState = initialManagerAkahuTransactionSyncAccountState(account.transferRuleWarnings)

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

const syncManagerAkahuUnsupportedAccount = Effect.fn("syncManagerAkahuUnsupportedAccount")(
  function* (input: SyncManagerAkahuTransactionsInput, account: LinkedAccount, warning: string) {
    let state = initialManagerAkahuTransactionSyncAccountState(account.transferRuleWarnings)
    state = addManagerAkahuTransactionSyncAccountWarning(state, warning)
    state = incrementManagerAkahuTransactionSyncAccountCount(state, "warnings")

    const settledResult = yield* syncManagerAkahuUnsupportedAccountSummaryPhase({
      state,
      stream: input.fetchSettledTransactions({
        akahuAppToken: input.tokens.akahuAppToken,
        akahuUserToken: input.tokens.akahuUserToken,
        accountId: account.akahuAccount._id,
        start: Option.getOrUndefined(account.akahuStartDate),
      }),
      startDate: getManagerAkahuLinkedAccountStartDate(account),
      fetchedCount: "settledFetched",
    })
    state = settledResult.state

    if (!settledResult.failed && account.canHavePendingTransactions) {
      state = (yield* syncManagerAkahuUnsupportedAccountSummaryPhase({
        state,
        stream: input.fetchPendingTransactions({
          akahuAppToken: input.tokens.akahuAppToken,
          akahuUserToken: input.tokens.akahuUserToken,
          accountId: account.akahuAccount._id,
        }),
        startDate: getManagerAkahuLinkedAccountStartDate(account),
        fetchedCount: "pendingFetched",
      })).state
    }

    return buildManagerAkahuTransactionSyncAccountSummaryFromState(account, state)
  },
)

const syncManagerAkahuUnsupportedAccountSummaryPhase = Effect.fn(
  "syncManagerAkahuUnsupportedAccountSummaryPhase",
)(function* <A>(input: {
  readonly state: ManagerAkahuTransactionSyncAccountState
  readonly stream: Stream.Stream<A & { readonly date: DateTime.DateTime }, unknown>
  readonly startDate: DateTime.Utc | undefined
  readonly fetchedCount: "settledFetched" | "pendingFetched"
}) {
  let state = input.state
  let failed = false

  yield* input.stream.pipe(
    Stream.runForEach((transaction) =>
      Effect.sync(() => {
        if (!isManagerAkahuTransactionEligibleForStartDate(transaction.date, input.startDate)) {
          return
        }
        state = incrementManagerAkahuTransactionSyncAccountCount(state, input.fetchedCount)
        state = incrementManagerAkahuTransactionSyncAccountCount(state, "unsupportedSkipped")
      }),
    ),
    Effect.catch((error) => {
      failed = true
      state = addManagerAkahuTransactionSyncAccountError(state, formatSyncError(error))
      return Effect.void
    }),
  )

  return { state, failed } as const
})

const refreshManagerAkahuTransferRuleAccounts = Effect.fn(
  "refreshManagerAkahuTransferRuleAccounts",
)(function* (input: {
  readonly client: Pick<
    ManagerAkahuTransactionSyncManagerClient,
    "GET/api4/text-custom-field-batch" | "GET/api4/bank-or-cash-account-batch"
  >
  readonly accounts: ReadonlyArray<LinkedAccount>
}) {
  const transferRulesField = (yield* input.client[
    "GET/api4/text-custom-field-batch"
  ]()).items?.find((field) => field.item.name === managerAkahuTransferRulesFieldName)
  if (!transferRulesField) {
    return input.accounts.map((account) =>
      buildManagerAkahuRefreshedAccountWithoutTransferRules({
        account,
        warning: `Manager custom field "${managerAkahuTransferRulesFieldName}" is missing; transfer rules were disabled for this sync.`,
      }),
    )
  }

  const managerAccounts = (yield* input.client["GET/api4/bank-or-cash-account-batch"]()).items ?? []
  const managerAccountsByKey = new Map<string, ManagerAkahuTransferRuleAccountMetadata>(
    managerAccounts.map(({ item: account, key }) => [
      key,
      managerAkahuAccountMetadata(key, account),
    ]),
  )
  const managerAccountItemsByKey = new Map(managerAccounts.map((account) => [account.key, account]))

  return input.accounts.map((account): ManagerAkahuRefreshedLinkedAccount => {
    const managerAccount = managerAccountItemsByKey.get(account.key)
    const sourceAccount = managerAccountsByKey.get(account.key)
    if (!managerAccount || !sourceAccount) {
      return buildManagerAkahuRefreshedAccountWithoutTransferRules({
        account,
        warning: `Manager bank/cash account ${account.name} (${account.key}) was not returned by Manager during sync-start refresh; transfer rules were disabled for this sync.`,
      })
    }

    const rawValue = managerAccount.item.customFields2?.strings?.[transferRulesField.key]
    const transferRulesResult = buildLinkedAccountTransferRules({
      sourceAccount,
      rawValue,
      managerAccountsByKey,
    })

    return {
      account: new LinkedAccount({
        ...sourceAccount,
        akahuStartDate: account.akahuStartDate,
        akahuAccount: account.akahuAccount,
        transferRules: transferRulesResult.rules,
        transferRuleWarnings: transferRulesResult.warnings,
      }),
      invalidTransferRuleMatchers: transferRulesResult.skippedRules,
    }
  })
})

const buildManagerAkahuRefreshedAccountWithoutTransferRules = (input: {
  readonly account: LinkedAccount
  readonly warning: string
}): ManagerAkahuRefreshedLinkedAccount => ({
  account: new LinkedAccount({
    key: input.account.key,
    name: input.account.name,
    currency: input.account.currency,
    canHavePendingTransactions: input.account.canHavePendingTransactions,
    akahuStartDate: input.account.akahuStartDate,
    akahuAccount: input.account.akahuAccount,
    transferRules: [],
    transferRuleWarnings: [input.warning],
  }),
  invalidTransferRuleMatchers: [],
})

const managerAkahuAccountMetadata = (
  key: string,
  account: {
    readonly name?: string | null | undefined
    readonly currency?: string | null | undefined
    readonly canHavePendingTransactions?: boolean | undefined
  },
): ManagerAkahuTransferRuleAccountMetadata => ({
  key,
  name: account.name ?? "",
  currency: account.currency ?? null,
  canHavePendingTransactions: account.canHavePendingTransactions === true,
})

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
      start: Option.getOrUndefined(input.context.account.akahuStartDate),
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
  let failed = false
  const currentPendingFdxTransactionIds = new Set<string>()
  const currentPendingTransferFdxTransactionIds = new Set<string>()

  yield* input.input
    .fetchPendingTransactions({
      akahuAppToken: input.input.tokens.akahuAppToken,
      akahuUserToken: input.input.tokens.akahuUserToken,
      accountId: input.context.account.akahuAccount._id,
    })
    .pipe(
      Stream.runForEach((transaction) =>
        Effect.gen(function* () {
          const startDate = getManagerAkahuLinkedAccountStartDate(input.context.account)
          if (!isManagerAkahuTransactionEligibleForStartDate(transaction.date, startDate)) {
            return
          }
          const fingerprintDecision = buildAkahuPendingTransactionFingerprint({
            akahuAccountId: input.context.account.akahuAccount._id,
            date: transaction.date,
            amount: transaction.amount,
            description: transaction.description,
          })
          if (fingerprintDecision._tag === "fingerprint") {
            currentPendingFdxTransactionIds.add(fingerprintDecision.fingerprint)
          }
          state = yield* processManagerAkahuPendingTransaction({
            context: input.context,
            state,
            transaction,
            currentPendingFdxTransactionIds,
            currentPendingTransferFdxTransactionIds,
          })
        }),
      ),
      Effect.catch((error) => {
        failed = true
        state = addManagerAkahuTransactionSyncAccountError(state, formatSyncError(error))
        return Effect.void
      }),
    )

  if (!failed) {
    state = detectManagerAkahuStalePendingEntries({
      state,
      syncRead: input.context.syncRead,
      currentPendingFdxTransactionIds,
      currentPendingTransferFdxTransactionIds,
      startDate: getManagerAkahuLinkedAccountStartDate(input.context.account),
    })
  }

  return state
})

const processManagerAkahuSettledTransaction = Effect.fn("processManagerAkahuSettledTransaction")(
  function* (input: {
    readonly context: ManagerAkahuTransactionSyncAccountContext
    readonly state: ManagerAkahuSettledPhaseState
    readonly transaction: Transaction
  }) {
    const { client, syncRead } = input.context
    const transaction = input.transaction
    const startDate = getManagerAkahuLinkedAccountStartDate(input.context.account)
    if (!isManagerAkahuTransactionEligibleForStartDate(transaction.date, startDate)) {
      return continueManagerAkahuSettledPhase(input.state)
    }

    let accountState = incrementManagerAkahuTransactionSyncAccountCount(
      input.state.accountState,
      "settledFetched",
    )
    let state: ManagerAkahuSettledPhaseState = { ...input.state, accountState }

    const intent = decideManagerAkahuSettledImportIntent({
      context: input.context,
      transaction,
    })

    switch (intent._tag) {
      case "invalid-transfer-intent":
        state = {
          ...state,
          accountState: incrementManagerAkahuTransactionSyncAccountCount(
            state.accountState,
            "unsupportedSkipped",
          ),
        }
        return continueManagerAkahuSettledPhase(state)
      case "transfer": {
        accountState = incrementManagerAkahuTransactionSyncAccountCount(
          state.accountState,
          "transferRulesMatched",
        )
        state = { ...state, accountState }

        state = {
          ...state,
          accountState: addManagerAkahuTransferRuleOverlapWarning(
            state.accountState,
            intent.match.overlapMatch,
          ),
        }

        if (state.accountState.processedFdxTransactionIds.has(transaction._id)) {
          state = addManagerAkahuSettledPhaseAccountState(
            state,
            addManagerAkahuTransactionSyncAccountDuplicateSkip(state.accountState),
          )
          return continueManagerAkahuSettledPhase(state)
        }

        switch (intent.classification._tag) {
          case "transfer":
            return yield* processManagerAkahuSettledTransferTransaction({
              client,
              syncRead,
              state,
              transaction,
              classification: intent.classification,
            })
          case "zero":
            state = addManagerAkahuSettledPhaseAccountState(
              state,
              incrementManagerAkahuTransactionSyncAccountCount(
                state.accountState,
                "zeroAmountSkipped",
              ),
            )
            return continueManagerAkahuSettledPhase(state)
          case "unsupported":
            state = addManagerAkahuSettledPhaseAccountState(
              state,
              addManagerAkahuTransactionSyncAccountWarningSkip(
                state.accountState,
                intent.classification.warning,
                "unsupportedSkipped",
              ),
            )
            return continueManagerAkahuSettledPhase(state)
        }
      }
      case "suspense":
        break
    }

    const duplicateDecision = decideSettledDuplicateByAkahuTransactionId(syncRead, transaction._id)
    if (duplicateDecision._tag === "duplicate") {
      return skipManagerAkahuSettledPhaseDuplicateOverlap({
        state,
        fdxTransactionId: transaction._id,
      })
    }

    if (state.accountState.processedFdxTransactionIds.has(transaction._id)) {
      state = addManagerAkahuSettledPhaseAccountState(
        state,
        addManagerAkahuTransactionSyncAccountDuplicateSkip(state.accountState),
      )
      return continueManagerAkahuSettledPhase(state)
    }

    switch (intent.classification._tag) {
      case "receipt":
      case "payment":
        {
          const pendingReplacementDecision = decidePendingToSettledMatch({
            syncRead,
            settledDate: transaction.date,
            settledSignedAmount: transaction.amount,
            settledDescription: getAkahuTransactionDescription(transaction),
            excludedFdxTransactionIds: state.accountState.processedFdxTransactionIds,
            startDate,
          })

          if (pendingReplacementDecision._tag === "match") {
            accountState =
              pendingReplacementDecision.entry._tag === "interAccountTransfer"
                ? yield* updateManagerAkahuSettledRecategorizedTransferEndpoint({
                    state: state.accountState,
                    client,
                    fdxTransactionId: transaction._id,
                    entry: pendingReplacementDecision.entry,
                  })
                : yield* updateManagerAkahuAccountStateFromClassifiedUpdate({
                    state: state.accountState,
                    client,
                    classification: intent.classification,
                    entry: pendingReplacementDecision.entry,
                    kindMismatchWarning: `Existing pending Manager entry ${pendingReplacementDecision.entry.key} has a different transaction type than the settled Akahu transaction.`,
                    processedFdxTransactionIds: [
                      pendingReplacementDecision.entry.fdxTransactionId,
                      transaction._id,
                    ],
                    successCount: "pendingSettled",
                  })
            return continueManagerAkahuSettledPhase({ ...state, accountState })
          }

          if (pendingReplacementDecision._tag === "ambiguous") {
            accountState = addManagerAkahuTransactionSyncAccountWarningSkip(
              state.accountState,
              pendingReplacementDecision.warning,
              "warnings",
            )
            state = { ...state, accountState }
          }

          const transferDuplicateDecision = selectManagerAkahuSuspenseTransferDuplicateCandidate({
            syncRead,
            bankOrCashAccountKey: input.context.account.key,
            settledKind: intent.classification._tag,
            settledDate: transaction.date,
            absoluteNormalizedAmount: intent.classification.absoluteNormalizedAmount,
            settledDescription: getAkahuTransactionDescription(transaction),
          })

          if (transferDuplicateDecision._tag === "candidate") {
            return skipManagerAkahuSettledPhaseDuplicateOverlap({
              state,
              fdxTransactionId: transaction._id,
            })
          }

          if (transferDuplicateDecision._tag === "ambiguous") {
            return skipManagerAkahuSettledPhaseDuplicateOverlap({
              state,
              fdxTransactionId: transaction._id,
              warning: transferDuplicateDecision.warning,
            })
          }
        }

        accountState = yield* createManagerAkahuTransaction({
          state: state.accountState,
          client,
          fdxTransactionId: transaction._id,
          classification: intent.classification,
          successCounts: [],
        })
        return continueManagerAkahuSettledPhase({ ...state, accountState })
      case "zero": {
        state = addManagerAkahuSettledPhaseAccountState(
          state,
          incrementManagerAkahuTransactionSyncAccountCount(state.accountState, "zeroAmountSkipped"),
        )
        return continueManagerAkahuSettledPhase(state)
      }
      case "unsupported": {
        accountState = addManagerAkahuTransactionSyncAccountWarningSkip(
          state.accountState,
          intent.classification.warning,
          "unsupportedSkipped",
        )
        return continueManagerAkahuSettledPhase({ ...state, accountState })
      }
    }
  },
)

const decideManagerAkahuSettledImportIntent = (input: {
  readonly context: ManagerAkahuTransactionSyncAccountContext
  readonly transaction: Transaction
}): ManagerAkahuSettledImportIntent => {
  const { account } = input.context
  const transaction = input.transaction
  const transferRuleMatch = matchManagerAkahuTransferRule({
    rules: account.transferRules,
    description: transaction.description,
  })

  if (transferRuleMatch._tag === "match") {
    return {
      _tag: "transfer",
      match: transferRuleMatch,
      classification: classifyManagerAkahuInterAccountTransfer({
        rule: transferRuleMatch.rule,
        date: transaction.date,
        signedAmount: transaction.amount,
        description: transaction.description,
        fdxTransactionId: transaction._id,
        clearance: { _tag: "settled" },
      }),
    }
  }

  if (
    input.context.invalidTransferRuleMatchers.some((matcher) =>
      matchesAkahuTransferRuleDescription(matcher.rule, transaction.description),
    )
  ) {
    return { _tag: "invalid-transfer-intent" }
  }

  return {
    _tag: "suspense",
    classification: classifyManagerAkahuSuspenseImport({
      bankOrCashAccountKey: account.key,
      date: transaction.date,
      signedAmount: transaction.amount,
      description: getAkahuTransactionDescription(transaction),
      fdxTransactionId: transaction._id,
      clearance: { _tag: "settled" },
      importabilityDecision: managerAkahuImportCurrencyDecision,
    }),
  }
}

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

  return addManagerAkahuTransactionSyncAccountSuccessfulWrite(input.state, {
    processedFdxTransactionIds: [input.fdxTransactionId],
    successCounts: [write.createdCount, ...input.successCounts],
  })
})

const processManagerAkahuSettledTransferTransaction = Effect.fn(
  "processManagerAkahuSettledTransferTransaction",
)(function* (input: {
  readonly client: ManagerAkahuTransactionSyncManagerClient
  readonly syncRead: ManagerBankOrCashAccountSyncRead
  readonly state: ManagerAkahuSettledPhaseState
  readonly transaction: Transaction
  readonly classification: ManagerAkahuTransferCreateClassification
}) {
  let accountState = input.state.accountState
  const duplicateDecision = decideTransferDuplicateByFdxTransactionId({
    syncRead: input.syncRead,
    fdxTransactionId: input.transaction._id,
    sourceTransferSide: input.classification.sourceTransferSide,
    payload: input.classification.payload,
  })

  switch (duplicateDecision._tag) {
    case "create": {
      const pendingReplacementDecision = decidePendingTransferToSettledMatch({
        syncRead: input.syncRead,
        sourceTransferSide: input.classification.sourceTransferSide,
        payload: input.classification.payload,
        excludedFdxTransactionIds: accountState.processedFdxTransactionIds,
      })

      switch (pendingReplacementDecision._tag) {
        case "match":
          accountState = yield* updateManagerAkahuSettledPendingTransfer({
            state: accountState,
            client: input.client,
            fdxTransactionId: input.transaction._id,
            pendingFdxTransactionId: pendingReplacementDecision.pendingFdxTransactionId,
            classification: input.classification,
            transfer: pendingReplacementDecision.transfer,
          })
          return continueManagerAkahuSettledPhase({ ...input.state, accountState })
        case "ambiguous":
          accountState = addManagerAkahuTransactionSyncAccountWarningSkip(
            accountState,
            pendingReplacementDecision.warning,
            "duplicatesSkipped",
          )
          return continueManagerAkahuSettledPhase({ ...input.state, accountState })
        case "none":
          break
      }

      const mirrorDecision = selectManagerAkahuMirroredTransferCandidate({
        syncRead: input.syncRead,
        sourceTransferSide: input.classification.sourceTransferSide,
        payload: input.classification.payload,
      })

      switch (mirrorDecision._tag) {
        case "none":
          accountState = yield* createManagerAkahuTransfer({
            state: accountState,
            client: input.client,
            fdxTransactionId: input.transaction._id,
            classification: input.classification,
          })
          return continueManagerAkahuSettledPhase({ ...input.state, accountState })
        case "candidate":
          accountState = yield* updateManagerAkahuSettledMirroredTransfer({
            state: accountState,
            client: input.client,
            fdxTransactionId: input.transaction._id,
            classification: input.classification,
            candidate: mirrorDecision.candidate,
          })
          return continueManagerAkahuSettledPhase({ ...input.state, accountState })
        case "ambiguous":
          accountState = addManagerAkahuTransactionSyncAccountWarningSkip(
            accountState,
            mirrorDecision.warning,
            "duplicatesSkipped",
          )
          return continueManagerAkahuSettledPhase({ ...input.state, accountState })
      }
    }
    case "duplicate":
      return skipManagerAkahuSettledPhaseDuplicateOverlap({
        state: input.state,
        fdxTransactionId: input.transaction._id,
      })
    case "previouslyImportedAsSuspense":
    case "ambiguous":
      return skipManagerAkahuSettledPhaseDuplicateOverlap({
        state: input.state,
        fdxTransactionId: input.transaction._id,
        warning: duplicateDecision.warning,
      })
  }
})

const createManagerAkahuTransfer = Effect.fn("createManagerAkahuTransfer")(function* (input: {
  readonly state: ManagerAkahuTransactionSyncAccountState
  readonly client: ManagerAkahuTransactionSyncManagerClient
  readonly fdxTransactionId: string
  readonly classification: ManagerAkahuTransferCreateClassification
  readonly successCounts?: ReadonlyArray<keyof ManagerAkahuSyncSummaryCounts> | undefined
}) {
  const writeResult = yield* input.client["POST/api4/inter-account-transfer"](
    input.classification.payload,
  ).pipe(
    Effect.as({ _tag: "created" as const }),
    Effect.catch((error) =>
      Effect.succeed({ _tag: "error" as const, error: formatSyncError(error) }),
    ),
  )

  if (writeResult._tag === "error") {
    return addManagerAkahuTransactionSyncAccountError(input.state, writeResult.error)
  }

  return addManagerAkahuTransactionSyncAccountSuccessfulWrite(input.state, {
    processedFdxTransactionIds: [input.fdxTransactionId],
    successCounts: ["transfersCreated", ...(input.successCounts ?? [])],
  })
})

const updateManagerAkahuPendingTransfer = Effect.fn("updateManagerAkahuPendingTransfer")(
  function* (input: {
    readonly state: ManagerAkahuTransactionSyncAccountState
    readonly client: ManagerAkahuTransactionSyncManagerClient
    readonly fdxTransactionId: string
    readonly classification: ManagerAkahuTransferCreateClassification
    readonly entry: ManagerBankOrCashAccountSyncRead["existingTransferFdxTransactionIdEntries"][number]
  }) {
    const writeResult = yield* input.client["PUT/api4/inter-account-transfer"]({
      key: input.entry.key,
      value: input.classification.payload.value,
    }).pipe(
      Effect.as({ _tag: "updated" as const }),
      Effect.catch((error) =>
        Effect.succeed({ _tag: "error" as const, error: formatSyncError(error) }),
      ),
    )

    if (writeResult._tag === "error") {
      return addManagerAkahuTransactionSyncAccountError(input.state, writeResult.error)
    }

    return addManagerAkahuTransactionSyncAccountSuccessfulWrite(input.state, {
      processedFdxTransactionIds: [input.fdxTransactionId],
      successCounts: ["transfersUpdated", "pendingUpdated"],
    })
  },
)

const updateManagerAkahuSettledPendingTransfer = Effect.fn(
  "updateManagerAkahuSettledPendingTransfer",
)(function* (input: {
  readonly state: ManagerAkahuTransactionSyncAccountState
  readonly client: ManagerAkahuTransactionSyncManagerClient
  readonly fdxTransactionId: string
  readonly pendingFdxTransactionId: string
  readonly classification: ManagerAkahuTransferCreateClassification
  readonly transfer: ManagerBankOrCashAccountSyncRead["interAccountTransfers"][number]
}) {
  const writeResult = yield* input.client["PUT/api4/inter-account-transfer"](
    buildManagerAkahuSettledMirroredTransferUpdatePayload({
      transfer: input.transfer,
      sourceTransferSide: input.classification.sourceTransferSide,
      fdxTransactionId: input.fdxTransactionId,
    }),
  ).pipe(
    Effect.as({ _tag: "updated" as const }),
    Effect.catch((error) =>
      Effect.succeed({ _tag: "error" as const, error: formatSyncError(error) }),
    ),
  )

  if (writeResult._tag === "error") {
    return addManagerAkahuTransactionSyncAccountError(input.state, writeResult.error)
  }

  return addManagerAkahuTransactionSyncAccountSuccessfulWrite(input.state, {
    processedFdxTransactionIds: [input.pendingFdxTransactionId, input.fdxTransactionId],
    successCounts: ["transfersUpdated", "pendingSettled"],
  })
})

const updateManagerAkahuSettledRecategorizedTransferEndpoint = Effect.fn(
  "updateManagerAkahuSettledRecategorizedTransferEndpoint",
)(function* (input: {
  readonly state: ManagerAkahuTransactionSyncAccountState
  readonly client: ManagerAkahuTransactionSyncManagerClient
  readonly fdxTransactionId: string
  readonly entry: ManagerBankOrCashAccountSyncRead["existingTransferFdxTransactionIdEntries"][number]
}) {
  const writeResult = yield* input.client["PUT/api4/inter-account-transfer"](
    buildManagerAkahuSettledTransferEndpointUpdatePayload({
      transfer: input.entry.interAccountTransfer,
      transferSide: input.entry.transferSide,
      fdxTransactionId: input.fdxTransactionId,
    }),
  ).pipe(
    Effect.as({ _tag: "updated" as const }),
    Effect.catch((error) =>
      Effect.succeed({ _tag: "error" as const, error: formatSyncError(error) }),
    ),
  )

  if (writeResult._tag === "error") {
    return addManagerAkahuTransactionSyncAccountError(input.state, writeResult.error)
  }

  return addManagerAkahuTransactionSyncAccountSuccessfulWrite(input.state, {
    processedFdxTransactionIds: [input.entry.fdxTransactionId, input.fdxTransactionId],
    successCounts: ["transfersUpdated", "pendingSettled"],
  })
})

const updateManagerAkahuSettledMirroredTransfer = Effect.fn(
  "updateManagerAkahuSettledMirroredTransfer",
)(function* (input: {
  readonly state: ManagerAkahuTransactionSyncAccountState
  readonly client: ManagerAkahuTransactionSyncManagerClient
  readonly fdxTransactionId: string
  readonly classification: ManagerAkahuTransferCreateClassification
  readonly candidate: ManagerBankOrCashAccountSyncRead["interAccountTransfers"][number]
}) {
  const writeResult = yield* input.client["PUT/api4/inter-account-transfer"](
    buildManagerAkahuSettledMirroredTransferUpdatePayload({
      transfer: input.candidate,
      sourceTransferSide: input.classification.sourceTransferSide,
      fdxTransactionId: input.fdxTransactionId,
    }),
  ).pipe(
    Effect.as({ _tag: "updated" as const }),
    Effect.catch((error) =>
      Effect.succeed({ _tag: "error" as const, error: formatSyncError(error) }),
    ),
  )

  if (writeResult._tag === "error") {
    return addManagerAkahuTransactionSyncAccountError(input.state, writeResult.error)
  }

  return addManagerAkahuTransactionSyncAccountSuccessfulWrite(input.state, {
    processedFdxTransactionIds: [input.fdxTransactionId],
    successCounts: ["transfersMerged"],
  })
})

const processManagerAkahuPendingTransaction = Effect.fn("processManagerAkahuPendingTransaction")(
  function* (input: {
    readonly context: ManagerAkahuTransactionSyncAccountContext
    readonly state: ManagerAkahuTransactionSyncAccountState
    readonly transaction: PendingTransaction
    readonly currentPendingFdxTransactionIds: Set<string>
    readonly currentPendingTransferFdxTransactionIds: Set<string>
  }): Effect.fn.Return<ManagerAkahuTransactionSyncAccountState> {
    const { account, client, syncRead } = input.context
    const transaction = input.transaction
    const description = transaction.description
    let state = incrementManagerAkahuTransactionSyncAccountCount(input.state, "pendingFetched")

    const transferRuleMatch = matchManagerAkahuTransferRule({
      rules: account.transferRules,
      description,
    })

    if (transferRuleMatch._tag === "match") {
      state = incrementManagerAkahuTransactionSyncAccountCount(state, "transferRulesMatched")
      state = addManagerAkahuTransferRuleOverlapWarning(state, transferRuleMatch.overlapMatch)

      const fingerprintDecision = buildAkahuPendingTransferFingerprint({
        akahuAccountId: account.akahuAccount._id,
        date: transaction.date,
        amount: transaction.amount,
        description,
        rule: transferRuleMatch.rule,
      })

      if (fingerprintDecision._tag === "unsupported") {
        state = addManagerAkahuTransactionSyncAccountWarning(state, fingerprintDecision.warning)
        state = incrementManagerAkahuTransactionSyncAccountCount(state, "unsupportedSkipped")
        return incrementManagerAkahuTransactionSyncAccountCount(state, "warnings")
      }

      input.currentPendingTransferFdxTransactionIds.add(fingerprintDecision.fingerprint)

      if (state.processedFdxTransactionIds.has(fingerprintDecision.fingerprint)) {
        return incrementManagerAkahuTransactionSyncAccountCount(state, "duplicatesSkipped")
      }

      const classification = classifyManagerAkahuInterAccountTransfer({
        rule: transferRuleMatch.rule,
        date: transaction.date,
        signedAmount: transaction.amount,
        description,
        fdxTransactionId: fingerprintDecision.fingerprint,
        clearance: { _tag: "pending" },
      })

      switch (classification._tag) {
        case "transfer":
          return yield* processManagerAkahuPendingTransferTransaction({
            state,
            client,
            syncRead,
            fdxTransactionId: fingerprintDecision.fingerprint,
            classification,
          })
        case "zero":
          return incrementManagerAkahuTransactionSyncAccountCount(state, "zeroAmountSkipped")
        case "unsupported":
          state = addManagerAkahuTransactionSyncAccountWarning(state, classification.warning)
          state = incrementManagerAkahuTransactionSyncAccountCount(state, "unsupportedSkipped")
          return incrementManagerAkahuTransactionSyncAccountCount(state, "warnings")
      }
    }

    if (
      input.context.invalidTransferRuleMatchers.some((matcher) =>
        matchesAkahuTransferRuleDescription(matcher.rule, description),
      )
    ) {
      return incrementManagerAkahuTransactionSyncAccountCount(state, "unsupportedSkipped")
    }

    const fingerprintDecision = buildAkahuPendingTransactionFingerprint({
      akahuAccountId: account.akahuAccount._id,
      date: transaction.date,
      amount: transaction.amount,
      description,
    })

    if (fingerprintDecision._tag === "fingerprint") {
      input.currentPendingFdxTransactionIds.add(fingerprintDecision.fingerprint)
    }

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
      description,
      fdxTransactionId: fingerprintDecision.fingerprint,
      clearance: { _tag: "pending" },
      importabilityDecision: managerAkahuImportCurrencyDecision,
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
          : yield* updateManagerAkahuAccountStateFromClassifiedUpdate({
              state,
              client,
              classification,
              entry: exactFingerprintDecision.entry,
              kindMismatchWarning: `Existing pending Manager entry ${exactFingerprintDecision.entry.key} has a different transaction type than its fingerprint.`,
              processedFdxTransactionIds: [fingerprintDecision.fingerprint],
              successCount: "pendingUpdated",
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

const processManagerAkahuPendingTransferTransaction = Effect.fn(
  "processManagerAkahuPendingTransferTransaction",
)(function* (input: {
  readonly state: ManagerAkahuTransactionSyncAccountState
  readonly client: ManagerAkahuTransactionSyncManagerClient
  readonly syncRead: ManagerBankOrCashAccountSyncRead
  readonly fdxTransactionId: string
  readonly classification: ManagerAkahuTransferCreateClassification
}) {
  const duplicateDecision = decideTransferDuplicateByFdxTransactionId({
    syncRead: input.syncRead,
    fdxTransactionId: input.fdxTransactionId,
    sourceTransferSide: input.classification.sourceTransferSide,
    payload: input.classification.payload,
  })

  switch (duplicateDecision._tag) {
    case "create":
      return yield* createManagerAkahuTransfer({
        state: input.state,
        client: input.client,
        fdxTransactionId: input.fdxTransactionId,
        classification: input.classification,
        successCounts: ["pendingCreated"],
      })
    case "duplicate":
      return yield* updateManagerAkahuPendingTransfer({
        state: input.state,
        client: input.client,
        fdxTransactionId: input.fdxTransactionId,
        classification: input.classification,
        entry: duplicateDecision.entries[0],
      })
    case "previouslyImportedAsSuspense":
    case "ambiguous":
      return addManagerAkahuTransactionSyncAccountWarningSkip(
        input.state,
        duplicateDecision.warning,
        "duplicatesSkipped",
      )
  }
})

const updateManagerAkahuAccountStateFromClassifiedUpdate = Effect.fn(
  "updateManagerAkahuAccountStateFromClassifiedUpdate",
)(function* (input: {
  readonly state: ManagerAkahuTransactionSyncAccountState
  readonly client: ManagerAkahuTransactionSyncManagerClient
  readonly classification: ManagerAkahuTransactionCreateClassification
  readonly entry: ManagerBankOrCashAccountSyncRead["existingFdxTransactionIdEntries"][number]
  readonly kindMismatchWarning: string
  readonly processedFdxTransactionIds: ReadonlyArray<string>
  readonly successCount: keyof ManagerAkahuSyncSummaryCounts
}) {
  if (input.classification._tag !== input.entry._tag) {
    let state = addManagerAkahuTransactionSyncAccountWarning(input.state, input.kindMismatchWarning)
    state = incrementManagerAkahuTransactionSyncAccountCount(state, "duplicatesSkipped")
    return incrementManagerAkahuTransactionSyncAccountCount(state, "warnings")
  }

  const writeResult = yield* putManagerAkahuClassifiedUpdate({
    client: input.client,
    key: input.entry.key,
    classification: input.classification,
  })

  if (writeResult._tag === "error") {
    return addManagerAkahuTransactionSyncAccountError(input.state, writeResult.error)
  }

  return addManagerAkahuTransactionSyncAccountSuccessfulWrite(input.state, {
    processedFdxTransactionIds: input.processedFdxTransactionIds,
    successCounts: [input.successCount],
  })
})

const putManagerAkahuClassifiedUpdate = Effect.fn("putManagerAkahuClassifiedUpdate")(
  function* (input: {
    readonly client: ManagerAkahuTransactionSyncManagerClient
    readonly key: string
    readonly classification: ManagerAkahuTransactionCreateClassification
  }) {
    // Updates intentionally replace the entry with the canonical Akahu suspense
    // payload until a safe field-preservation policy is verified.
    const write =
      input.classification._tag === "receipt"
        ? input.client["PUT/api4/receipt"]({
            key: input.key,
            value: input.classification.managerDecision.payload.value,
          } satisfies ManagerAkahuReceiptUpdatePayload)
        : input.client["PUT/api4/payment"]({
            key: input.key,
            value: input.classification.managerDecision.payload.value,
          } satisfies ManagerAkahuPaymentUpdatePayload)

    return yield* write.pipe(
      Effect.as({ _tag: "updated" as const }),
      Effect.catch((error) =>
        Effect.succeed({ _tag: "error" as const, error: formatSyncError(error) }),
      ),
    )
  },
)

const initialManagerAkahuTransactionSyncAccountState = (
  warnings: ReadonlyArray<string> = [],
): ManagerAkahuTransactionSyncAccountState => ({
  counts: warnings.reduce(
    (counts) => incrementManagerAkahuSyncSummaryCount(counts, "warnings"),
    emptyManagerAkahuSyncSummaryCounts(),
  ),
  warnings,
  errors: [],
  processedFdxTransactionIds: new Set(),
  transferRuleOverlapAggregationKeys: new Set(),
})

const incrementManagerAkahuTransactionSyncAccountCount = (
  state: ManagerAkahuTransactionSyncAccountState,
  count: keyof ManagerAkahuSyncSummaryCounts,
): ManagerAkahuTransactionSyncAccountState => ({
  ...state,
  counts: incrementManagerAkahuSyncSummaryCount(state.counts, count),
})

const addManagerAkahuTransactionSyncAccountCounts = (
  state: ManagerAkahuTransactionSyncAccountState,
  counts: ReadonlyArray<keyof ManagerAkahuSyncSummaryCounts>,
): ManagerAkahuTransactionSyncAccountState =>
  counts.reduce(incrementManagerAkahuTransactionSyncAccountCount, state)

const addManagerAkahuTransactionSyncAccountDuplicateSkip = (
  state: ManagerAkahuTransactionSyncAccountState,
): ManagerAkahuTransactionSyncAccountState =>
  incrementManagerAkahuTransactionSyncAccountCount(state, "duplicatesSkipped")

const addManagerAkahuTransactionSyncAccountWarningSkip = (
  state: ManagerAkahuTransactionSyncAccountState,
  warning: string,
  skippedCount: keyof ManagerAkahuSyncSummaryCounts,
): ManagerAkahuTransactionSyncAccountState => {
  const nextState = incrementManagerAkahuTransactionSyncAccountCount(
    addManagerAkahuTransactionSyncAccountWarning(state, warning),
    skippedCount,
  )
  return skippedCount === "warnings"
    ? nextState
    : incrementManagerAkahuTransactionSyncAccountCount(nextState, "warnings")
}

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

const addManagerAkahuTransactionSyncAccountSuccessfulWrite = (
  state: ManagerAkahuTransactionSyncAccountState,
  input: {
    readonly processedFdxTransactionIds: ReadonlyArray<string>
    readonly successCounts: ReadonlyArray<keyof ManagerAkahuSyncSummaryCounts>
  },
): ManagerAkahuTransactionSyncAccountState => {
  let nextState = state
  for (const fdxTransactionId of input.processedFdxTransactionIds) {
    nextState = addManagerAkahuTransactionSyncAccountProcessedFdxTransactionId(
      nextState,
      fdxTransactionId,
    )
  }
  return addManagerAkahuTransactionSyncAccountCounts(nextState, input.successCounts)
}

const addManagerAkahuTransferRuleOverlapWarning = (
  state: ManagerAkahuTransactionSyncAccountState,
  overlapMatch: ManagerAkahuTransferRuleOverlapMatch | undefined,
): ManagerAkahuTransactionSyncAccountState => {
  if (!overlapMatch || state.transferRuleOverlapAggregationKeys.has(overlapMatch.aggregationKey)) {
    return state
  }

  let accountState = addManagerAkahuTransactionSyncAccountWarning(
    {
      ...state,
      transferRuleOverlapAggregationKeys: new Set(state.transferRuleOverlapAggregationKeys).add(
        overlapMatch.aggregationKey,
      ),
    },
    `Transfer rule "${overlapMatch.selectedRule.keyword}" matched; ignored ${overlapMatch.ignoredRules.length} later matching transfer rule(s).`,
  )
  accountState = incrementManagerAkahuTransactionSyncAccountCount(accountState, "warnings")
  return accountState
}

const detectManagerAkahuStalePendingEntries = (input: {
  readonly state: ManagerAkahuTransactionSyncAccountState
  readonly syncRead: ManagerBankOrCashAccountSyncRead
  readonly currentPendingFdxTransactionIds: ReadonlySet<string>
  readonly currentPendingTransferFdxTransactionIds: ReadonlySet<string>
  readonly startDate: DateTime.Utc | undefined
}): ManagerAkahuTransactionSyncAccountState => {
  let state = input.state

  for (const entry of decideStalePendingEntries({
    syncRead: input.syncRead,
    currentPendingFdxTransactionIds: input.currentPendingFdxTransactionIds,
    processedFdxTransactionIds: state.processedFdxTransactionIds,
    startDate: input.startDate,
  })) {
    state = addManagerAkahuTransactionSyncAccountWarning(
      state,
      `Stale Akahu pending Manager ${entry._tag} ${entry.key} (${entry.fdxTransactionId}) was not returned by Akahu pending transactions and was not replaced by a settled transaction; leaving it unchanged.`,
    )
    state = incrementManagerAkahuTransactionSyncAccountCount(state, "stalePendingDetected")
    state = incrementManagerAkahuTransactionSyncAccountCount(state, "warnings")
  }

  for (const entry of decideStalePendingTransferEntries({
    syncRead: input.syncRead,
    currentPendingFdxTransactionIds: input.currentPendingTransferFdxTransactionIds,
    processedFdxTransactionIds: state.processedFdxTransactionIds,
    startDate: input.startDate,
  })) {
    state = addManagerAkahuTransactionSyncAccountWarning(
      state,
      `Stale Akahu pending Manager inter-account transfer ${entry.key} (${entry.fdxTransactionId}) was not returned by Akahu pending transactions and was not replaced by a settled transaction; leaving it unchanged.`,
    )
    state = incrementManagerAkahuTransactionSyncAccountCount(state, "stalePendingDetected")
    state = incrementManagerAkahuTransactionSyncAccountCount(state, "stalePendingTransfersDetected")
    state = incrementManagerAkahuTransactionSyncAccountCount(state, "warnings")
  }

  return state
}

const addManagerAkahuSettledPhaseExistingOverlap = (
  state: ManagerAkahuSettledPhaseState,
  fdxTransactionId: string,
): ManagerAkahuSettledPhaseState => ({
  ...state,
  existingSettledOverlapIds: new Set(state.existingSettledOverlapIds).add(fdxTransactionId),
})

const addManagerAkahuSettledPhaseAccountState = (
  state: ManagerAkahuSettledPhaseState,
  accountState: ManagerAkahuTransactionSyncAccountState,
): ManagerAkahuSettledPhaseState => ({ ...state, accountState })

const skipManagerAkahuSettledPhaseDuplicateOverlap = (input: {
  readonly state: ManagerAkahuSettledPhaseState
  readonly fdxTransactionId: string
  readonly warning?: string | undefined
}): ManagerAkahuSettledPhaseStep => {
  const accountState = input.warning
    ? addManagerAkahuTransactionSyncAccountWarningSkip(
        input.state.accountState,
        input.warning,
        "duplicatesSkipped",
      )
    : addManagerAkahuTransactionSyncAccountDuplicateSkip(input.state.accountState)

  return buildManagerAkahuSettledPhaseResult(
    addManagerAkahuSettledPhaseExistingOverlap(
      addManagerAkahuSettledPhaseAccountState(input.state, accountState),
      input.fdxTransactionId,
    ),
  )
}

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
  const credentialFields = findManagerAkahuCredentialFields(fields)

  if (credentialFields.missingFieldNames.length > 0) {
    return yield* new ManagerAkahuTransactionSyncConfigurationError({
      message: "Akahu credential fields are missing from Manager Business Details.",
    })
  }

  const business = yield* client["GET/api4/business-details"]()
  const tokens = decodeManagerAkahuBusinessDetailTokens({
    fields: credentialFields,
    strings: business.customFields2?.strings ?? {},
  })

  if (tokens._tag === "missing") {
    return yield* new ManagerAkahuTransactionSyncConfigurationError({
      message: "Akahu credentials are missing from Manager Business Details.",
    })
  }

  return tokens.tokens
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

const getManagerAkahuLinkedAccountStartDate = (account: LinkedAccount): DateTime.Utc | undefined =>
  Option.getOrUndefined(account.akahuStartDate)

const isManagerAkahuTransactionEligibleForStartDate = (
  transactionDate: DateTime.DateTime,
  startDate: DateTime.Utc | undefined,
): boolean =>
  decideAkahuDateTimeStartDateEligibility({ transactionDate, startDate })._tag === "eligible"

const formatSyncError = (error: unknown): string =>
  error instanceof Error ? error.message : String(error)
