import { AccountId } from "@app/domain/Akahu"
import { AkahuRpcError, ApiRpcs } from "@app/domain/rpc"
import { Effect, Layer, Redacted, Schema, Stream } from "effect"
import { HttpClient, HttpClientResponse } from "effect/unstable/http"
import { RpcTest } from "effect/unstable/rpc"
import { expect, it } from "@effect/vitest"
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
  readonly status?: number
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

const settledTransaction = (
  id: string,
  accountId = "acc_1",
  date = "2026-01-02T00:00:00.000Z",
) => ({
  _id: id,
  _account: accountId,
  _user: "user_1",
  _connection: "conn_1",
  date,
  description: id,
  amount: 12.34,
})

const pendingTransaction = (
  description: string,
  accountId = "acc_1",
  date = "2026-01-02T00:00:00.000Z",
) => ({
  _account: accountId,
  _user: "user_1",
  _connection: "conn_1",
  date,
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
          status: exchange.status ?? 200,
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
      const result = yield* useClient(client).pipe(
        Effect.ensuring(Effect.sync(() => expect(requestIndex).toBe(exchanges.length))),
      )
      return result
    }),
  )
}

it.effect("ListAccounts returns all Akahu accounts across cursor pages", () =>
  Effect.gen(function* () {
    const result = yield* runWithMockAkahu(
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
    )
    expect(result.map((item) => item._id)).toEqual(["acc_1", "acc_2"])
  }),
)

it.effect("ListAccounts preserves Akahu authentication failures as typed RPC errors", () =>
  Effect.gen(function* () {
    const error = yield* runWithMockAkahu(
      [
        {
          request: expectedAkahuRequest({ pathname: "/v1/accounts" }),
          response: { success: false },
          status: 401,
        },
      ],
      (client) => client.ListAccounts(credentials),
    ).pipe(Effect.flip)

    expect(error).toBeInstanceOf(AkahuRpcError)
    expect(error).toMatchObject({ reason: "authentication", status: 401 })
  }),
)

it.effect("AccountTransactions streams full settled history across cursor pages", () =>
  Effect.gen(function* () {
    const result = yield* runWithMockAkahu(
      [
        {
          request: expectedAkahuRequest({ pathname: "/v1/accounts/acc_1/transactions" }),
          response: page(
            [settledTransaction("txn_1", "acc_1", "2026-06-05T00:30:00.000+13:00")],
            "settled-page-2",
          ),
        },
        {
          request: expectedAkahuRequest({
            pathname: "/v1/accounts/acc_1/transactions",
            query: { cursor: "settled-page-2" },
          }),
          response: page(
            [settledTransaction("txn_2", "acc_1", "2026-04-01T00:00:00.000Z")],
            "settled-page-3",
          ),
        },
        {
          request: expectedAkahuRequest({
            pathname: "/v1/accounts/acc_1/transactions",
            query: { cursor: "settled-page-3" },
          }),
          response: page([settledTransaction("txn_3", "acc_1", "2025-12-31T00:00:00.000Z")]),
        },
      ],
      (client) =>
        client.AccountTransactions({ ...credentials, accountId }).pipe(
          Stream.runCollect,
          Effect.map((items) => Array.from(items)),
        ),
    )
    expect(result.map((item) => item._id)).toEqual(["txn_1", "txn_2", "txn_3"])
  }),
)

it.effect("AccountTransactions fails RPC decoding for malformed Akahu transaction dates", () =>
  Effect.gen(function* () {
    const error = yield* runWithMockAkahu(
      [
        {
          request: expectedAkahuRequest({ pathname: "/v1/accounts/acc_1/transactions" }),
          response: page([settledTransaction("txn-bad-date", "acc_1", "2026-13-01T00:00:00.000Z")]),
        },
      ],
      (client) =>
        client.AccountTransactions({ ...credentials, accountId }).pipe(
          Stream.runCollect,
          Effect.map((items) => Array.from(items)),
        ),
    ).pipe(Effect.flip)

    expect(error).toBeInstanceOf(AkahuRpcError)
    expect(error).toMatchObject({ reason: "read" })
  }),
)

it.effect("AccountTransactions preserves retryable Akahu read failures as typed RPC errors", () =>
  Effect.gen(function* () {
    const error = yield* runWithMockAkahu(
      Array.from(
        { length: 6 },
        () =>
          ({
            request: expectedAkahuRequest({ pathname: "/v1/accounts/acc_1/transactions" }),
            response: { success: false },
            status: 500,
          }) satisfies ExpectedAkahuExchange,
      ),
      (client) =>
        client.AccountTransactions({ ...credentials, accountId }).pipe(
          Stream.runCollect,
          Effect.map((items) => Array.from(items)),
        ),
    ).pipe(Effect.flip)

    expect(error).toBeInstanceOf(AkahuRpcError)
    expect(error).toMatchObject({ reason: "read", status: 500 })
  }),
)

it.effect(
  "AccountPendingTransactions streams all pending transactions with amount_as_number across cursor pages",
  () =>
    Effect.gen(function* () {
      const result = yield* runWithMockAkahu(
        [
          {
            request: expectedAkahuRequest({
              pathname: "/v1/accounts/acc_1/transactions/pending",
              query: { amount_as_number: "true" },
            }),
            response: page(
              [pendingTransaction("pending-1", "acc_1", "2026-06-04T23:30:00.000-10:00")],
              "pending-page-2",
            ),
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
      )
      expect(result.map((item) => item.description)).toEqual(["pending-1", "pending-2"])
    }),
)
