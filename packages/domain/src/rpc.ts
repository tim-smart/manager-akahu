import { Schema } from "effect"
import * as Rpc from "effect/unstable/rpc/Rpc"
import * as RpcGroup from "effect/unstable/rpc/RpcGroup"
import { Account, AccountId, PendingTransaction, Transaction } from "./Akahu.ts"

export class ListAccounts extends Rpc.make("ListAccounts", {
  payload: {
    akahuAppToken: Schema.Redacted(Schema.String),
    akahuUserToken: Schema.Redacted(Schema.String),
  },
  success: Schema.Array(Account),
}) {}

export class AccountTransactions extends Rpc.make("AccountTransactions", {
  payload: {
    akahuAppToken: Schema.Redacted(Schema.String),
    akahuUserToken: Schema.Redacted(Schema.String),
    accountId: AccountId,
  },
  success: Transaction,
  stream: true,
}) {}

export class AccountPendingTransactions extends Rpc.make("AccountPendingTransactions", {
  payload: {
    akahuAppToken: Schema.Redacted(Schema.String),
    akahuUserToken: Schema.Redacted(Schema.String),
    accountId: AccountId,
  },
  success: PendingTransaction,
  stream: true,
}) {}

export const ApiRpcs = RpcGroup.make(ListAccounts, AccountTransactions, AccountPendingTransactions)
