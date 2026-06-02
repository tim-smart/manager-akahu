import { ApiRpcs, Health } from "@app/domain/rpc"
import { Effect, Layer } from "effect"
import { RpcSerialization, RpcServer } from "effect/unstable/rpc"

export const ApiHandlers = ApiRpcs.toLayer({
  GetHealth: () => Effect.sync(() => new Health({ status: "ok", uptime: process.uptime() })),
})

export const RpcRoute = RpcServer.layerHttp({
  group: ApiRpcs,
  path: "/rpc",
  protocol: "websocket",
  disableFatalDefects: true,
}).pipe(Layer.provide([ApiHandlers, RpcSerialization.layerJson]))
