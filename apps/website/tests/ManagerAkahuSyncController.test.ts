import { Account, AccountId } from "@app/domain/Akahu"
import { LinkedAccount } from "@app/domain/Manager/AkahuCustomFields"
import { emptyManagerAkahuSyncSummaryCounts } from "@app/manager-api/ManagerAkahuTransactionSync"
import { DateTime, Schema } from "effect"
import { expect, it } from "@effect/vitest"
import type { ManagerAkahuTransactionSyncSummary } from "../src/Manager/SyncFlows.ts"
import {
  closeManagerAkahuSyncController,
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

  startManagerAkahuSyncController({ state, inFlightRef, setState, runTransactionSync })
  startManagerAkahuSyncController({
    state: openManagerAkahuSyncDialog(initialManagerAkahuSyncDialogState, [account]),
    inFlightRef,
    setState,
    runTransactionSync,
  })

  expect(syncCalls).toBe(1)
  expect(state._tag).toBe("running")

  resolveSync(summaryFor(account))
  await syncPromise
  await Promise.resolve()
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
