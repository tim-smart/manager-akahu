import { ApiRpcs } from "@app/domain/rpc"
import { Effect, Layer, Stream } from "effect"
import { RpcSerialization, RpcServer } from "effect/unstable/rpc"
import { Akahu, AkahuCredentials } from "./Akahu.ts"

export const ApiHandlersBase = ApiRpcs.toLayer(
  Effect.gen(function* () {
    const akahu = yield* Akahu

    return ApiRpcs.of({
      ListAccounts: ({ akahuAppToken, akahuUserToken }) =>
        akahu.accounts.pipe(
          Effect.provideService(AkahuCredentials, {
            appToken: akahuAppToken,
            userToken: akahuUserToken,
          }),
        ),
      AccountTransactions: ({ akahuAppToken, akahuUserToken, accountId }) =>
        akahu.transactions({ accountId }).pipe(
          Stream.provideService(AkahuCredentials, {
            appToken: akahuAppToken,
            userToken: akahuUserToken,
          }),
        ),
      AccountPendingTransactions: ({ akahuAppToken, akahuUserToken, accountId }) =>
        akahu.pendingTransactions({ accountId }).pipe(
          Stream.provideService(AkahuCredentials, {
            appToken: akahuAppToken,
            userToken: akahuUserToken,
          }),
        ),
    })
  }),
)

export const ApiHandlers = ApiHandlersBase.pipe(Layer.provide(Akahu.layer))

export const RpcRouteBase = RpcServer.layerHttp({
  group: ApiRpcs,
  path: "/rpc",
  protocol: "websocket",
  disableFatalDefects: true,
}).pipe(Layer.provide([ApiHandlersBase, RpcSerialization.layerJson]))

export const RpcRoute = RpcRouteBase.pipe(Layer.provide(Akahu.layer))
