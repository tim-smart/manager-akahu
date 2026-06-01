import { ApiRpcs } from "@app/domain/rpc"
import { BrowserSocket } from "@effect/platform-browser"
import { Layer } from "effect"
import { AtomRpc } from "effect/unstable/reactivity"
import { RpcClient, RpcSerialization } from "effect/unstable/rpc"

export class ApiClient extends AtomRpc.Service<ApiClient>()("ApiClient", {
  group: ApiRpcs,
  protocol: RpcClient.layerProtocolSocket({ retryTransientErrors: true }).pipe(
    Layer.provide(RpcSerialization.layerJson),
    Layer.provide(BrowserSocket.layerWebSocket("/rpc")),
  ),
}) {}
