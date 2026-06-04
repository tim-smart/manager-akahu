import { Atom } from "effect/unstable/reactivity"
import { ManagerFlows } from "./Flows"
import { Effect, Layer } from "effect"
import { ApiClient } from "@/ApiClient"

const runtime = Atom.runtime((get) =>
  ManagerFlows.layer.pipe(Layer.provide(get(ApiClient.runtime.layer))),
)

export const akakuFieldsAtom = runtime.atom(
  Effect.fnUntraced(function* () {
    const flows = yield* ManagerFlows
    return yield* flows.getAkahuFields
  }),
)
