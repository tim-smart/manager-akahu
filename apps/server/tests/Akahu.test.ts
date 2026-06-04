import type { PaginatedResponse } from "@app/domain/Akahu"
import { Effect, Stream } from "effect"
import { expect, test } from "vite-plus/test"
import { paginatedAkahuItems } from "../src/Akahu.ts"

const collectMockPages = <A>(pages: ReadonlyMap<string | undefined, PaginatedResponse<A>>) => {
  const requestedCursors: Array<string | undefined> = []

  return paginatedAkahuItems((cursor) =>
    Effect.sync(() => {
      requestedCursors.push(cursor)

      const page = pages.get(cursor)
      if (page === undefined) {
        throw new Error(`Unexpected cursor: ${cursor ?? "<first>"}`)
      }

      return page
    }),
  ).pipe(
    Stream.runCollect,
    Effect.map((items) => ({ items, requestedCursors })),
  )
}

test("collects multi-page Akahu account responses", () =>
  Effect.runPromise(
    collectMockPages(
      new Map<string | undefined, PaginatedResponse<string>>([
        [undefined, { success: true, items: ["account-1"], cursor: { next: "accounts-page-2" } }],
        ["accounts-page-2", { success: true, items: ["account-2"], cursor: { next: null } }],
      ]),
    ),
  ).then(({ items, requestedCursors }) => {
    expect(items).toEqual(["account-1", "account-2"])
    expect(requestedCursors).toEqual([undefined, "accounts-page-2"])
  }))

test("streams multi-page Akahu settled transaction responses", () =>
  Effect.runPromise(
    collectMockPages(
      new Map<string | undefined, PaginatedResponse<string>>([
        [undefined, { success: true, items: ["settled-1"], cursor: { next: "settled-page-2" } }],
        [
          "settled-page-2",
          { success: true, items: ["settled-2"], cursor: { next: "settled-page-3" } },
        ],
        ["settled-page-3", { success: true, items: ["settled-3"] }],
      ]),
    ),
  ).then(({ items, requestedCursors }) => {
    expect(items).toEqual(["settled-1", "settled-2", "settled-3"])
    expect(requestedCursors).toEqual([undefined, "settled-page-2", "settled-page-3"])
  }))

test("streams multi-page Akahu pending transaction responses", () =>
  Effect.runPromise(
    collectMockPages(
      new Map<string | undefined, PaginatedResponse<string>>([
        [undefined, { success: true, items: ["pending-1"], cursor: { next: "pending-page-2" } }],
        ["pending-page-2", { success: true, items: ["pending-2"], cursor: { next: null } }],
      ]),
    ),
  ).then(({ items, requestedCursors }) => {
    expect(items).toEqual(["pending-1", "pending-2"])
    expect(requestedCursors).toEqual([undefined, "pending-page-2"])
  }))
