# Manager Akahu Bank Account Sync Specification

## Overview

Refactor the Manager Akahu extension UI so it reflects the user's setup stage and implement bank account transaction syncing from Akahu into Manager receipts and payments.

The extension already discovers Akahu credentials from Manager Business Details custom fields, ensures an "Akahu Account" custom field exists on Manager bank/cash accounts, lists linked accounts, and exposes Akahu account/transaction/pending-transaction reads through the ApiClient/RPC layer. This specification completes the user-facing setup flow, confirmation/progress UX, and safe receipt/payment creation with de-duplication.

## Goals

- Show a setup-state UI for missing credentials, no linked accounts, and linked accounts.
- Show linked Manager bank/cash accounts with per-account sync and sync-all actions.
- Confirm sync actions in a modal dialog before any writes happen.
- Show progress, warnings, errors, and summary counts in the modal while and after syncing.
- Fetch Akahu settled transactions for selected accounts via ApiClient/RPC.
- Fetch Akahu pending transactions only for linked Manager bank/cash accounts that support pending transactions.
- Create Manager receipts for positive Akahu amounts and Manager payments for negative Akahu amounts.
- De-duplicate settled transactions by Akahu transaction ID stored in Manager's fdxTransactionId field.
- De-duplicate pending transactions by a generated fingerprint stored in Manager's fdxTransactionId field.
- Fetch settled Akahu transaction history for each selected account until five overlapping transactions are found, or Akahu has no more settled transactions to return.

## Non-goals and first-pass limits

- Do not add automatic/background sync scheduling.
- Do not add a user-configurable date range yet.
- Do not implement Akahu credential editing or OAuth in this extension. Credentials continue to come from Manager Business Details custom fields.
- Do not trigger Akahu refresh as part of this first implementation. Sync imports transactions already available from Akahu through the ApiClient/RPC reads. The UI must avoid implying that it forced a fresh bank refresh.
- Do not add categorisation rules. Manager supports uncategorized/suspense receipts and payments, so default synced entries may rely on that.
- Do not delete or modify user-created/non-Akahu Manager receipts/payments.
- Do not automatically delete unmatched stale pending entries in the first implementation.
- Foreign-currency Manager bank/cash accounts are not supported until Manager payload requirements are verified. The first implementation must either skip them with a clear warning or include them only after an explicit compatibility check verifies amount/currencyAmount/exchangeRate behaviour.

## Current implementation findings

### Task 0 baseline validation findings

- Baseline validation now uses `pnpm ready`, which formats, lints, runs existing tests recursively, and builds from the workspace root. The original recursive flag order passed `-r` through as a task argument, and the recursive build also duplicated the root TypeScript project-reference build.
- The website TypeScript build resolves `@app/manager-api/ManagerClient` through workspace TypeScript path mappings and an explicit website project reference to `packages/manager-api`.
- `@app/manager-api` now has a source index that re-exports the generated client and provides named Manager API type aliases for future bank/cash account, receipt, and payment sync code.
- Generated Manager client lazy-effect diagnostics and the server Node HTTP import are intentionally suppressed so baseline type/build validation is not blocked by non-feature diagnostics.
- `pnpm ready` passes as of Task 0.

### Existing Akahu/domain/API pieces

- packages/domain/src/Akahu.ts defines Akahu Account, Transaction, and PendingTransaction schemas.
- packages/domain/src/Akahu.ts defines HTTP API endpoints for account listing, settled account transactions, pending account transactions, and refresh.
- packages/domain/src/rpc.ts exposes ListAccounts, AccountTransactions, and AccountPendingTransactions RPCs.
- apps/server/src/Akahu.ts currently fetches transactions from the last 30 days; later sync tasks must replace or extend this boundary so settled sync can continue until the five-overlap stop condition is reached.
- apps/website/src/ApiClient.ts exposes the RPCs to the frontend through websocket AtomRpc.

### Existing Manager integration pieces

- apps/website/src/Manager/Flows.ts currently:
  - Ensures Manager text custom fields named "Akahu App Token" and "Akahu User Token" exist.
  - Reads Business Details custom field values and decodes credentials.
  - Calls ListAccounts to populate an "Akahu Account" dropdown field on Manager bank/cash accounts.
  - Reads Manager bank/cash accounts and returns linked accounts where the "Akahu Account" custom field is set and matches an Akahu account.
- packages/domain/src/Manager/AkahuCustomFields.ts currently models AkahuCustomFields and LinkedAccount.
- apps/website/src/main.tsx currently only renders "No credentials found", "No accounts found", or a simple linked-account list.

### Manager API support relevant to sync

The generated Manager API client includes endpoints and fields needed for this feature:

- Bank/cash accounts:
  - GET/api4/bank-or-cash-account-batch
  - BankOrCashAccount.canHavePendingTransactions
  - BankOrCashAccount.currency
- Receipts:
  - GET/api4/receipt-batch with BankOrCashAccount filter
  - POST/api4/receipt, PUT/api4/receipt, POST/api4/receipt-batch, PUT/api4/receipt-batch
  - Fields include date, reference, receivedIn, cleared, bankClearDate, description, lines, fdxTransactionId, and custom fields.
- Payments:
  - GET/api4/payment-batch with BankOrCashAccount filter
  - POST/api4/payment, PUT/api4/payment, POST/api4/payment-batch, PUT/api4/payment-batch
  - Fields include date, reference, paidFrom, cleared, bankClearDate, description, lines, fdxTransactionId, and custom fields.

### Task 1 Manager API compatibility findings

- `packages/manager-api/src/ManagerCompatibility.ts` now records the first-pass Manager receipt/payment write decisions behind named constants and payload builders.
- The generated Manager API client exposes `paidBy` on receipt creates and `payee` on payment creates as optional fields. The first-pass suspense import payload builders intentionally omit them.
- The generated Manager API client exposes receipt/payment amounts on lines, not on the top-level receipt/payment object. First-pass suspense imports use exactly one line containing `amount` and `lineDescription`, with no `account`, so Manager can leave the uncategorized amount in suspense.
- Manager's published guide for cleared/pending bank transactions verifies the field combinations: new bank receipts/payments default to cleared on the transaction date, `Cleared` = `On a later date` plus a date represents a later cleared date, and `Cleared` = `On a later date` without `bankClearDate` represents pending.
- The Manager clear-status numeric values are codified as `ManagerBankAccountClearStatusValue.onSameDate = 0` and `ManagerBankAccountClearStatusValue.onLaterDate = 1`, with settled builders using `onSameDate` and pending builders using `onLaterDate` without `bankClearDate`.
- Live `POST /api4/receipt` and `POST /api4/payment` validation was not possible in this workspace because no Manager business/API host was available. Current validation is generated-client shape plus Manager guide behaviour, covered by focused tests.
- Foreign-currency Manager bank/cash account write behaviour was not verified. `getManagerBankAccountCurrencyImportDecision` treats blank/null account currency as importable and returns a skip-with-warning decision for any non-empty currency value.
- Task 1 follow-up tightened the suspense receipt/payment payload builders to return local payload types with required `value` objects, so downstream sync code can use `payload.value` without non-null assertions. Builder amount input is now a normalized decimal string boundary instead of `number | string`; future Akahu amount normalization must happen before calling these Manager payload builders.
- Task 1 follow-up review replaced the public suspense receipt/payment builder pair with `buildManagerSuspenseImportDecision`. The helper now owns signed amount classification, payment absolute-amount conversion, zero-amount skipping, and importability skips before returning a receipt payload, payment payload, or explicit skip reason. Receipt/payment constructors remain private, and focused tests assert the local payloads remain assignable to the generated Manager POST endpoint wrappers.
- Task 1 follow-up review follow-up simplified the focused compatibility contract tests so each receipt/payment scenario has one expected payload literal. Generated endpoint drift coverage now stays source-local through the `ManagerSuspenseReceiptPayload extends ManagerPostReceipt` and `ManagerSuspensePaymentPayload extends ManagerPostPayment` production payload contracts, with tests focused on behavior and omitted `paidBy`/`payee`/`bankClearDate` invariants.
- Task 1 follow-up review follow-up audit narrowed the private suspense receipt/payment constructor input. After importability and zero-amount decisions, `buildManagerSuspenseImportDecision` now creates a local payload object containing only Manager write fields plus the normalized absolute amount, so decision-only fields no longer cross the private constructor boundary at runtime.
- Task 1 follow-up review follow-up audit follow-up collapsed the remaining private suspense payload construction layer. `buildManagerSuspenseImportDecision` now builds one shared local base value and suspense line after importability, zero-amount handling, and absolute-amount normalization, then branches only for the Manager account field (`receivedIn` for receipts, `paidFrom` for payments).

### Task 2 Akahu pagination findings

- `apps/server/src/Akahu.ts` now uses one shared cursor-pagination helper for Akahu account, settled transaction, and pending transaction reads. `ListAccounts` collects all account pages before returning, while transaction RPCs continue to stream items across every page.
- The transaction request shape was intentionally kept unchanged apart from forwarding `cursor`, preserving the then-existing 30-day Akahu transaction fetch behaviour/window. This is superseded for settled sync by the five-overlap stop condition, which may require ApiClient/RPC support for fetching older settled transactions.
- Focused server tests cover multi-page mocked Akahu account, settled transaction, and pending transaction responses, including the cursor order requested from each mock page.
- `packages/manager-api/src/ManagerBatchPagination.ts` now exposes receipt and payment batch read helpers for a selected Manager bank/cash account. The helpers call `GET/api4/receipt-batch` and `GET/api4/payment-batch` with `BankOrCashAccount`, `Skip`, and `PageSize`, then keep reading until Manager returns fewer items than the requested page size.
- Focused manager-api tests cover multi-page receipt and payment reads, assert the requested `Skip`/`PageSize` sequence, and include an existing duplicate `fdxTransactionId` beyond the first page so later sync de-duplication can rely on complete Manager read sets.
- Full `pnpm ready` validation was attempted for the Manager pagination helper change but currently stops during root lint because `apps/server/tests/Akahu.test.ts` cannot resolve `@app/domain/Akahu`; targeted `@app/manager-api` test, build, and check validation passes for this change.

## Requirements

### Setup-state UI

The app must render one setup state after loading.

1. Loading state
   - Show a non-blocking loading or skeleton state while Manager/Akahu setup information is being fetched.

2. Missing credentials state
   - Triggered when either "Akahu App Token" or "Akahu User Token" is absent or blank in Business Details.
   - Show a helpful message explaining that Akahu credentials are required and that Manager Business Details must be updated with the two fields.
   - Mention the exact field names: "Akahu App Token" and "Akahu User Token".
   - Do not show sync buttons.

3. Credentials present but invalid/expired state
   - Triggered when credential fields are present but Akahu ListAccounts fails with an authentication/authorization error.
   - Show an actionable error telling the user to check the Akahu credentials in Business Details.
   - Do not expose token values.
   - Do not show sync buttons.

4. Credentials present but Akahu has no accounts state
   - Triggered when Akahu credentials work but Akahu returns zero accessible accounts.
   - Show a message explaining that the Akahu user must connect bank accounts to the Akahu application before Manager accounts can be linked.
   - Do not show sync buttons.

5. Credentials present but no linked Manager accounts state
   - Triggered when Akahu accounts exist but no Manager bank/cash account has an "Akahu Account" custom field selection that matches an Akahu account.
   - Show a message saying to create or edit a Manager bank/cash account and choose the associated Akahu account in the "Akahu Account" custom field.
   - Do not show sync buttons.

6. Linked accounts ready state
   - Triggered when one or more linked accounts exist.
   - Show a list, table, or card list containing:
     - Manager bank/cash account name.
     - Akahu account name.
     - Whether the Manager account supports pending transactions.
     - Optional Akahu transaction refresh metadata if available.
   - Show a working per-account Sync button.
   - Show a working Sync all button.
   - Disable all sync buttons while any sync is running.

7. Stale or unmatched linked-account warning
   - If a Manager bank/cash account has an "Akahu Account" custom field value that no longer matches any current Akahu account, do not silently treat it as linked.
   - Show a non-blocking warning in setup state or ready state so the user can edit the Manager bank/cash account selection.

8. General error state
   - Show clear Manager/Akahu error information for failures that are not normal setup states.
   - Include a retry button that refreshes setup information.
   - Never display redacted credential values.

### Sync confirmation/progress modal

- Starting a single-account sync or sync-all action opens a modal dialog.
- Confirmation mode must show:
  - The accounts to be synced.
  - That Akahu settled transactions will be checked from newest to oldest until five already-imported overlaps are found, using already-available Akahu data.
  - Whether pending transactions will be included per account.
  - Buttons: Cancel and Start sync.
- Running mode must show:
  - Overall status: queued, running, completed, failed, or cancelled if cancellation is later implemented.
  - Per-account status.
  - Counts for settled fetched, pending fetched, receipts created, payments created, duplicates skipped, zero amounts skipped, unsupported skipped, pending created, pending updated, pending settled/replaced, stale pending detected, warnings, and errors.
  - A progress indicator based on known account count and transaction processing count.
- Completion mode must show final summary counts and allow closing.
- Failure mode must show error details and partial success summaries.
- The dialog must not close implicitly while running. Escape, overlay click, close button, and cancel must be disabled while running unless real cancellation is implemented.
- Prevent double-clicking Start sync from launching duplicate sync fibers/flows.
- Running-state copy should tell the user to keep the window open until the sync completes.

### Accessibility requirements

- The dialog must have an accessible title and description.
- Focus must be managed appropriately for the dialog.
- Buttons must have descriptive labels such as "Sync Operating Account".
- Progress and errors must be conveyed in text, not colour alone.

### Data model requirements

Add or update model types for:

- A setup-state discriminated union with states for loading, missing credentials, invalid credentials, no Akahu accounts, no linked accounts, ready, and error.
- Extended linked account metadata:
  - Manager bank/cash account key.
  - Manager account name.
  - Manager account currency.
  - Manager canHavePendingTransactions boolean.
  - Akahu account object.
- Stale/unmatched account metadata for Manager bank/cash accounts with obsolete Akahu selections.
- Sync request containing selected linked account keys or all selected accounts.
- Sync progress and summary counts.

Credentials must remain redacted as long as practical and must not be logged.

### Pagination requirements

Akahu and Manager pagination must be handled before sync is considered complete.

- Akahu account and transaction reads must follow cursor.next until no next cursor remains. Existing server/RPC code currently maps a single page; implementation must extend it to return all pages for ListAccounts, AccountTransactions, and AccountPendingTransactions where pagination is provided.
- Settled transaction sync must not rely on a fixed last-30-days window. It must be able to fetch enough settled Akahu history to satisfy the five-overlap stop condition or prove that Akahu returned no more settled transactions.
- Manager batch reads for existing receipts and payments must fetch all relevant items for the selected bank/cash account. Use Skip/PageSize paging or a verified Manager API mechanism that returns all filtered items.
- De-duplication must be based on the complete existing receipt/payment set for the account, not just the first page.
- Tests must cover duplicate entries beyond the first Manager page and Akahu transaction results beyond the first Akahu page if practical with the available test setup.

### Settled sync history boundary

For each selected linked account, settled Akahu transactions must be fetched and processed from newest to oldest until one of these stop conditions is reached:

- Five overlapping settled transactions have been found for that Manager account.
- Akahu indicates there are no more settled transactions available for that account.
- A fatal read/write error stops the account sync and is reported in the modal summary.

An overlapping settled transaction means an Akahu settled transaction whose ID already exists in Manager as `fdxTransactionId` on either a receipt or a payment for the same linked Manager bank/cash account.

The five-overlap boundary is only a sync-history stop signal. Overlapping transactions are still counted as `duplicatesSkipped`, and non-overlapping transactions encountered before the fifth overlap must still be imported or skipped according to the normal transaction rules. Transactions older than the fifth overlap in newest-to-oldest order must not be imported during that sync run.

Pending transaction sync is not bounded by the five-overlap rule. Pending transactions should continue to use the current pending endpoint result set for accounts that support pending transactions.

The implementation may satisfy this by extending the existing Akahu transaction RPC to request older settled history, by adding a dedicated sync-history RPC, or by another verified Akahu pagination/date-window mechanism. Do not expose a user-configurable date range as part of this requirement.

### Manager API compatibility requirements

Before implementing Manager writes, verify and document these Manager API details in code/tests or in implementation notes:

- Minimal valid POST/api4/receipt payload for an uncategorized/suspense receipt.
- Minimal valid POST/api4/payment payload for an uncategorized/suspense payment.
- Whether lines may be omitted/empty or must include a single line with amount and lineDescription and no account.
- Numeric BankAccountClearStatus values and required field combinations for:
  - settled/cleared on transaction date,
  - pending/uncleared/later date with no bankClearDate.
- Whether paidBy/payee can be omitted safely for uncategorized imported transactions.
- Foreign-currency behaviour. If not verified, foreign-currency accounts must be skipped with a warning rather than imported incorrectly.

### Transaction mapping

For each selected linked account:

1. Fetch settled Akahu transactions through ApiClient AccountTransactions using the account's Akahu account ID and current credentials, continuing from newest to oldest until five overlapping settled transactions are found or Akahu has no more settled transactions.
2. If the linked Manager bank/cash account has canHavePendingTransactions true, fetch pending Akahu transactions through ApiClient AccountPendingTransactions.
3. Positive Akahu amount creates a Manager receipt:
   - receivedIn = linked Manager bank/cash account key.
   - Amount = Akahu amount.
4. Negative Akahu amount creates a Manager payment:
   - paidFrom = linked Manager bank/cash account key.
   - Amount = absolute value of Akahu amount.
5. Zero amount is skipped and counted as zeroAmountSkipped unless a later compatibility check proves Manager accepts and needs zero-value entries.
6. Common field mapping:
   - date = Akahu transaction calendar date formatted for Manager, expected as YYYY-MM-DD.
   - settled transactions use the verified same-date clear status; do not set `bankClearDate` for same-date clearance.
   - description = Akahu merchant name when present, otherwise Akahu description.
   - reference = Akahu settled transaction ID or generated pending fingerprint.
   - fdxTransactionId = Akahu settled transaction ID for settled transactions; generated pending fingerprint for pending transactions.
   - lines = the minimal verified Manager-compatible uncategorized/suspense representation.
7. Settled transactions are marked cleared on the transaction date using verified Manager fields/status values.
8. Pending transactions are marked pending using the verified "on a later date" clear status with no `bankClearDate`.

### Decimal and date handling

- Do not use binary floating-point stringification for de-duplication fingerprints.
- Normalize amounts with stable decimal formatting. Prefer decimal/string values for Manager payloads when that avoids precision loss.
- Define and test rounding behaviour for amounts with more than two decimal places if encountered.
- Date conversion must be deterministic. Prefer preserving the calendar date represented by the Akahu date component rather than shifting it through the browser's local timezone.
- Add tests for dates near midnight UTC if practical.

### De-duplication rules

#### Settled transactions

- Use fdxTransactionId equal to the Akahu settled transaction ID as the primary de-duplication key.
- Before creating settled transactions for a Manager account:
  - Fetch all existing receipts for that bank/cash account.
  - Fetch all existing payments for that bank/cash account.
  - Build a lookup of existing fdxTransactionId values.
- If a matching settled transaction already exists as a receipt or payment, skip it and count duplicatesSkipped.
- Process settled transactions before pending transactions.
- If a settled transaction appears to correspond to an existing Akahu-created pending entry, update the pending Manager entry to settled rather than creating a duplicate when safe.

#### Pending transactions

- Pending Akahu transactions do not have stable IDs.
- Generate a versioned fingerprint and store it in fdxTransactionId and reference.
- Recommended fingerprint format: akahu-pending:v1:{akahuAccountId}:{yyyy-mm-dd}:{amount}:{normalizedDescription}.
- Normalize description by trimming, lowercasing, and collapsing whitespace. Additional punctuation removal should only be added with tests.
- Existing pending entries are identified by fdxTransactionId starting with akahu-pending:v1:.
- Exact fingerprint match is the primary pending de-duplication rule.
- If exact fingerprint matches an existing pending entry, update that entry with current pending date, description, amount, and pending clear status. Count pendingUpdated.
- If no exact match exists, create a new pending receipt/payment. Count pendingCreated and receipt/payment creation counts as appropriate.
- Do not delete prior pending entries that no longer match. Count stalePendingDetected and show a warning.

#### Pending-to-settled replacement

A settled transaction may update an existing pending Manager entry only if exactly one safe candidate exists:

- Existing entry is Akahu-created pending, identified by fdxTransactionId prefix akahu-pending:v1:.
- Same linked Manager bank/cash account.
- Same transaction kind: receipt for positive, payment for negative.
- Same absolute amount after stable decimal normalization.
- Normalized descriptions are equal, or a conservative deterministic similarity rule is implemented and tested.
- Dates are equal or within a small configured window such as plus/minus three days.

If exactly one candidate matches, update that Manager entry to settled fields and replace fdxTransactionId/reference with the settled Akahu transaction ID. Count pendingSettled.

If zero or multiple candidates match, do not update a pending entry. Create the settled entry unless it is otherwise a duplicate, and record a warning for ambiguous pending replacement.

When updating Akahu-created pending entries, preserve user-editable fields where safe. If a user has manually added categorised lines to an Akahu-created pending entry, the implementation should avoid overwriting those lines unless the Manager API compatibility check proves overwriting is required for correctness.

### Sync execution behaviour

- Only one sync may run at a time in the UI.
- Cross-tab or concurrent-user locking is out of scope. Because Manager does not guarantee a unique fdxTransactionId constraint, concurrent syncs from multiple tabs/users may still create duplicates. The UI must at least prevent duplicate syncs in the current tab.
- Prefer sequential account processing for the first implementation.
- Within each account:
  1. Fetch existing Manager receipts/payments with complete pagination.
  2. Fetch settled Akahu transactions with complete pagination/history until five overlapping settled transactions are found or Akahu has no more settled transactions.
  3. Fetch pending Akahu transactions only if supported by the Manager account.
  4. Process settled transactions before pending transactions.
  5. Create/update Manager receipts/payments.
  6. Record per-account summary.
- Use single-entry Manager POST/PUT endpoints initially for better error reporting unless batch endpoints are verified to provide sufficient per-item detail.
- Do not automatically retry non-idempotent Manager POSTs. Akahu reads may keep existing transient retry behaviour.
- If the implementation adds any retry around Manager writes, it must re-check de-duplication immediately before retrying.

### Summary count definitions

Per-account and overall summaries must distinguish:

- settledFetched: settled Akahu transactions fetched.
- pendingFetched: pending Akahu transactions fetched.
- receiptsCreated: Manager receipts newly created, including pending receipts if represented as receipts.
- paymentsCreated: Manager payments newly created, including pending payments if represented as payments.
- duplicatesSkipped: settled or pending entries skipped because a matching fdxTransactionId already existed and no update was needed.
- zeroAmountSkipped: zero-value Akahu transactions skipped.
- unsupportedSkipped: transactions skipped because the account/currency/status is unsupported.
- pendingCreated: pending Manager entries newly created.
- pendingUpdated: existing pending Manager entries updated from pending-to-pending.
- pendingSettled: existing pending Manager entries updated to settled Akahu transaction IDs.
- stalePendingDetected: prior Akahu-created pending entries not seen in current pending data and not matched to settled data.
- warnings: non-fatal issues.
- errors: fatal or per-entry failures.

### Tests and validation requirements

Add tests alongside the implementation tasks, not only at the end.

Pure helper tests should cover:

- Amount sign to receipt/payment mapping.
- Stable decimal formatting.
- Pending fingerprint generation and normalization.
- Manager date formatting, including near-midnight cases if practical.
- Settled duplicate lookup by fdxTransactionId.
- Pending create/update decisions.
- Pending-to-settled matching, including ambiguous candidates.
- Summary count accumulation.

Mocked service tests should cover:

- Missing credentials setup state.
- Invalid credentials setup state.
- No Akahu accounts setup state.
- No linked Manager accounts setup state.
- Stale Manager Akahu account selection warning.
- Single-account settled sync creating expected receipt/payment payloads.
- Re-running settled sync skipping duplicates.
- Settled sync stops after finding five overlapping transactions.
- Settled sync continues past fewer than five overlaps and imports non-overlapping older transactions.
- Existing duplicate beyond the first Manager page.
- Pending endpoint not called when canHavePendingTransactions is false.
- Pending create/update and repeat pending sync without duplicates.
- Safe pending-to-settled replacement.
- Double-start prevention in sync state if practical.

If the repository lacks a website test script/config, add one in the task that introduces tested website helper/service code, or move pure helper logic to a package where tests are already configured. Ensure repository validation actually runs the new tests.

## UX copy

### Missing credentials

Akahu credentials required

Add your Akahu App Token and Akahu User Token in Manager Business Details before syncing bank accounts. This extension reads those Business Details custom fields to connect to Akahu.

### Invalid credentials

Akahu credentials could not be used

Check the Akahu App Token and Akahu User Token in Manager Business Details, then try again.

### No Akahu accounts

No Akahu accounts available

Your Akahu credentials are valid, but no bank accounts are available to this application. Connect accounts in Akahu before linking Manager bank/cash accounts.

### No linked Manager accounts

No bank accounts linked

Create or edit a Manager bank/cash account and choose the matching Akahu account in the Akahu Account custom field. Linked accounts will appear here with sync options.

### Ready state

Linked bank accounts

Sync Akahu transactions into Manager receipts and payments. Settled transactions are checked from newest to oldest until five already-imported overlaps are found, and duplicates are skipped.

## Implementation plan

### Task 0: Restore and verify baseline validation (completed)

- Run the repository's normal validation command before feature work.
- Fix any existing build/type/test failures that would prevent later feature tasks from being independently validated.
- Ensure the website can resolve @app/manager-api/ManagerClient during TypeScript builds.
- Ensure Manager API client types for bank/cash accounts, receipts, and payments are available where sync code will use them.
- If repository validation includes tests, ensure the current test setup passes before adding feature tests.
- Validation: `pnpm ready` passes.

### Task 1: Manager API compatibility spike (completed)

- Verify minimal valid Manager receipt and payment payloads for uncategorized/suspense imports.
- Verify BankAccountClearStatus numeric values and field combinations for settled and pending entries.
- Verify whether paidBy/payee can be omitted.
- Verify foreign-currency account behaviour. If not verified, codify first-pass skip-with-warning behaviour.
- Record verified constants behind named functions/constants in code so feature code does not use unexplained numeric values.
- Add small tests for constants/payload builders where practical.
- Validation: `pnpm --filter @app/manager-api test`, `pnpm --filter @app/manager-api build`, `pnpm build`, and `pnpm ready` pass.

### Task 1 follow-up: Tighten Manager compatibility API shape (completed)

- Refactor `ManagerCompatibility.ts` so payload builders return precise local payload types with required `value` objects instead of the broad generated `ManagerPostReceipt`/`ManagerPostPayment` shapes whose `value` field is optional. The current return type erases the builder invariant and already forces `payload.value!` in tests; downstream sync code should not need non-null assertions for a payload this module just constructed.
- Make the amount boundary stricter before sync code depends on it. Prefer accepting a normalized decimal string/line amount from the future decimal helper rather than `number | string`, or otherwise make the conversion owner explicit. This avoids baking binary-floating-point-friendly inputs into the canonical Manager write helper.
- Delete the exported `managerSuspenseReceiptValueCanOmitPaidBy` and `managerSuspensePaymentValueCanOmitPayee` helpers. They are thin wrappers around `value.paidBy === undefined` / `value.payee === undefined`, add public API surface without clarifying production code, and can be replaced by direct payload-shape assertions in tests.
- Consider a code-judo consolidation that exposes one canonical Manager suspense import decision/builder taking the signed Akahu amount, normalized amount string, clearance, and account key, then returns a discriminated receipt/payment payload or an explicit skip decision. This would keep positive/negative receipt/payment branching, absolute-value handling, and zero/unsupported decisions out of later orchestration code instead of scattering ad-hoc conditionals across the sync service.
- Move the compatibility tests out of `packages/manager-api/tests/index.test.ts` into a focused `ManagerCompatibility.test.ts`, leaving `index.test.ts` as a barrel/package-name smoke test. The current test file is already becoming a grab bag and will grow harder to scan as more compatibility cases are added.
- Validation: `pnpm --filter @app/manager-api test`, `pnpm --filter @app/manager-api build`, and `pnpm ready` pass.

### Task 2: Pagination foundations (completed)

- Extend server/RPC Akahu reads to fetch all pages for accounts and settled/pending account transactions when cursor.next is present. (completed)
- Add Manager batch pagination helpers for receipts/payments filtered by bank/cash account and for any other batch reads needed by setup/sync. (completed for receipt/payment sync reads)
- Add tests or mocked coverage for multi-page Akahu and Manager responses. (completed)
- Validation: `pnpm --filter server test`, `pnpm --filter server build`, and `pnpm --filter @app/domain build` pass for the Akahu pagination portion. `pnpm --filter @app/manager-api test` covers the Manager pagination helper portion.

### Task 2 follow-up: Test Akahu pagination at the service/RPC boundary

- Replace or supplement the current helper-only Akahu pagination tests with tests that exercise the actual `Akahu` service and/or RPC handlers. The current tests validate the shared pagination helper but would not catch production wiring regressions where `accounts.list`, `transactions.list`, or `transactions.pending` stop forwarding cursors correctly.
- Assert the concrete Akahu request/query shape for all three paths: account pages request `cursor`, settled transaction pages request `cursor` and any required older-history/date-window parameters for the five-overlap stop condition, and pending transaction pages request both `amount_as_number=true` and `cursor` on every page.
- Verify RPC consumption returns all `ListAccounts`, `AccountTransactions`, and `AccountPendingTransactions` items across multiple pages, not only that the exported helper can flatten mock strings.
- After boundary coverage exists, make `paginatedAkahuItems` private to `apps/server/src/Akahu.ts` unless another production module has a real need for it. Avoid exporting implementation details solely to test them.
- Validation: `pnpm --filter server test`, `pnpm --filter server build`, `pnpm --filter @app/domain build`, and `pnpm ready` pass.

### Task 3: Setup-state flow, atom, and minimal setup UI

- Add extended LinkedAccount metadata including canHavePendingTransactions and currency.
- Add setup-state discriminated union.
- Replace or wrap getAkahuFields with a setup-state flow that does not throw for normal missing credentials.
- Preserve custom-field creation behaviour.
- Only call Akahu ListAccounts and create/update the Akahu Account dropdown when credentials are present.
- Distinguish missing credentials, invalid credentials, no Akahu accounts, no linked Manager accounts, ready, stale selections, and general errors.
- Update atoms and consuming UI in the same task so typechecking never sees mismatched return types.
- Render loading, all setup messages, ready linked-account list without sync controls, stale warnings, and retryable errors.
- Validation: website/domain build and related tests pass.

### Task 4: Pure transaction sync helpers with tests

- Add a pure helper module independent of React, Atom, Manager client, and ApiClient.
- Include date formatting, decimal normalization, amount classification, pending fingerprint generation, payload construction, fdxTransactionId lookup, settled duplicate decisions, pending create/update decisions, pending-to-settled matching, and summary accumulation.
- Add unit tests alongside the helpers.
- Validation: helper tests and build/typecheck pass.

### Task 5: Hidden settled-transaction sync service with mocked tests

- Add ManagerSyncFlows or extend ManagerFlows with a sync function that is not wired to visible UI yet.
- For selected linked accounts, fetch complete existing Manager receipt/payment sets, fetch settled Akahu transactions, skip duplicates by fdxTransactionId, create Manager receipts/payments for positive/negative settled transactions, skip zero amounts, and return summaries.
- Avoid automatic retries around Manager POSTs.
- Add mocked tests for settled receipt/payment payloads, duplicate skipping, zero skipping, and summary counts.
- Validation: website build/typecheck and mocked settled-sync tests pass.

### Task 6: Pending-transaction sync service extension with mocked tests

- Extend the hidden sync service to fetch pending Akahu transactions only when canHavePendingTransactions is true.
- Process settled transactions before pending transactions.
- Use fingerprint matching for pending create/update.
- Implement safe pending-to-settled replacement when exactly one safe candidate exists.
- Leave unsafe/ambiguous opposite-kind or multi-candidate cases unchanged and report warnings.
- Preserve user-editable fields when updating Akahu-created pending entries where safe.
- Add mocked tests for unsupported pending accounts, pending create/update, repeat pending sync without duplicates, stale pending detection, and safe pending-to-settled replacement.
- Validation: website build/typecheck and mocked pending-sync tests pass.

### Task 7: Sync atoms, linked-account sync UI, and confirmation/progress modal

- Add sync atom/mutation state that invokes the completed sync service and prevents concurrent sync in the current tab.
- Refactor UI into smaller components as needed.
- Add local shadcn-style primitives needed for cards, alerts, badges, dialog, and progress while matching existing component style.
- In ready state, show working per-account Sync and Sync all buttons.
- Implement confirmation, running/progress, completion, and failure modal states.
- Disable closing and duplicate starts while running.
- Show all summary counts and warnings/errors without exposing credentials.
- Refresh setup state after completion only if useful and safe.
- Validation: website build/typecheck, helper/service tests, and any available UI/state tests pass.

## Open questions

None. Decisions made for this specification:

- Manager uncategorized/suspense receipts/payments are the default target for uncategorized Akahu transactions.
- Pending Akahu transactions should use Manager's creation and clearance date/status support.
- fdxTransactionId stores settled Akahu transaction IDs and generated pending fingerprints.
- Settled transaction sync continues until five already-imported overlaps are found or Akahu has no more settled transactions; pending sync remains limited to the current pending endpoint result set.
- Pending entries are matched by generated fingerprint rather than deleted/recreated.
- Positive Akahu amounts map to receipts; negative Akahu amounts map to payments using absolute amount.
- Akahu refresh is not triggered in the first implementation.
- Foreign-currency accounts are skipped with a warning unless compatibility is explicitly verified before implementation.
