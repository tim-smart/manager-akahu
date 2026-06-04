import { Context, Effect, Layer, Redacted } from "effect"
import { Account, AkahuApi } from "@app/domain/Akahu"
import { HttpClient, HttpClientRequest } from "effect/unstable/http"
import { HttpApiClient } from "effect/unstable/httpapi"
import { NodeHttpClient } from "@effect/platform-node"

export class AkahuCredentials extends Context.Service<
  AkahuCredentials,
  {
    readonly appToken: Redacted.Redacted
    readonly userToken: Redacted.Redacted
  }
>()("server/AkahuCredentials") {}

export class Akahu extends Context.Service<
  Akahu,
  {
    readonly accounts: Effect.Effect<ReadonlyArray<Account>, never, AkahuCredentials>
  }
>()("server/Akahu") {
  static readonly layer = Layer.effect(
    Akahu,
    Effect.gen(function* () {
      const httpClient = (yield* HttpClient.HttpClient).pipe(
        HttpClient.mapRequestEffect(
          Effect.fnUntraced(function* (request) {
            const credentials = yield* AkahuCredentials
            return request.pipe(
              HttpClientRequest.prependUrl("https://api.akahu.io/v1"),
              HttpClientRequest.setHeader("X-Akahu-Id", Redacted.value(credentials.appToken)),
              HttpClientRequest.bearerToken(credentials.userToken),
            )
          }),
        ),
        HttpClient.retryTransient({
          times: 5,
        }),
      )

      const akahu = yield* HttpApiClient.makeWith(AkahuApi, {
        httpClient,
      })

      return Akahu.of({
        accounts: akahu.accounts
          .list({
            query: {},
          })
          .pipe(
            Effect.map((r) => r.items),
            Effect.orDie,
          ),
      })
    }),
  ).pipe(Layer.provide(NodeHttpClient.layerUndici))
}
