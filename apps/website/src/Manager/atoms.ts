import { Atom } from "effect/unstable/reactivity"
import { ManagerFlows } from "./Flows"
import { Effect } from "effect"
import { AkahuCustomFields } from "@app/domain/Manager/AkahuCustomFields"

const runtime = Atom.runtime(ManagerFlows.layer)

const akakuFieldsReadAtom = runtime
  .atom(
    Effect.fnUntraced(function* () {
      const flows = yield* ManagerFlows
      return yield* flows.getAkahuFields
    }),
  )
  .pipe(Atom.withReactivity(["fields"]), Atom.keepAlive)

const akakuFieldsWriteAtom = runtime.fn<AkahuCustomFields>()(
  Effect.fnUntraced(function* (fields) {
    const flows = yield* ManagerFlows
    yield* flows.setAkahuFields(fields)
  }),
  {
    reactivityKeys: ["fields"],
  },
)

export const akakuFieldsAtom = Atom.writable(
  (get) => {
    get.mount(akakuFieldsWriteAtom)
    return get(akakuFieldsReadAtom)
  },
  (ctx, fields: AkahuCustomFields) => {
    ctx.set(akakuFieldsWriteAtom, fields)
  },
)
