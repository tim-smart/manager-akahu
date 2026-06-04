import { Atom } from "effect/unstable/reactivity"
import { ManagerFlows } from "./Flows"
import { Effect, Layer } from "effect"
import { ApiClient } from "@/ApiClient"
import { ManagerSyncFlows, type ManagerAkahuTransactionSyncInput } from "./SyncFlows"

const runtime = Atom.runtime((get) =>
  ManagerFlows.layer.pipe(Layer.provide(get(ApiClient.runtime.layer))),
)

export const akahuSetupStateAtom = runtime.atom(
  Effect.fnUntraced(function* () {
    const flows = yield* ManagerFlows
    return yield* flows.getAkahuSetupState
  }),
)

const syncRuntime = Atom.runtime((get) =>
  ManagerSyncFlows.layer.pipe(Layer.provide(get(ApiClient.runtime.layer))),
)

export const akahuTransactionSyncAtom = syncRuntime.fn(
  Effect.fnUntraced(function* (input: ManagerAkahuTransactionSyncInput) {
    const flows = yield* ManagerSyncFlows
    return yield* flows.syncTransactions(input)
  }),
)
