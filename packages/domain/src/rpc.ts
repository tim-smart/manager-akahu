import { Schema } from "effect"
import * as Rpc from "effect/unstable/rpc/Rpc"
import * as RpcGroup from "effect/unstable/rpc/RpcGroup"
import { Account } from "./Akahu.ts"

export class ListAccounts extends Rpc.make("ListAccounts", {
  payload: {
    akahuAppToken: Schema.Redacted(Schema.String),
    akahuUserToken: Schema.Redacted(Schema.String),
  },
  success: Schema.Array(Account),
}) {}

export const ApiRpcs = RpcGroup.make(ListAccounts)
