import { AccountId } from "@app/domain/Akahu"
import { ApiRpcs } from "@app/domain/rpc"
import { Effect, Layer, Redacted, Schema, Stream } from "effect"
import { HttpClient, HttpClientResponse } from "effect/unstable/http"
import { RpcTest } from "effect/unstable/rpc"
import { expect, test } from "vite-plus/test"
import { Akahu } from "../src/Akahu.ts"
import { ApiHandlersBase } from "../src/rpc.ts"

const credentials = {
  akahuAppToken: Redacted.make("app-token"),
  akahuUserToken: Redacted.make("user-token"),
}
const accountId = Schema.decodeSync(AccountId)("acc_1")

interface ExpectedAkahuRequest {
  readonly method: string
  readonly pathname: string
  readonly query: Readonly<Record<string, string>>
  readonly headers: Readonly<Record<string, string | undefined>>
}

interface ExpectedAkahuExchange {
  readonly request: ExpectedAkahuRequest
  readonly response: unknown
}

const makeApiRpcClient = () => RpcTest.makeClient(ApiRpcs)
type ApiRpcClient = Effect.Success<ReturnType<typeof makeApiRpcClient>>

const page = (items: ReadonlyArray<unknown>, next?: string | null) => ({
  success: true,
  items,
  ...(next === undefined ? {} : { cursor: { next } }),
})

const refreshed = {
  meta: "2026-01-01T00:00:00.000Z",
  transactions: "2026-01-01T00:00:00.000Z",
  party: "2026-01-01T00:00:00.000Z",
}

const account = (id: string, name: string) => ({
  _id: id,
  name,
  refreshed,
})

const settledTransaction = (id: string, accountId = "acc_1") => ({
  _id: id,
  _account: accountId,
  _user: "user_1",
  _connection: "conn_1",
  date: "2026-01-02T00:00:00.000Z",
  description: id,
  amount: 12.34,
})

const pendingTransaction = (description: string, accountId = "acc_1") => ({
  _account: accountId,
  _user: "user_1",
  _connection: "conn_1",
  date: "2026-01-02T00:00:00.000Z",
  description,
  amount: -5.67,
})

const expectedAkahuRequest = (request: {
  readonly pathname: string
  readonly query?: Readonly<Record<string, string>>
}): ExpectedAkahuRequest => ({
  method: "GET",
  pathname: request.pathname,
  query: request.query ?? {},
  headers: {
    authorization: "Bearer user-token",
    "x-akahu-id": "app-token",
  },
})

const runWithMockAkahu = <A, E, R>(
  exchanges: ReadonlyArray<ExpectedAkahuExchange>,
  useClient: (client: ApiRpcClient) => Effect.Effect<A, E, R>,
) => {
  let requestIndex = 0
  const httpClient = HttpClient.make((request, url) =>
    Effect.sync(() => {
      const exchange = exchanges[requestIndex]
      requestIndex += 1

      if (exchange === undefined) {
        throw new Error(`Unexpected extra Akahu request: ${url.pathname}${url.search}`)
      }

      expect({
        method: request.method,
        pathname: url.pathname,
        query: Object.fromEntries(url.searchParams.entries()),
        headers: {
          authorization: request.headers.authorization,
          "x-akahu-id": request.headers["x-akahu-id"],
        },
      }).toEqual(exchange.request)

      return HttpClientResponse.fromWeb(
        request,
        new Response(JSON.stringify(exchange.response), {
          status: 200,
          headers: { "content-type": "application/json" },
        }),
      )
    }),
  )
  const akahuLayer = Akahu.layer.pipe(
    Layer.provide(Layer.succeed(HttpClient.HttpClient, httpClient)),
  )
  const rpcLayer = ApiHandlersBase.pipe(Layer.provide(akahuLayer))

  return Effect.scoped(
    Effect.gen(function* () {
      const client = yield* makeApiRpcClient().pipe(Effect.provide(rpcLayer))
      const result = yield* useClient(client)
      yield* Effect.sync(() => expect(requestIndex).toBe(exchanges.length))
      return result
    }),
  )
}

test("ListAccounts returns all Akahu accounts across cursor pages", () =>
  Effect.runPromise(
    runWithMockAkahu(
      [
        {
          request: expectedAkahuRequest({ pathname: "/v1/accounts" }),
          response: page([account("acc_1", "Everyday")], "accounts-page-2"),
        },
        {
          request: expectedAkahuRequest({
            pathname: "/v1/accounts",
            query: { cursor: "accounts-page-2" },
          }),
          response: page([account("acc_2", "Savings")], null),
        },
      ],
      (client) => client.ListAccounts(credentials),
    ),
  ).then((result) => {
    expect(result.map((item) => item._id)).toEqual(["acc_1", "acc_2"])
  }))

test("AccountTransactions streams all settled transactions across cursor pages", () =>
  Effect.runPromise(
    runWithMockAkahu(
      [
        {
          request: expectedAkahuRequest({ pathname: "/v1/accounts/acc_1/transactions" }),
          response: page([settledTransaction("txn_1")], "settled-page-2"),
        },
        {
          request: expectedAkahuRequest({
            pathname: "/v1/accounts/acc_1/transactions",
            query: { cursor: "settled-page-2" },
          }),
          response: page([settledTransaction("txn_2")], "settled-page-3"),
        },
        {
          request: expectedAkahuRequest({
            pathname: "/v1/accounts/acc_1/transactions",
            query: { cursor: "settled-page-3" },
          }),
          response: page([settledTransaction("txn_3")]),
        },
      ],
      (client) =>
        client.AccountTransactions({ ...credentials, accountId }).pipe(
          Stream.runCollect,
          Effect.map((items) => Array.from(items)),
        ),
    ),
  ).then((result) => {
    expect(result.map((item) => item._id)).toEqual(["txn_1", "txn_2", "txn_3"])
  }))

test("AccountPendingTransactions streams all pending transactions with amount_as_number across cursor pages", () =>
  Effect.runPromise(
    runWithMockAkahu(
      [
        {
          request: expectedAkahuRequest({
            pathname: "/v1/accounts/acc_1/transactions/pending",
            query: { amount_as_number: "true" },
          }),
          response: page([pendingTransaction("pending-1")], "pending-page-2"),
        },
        {
          request: expectedAkahuRequest({
            pathname: "/v1/accounts/acc_1/transactions/pending",
            query: { amount_as_number: "true", cursor: "pending-page-2" },
          }),
          response: page([pendingTransaction("pending-2")], null),
        },
      ],
      (client) =>
        client.AccountPendingTransactions({ ...credentials, accountId }).pipe(
          Stream.runCollect,
          Effect.map((items) => Array.from(items)),
        ),
    ),
  ).then((result) => {
    expect(result.map((item) => item.description)).toEqual(["pending-1", "pending-2"])
  }))
