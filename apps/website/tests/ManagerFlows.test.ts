import { expect, test } from "@effect/vitest"
import { DateTime } from "effect"
import { Account, type AccountId } from "@app/domain/Akahu"
import { makeManagerAkahuSetupState } from "@app/domain/Manager/AkahuCustomFields"
import { AkahuRpcError } from "@app/domain/rpc"
import {
  collectManagerAkahuAccountSelections,
  mapAkahuAccountsReadFailure,
} from "../src/Manager/Flows.ts"

const akahuChecking = new Account({
  _id: "akahu-checking" as AccountId,
  name: "Akahu Checking",
  refreshed: {
    meta: DateTime.makeUnsafe("2026-06-05T00:00:00.000Z"),
    transactions: DateTime.makeUnsafe("2026-06-05T00:00:00.000Z"),
    party: DateTime.makeUnsafe("2026-06-05T00:00:00.000Z"),
  },
})

test("collects linked Manager accounts with sync setup metadata", () => {
  const selections = collectManagerAkahuAccountSelections({
    accountFieldKey: "akahu-field",
    akahuAccounts: [akahuChecking],
    managerAccounts: [
      {
        key: "manager-checking",
        item: {
          name: "Manager Checking",
          currency: "NZD",
          canHavePendingTransactions: true,
          customFields2: {
            strings: {
              "akahu-field": "Akahu Checking - akahu-checking",
            },
          },
        },
      },
    ],
  })

  expect(selections.staleSelections).toEqual([])
  expect(selections.linkedAccounts).toMatchObject([
    {
      key: "manager-checking",
      name: "Manager Checking",
      currency: "NZD",
      canHavePendingTransactions: true,
      akahuAccount: akahuChecking,
    },
  ])
})

test("collects stale Manager Akahu account selections separately", () => {
  const selections = collectManagerAkahuAccountSelections({
    accountFieldKey: "akahu-field",
    akahuAccounts: [akahuChecking],
    managerAccounts: [
      {
        key: "manager-stale",
        item: {
          name: "Old Savings",
          canHavePendingTransactions: false,
          customFields2: {
            strings: {
              "akahu-field": "Closed Savings - akahu-closed",
            },
          },
        },
      },
    ],
  })

  expect(selections.linkedAccounts).toEqual([])
  expect(selections.staleSelections).toMatchObject([
    {
      key: "manager-stale",
      name: "Old Savings",
      currency: null,
      canHavePendingTransactions: false,
      selectedAkahuAccountId: "akahu-closed",
      selectedAkahuAccountLabel: "Closed Savings",
    },
  ])
})

test("classifies setup state from Akahu account and Manager link availability", () => {
  const staleSelections = collectManagerAkahuAccountSelections({
    accountFieldKey: "akahu-field",
    akahuAccounts: [akahuChecking],
    managerAccounts: [
      {
        key: "manager-stale",
        item: {
          customFields2: {
            strings: {
              "akahu-field": "Closed Savings - akahu-closed",
            },
          },
        },
      },
    ],
  }).staleSelections

  expect(
    makeManagerAkahuSetupState({
      akahuAccountCount: 0,
      linkedAccounts: [],
      staleSelections,
    })._tag,
  ).toBe("noAkahuAccounts")

  expect(
    makeManagerAkahuSetupState({
      akahuAccountCount: 1,
      linkedAccounts: [],
      staleSelections,
    })._tag,
  ).toBe("noLinkedManagerAccounts")

  const ready = makeManagerAkahuSetupState({
    akahuAccountCount: 1,
    linkedAccounts: [
      ...collectManagerAkahuAccountSelections({
        accountFieldKey: "akahu-field",
        akahuAccounts: [akahuChecking],
        managerAccounts: [
          {
            key: "manager-checking",
            item: {
              customFields2: {
                strings: {
                  "akahu-field": "Akahu Checking - akahu-checking",
                },
              },
            },
          },
        ],
      }).linkedAccounts,
    ],
    staleSelections,
  })

  expect(ready._tag).toBe("ready")
  if (ready._tag === "ready") {
    expect(ready.staleSelections).toHaveLength(1)
  }
})

test("maps typed Akahu authentication failures to invalid credentials", () => {
  expect(
    mapAkahuAccountsReadFailure(new AkahuRpcError({ reason: "authentication", status: 401 }))._tag,
  ).toBe("invalidCredentials")

  expect(
    mapAkahuAccountsReadFailure(new AkahuRpcError({ reason: "authorization", status: 403 }))._tag,
  ).toBe("invalidCredentials")
})

test("maps typed retryable Akahu read failures to setup error", () => {
  const state = mapAkahuAccountsReadFailure(new AkahuRpcError({ reason: "read", status: 500 }))

  expect(state._tag).toBe("error")
  if (state._tag === "error") {
    expect(state.message).toBe(
      "Akahu accounts could not be loaded. Check the Akahu connection and try again.",
    )
  }
})
