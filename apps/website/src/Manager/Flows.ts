import { Manager } from "@/Manager"
import { Array, Cause, Context, Effect, Layer, Resource, Schema } from "effect"
import {
  AkahuCustomFields,
  AkahuTokens,
  LinkedAccount,
} from "@app/domain/Manager/AkahuCustomFields"
import { ApiClient } from "@/ApiClient"

export class ManagerFlows extends Context.Service<
  ManagerFlows,
  {
    readonly getAkahuFields: Effect.Effect<AkahuCustomFields, Cause.NoSuchElementError>
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
        }).pipe(Effect.orDie),
      )

      const ensureCustomFields = Effect.gen(function* () {
        const current = yield* Resource.get(textFields)
        let akahuAppToken = current.find((field) => field.item.name === "Akahu App Token")
        if (!akahuAppToken) {
          akahuAppToken = yield* createTextField("Akahu App Token")
        }
        let akahuUserToken = current.find((field) => field.item.name === "Akahu User Token")
        if (!akahuUserToken) {
          akahuUserToken = yield* createTextField("Akahu User Token")
        }
        return {
          akahuAppToken,
          akahuUserToken,
        } as const
      }).pipe(Effect.orDie)

      const createTextField = Effect.fn("ManagerFlows.createTextField")(function* (name: string) {
        yield* client["POST/api4/text-custom-field"]({
          value: {
            name,
            type: 2,
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
      }, Effect.orDie)

      const createDropdownField = Effect.fn("ManagerFlows.createDropdownField")(function* (
        name: string,
        options: ReadonlyArray<string>,
      ) {
        yield* client["POST/api4/text-custom-field"]({
          value: {
            name,
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

      const getAkahuFields = Effect.gen(function* () {
        const fields = yield* ensureCustomFields
        const business = yield* client["GET/api4/business-details"]()
        const input = business.customFields2?.strings ?? {}
        const tokens = yield* Effect.fromOption(
          Schema.decodeOption(AkahuTokens)({
            akahuAppToken: input[fields.akahuAppToken.key] as string,
            akahuUserToken: input[fields.akahuUserToken.key] as string,
          }),
        )

        const accounts = yield* api("ListAccounts", tokens).pipe(Effect.orDie)
        const accountField = yield* ensureAccountField({
          name: "Akahu Account",
          options: accounts.map((account) => ({
            label: account.name,
            value: account._id,
          })),
        })

        const managerAccounts = (yield* client["GET/api4/bank-or-cash-account-batch"]()).items ?? []
        const linkedAccounts = Array.empty<LinkedAccount>()

        for (const { item: account, key } of managerAccounts) {
          const fields = account.customFields2?.strings ?? {}
          const akahuAccountId = fields[accountField.key] as string
          if (!akahuAccountId) continue

          const decoded = decodeMultipleValue(akahuAccountId)
          const akahuAccount = accounts.find((account) => account._id === decoded.value)
          if (!akahuAccount) continue

          linkedAccounts.push(
            new LinkedAccount({
              key,
              name: account.name ?? "",
              akahuAccount,
            }),
          )
        }

        return new AkahuCustomFields({
          akahuAppToken: tokens.akahuAppToken,
          akahuUserToken: tokens.akahuUserToken,
          accounts: linkedAccounts,
        })
      }).pipe(Effect.catchTag(["ErrorResponse", "HttpClientError"], Effect.die))

      return ManagerFlows.of({
        getAkahuFields,
      })
    }),
  ).pipe(Layer.provide(Manager.layer))
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
