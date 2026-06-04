import { AccountId } from "@app/domain/Akahu"
import { ApiRpcs } from "@app/domain/rpc"
import { Effect, Layer, Redacted, Schema, Stream } from "effect"
import { HttpClient, HttpClientResponse } from "effect/unstable/http"
import { RpcTest } from "effect/unstable/rpc"
import { expect, test } from "vite-plus/test"
import { Akahu } from "../src/Akahu.ts"
import { ApiHandlersWithoutAkahu } from "../src/rpc.ts"

const credentials = {
  akahuAppToken: Redacted.make("app-token"),
  akahuUserToken: Redacted.make("user-token"),
}
const accountId = Schema.decodeSync(AccountId)("acc_1")

interface CapturedAkahuRequest {
  readonly method: string
  readonly pathname: string
  readonly query: Readonly<Record<string, string>>
  readonly headers: Readonly<Record<string, string | undefined>>
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

const requestKey = (url: URL) =>
  `${url.pathname}|cursor=${url.searchParams.get("cursor") ?? ""}|amount_as_number=${
    url.searchParams.get("amount_as_number") ?? ""
  }`

const runWithMockAkahu = <A, E, R>(
  pages: ReadonlyMap<string, unknown>,
  useClient: (client: ApiRpcClient) => Effect.Effect<A, E, R>,
) => {
  const requests: Array<CapturedAkahuRequest> = []
  const httpClient = HttpClient.make((request, url) =>
    Effect.sync(() => {
      requests.push({
        method: request.method,
        pathname: url.pathname,
        query: Object.fromEntries(url.searchParams.entries()),
        headers: {
          authorization: request.headers.authorization,
          "x-akahu-id": request.headers["x-akahu-id"],
        },
      })

      const response = pages.get(requestKey(url))
      if (response === undefined) {
        throw new Error(`Unexpected Akahu request: ${url.pathname}${url.search}`)
      }

      return HttpClientResponse.fromWeb(
        request,
        new Response(JSON.stringify(response), {
          status: 200,
          headers: { "content-type": "application/json" },
        }),
      )
    }),
  )
  const akahuLayer = Akahu.layerWithHttpClient.pipe(
    Layer.provide(Layer.succeed(HttpClient.HttpClient, httpClient)),
  )
  const rpcLayer = ApiHandlersWithoutAkahu.pipe(Layer.provide(akahuLayer))

  return Effect.scoped(
    Effect.gen(function* () {
      const client = yield* makeApiRpcClient().pipe(Effect.provide(rpcLayer))
      const result = yield* useClient(client)
      return { result, requests }
    }),
  )
}

const expectAkahuCredentialHeaders = (requests: ReadonlyArray<CapturedAkahuRequest>) => {
  expect(requests.map((request) => request.headers)).toEqual(
    Array.from({ length: requests.length }, () => ({
      authorization: "Bearer user-token",
      "x-akahu-id": "app-token",
    })),
  )
}

test("ListAccounts returns all Akahu accounts across cursor pages", () =>
  Effect.runPromise(
    runWithMockAkahu(
      new Map<string, unknown>([
        [
          "/v1/accounts|cursor=|amount_as_number=",
          page([account("acc_1", "Everyday")], "accounts-page-2"),
        ],
        [
          "/v1/accounts|cursor=accounts-page-2|amount_as_number=",
          page([account("acc_2", "Savings")], null),
        ],
      ]),
      (client) => client.ListAccounts(credentials),
    ),
  ).then(({ result, requests }) => {
    expect(result.map((item) => item._id)).toEqual(["acc_1", "acc_2"])
    expect(requests.map(({ method, pathname, query }) => ({ method, pathname, query }))).toEqual([
      { method: "GET", pathname: "/v1/accounts", query: {} },
      { method: "GET", pathname: "/v1/accounts", query: { cursor: "accounts-page-2" } },
    ])
    expectAkahuCredentialHeaders(requests)
  }))

test("AccountTransactions streams all settled transactions across cursor pages", () =>
  Effect.runPromise(
    runWithMockAkahu(
      new Map<string, unknown>([
        [
          "/v1/accounts/acc_1/transactions|cursor=|amount_as_number=",
          page([settledTransaction("txn_1")], "settled-page-2"),
        ],
        [
          "/v1/accounts/acc_1/transactions|cursor=settled-page-2|amount_as_number=",
          page([settledTransaction("txn_2")], "settled-page-3"),
        ],
        [
          "/v1/accounts/acc_1/transactions|cursor=settled-page-3|amount_as_number=",
          page([settledTransaction("txn_3")]),
        ],
      ]),
      (client) =>
        client.AccountTransactions({ ...credentials, accountId }).pipe(
          Stream.runCollect,
          Effect.map((items) => Array.from(items)),
        ),
    ),
  ).then(({ result, requests }) => {
    expect(result.map((item) => item._id)).toEqual(["txn_1", "txn_2", "txn_3"])
    expect(requests.map(({ method, pathname, query }) => ({ method, pathname, query }))).toEqual([
      { method: "GET", pathname: "/v1/accounts/acc_1/transactions", query: {} },
      {
        method: "GET",
        pathname: "/v1/accounts/acc_1/transactions",
        query: { cursor: "settled-page-2" },
      },
      {
        method: "GET",
        pathname: "/v1/accounts/acc_1/transactions",
        query: { cursor: "settled-page-3" },
      },
    ])
    expectAkahuCredentialHeaders(requests)
  }))

test("AccountPendingTransactions streams all pending transactions with amount_as_number across cursor pages", () =>
  Effect.runPromise(
    runWithMockAkahu(
      new Map<string, unknown>([
        [
          "/v1/accounts/acc_1/transactions/pending|cursor=|amount_as_number=true",
          page([pendingTransaction("pending-1")], "pending-page-2"),
        ],
        [
          "/v1/accounts/acc_1/transactions/pending|cursor=pending-page-2|amount_as_number=true",
          page([pendingTransaction("pending-2")], null),
        ],
      ]),
      (client) =>
        client.AccountPendingTransactions({ ...credentials, accountId }).pipe(
          Stream.runCollect,
          Effect.map((items) => Array.from(items)),
        ),
    ),
  ).then(({ result, requests }) => {
    expect(result.map((item) => item.description)).toEqual(["pending-1", "pending-2"])
    expect(requests.map(({ method, pathname, query }) => ({ method, pathname, query }))).toEqual([
      {
        method: "GET",
        pathname: "/v1/accounts/acc_1/transactions/pending",
        query: { amount_as_number: "true" },
      },
      {
        method: "GET",
        pathname: "/v1/accounts/acc_1/transactions/pending",
        query: { amount_as_number: "true", cursor: "pending-page-2" },
      },
    ])
    expectAkahuCredentialHeaders(requests)
  }))
