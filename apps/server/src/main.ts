// @effect-diagnostics-next-line nodeBuiltinImport:off
import { createServer } from "node:http"
import { NodeHttpClient, NodeHttpServer, NodeRuntime } from "@effect/platform-node"
import { Config, Layer } from "effect"
import { HttpRouter, HttpServerResponse } from "effect/unstable/http"
import { RpcRoute } from "./rpc.ts"

const RoutesLive = Layer.mergeAll(
  HttpRouter.add("GET", "/health", HttpServerResponse.text("OK")),
  RpcRoute,
)

const ServerLive = HttpRouter.serve(RoutesLive).pipe(
  Layer.provide(
    NodeHttpServer.layerConfig(createServer, {
      port: Config.port("PORT").pipe(Config.withDefault(3000)),
    }),
  ),
  Layer.provide(NodeHttpClient.layerUndici),
)

NodeRuntime.runMain(Layer.launch(ServerLive))
