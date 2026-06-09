import { ApiClient } from "@/ApiClient"
import { Manager } from "@/Manager"
import {
  buildLinkedAccountTransferRules,
  LinkedAccount,
  matchesAkahuTransferRuleDescription,
  parseAkahuTransferRules,
  type AkahuTokens,
  type ManagerAkahuTransferRuleAccountMetadata,
} from "@app/domain/Manager/AkahuCustomFields"
import type { AccountId, PendingTransaction, Transaction } from "@app/domain/Akahu"
import {
  addManagerAkahuSyncSummaryCounts,
  buildAkahuPendingTransactionFingerprint,
  classifyManagerAkahuInterAccountTransfer,
  classifyManagerAkahuSuspenseImport,
  decidePendingExactFingerprint,
  decidePendingToSettledMatch,
  decideSettledDuplicateByAkahuTransactionId,
  decideStalePendingEntries,
  decideTransferDuplicateByFdxTransactionId,
  emptyManagerAkahuSyncSummaryCounts,
  incrementManagerAkahuSyncSummaryCount,
  matchManagerAkahuTransferRule,
  selectManagerAkahuMirroredTransferCandidate,
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
import { Context, Effect, Layer, Schema, Stream } from "effect"
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

interface ManagerAkahuInvalidTransferRuleMatcher {
  readonly rule: ReturnType<typeof parseAkahuTransferRules>["rules"][number]
}

interface ManagerAkahuRefreshedLinkedAccount {
  readonly account: LinkedAccount
  readonly invalidTransferRuleMatchers: ReadonlyArray<ManagerAkahuInvalidTransferRuleMatcher>
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
  readonly invalidTransferRuleMatchers: ReadonlyArray<ManagerAkahuInvalidTransferRuleMatcher>
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
      }),
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
  readonly stream: Stream.Stream<A, unknown>
  readonly fetchedCount: "settledFetched" | "pendingFetched"
}) {
  let state = input.state
  let failed = false

  yield* input.stream.pipe(
    Stream.runForEach(() =>
      Effect.sync(() => {
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
        akahuAccount: account.akahuAccount,
        transferRules: transferRulesResult.rules,
        transferRuleWarnings: transferRulesResult.warnings,
      }),
      invalidTransferRuleMatchers: buildInvalidTransferRuleMatchers({
        sourceAccount,
        rawValue,
        managerAccountsByKey,
      }),
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

const buildInvalidTransferRuleMatchers = (options: {
  readonly sourceAccount: ManagerAkahuTransferRuleAccountMetadata
  readonly rawValue: unknown
  readonly managerAccountsByKey: ReadonlyMap<string, ManagerAkahuTransferRuleAccountMetadata>
}): ReadonlyArray<ManagerAkahuInvalidTransferRuleMatcher> => {
  if (typeof options.rawValue !== "string" || options.rawValue.trim() === "") {
    return []
  }

  const parsed = parseAkahuTransferRules(options.rawValue)
  const matchers: Array<ManagerAkahuInvalidTransferRuleMatcher> = []
  const seenRuleKeys = new Set<string>()

  for (const rule of parsed.rules) {
    const ruleKey = `${rule.normalizedKeyword}\u0000${rule.destinationAccountKey}`
    if (seenRuleKeys.has(ruleKey)) {
      continue
    }
    seenRuleKeys.add(ruleKey)

    if (
      rule.destinationAccountKey === options.sourceAccount.key ||
      !options.managerAccountsByKey.has(rule.destinationAccountKey)
    ) {
      matchers.push({ rule })
    }
  }

  return matchers
}

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
  let failed = false
  const currentPendingFdxTransactionIds = new Set<string>()

  yield* input.input
    .fetchPendingTransactions({
      akahuAppToken: input.input.tokens.akahuAppToken,
      akahuUserToken: input.input.tokens.akahuUserToken,
      accountId: input.context.account.akahuAccount._id,
    })
    .pipe(
      Stream.runForEach((transaction) =>
        Effect.gen(function* () {
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
            fingerprintDecision,
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
    const { account, client, syncRead } = input.context
    const transaction = input.transaction
    let accountState = incrementManagerAkahuTransactionSyncAccountCount(
      input.state.accountState,
      "settledFetched",
    )
    let state: ManagerAkahuSettledPhaseState = { ...input.state, accountState }

    const transferRuleMatch = matchManagerAkahuTransferRule({
      rules: account.transferRules,
      description: transaction.description,
    })

    if (transferRuleMatch._tag === "match") {
      accountState = incrementManagerAkahuTransactionSyncAccountCount(
        state.accountState,
        "transferRulesMatched",
      )
      state = { ...state, accountState }

      if (transferRuleMatch.overlapMatch) {
        state = addManagerAkahuTransferRuleOverlapWarning(state, transferRuleMatch.overlapMatch)
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

      const classification = classifyManagerAkahuInterAccountTransfer({
        rule: transferRuleMatch.rule,
        date: transaction.date,
        signedAmount: transaction.amount,
        description: transaction.description,
        fdxTransactionId: transaction._id,
        clearance: { _tag: "settled" },
      })

      switch (classification._tag) {
        case "transfer":
          return yield* processManagerAkahuSettledTransferTransaction({
            client,
            syncRead,
            state,
            transaction,
            classification,
          })
        case "zero":
          state = {
            ...state,
            accountState: incrementManagerAkahuTransactionSyncAccountCount(
              state.accountState,
              "zeroAmountSkipped",
            ),
          }
          return continueManagerAkahuSettledPhase(state)
        case "unsupported":
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

    if (
      input.context.invalidTransferRuleMatchers.some((matcher) =>
        matchesAkahuTransferRuleDescription(matcher.rule, transaction.description),
      )
    ) {
      state = {
        ...state,
        accountState: incrementManagerAkahuTransactionSyncAccountCount(
          state.accountState,
          "unsupportedSkipped",
        ),
      }
      return continueManagerAkahuSettledPhase(state)
    }

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
      description: getAkahuTransactionDescription(transaction),
      fdxTransactionId: transaction._id,
      clearance: { _tag: "settled" },
      importabilityDecision: managerAkahuImportCurrencyDecision,
    })

    switch (classification._tag) {
      case "receipt":
      case "payment":
        {
          const pendingReplacementDecision = decidePendingToSettledMatch({
            syncRead,
            settledDate: transaction.date,
            settledSignedAmount: transaction.amount,
            settledDescription: getAkahuTransactionDescription(transaction),
            excludedFdxTransactionIds: state.accountState.processedFdxTransactionIds,
          })

          if (pendingReplacementDecision._tag === "match") {
            accountState = yield* updateManagerAkahuAccountStateFromClassifiedUpdate({
              state: state.accountState,
              client,
              classification,
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
          accountState = incrementManagerAkahuTransactionSyncAccountCount(
            accountState,
            "duplicatesSkipped",
          )
          return continueManagerAkahuSettledPhase({ ...input.state, accountState })
        case "ambiguous":
          accountState = addManagerAkahuTransactionSyncAccountWarning(
            accountState,
            mirrorDecision.warning,
          )
          accountState = incrementManagerAkahuTransactionSyncAccountCount(
            accountState,
            "duplicatesSkipped",
          )
          accountState = incrementManagerAkahuTransactionSyncAccountCount(accountState, "warnings")
          return continueManagerAkahuSettledPhase({ ...input.state, accountState })
      }
    }
    case "duplicate":
    case "mirrorCandidate":
      accountState = incrementManagerAkahuTransactionSyncAccountCount(
        accountState,
        "duplicatesSkipped",
      )
      return buildManagerAkahuSettledPhaseResult(
        addManagerAkahuSettledPhaseExistingOverlap(
          { ...input.state, accountState },
          input.transaction._id,
        ),
      )
    case "previouslyImportedAsSuspense":
    case "ambiguous":
      accountState = addManagerAkahuTransactionSyncAccountWarning(
        accountState,
        duplicateDecision.warning,
      )
      accountState = incrementManagerAkahuTransactionSyncAccountCount(
        accountState,
        "duplicatesSkipped",
      )
      accountState = incrementManagerAkahuTransactionSyncAccountCount(accountState, "warnings")
      return buildManagerAkahuSettledPhaseResult(
        addManagerAkahuSettledPhaseExistingOverlap(
          { ...input.state, accountState },
          input.transaction._id,
        ),
      )
  }
})

const createManagerAkahuTransfer = Effect.fn("createManagerAkahuTransfer")(function* (input: {
  readonly state: ManagerAkahuTransactionSyncAccountState
  readonly client: ManagerAkahuTransactionSyncManagerClient
  readonly fdxTransactionId: string
  readonly classification: ManagerAkahuTransferCreateClassification
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

  let state = addManagerAkahuTransactionSyncAccountProcessedFdxTransactionId(
    input.state,
    input.fdxTransactionId,
  )
  state = incrementManagerAkahuTransactionSyncAccountCount(state, "transfersCreated")
  return state
})

const processManagerAkahuPendingTransaction = Effect.fn("processManagerAkahuPendingTransaction")(
  function* (input: {
    readonly context: ManagerAkahuTransactionSyncAccountContext
    readonly state: ManagerAkahuTransactionSyncAccountState
    readonly transaction: PendingTransaction
    readonly fingerprintDecision: ReturnType<typeof buildAkahuPendingTransactionFingerprint>
  }): Effect.fn.Return<ManagerAkahuTransactionSyncAccountState> {
    const { account, client, syncRead } = input.context
    const transaction = input.transaction
    const description = transaction.description
    let state = incrementManagerAkahuTransactionSyncAccountCount(input.state, "pendingFetched")
    const fingerprintDecision = input.fingerprintDecision

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

  let state = input.state
  for (const fdxTransactionId of input.processedFdxTransactionIds) {
    state = addManagerAkahuTransactionSyncAccountProcessedFdxTransactionId(state, fdxTransactionId)
  }
  return incrementManagerAkahuTransactionSyncAccountCount(state, input.successCount)
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

const addManagerAkahuTransferRuleOverlapWarning = (
  state: ManagerAkahuSettledPhaseState,
  overlapMatch: ManagerAkahuTransferRuleOverlapMatch,
): ManagerAkahuSettledPhaseState => {
  if (state.accountState.transferRuleOverlapAggregationKeys.has(overlapMatch.aggregationKey)) {
    return state
  }

  let accountState = addManagerAkahuTransactionSyncAccountWarning(
    {
      ...state.accountState,
      transferRuleOverlapAggregationKeys: new Set(
        state.accountState.transferRuleOverlapAggregationKeys,
      ).add(overlapMatch.aggregationKey),
    },
    `Transfer rule "${overlapMatch.selectedRule.keyword}" matched; ignored ${overlapMatch.ignoredRules.length} later matching transfer rule(s).`,
  )
  accountState = incrementManagerAkahuTransactionSyncAccountCount(accountState, "warnings")
  return { ...state, accountState }
}

const detectManagerAkahuStalePendingEntries = (input: {
  readonly state: ManagerAkahuTransactionSyncAccountState
  readonly syncRead: ManagerBankOrCashAccountSyncRead
  readonly currentPendingFdxTransactionIds: ReadonlySet<string>
}): ManagerAkahuTransactionSyncAccountState => {
  let state = input.state

  for (const entry of decideStalePendingEntries({
    syncRead: input.syncRead,
    currentPendingFdxTransactionIds: input.currentPendingFdxTransactionIds,
    processedFdxTransactionIds: state.processedFdxTransactionIds,
  })) {
    state = addManagerAkahuTransactionSyncAccountWarning(
      state,
      `Stale Akahu pending Manager ${entry._tag} ${entry.key} (${entry.fdxTransactionId}) was not returned by Akahu pending transactions and was not replaced by a settled transaction; leaving it unchanged.`,
    )
    state = incrementManagerAkahuTransactionSyncAccountCount(state, "stalePendingDetected")
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

const formatSyncError = (error: unknown): string =>
  error instanceof Error ? error.message : String(error)
