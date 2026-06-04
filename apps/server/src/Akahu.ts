import { Context, Effect, Layer, Option, Redacted, Stream } from "effect"
import {
  Account,
  AccountId,
  AkahuApi,
  type PaginatedResponse,
  PendingTransaction,
  Transaction,
} from "@app/domain/Akahu"
import { HttpClient, HttpClientRequest } from "effect/unstable/http"
import * as HttpClientError from "effect/unstable/http/HttpClientError"
import { HttpApiClient } from "effect/unstable/httpapi"
import { AkahuRpcError } from "@app/domain/rpc"

const paginatedAkahuItems = <A, E, R>(
  fetchPage: (cursor: string | undefined) => Effect.Effect<PaginatedResponse<A>, E, R>,
): Stream.Stream<A, E, R> =>
  Stream.paginate(undefined as string | undefined, (cursor) =>
    fetchPage(cursor).pipe(
      Effect.map(
        (response) =>
          [response.items, Option.fromUndefinedOr(response.cursor?.next ?? undefined)] as const,
      ),
    ),
  )

export class AkahuCredentials extends Context.Service<
  AkahuCredentials,
  {
    readonly appToken: Redacted.Redacted
    readonly userToken: Redacted.Redacted
  }
>()("server/AkahuCredentials") {}

export class Akahu extends Context.Service<
  Akahu,
  {
    readonly accounts: Effect.Effect<ReadonlyArray<Account>, AkahuRpcError, AkahuCredentials>
    transactions(options: {
      readonly accountId: AccountId
    }): Stream.Stream<Transaction, AkahuRpcError, AkahuCredentials>
    pendingTransactions(options: {
      readonly accountId: AccountId
    }): Stream.Stream<PendingTransaction, AkahuRpcError, AkahuCredentials>
  }
>()("server/Akahu") {
  static readonly layer = Layer.effect(
    Akahu,
    Effect.gen(function* () {
      const httpClient = (yield* HttpClient.HttpClient).pipe(
        HttpClient.mapRequestEffect(
          Effect.fnUntraced(function* (request) {
            const credentials = yield* AkahuCredentials
            return request.pipe(
              HttpClientRequest.prependUrl("https://api.akahu.io/v1"),
              HttpClientRequest.setHeader("X-Akahu-Id", Redacted.value(credentials.appToken)),
              HttpClientRequest.bearerToken(credentials.userToken),
            )
          }),
        ),
        HttpClient.retryTransient({
          times: 5,
        }),
      )

      const akahu = yield* HttpApiClient.makeWith(AkahuApi, {
        httpClient,
      })

      return Akahu.of({
        accounts: paginatedAkahuItems((cursor) =>
          akahu.accounts.list({
            query: { cursor },
          }),
        ).pipe(
          Stream.runCollect,
          Effect.map((items): ReadonlyArray<Account> => Array.from(items)),
          Effect.mapError(mapAkahuRpcError),
        ),
        transactions: ({ accountId }) =>
          paginatedAkahuItems((cursor) =>
            akahu.transactions.list({
              params: { accountId },
              query: { cursor },
            }),
          ).pipe(Stream.mapError(mapAkahuRpcError)),
        pendingTransactions: ({ accountId }) =>
          paginatedAkahuItems((cursor) =>
            akahu.transactions.pending({
              params: { accountId },
              query: { amount_as_number: "true", cursor },
            }),
          ).pipe(Stream.mapError(mapAkahuRpcError)),
      })
    }),
  )
}

const mapAkahuRpcError = (error: unknown) => {
  if (HttpClientError.isHttpClientError(error)) {
    const status = error.response?.status
    if (status === 401) {
      return new AkahuRpcError({ reason: "authentication", status })
    }
    if (status === 403) {
      return new AkahuRpcError({ reason: "authorization", status })
    }
    return new AkahuRpcError({ reason: "read", ...(status === undefined ? {} : { status }) })
  }

  return new AkahuRpcError({ reason: "read" })
}
