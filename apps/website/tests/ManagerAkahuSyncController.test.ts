import { Account, AccountId } from "@app/domain/Akahu"
import { LinkedAccount } from "@app/domain/Manager/AkahuCustomFields"
import { emptyManagerAkahuSyncSummaryCounts } from "@app/manager-api/ManagerAkahuTransactionSync"
import { DateTime, Schema } from "effect"
import { expect, it } from "@effect/vitest"
import type { ManagerAkahuTransactionSyncSummary } from "../src/Manager/SyncFlows.ts"
import {
  closeManagerAkahuSyncController,
  managerAkahuSyncFailureMessage,
  startManagerAkahuSyncController,
  type RunManagerAkahuTransactionSync,
  type SetManagerAkahuSyncDialogState,
} from "../src/Manager/useManagerAkahuSyncController.ts"
import {
  initialManagerAkahuSyncDialogState,
  openManagerAkahuSyncDialog,
  type ManagerAkahuSyncDialogState,
} from "../src/Manager/SyncUi.ts"

const accountId = Schema.decodeSync(AccountId)("akahu-checking")

const akahuAccount = new Account({
  _id: accountId,
  name: "Akahu Checking",
  refreshed: {
    meta: DateTime.makeUnsafe("2026-06-05T00:00:00.000Z"),
    transactions: DateTime.makeUnsafe("2026-06-05T00:00:00.000Z"),
    party: DateTime.makeUnsafe("2026-06-05T00:00:00.000Z"),
  },
})

const linkedAccount = () =>
  new LinkedAccount({
    key: "manager-checking",
    name: "Manager Checking",
    currency: null,
    canHavePendingTransactions: true,
    akahuAccount,
  })

const summaryFor = (account: LinkedAccount): ManagerAkahuTransactionSyncSummary => ({
  accounts: [
    {
      account,
      counts: emptyManagerAkahuSyncSummaryCounts(),
      warnings: [],
      errors: [],
    },
  ],
  overall: emptyManagerAkahuSyncSummaryCounts(),
})

const flushSyncControllerPromises = async () => {
  await Promise.resolve()
  await Promise.resolve()
  await Promise.resolve()
}

it("invokes the sync mutation only once when Start is clicked twice before rerender", async () => {
  const account = linkedAccount()
  let state = openManagerAkahuSyncDialog(initialManagerAkahuSyncDialogState, [account])
  const setState: SetManagerAkahuSyncDialogState = (next) => {
    state = typeof next === "function" ? next(state) : next
  }
  const inFlightRef = { current: false }
  let resolveSync: (summary: ManagerAkahuTransactionSyncSummary) => void = () => {}
  const syncPromise = new Promise<ManagerAkahuTransactionSyncSummary>((resolve) => {
    resolveSync = resolve
  })
  let syncCalls = 0
  const runTransactionSync: RunManagerAkahuTransactionSync = () => {
    syncCalls += 1
    return syncPromise
  }
  expect(state._tag).toBe("confirming")

  startManagerAkahuSyncController({ inFlightRef, setState, runTransactionSync })
  startManagerAkahuSyncController({ inFlightRef, setState, runTransactionSync })

  expect(state._tag).toBe("running")
  await Promise.resolve()
  expect(syncCalls).toBe(1)

  resolveSync(summaryFor(account))
  await syncPromise
  await flushSyncControllerPromises()
  expect(state._tag).toBe("completed")
})

it("does not launch sync from a stale start callback after the dialog leaves confirming", async () => {
  const account = linkedAccount()
  let state = openManagerAkahuSyncDialog(initialManagerAkahuSyncDialogState, [account])
  const setState: SetManagerAkahuSyncDialogState = (next) => {
    state = typeof next === "function" ? next(state) : next
  }
  const inFlightRef = { current: false }
  let syncCalls = 0
  const runTransactionSync: RunManagerAkahuTransactionSync = () => {
    syncCalls += 1
    return Promise.resolve(summaryFor(account))
  }
  const staleStart = () => {
    startManagerAkahuSyncController({ inFlightRef, setState, runTransactionSync })
  }
  expect(state._tag).toBe("confirming")

  closeManagerAkahuSyncController(setState)
  staleStart()
  await flushSyncControllerPromises()

  expect(syncCalls).toBe(0)
  expect(inFlightRef.current).toBe(false)
  expect(state._tag).toBe("closed")
})

it("recovers from a synchronous sync runner throw and allows a later valid start", async () => {
  const account = linkedAccount()
  let state = openManagerAkahuSyncDialog(initialManagerAkahuSyncDialogState, [account])
  const setState: SetManagerAkahuSyncDialogState = (next) => {
    state = typeof next === "function" ? next(state) : next
  }
  const inFlightRef = { current: false }
  let syncCalls = 0
  const runTransactionSync: RunManagerAkahuTransactionSync = () => {
    syncCalls += 1
    if (syncCalls === 1) {
      throw new Error("sync runner failed before returning a promise")
    }
    return Promise.resolve(summaryFor(account))
  }

  startManagerAkahuSyncController({ inFlightRef, setState, runTransactionSync })
  expect(state._tag).toBe("running")
  expect(inFlightRef.current).toBe(true)
  await flushSyncControllerPromises()

  expect(syncCalls).toBe(1)
  expect(inFlightRef.current).toBe(false)
  expect(state).toEqual({
    _tag: "failed",
    accounts: [account],
    message: managerAkahuSyncFailureMessage,
  })

  setState((current) => openManagerAkahuSyncDialog(current, [account]))
  expect(state._tag).toBe("confirming")
  startManagerAkahuSyncController({ inFlightRef, setState, runTransactionSync })
  await flushSyncControllerPromises()

  expect(syncCalls).toBe(2)
  expect(inFlightRef.current).toBe(false)
  expect(state._tag).toBe("completed")
})

it("does not dismiss running sync state through controller close paths", () => {
  const account = linkedAccount()
  let state: ManagerAkahuSyncDialogState = { _tag: "running", accounts: [account] }
  const setState: SetManagerAkahuSyncDialogState = (next) => {
    state = typeof next === "function" ? next(state) : next
  }
  expect(state._tag).toBe("running")

  closeManagerAkahuSyncController(setState)
  closeManagerAkahuSyncController(setState)

  expect(state._tag).toBe("running")
})
