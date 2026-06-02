import { Schema } from "effect"
import * as Rpc from "effect/unstable/rpc/Rpc"
import * as RpcGroup from "effect/unstable/rpc/RpcGroup"

export class Health extends Schema.Class<Health>("Health")({
  status: Schema.Literal("ok"),
  uptime: Schema.Number,
}) {}

export class GetHealth extends Rpc.make("GetHealth", {
  success: Health,
}) {}

export const ApiRpcs = RpcGroup.make(GetHealth)
