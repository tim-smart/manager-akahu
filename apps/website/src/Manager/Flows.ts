import { Manager } from "@/Manager"
import { Context, Effect, Layer, Resource } from "effect"
import {
  LinkedAccount,
  makeManagerAkahuSetupState,
  ManagerAkahuSetupError,
  ManagerAkahuSetupInvalidCredentials,
  ManagerAkahuSetupMissingCredentials,
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
            type: 2,
            placement: ["1408c33b-6284-4f50-9e31-48cbea21f3cf"],
            optionsForDropdownList: options.join("\n"),
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
          name: "Akahu Account",
          options: accounts.map((account) => ({
            label: account.name,
            value: account._id,
          })),
        })

        const managerAccounts = (yield* client["GET/api4/bank-or-cash-account-batch"]()).items ?? []
        const selections = collectManagerAkahuAccountSelections({
          managerAccounts,
          accountFieldKey: accountField.key,
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
  readonly akahuAccounts: ReadonlyArray<Account>
}) => {
  const linkedAccounts: Array<LinkedAccount> = []
  const staleSelections: Array<StaleLinkedAccountSelection> = []

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
      linkedAccounts.push(
        new LinkedAccount({
          ...accountMetadata,
          akahuAccount,
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
