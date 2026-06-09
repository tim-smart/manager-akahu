import { Manager } from "@/Manager"
import { Context, DateTime, Effect, Layer, Resource } from "effect"
import {
  buildLinkedAccountTransferRules,
  LinkedAccount,
  makeManagerAkahuSetupState,
  ManagerAkahuSetupError,
  ManagerAkahuSetupInvalidCredentials,
  ManagerAkahuSetupMissingCredentials,
  type ManagerAkahuTransferRuleAccountMetadata,
  type ManagerAkahuSetupState,
  StaleLinkedAccountSelection,
} from "@app/domain/Manager/AkahuCustomFields"
import { ApiClient } from "@/ApiClient"
import type { Account } from "@app/domain/Akahu"
import type { DateCustomField, ItemOfDateCustomField } from "@app/manager-api/ManagerClient"
import { AkahuRpcError } from "@app/domain/rpc"
import type { Client, ItemOfTextCustomField, TextCustomField } from "@app/manager-api/ManagerClient"
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
          readonly dates?: Record<string, unknown> | null | undefined
        }
      | undefined
  }
}

export const managerAkahuAccountFieldName = "Akahu Account"
export const managerAkahuTransferRulesFieldName = "Akahu Transfer Rules"
export const managerAkahuStartDateFieldName = "Akahu Start Date"
export const managerBankOrCashAccountCustomFieldPlacementKey =
  "1408c33b-6284-4f50-9e31-48cbea21f3cf"

const managerBankOrCashAccountCustomFieldPlacement = [
  managerBankOrCashAccountCustomFieldPlacementKey,
] as const
const managerMultilineTextCustomFieldType = 1
const managerDropdownTextCustomFieldType = 2

export type ManagerAkahuDateCustomFieldRecord = Pick<ItemOfDateCustomField, "key" | "item">

type ManagerTextCustomFieldClient = Pick<
  Client,
  "POST/api4/text-custom-field" | "PUT/api4/text-custom-field"
>

type EnsureManagerBankOrCashAccountTextFieldOptions = {
  readonly client: ManagerTextCustomFieldClient
  readonly getCurrentFields: () => Effect.Effect<ReadonlyArray<ItemOfTextCustomField>, unknown>
  readonly refreshFields: () => Effect.Effect<void, unknown>
  readonly name: string
  readonly type: number
  readonly placement: ReadonlyArray<string>
  readonly optionsForDropdownList?: ReadonlyArray<string> | undefined
}

export const ensureManagerBankOrCashAccountTextField = Effect.fn(
  "ManagerFlows.ensureManagerBankOrCashAccountTextField",
)(function* (options: EnsureManagerBankOrCashAccountTextFieldOptions) {
  const desired = makeManagerBankOrCashAccountTextFieldPayload(options)
  const current = yield* options.getCurrentFields()
  let field = current.find((field) => field.item.name === options.name)

  if (!field) {
    yield* options.client["POST/api4/text-custom-field"]({ value: desired })
    yield* options.refreshFields()
    const refreshed = yield* options.getCurrentFields()
    return refreshed.find((field) => field.item.name === options.name)!
  }

  if (!isManagerBankOrCashAccountTextFieldCurrent(field.item, desired)) {
    yield* options.client["PUT/api4/text-custom-field"]({
      key: field.key,
      value: desired,
    })
    yield* options.refreshFields()
    const refreshed = yield* options.getCurrentFields()
    field = refreshed.find((field) => field.item.name === options.name) ?? field
  }

  return field
})

const makeManagerBankOrCashAccountTextFieldPayload = (options: {
  readonly name: string
  readonly type: number
  readonly placement: ReadonlyArray<string>
  readonly optionsForDropdownList?: ReadonlyArray<string> | undefined
}): TextCustomField => {
  const payload: TextCustomField = {
    name: options.name,
    type: options.type,
    placement: [...options.placement],
    excludeFromCopyingOrCloning: true,
    size: 2,
  }

  if (options.optionsForDropdownList !== undefined) {
    return {
      ...payload,
      optionsForDropdownList: options.optionsForDropdownList.join("\n"),
    }
  }

  return payload
}

const isManagerBankOrCashAccountTextFieldCurrent = (
  field: TextCustomField,
  desired: TextCustomField,
) =>
  field.type === desired.type &&
  sameStringSet(field.placement ?? [], desired.placement ?? []) &&
  (desired.optionsForDropdownList === undefined ||
    field.optionsForDropdownList === desired.optionsForDropdownList)

export type ManagerAkahuStartDateFieldSetupPlan =
  | { readonly _tag: "reuse"; readonly field: ManagerAkahuDateCustomFieldRecord }
  | { readonly _tag: "create"; readonly value: DateCustomField }
  | {
      readonly _tag: "repair"
      readonly field: ManagerAkahuDateCustomFieldRecord
      readonly value: DateCustomField
    }

const isReusableManagerAkahuStartDateField = (field: ManagerAkahuDateCustomFieldRecord) =>
  field.item.name === managerAkahuStartDateFieldName &&
  field.item.inactive !== true &&
  (field.item.placement ?? []).includes(managerBankOrCashAccountCustomFieldPlacementKey)

export const planManagerAkahuStartDateFieldSetup = (
  fields: ReadonlyArray<ManagerAkahuDateCustomFieldRecord>,
): ManagerAkahuStartDateFieldSetupPlan => {
  const exactNameFields = fields.filter(
    (field) => field.item.name === managerAkahuStartDateFieldName,
  )
  const reusableField = exactNameFields.find(isReusableManagerAkahuStartDateField)
  if (reusableField) {
    return { _tag: "reuse", field: reusableField }
  }

  const repairField = exactNameFields.toSorted((left, right) => {
    const leftActive = left.item.inactive !== true
    const rightActive = right.item.inactive !== true
    if (leftActive !== rightActive) return leftActive ? -1 : 1

    const leftPlacementCount = left.item.placement?.length ?? 0
    const rightPlacementCount = right.item.placement?.length ?? 0
    if (leftPlacementCount !== rightPlacementCount) return rightPlacementCount - leftPlacementCount

    return left.key.localeCompare(right.key)
  })[0]

  if (!repairField) {
    return {
      _tag: "create",
      value: makeManagerAkahuStartDateDateField(),
    }
  }

  const placement = repairField.item.placement ?? []

  return {
    _tag: "repair",
    field: repairField,
    value: {
      ...repairField.item,
      inactive: false,
      placement: placement.includes(managerBankOrCashAccountCustomFieldPlacementKey)
        ? placement
        : [...placement, managerBankOrCashAccountCustomFieldPlacementKey],
    },
  }
}

export const resolveManagerAkahuStartDateFieldSetupPlan = (
  plan: ManagerAkahuStartDateFieldSetupPlan,
  fields: ReadonlyArray<ManagerAkahuDateCustomFieldRecord>,
): ManagerAkahuDateCustomFieldRecord | undefined => {
  if (plan._tag === "reuse") return plan.field

  if (plan._tag === "repair") {
    const repairedField = fields.find((field) => field.key === plan.field.key)
    if (repairedField) return repairedField
  }

  const refreshedPlan = planManagerAkahuStartDateFieldSetup(fields)
  if (refreshedPlan._tag === "reuse") return refreshedPlan.field
  return undefined
}

const makeManagerAkahuStartDateDateField = (): DateCustomField => ({
  name: managerAkahuStartDateFieldName,
  placement: [managerBankOrCashAccountCustomFieldPlacementKey],
  excludeFromCopyingOrCloning: true,
})

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

      const dateFields = yield* Resource.manual(
        Effect.gen(function* () {
          return (yield* client["GET/api4/date-custom-field-batch"]()).items ?? []
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

      const ensureAkahuStartDateField = Effect.fn("ManagerFlows.ensureAkahuStartDateField")(
        function* () {
          const current = yield* Resource.get(dateFields)
          const plan = planManagerAkahuStartDateFieldSetup(current)

          const mutateRefreshAndResolve = Effect.fn(
            "ManagerFlows.ensureAkahuStartDateField.mutateRefreshAndResolve",
          )(function* (
            plan: Extract<ManagerAkahuStartDateFieldSetupPlan, { _tag: "create" | "repair" }>,
          ) {
            if (plan._tag === "create") {
              yield* client["POST/api4/date-custom-field"]({
                value: plan.value,
              })
            } else {
              yield* client["PUT/api4/date-custom-field"]({
                key: plan.field.key,
                value: plan.value,
              })
            }

            yield* Resource.refresh(dateFields)
            const refreshed = yield* Resource.get(dateFields)
            const resolved = resolveManagerAkahuStartDateFieldSetupPlan(plan, refreshed)
            if (!resolved) {
              return yield* Effect.fail(
                "Akahu Start Date field was not available after Manager custom-field setup",
              )
            }
            return resolved
          })

          switch (plan._tag) {
            case "reuse":
              return plan.field
            case "create":
            case "repair":
              return yield* mutateRefreshAndResolve(plan)
          }
        },
      )
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
        const accountField = yield* ensureManagerBankOrCashAccountTextField({
          client,
          getCurrentFields: () => Resource.get(textFields),
          refreshFields: () => Resource.refresh(textFields),
          name: managerAkahuAccountFieldName,
          type: managerDropdownTextCustomFieldType,
          placement: managerBankOrCashAccountCustomFieldPlacement,
          optionsForDropdownList: accounts.map((account) =>
            encodeMultipleValue({
              label: account.name,
              value: account._id,
            }),
          ),
        })
        const transferRulesField = yield* ensureManagerBankOrCashAccountTextField({
          client,
          getCurrentFields: () => Resource.get(textFields),
          refreshFields: () => Resource.refresh(textFields),
          name: managerAkahuTransferRulesFieldName,
          type: managerMultilineTextCustomFieldType,
          placement: managerBankOrCashAccountCustomFieldPlacement,
        })
        const akahuStartDateField = yield* ensureAkahuStartDateField()

        const managerAccounts = (yield* client["GET/api4/bank-or-cash-account-batch"]()).items ?? []
        const selections = collectManagerAkahuAccountSelections({
          managerAccounts,
          accountFieldKey: accountField.key,
          transferRulesFieldKey: transferRulesField.key,
          akahuStartDateFieldKey: akahuStartDateField.key,
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
  readonly akahuStartDateFieldKey: string
  readonly akahuAccounts: ReadonlyArray<Account>
}) => {
  const linkedAccounts: Array<LinkedAccount> = []
  const staleSelections: Array<StaleLinkedAccountSelection> = []
  const managerAccountsByKey = new Map<string, ManagerAkahuTransferRuleAccountMetadata>(
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
    const akahuStartDate = DateTime.make(
      account.customFields2?.dates?.[options.akahuStartDateFieldKey] as string,
    )

    if (akahuAccount) {
      const transferRulesResult = buildLinkedAccountTransferRules({
        sourceAccount: accountMetadata,
        rawValue: fields[options.transferRulesFieldKey],
        managerAccountsByKey,
      })
      linkedAccounts.push(
        new LinkedAccount({
          ...accountMetadata,
          akahuStartDate,
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
