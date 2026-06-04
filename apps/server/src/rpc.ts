import { ApiRpcs } from "@app/domain/rpc"
import { Effect, Layer } from "effect"
import { RpcSerialization, RpcServer } from "effect/unstable/rpc"
import { Akahu, AkahuCredentials } from "./Akahu.ts"

export const ApiHandlers = ApiRpcs.toLayer(
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
          Effect.provideService(AkahuCredentials, {
            appToken: akahuAppToken,
            userToken: akahuUserToken,
          }),
        ),
      AccountPendingTransactions: ({ akahuAppToken, akahuUserToken, accountId }) =>
        akahu.pendingTransactions({ accountId }).pipe(
          Effect.provideService(AkahuCredentials, {
            appToken: akahuAppToken,
            userToken: akahuUserToken,
          }),
        ),
    })
  }),
).pipe(Layer.provide(Akahu.layer))

export const RpcRoute = RpcServer.layerHttp({
  group: ApiRpcs,
  path: "/rpc",
  protocol: "websocket",
  disableFatalDefects: true,
}).pipe(Layer.provide([ApiHandlers, RpcSerialization.layerJson]))
