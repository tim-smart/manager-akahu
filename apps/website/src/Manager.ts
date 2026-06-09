import { Context, Deferred, Effect, Exit, Layer } from "effect"
import * as ManagerClient from "@app/manager-api/ManagerClient"
import { HttpClient, HttpClientError, HttpClientResponse } from "effect/unstable/http"

// @effect-diagnostics-next-line lazyEffect:off
export class Manager extends Context.Service<Manager, ManagerClient.Client>()("Manager", {
  make: Effect.gen(function* () {
    const httpClient = yield* makeIframeHttpClient
    return ManagerClient.make(httpClient)
  }),
}) {
  static layer = Layer.effect(this, this.make)
}

const makeIframeHttpClient = Effect.gen(function* () {
  const deferreds = new Map<string, Deferred.Deferred<Response>>()

  const context = yield* getPageContext

  const onMessage = (event: MessageEvent) => {
    if (!(event.data instanceof Object && "requestId" in event.data)) {
      return
    }
    const requestId = event.data.requestId
    const deferred = deferreds.get(requestId)
    if (deferred === undefined) {
      return
    }
    deferreds.delete(requestId)
    Deferred.doneUnsafe(deferred, Exit.succeed(Response.json(event.data.body)))
  }

  yield* Effect.addFinalizer(() => {
    window.removeEventListener("message", onMessage)
    return Effect.void
  })
  window.addEventListener("message", onMessage)

  const decoder = new TextDecoder()

  return HttpClient.makeWith<never, never, HttpClientError.HttpClientError, never>(
    Effect.fnUntraced(function* (eff) {
      const request = yield* eff
      // @effect-diagnostics-next-line cryptoRandomUUIDInEffect:off
      const requestId = crypto.randomUUID()
      const deferred = Deferred.makeUnsafe<Response>()
      deferreds.set(requestId, deferred)

      window.parent.postMessage(
        {
          type: "api-request",
          requestId,
          method: request.method,
          path: request.url,
          headers: {
            "Manager-Business": context.query.business,
          },
          body:
            request.body._tag === "Uint8Array"
              ? // @effect-diagnostics-next-line preferSchemaOverJson:off
                JSON.parse(decoder.decode(request.body.body))
              : undefined,
        },
        "*",
      )

      return HttpClientResponse.fromWeb(request, yield* Deferred.await(deferred))
    }),
    Effect.succeed,
  )
})

const getPageContext = Effect.callback<{
  readonly handler: string
  readonly path: string
  readonly query: {
    readonly business: string
  }
}>((resume) => {
  const onMessage = (event: MessageEvent) => {
    if (event.data.type === "page-response") {
      window.removeEventListener("message", onMessage)
      resume(Exit.succeed(event.data.body))
    }
  }
  window.addEventListener("message", onMessage)
  window.parent.postMessage({ type: "page-request" }, "*")
  return Effect.sync(() => {
    window.addEventListener("message", onMessage)
  })
})
