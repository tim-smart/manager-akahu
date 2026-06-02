import { Manager } from "@/Manager"
import { Cause, Context, Effect, Layer, Schema } from "effect"
import { AkahuCustomFields } from "@app/domain/Manager/AkahuCustomFields"

export class ManagerFlows extends Context.Service<
  ManagerFlows,
  {
    readonly getAkahuFields: Effect.Effect<AkahuCustomFields, Cause.NoSuchElementError>
    setAkahuFields(fields: AkahuCustomFields): Effect.Effect<void>
  }
>()("ManagerFlows") {
  static readonly layer = Layer.effect(
    ManagerFlows,
    Effect.gen(function* () {
      const client = yield* Manager

      const ensureCustomFields = Effect.gen(function* () {
        const current = (yield* client["GET/api4/text-custom-field-batch"]()).items ?? []
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
            placement: ["38cf4712-6e95-4ce1-b53a-bff03edad273"],
            excludeFromCopyingOrCloning: true,
          },
        })
        const current = (yield* client["GET/api4/text-custom-field-batch"]()).items ?? []
        return current.find((field) => field.item.name === name)!
      })

      const getAkahuFields = Effect.gen(function* () {
        const fields = yield* ensureCustomFields
        const business = yield* client["GET/api4/business-details"]()
        const input = business.customFields2?.strings ?? {}
        return yield* Effect.fromOption(
          Schema.decodeOption(AkahuCustomFields)({
            akahuAppToken: input[fields.akahuAppToken.key] as string,
            akahuUserToken: input[fields.akahuUserToken.key] as string,
          }),
        )
      }).pipe(Effect.catchTag(["ErrorResponse", "HttpClientError"], Effect.die))

      const setAkahuFields = Effect.fn("ManagerFlows.setAkahuFields")(function* (
        fields: AkahuCustomFields,
      ) {
        const business = yield* client["GET/api4/business-details"]()
        const input = business.customFields ?? {}
        const encoded = yield* Effect.orDie(Schema.encodeUnknownEffect(AkahuCustomFields)(fields))
        yield* client["PUT/api4/business-details"]({
          business: business.id,
          value: {
            id: business.id,
            customFields: { ...input, ...encoded },
          },
        })
      }, Effect.orDie)

      return ManagerFlows.of({
        getAkahuFields,
        setAkahuFields,
      })
    }),
  ).pipe(Layer.provide(Manager.layer))
}
