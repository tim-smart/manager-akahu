import { Manager } from "@/Manager"
import { Context, Effect, Layer, Resource } from "effect"
import {
  LinkedAccount,
  LinkedAccountTransferRule,
  makeManagerAkahuSetupState,
  ManagerAkahuSetupError,
  ManagerAkahuSetupInvalidCredentials,
  ManagerAkahuSetupMissingCredentials,
  parseAkahuTransferRules,
  type ManagerAkahuSetupState,
  StaleLinkedAccountSelection,
} from "@app/domain/Manager/AkahuCustomFields"
import { ApiClient } from "@/ApiClient"
import type { Account } from "@app/domain/Akahu"
import { AkahuRpcError } from "@app/domain/rpc"
import {
  decodeManagerAkahuBusinessDetailTokens,
  findManagerAkahuCredentialFields,
  managerAkahuAppTokenFieldName,
  managerAkahuUserTokenFieldName,
} from "./AkahuCredentials"

type ManagerAkahuAccountRecord = {
  readonly key: string
  readonly item: {
    readonly name?: string | null | undefined
    readonly currency?: string | null | undefined
    readonly canHavePendingTransactions?: boolean | undefined
    readonly customFields2?:
      | {
          readonly strings?: Record<string, unknown> | null | undefined
        }
      | undefined
  }
}

export const managerAkahuAccountFieldName = "Akahu Account"
export const managerAkahuTransferRulesFieldName = "Akahu Transfer Rules"

const managerBankOrCashAccountCustomFieldPlacement = [
  "1408c33b-6284-4f50-9e31-48cbea21f3cf",
] as const
const managerMultilineTextCustomFieldType = 1
const managerDropdownTextCustomFieldType = 2

export class ManagerFlows extends Context.Service<
  ManagerFlows,
  {
    readonly getAkahuSetupState: Effect.Effect<ManagerAkahuSetupState>
  }
>()("ManagerFlows") {
  static readonly layer = Layer.effect(
    ManagerFlows,
    Effect.gen(function* () {
      const client = yield* Manager
      const api = yield* ApiClient

      const textFields = yield* Resource.manual(
        Effect.gen(function* () {
          return (yield* client["GET/api4/text-custom-field-batch"]()).items ?? []
        }),
      )

      const ensureCustomFields = Effect.gen(function* () {
        const current = yield* Resource.get(textFields)
        const credentialFields = findManagerAkahuCredentialFields(current)
        let akahuAppToken = credentialFields.akahuAppToken
        if (!akahuAppToken) {
          akahuAppToken = yield* createTextField(managerAkahuAppTokenFieldName)
        }
        let akahuUserToken = credentialFields.akahuUserToken
        if (!akahuUserToken) {
          akahuUserToken = yield* createTextField(managerAkahuUserTokenFieldName)
        }
        return {
          akahuAppToken,
          akahuUserToken,
        } as const
      })

      const createTextField = Effect.fn("ManagerFlows.createTextField")(function* (name: string) {
        yield* client["POST/api4/text-custom-field"]({
          value: {
            name,
            placement: ["38cf4712-6e95-4ce1-b53a-bff03edad273"],
            excludeFromCopyingOrCloning: true,
            size: 2,
          },
        })
        yield* Resource.refresh(textFields)
        const current = yield* Resource.get(textFields)
        return current.find((field) => field.item.name === name)!
      })

      const ensureAccountField = Effect.fn("ManagerFlows.ensureAccountField")(function* (options: {
        readonly name: string
        readonly options: ReadonlyArray<{
          readonly label: string
          readonly value: string
        }>
      }) {
        const current = yield* Resource.get(textFields)
        let field = current.find((field) => field.item.name === options.name)
        if (!field) {
          field = yield* createDropdownField(options.name, options.options.map(encodeMultipleValue))
        } else {
          yield* client["PUT/api4/text-custom-field"]({
            key: field.key,
            value: {
              ...field.item,
              optionsForDropdownList: options.options.map(encodeMultipleValue).join("\n"),
            },
          })
        }
        return field
      })

      const createDropdownField = Effect.fn("ManagerFlows.createDropdownField")(function* (
        name: string,
        options: ReadonlyArray<string>,
      ) {
        yield* client["POST/api4/text-custom-field"]({
          value: {
            name,
            type: managerDropdownTextCustomFieldType,
            placement: managerBankOrCashAccountCustomFieldPlacement,
            optionsForDropdownList: options.join("\n"),
            excludeFromCopyingOrCloning: true,
            size: 2,
          },
        })
        yield* Resource.refresh(textFields)
        const current = yield* Resource.get(textFields)
        return current.find((field) => field.item.name === name)!
      })

      const ensureMultilineAccountTextField = Effect.fn(
        "ManagerFlows.ensureMultilineAccountTextField",
      )(function* (name: string) {
        const current = yield* Resource.get(textFields)
        let field = current.find((field) => field.item.name === name)
        if (!field) {
          field = yield* createMultilineAccountTextField(name)
        } else if (!isMultilineAccountTextField(field.item)) {
          yield* client["PUT/api4/text-custom-field"]({
            key: field.key,
            value: {
              ...field.item,
              name,
              type: managerMultilineTextCustomFieldType,
              placement: managerBankOrCashAccountCustomFieldPlacement,
            },
          })
          yield* Resource.refresh(textFields)
          const refreshed = yield* Resource.get(textFields)
          field = refreshed.find((field) => field.item.name === name) ?? field
        }
        return field
      })

      const createMultilineAccountTextField = Effect.fn(
        "ManagerFlows.createMultilineAccountTextField",
      )(function* (name: string) {
        yield* client["POST/api4/text-custom-field"]({
          value: {
            name,
            type: managerMultilineTextCustomFieldType,
            placement: managerBankOrCashAccountCustomFieldPlacement,
            excludeFromCopyingOrCloning: true,
            size: 2,
          },
        })
        yield* Resource.refresh(textFields)
        const current = yield* Resource.get(textFields)
        return current.find((field) => field.item.name === name)!
      })

      const getAkahuSetupState = Effect.gen(function* () {
        const fields = yield* ensureCustomFields
        const business = yield* client["GET/api4/business-details"]()
        const tokensResult = decodeManagerAkahuBusinessDetailTokens({
          fields,
          strings: business.customFields2?.strings ?? {},
        })
        if (tokensResult._tag === "missing") {
          return new ManagerAkahuSetupMissingCredentials({
            missingFieldNames: tokensResult.missingFieldNames,
          })
        }
        const tokens = tokensResult.tokens

        const accountsResult = yield* api("ListAccounts", tokens).pipe(
          Effect.map((accounts) => ({ _tag: "accounts" as const, accounts })),
          Effect.catchTag("AkahuRpcError", (error) =>
            Effect.succeed({
              _tag: "setupState" as const,
              setupState: mapAkahuAccountsReadFailure(error),
            }),
          ),
        )
        if (accountsResult._tag === "setupState") {
          return accountsResult.setupState
        }

        const accounts = accountsResult.accounts
        const accountField = yield* ensureAccountField({
          name: managerAkahuAccountFieldName,
          options: accounts.map((account) => ({
            label: account.name,
            value: account._id,
          })),
        })
        const transferRulesField = yield* ensureMultilineAccountTextField(
          managerAkahuTransferRulesFieldName,
        )

        const managerAccounts = (yield* client["GET/api4/bank-or-cash-account-batch"]()).items ?? []
        const selections = collectManagerAkahuAccountSelections({
          managerAccounts,
          accountFieldKey: accountField.key,
          transferRulesFieldKey: transferRulesField.key,
          akahuAccounts: accounts,
        })

        return makeManagerAkahuSetupState({
          akahuAccountCount: accounts.length,
          linkedAccounts: selections.linkedAccounts,
          staleSelections: selections.staleSelections,
        })
      }).pipe(
        Effect.orElseSucceed(
          () =>
            new ManagerAkahuSetupError({
              message:
                "Manager setup information could not be loaded. Try again after checking Manager is available.",
            }),
        ),
      )

      return ManagerFlows.of({
        getAkahuSetupState,
      })
    }),
  ).pipe(Layer.provide(Manager.layer))
}

export const collectManagerAkahuAccountSelections = (options: {
  readonly managerAccounts: ReadonlyArray<ManagerAkahuAccountRecord>
  readonly accountFieldKey: string
  readonly transferRulesFieldKey: string
  readonly akahuAccounts: ReadonlyArray<Account>
}) => {
  const linkedAccounts: Array<LinkedAccount> = []
  const staleSelections: Array<StaleLinkedAccountSelection> = []
  const managerAccountMetadata = new Map(
    options.managerAccounts.map(({ item: account, key }) => [
      key,
      {
        key,
        name: account.name ?? "",
        currency: account.currency ?? null,
        canHavePendingTransactions: account.canHavePendingTransactions === true,
      },
    ]),
  )

  for (const { item: account, key } of options.managerAccounts) {
    const fields = account.customFields2?.strings ?? {}
    const akahuAccountId = fields[options.accountFieldKey]
    if (typeof akahuAccountId !== "string" || akahuAccountId.trim() === "") continue

    const decoded = decodeMultipleValue(akahuAccountId)
    const akahuAccount = options.akahuAccounts.find((account) => account._id === decoded.value)
    const accountMetadata = {
      key,
      name: account.name ?? "",
      currency: account.currency ?? null,
      canHavePendingTransactions: account.canHavePendingTransactions === true,
    } as const

    if (akahuAccount) {
      const transferRulesResult = parseLinkedAccountTransferRules({
        sourceAccount: accountMetadata,
        rawValue: fields[options.transferRulesFieldKey],
        managerAccountMetadata,
      })
      linkedAccounts.push(
        new LinkedAccount({
          ...accountMetadata,
          akahuAccount,
          transferRules: transferRulesResult.rules,
          transferRuleWarnings: transferRulesResult.warnings,
        }),
      )
    } else {
      staleSelections.push(
        new StaleLinkedAccountSelection({
          ...accountMetadata,
          selectedAkahuAccountId: decoded.value,
          selectedAkahuAccountLabel: decoded.label === decoded.value ? null : decoded.label,
        }),
      )
    }
  }

  return { linkedAccounts, staleSelections } as const
}

export const isManagerAkahuTransferRulesFieldCurrent = (field: {
  readonly type?: number | undefined
  readonly placement?: ReadonlyArray<string> | null | undefined
}) => isMultilineAccountTextField(field)

const isMultilineAccountTextField = (field: {
  readonly type?: number | undefined
  readonly placement?: ReadonlyArray<string> | null | undefined
}) =>
  field.type === managerMultilineTextCustomFieldType &&
  sameStringSet(field.placement ?? [], managerBankOrCashAccountCustomFieldPlacement)

const sameStringSet = (left: ReadonlyArray<string>, right: ReadonlyArray<string>) =>
  left.length === right.length && right.every((value) => left.includes(value))

const parseLinkedAccountTransferRules = (options: {
  readonly sourceAccount: {
    readonly key: string
    readonly name: string
    readonly currency: string | null
    readonly canHavePendingTransactions: boolean
  }
  readonly rawValue: unknown
  readonly managerAccountMetadata: ReadonlyMap<
    string,
    {
      readonly key: string
      readonly name: string
      readonly currency: string | null
      readonly canHavePendingTransactions: boolean
    }
  >
}) => {
  if (typeof options.rawValue !== "string" || options.rawValue.trim() === "") {
    return { rules: [], warnings: [] } as const
  }

  const parsed = parseAkahuTransferRules(options.rawValue)
  const rules: Array<LinkedAccountTransferRule> = []
  const warnings = parsed.invalidLines.map((line) =>
    formatTransferRuleSyntaxWarning(line.reason, line.lineNumber),
  )

  for (const rule of parsed.rules) {
    if (rule.destinationAccountKey === options.sourceAccount.key) {
      warnings.push(
        `Transfer rule "${rule.keyword}" targets its own Manager bank/cash account and was skipped.`,
      )
      continue
    }

    const destinationAccount = options.managerAccountMetadata.get(rule.destinationAccountKey)
    if (!destinationAccount) {
      warnings.push(
        `Transfer rule "${rule.keyword}" targets unknown Manager bank/cash account key ${rule.destinationAccountKey} and was skipped.`,
      )
      continue
    }

    rules.push(
      new LinkedAccountTransferRule({
        sourceAccountKey: options.sourceAccount.key,
        sourceAccountName: options.sourceAccount.name,
        sourceAccountCurrency: options.sourceAccount.currency,
        sourceAccountCanHavePendingTransactions: options.sourceAccount.canHavePendingTransactions,
        keyword: rule.keyword,
        normalizedKeyword: rule.normalizedKeyword,
        destinationAccountKey: destinationAccount.key,
        destinationAccountName: destinationAccount.name,
        destinationAccountCurrency: destinationAccount.currency,
        destinationAccountCanHavePendingTransactions: destinationAccount.canHavePendingTransactions,
      }),
    )
  }

  return { rules, warnings } as const
}

const formatTransferRuleSyntaxWarning = (reason: string, lineNumber: number) => {
  switch (reason) {
    case "missingComma":
      return `Transfer rule line ${lineNumber} must use keyword,destination account key and was skipped.`
    case "blankKeyword":
      return `Transfer rule line ${lineNumber} has a blank keyword and was skipped.`
    case "blankDestinationAccountKey":
      return `Transfer rule line ${lineNumber} has a blank destination account key and was skipped.`
    default:
      return `Transfer rule line ${lineNumber} is invalid and was skipped.`
  }
}

export const mapAkahuAccountsReadFailure = (error: AkahuRpcError): ManagerAkahuSetupState => {
  switch (error.reason) {
    case "authentication":
    case "authorization":
      return new ManagerAkahuSetupInvalidCredentials()
    case "read":
      return new ManagerAkahuSetupError({
        message: "Akahu accounts could not be loaded. Check the Akahu connection and try again.",
      })
  }
}

const encodeMultipleValue = (options: { readonly label: string; readonly value: string }) => {
  return `${options.label} - ${options.value}`
}

const decodeMultipleValue = (input: string) => {
  const index = input.lastIndexOf(" - ")
  if (index === -1) {
    return { label: input, value: input } as const
  }
  const label = input.slice(0, index)
  const value = input.slice(index + 3)
  return { label, value } as const
}
