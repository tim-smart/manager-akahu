# Manager Akahu Start Date Custom Field Specification

## Overview

Add a Manager custom date field named "Akahu Start Date" to Manager bank/cash accounts so each linked bank account can choose the earliest Akahu transaction date eligible for sync.

The existing Manager Akahu sync flow already creates and reads custom fields for Akahu credentials and account linking, discovers linked Manager bank/cash accounts, and syncs Akahu settled and pending transactions into Manager receipts/payments. This specification adds a per-account inclusive start-date boundary without replacing the current full-history/five-overlap behavior for accounts where no start date is set.

## Original Request

We need to add a date custom field to bank accounts called "Akahu Start Date", for choosing the earliest date to pull transactions from.

We can use a Manager Custom Date field to do this.

## Goals

- Ensure a Manager Date custom field named exactly "Akahu Start Date" exists on bank/cash accounts.
- Read each linked Manager bank/cash account's "Akahu Start Date" custom date value during setup.
- Expose the start-date state in linked-account metadata and account UI.
- Use a set start date as an inclusive lower bound for settled Akahu transactions.
- Use the same set start date as an inclusive lower bound for pending Akahu transactions.
- Preserve existing full-history/five-overlap sync behavior when the field is unset.
- Avoid importing, updating, matching, or warning about transactions that are outside the configured start-date scope.
- Keep existing sync summary count keys; do not add a new before-start-date skipped count.

## Non-Goals

- Do not add a global sync date range or one-off sync date picker.
- Do not add an end date.
- Do not trigger Akahu refresh as part of this work.
- Do not change Manager receipt/payment mapping, suspense import behavior, duplicate keys, or pending fingerprints except where needed for start-date eligibility.
- Do not change the foreign-currency importability policy; start-date filtering may only change which fetched rows are counted before the existing unsupported-account skip summary is produced.
- Do not add cross-tab/concurrent-user locking.

## Research Findings

- `.specs/manager-akahu-bank-account-sync.md` is the existing broader Manager Akahu sync specification. This request is related but is now tracked in this dedicated specification.
- `apps/website/src/Manager/Flows.ts` currently creates missing Akahu credential text fields, ensures the "Akahu Account" dropdown text custom field, and reads linked Manager bank/cash accounts.
- The existing "Akahu Account" field is created on bank/cash accounts with placement GUID `1408c33b-6284-4f50-9e31-48cbea21f3cf`.
- `packages/domain/src/Manager/AkahuCustomFields.ts` currently defines `LinkedAccount` with Manager account key/name/currency/pending support and the linked Akahu account. It does not carry a start date yet.
- The generated Manager client exposes `CustomFields.dates?: Record<string, unknown>` on records, which is where Manager custom date field values should be read.
- The generated Manager client exposes date custom-field APIs: `GET/api4/date-custom-field-batch`, `POST/api4/date-custom-field`, `PUT/api4/date-custom-field`, and matching batch endpoints.
- `apps/website/src/Manager/SyncFlows.ts` currently fetches settled transactions, stops after five unique existing Manager overlaps, then processes pending transactions when the Manager account supports pending transactions.
- `apps/server/src/Akahu.ts` currently sends settled Akahu transaction requests as cursor-only queries. A comment records that Akahu returns full app-accessible settled history when `start`/`end` are omitted.
- `packages/manager-api/src/ManagerAkahuTransactionSync.ts` owns pure sync policies for duplicate detection, pending fingerprints, pending-to-settled matching, stale pending detection, and summary counts.
- Current stale pending detection reports existing Akahu-created pending Manager entries absent from the current pending endpoint result set unless they were processed/replaced in the same run.
- Effect `DateTime.make` accepts JavaScript-parsed date strings, so exact calendar-date validation needs both an input-shape guard and a `DateTime.formatIsoDate` round-trip check to reject rolled-over values such as `2024-02-30`.
- Effect Schema branding works best here as a DateTime-backed string refinement followed by `Schema.brand`; `Schema.decodeTo` composes through the target encoded type and is not the right fit for adding the brand while validating the same string representation.
- Task 2 found that existing server tests already asserted settled no-start requests remain cursor-only and pending requests remain `amount_as_number` plus cursor only; the task added coverage for settled start forwarding across cursor pages.
- Task 3 found that focused manager-api Vitest runs resolve `@app/domain/*` through the workspace package export, so `@app/domain` must be built first when `packages/domain/dist` is absent.
- Task 4 setup work found the generated Manager Date custom-field endpoints use the same item shape and bank/cash placement GUID as text custom fields, so setup can reuse placement value `1408c33b-6284-4f50-9e31-48cbea21f3cf` for `Akahu Start Date`.
- Task 4 review follow-up found Manager date custom-field setup must not use a post-mutation exact-name lookup because duplicate `Akahu Start Date` fields can exist. Repair selection is now deterministic: reusable active bank/cash fields win first, otherwise active exact-name repair candidates with existing placements win before inactive or unplaced candidates, with key order as the final tiebreaker.
- Task 4 malformed sync handling found `ManagerSyncFlows` evaluated foreign-currency importability before any start-date state check. Malformed `Akahu Start Date` handling now runs first so malformed accounts produce only the configuration error and no sync reads or writes.
- Task 4 valid start-date enforcement found the current branch's `LinkedAccount` still stores `akahuStartDate` as `Option<DateTime.Utc>` only, so malformed Manager custom-field values are indistinguishable from unset values despite earlier malformed-state notes in this spec. Valid start-date enforcement was implemented against `Option.some` linked-account snapshots, and this discrepancy remains a follow-up issue for malformed-account behavior.
- Task 4 valid start-date enforcement also found `ManagerSyncFlows` had been passing `start` through pending transaction request objects even though the pending RPC payload has no `start` field. Pending reads now stay cursor/current-state only; start-date filtering happens after rows are read.

## Decisions

- The field name is exactly "Akahu Start Date".
- The field type is Manager Date custom field, not text or dropdown.
- The field applies to Manager bank/cash accounts.
- If "Akahu Start Date" is unset, blank, null, or absent for an account, sync keeps existing behavior.
- If "Akahu Start Date" is set, transactions on that date are included; transactions before that date are out of scope.
- The start date applies to both settled and pending Akahu transactions.
- Transactions ignored solely because they are before the start date do not get a new summary count and are not counted as duplicates, unsupported, zero amount, or fetched.
- Existing Akahu-created Manager pending entries before the configured start date are ignored by stale-pending detection.
- Malformed non-empty Manager start-date values should prevent writes for that account and produce a clear per-account sync error.
- Sync uses the linked-account start-date metadata snapshot loaded by setup. If the user changes the Manager field after the setup state has loaded, they must refresh/retry setup before starting sync for the new value to apply.
- A malformed start date takes precedence over foreign-currency skip handling: the account reports one configuration error and performs no Manager receipt/payment reads, Akahu reads, or Manager writes.
- All date parsing, validation, comparison, formatting, and date arithmetic for this feature must use Effect's `DateTime` module. Do not use JavaScript `Date`, numeric epoch arithmetic, locale parsing, or ad-hoc calendar manipulation.

## Requirements

### Custom Field Setup

- The setup flow must read Manager Date custom fields with `GET/api4/date-custom-field-batch`.
- The setup flow must look for a date custom field with `item.name === "Akahu Start Date"` before creating a new field.
- A reusable existing field is a Date custom field with the exact name that is active and has bank/cash account placement.
- If an exact-name Date custom field exists but is inactive or lacks bank/cash account placement, setup must update that field through `PUT/api4/date-custom-field` to make it active and include bank/cash account placement while preserving other existing placements where practical.
- If no matching date custom field exists, setup must create one through `POST/api4/date-custom-field`.
- The created field must use bank/cash account placement, expected to be `1408c33b-6284-4f50-9e31-48cbea21f3cf` unless implementation research proves the date custom-field endpoint needs a different representation.
- Creating the new date field must not interfere with the existing credential text fields or "Akahu Account" dropdown field.
- The setup flow must refresh date custom-field resources after creation before reading account values.
- The implementation must avoid creating duplicate "Akahu Start Date" fields on repeated setup loads.

### Linked Account Metadata

- `LinkedAccount` must include an Akahu start-date state.
- The start-date state must distinguish valid, unset, and malformed values.
- Valid dates must be exact `YYYY-MM-DD` calendar dates with valid calendar components, parsed and validated through Effect `DateTime`.
- Unset values include missing key, null, empty string, or whitespace-only string from `customFields2.dates`.
- Malformed non-empty values must carry enough information to show or report the bad value safely.
- Linked-account discovery must read the date value from `customFields2.dates[akahuStartDateFieldKey]` for each Manager bank/cash account.
- Sync must use this linked-account metadata snapshot rather than re-reading the custom field during sync.
- Stale Akahu account selections do not need start-date sync behavior, but setup UI may display their configured start date if it is cheap and useful.

### Setup And Ready UI

- Ready linked-account UI must show the Akahu start-date state for each linked account.
- Valid start date copy should make clear that sync imports transactions on or after that date.
- Unset start date copy should make clear that sync uses existing full-history/five-overlap behavior.
- Malformed start date copy should tell the user to fix the Manager "Akahu Start Date" value before syncing that account.
- Sync buttons may remain visible for malformed accounts, but the sync service must fail those accounts safely with no writes. If the UI disables malformed-account buttons, the sync-all path must still handle malformed accounts safely.

### Akahu Settled Request Boundary

- `AccountTransactions` must accept an optional start date for settled transaction reads.
- When no start date is supplied, server requests must preserve the existing cursor-only query shape.
- When a start date is supplied, server requests should pass it to Akahu as the inclusive `start` query parameter on the first and later cursor pages.
- Do not add an `end` query parameter.
- Cursor pagination must continue to work for start-bounded settled reads.
- Pending transaction requests must not send `start`; pending filtering is handled by sync logic after reading the current pending endpoint result set.

### Sync Eligibility

- Start-date parsing and comparison must use deterministic Effect `DateTime` values, not browser-local `Date` conversion.
- The canonical Akahu transaction calendar date for this feature is the same date currently used for Manager receipt/payment payloads. In the current domain model this is the `DateTime.formatIsoDate` value of the domain-decoded Akahu transaction date in the existing Akahu date zone, not the browser local timezone.
- Manager `YYYY-MM-DD` custom date values should be parsed into Effect `DateTime` values at a stable calendar-date boundary before comparison.
- Formatting dates back to Manager or Akahu query strings must use Effect `DateTime` formatting helpers such as `DateTime.formatIsoDate`.
- A transaction with calendar date equal to the configured start date is eligible.
- A transaction with calendar date after the configured start date is eligible.
- A transaction with calendar date before the configured start date is ineligible.
- When no start date is configured, every transaction remains eligible under existing rules.
- If Akahu returns settled transactions before the requested start date, the service must still stop before counting, classifying, matching, or writing those rows.

### Settled Sync Behavior

- For valid start-date accounts, settled sync must pass the start date to the settled Akahu read boundary.
- Settled sync must stop at whichever condition is reached first: five unique existing Manager overlaps, no more Akahu settled transactions, fatal account error, or transaction older than the start date.
- Stopping at the first older-than-start settled row is valid only while the Akahu settled stream is verified to be newest-to-oldest. If that ordering is not guaranteed by the boundary tests or Akahu documentation, the service must filter older rows without using them as a stream stop signal.
- Settled rows before the start date must not increment `settledFetched`.
- Settled rows before the start date must not be considered duplicates, zero amounts, unsupported, pending-to-settled candidates, or writes.
- Existing behavior must be unchanged for accounts with no start date.
- Pending-to-settled matching must ignore existing Akahu-created Manager pending entries dated before the configured start date, so an eligible settled transaction cannot update an out-of-scope pre-start pending entry.

### Pending Sync Behavior

- Pending sync must apply the same inclusive start-date eligibility check.
- Pending rows before the start date must be ignored before `pendingFetched` increments.
- Pending rows before the start date must not generate pending fingerprints.
- Pending rows before the start date must not create or update Manager receipts/payments.
- Pending rows before the start date must not participate in exact-fingerprint duplicate decisions.
- Existing behavior must be unchanged for accounts with no start date.

### Stale Pending Behavior

- Stale pending detection must accept the optional start date.
- Existing Akahu-created Manager pending entries dated before the start date must be ignored by stale-pending detection.
- Existing Akahu-created Manager pending entries on or after the start date remain subject to existing stale-pending rules.
- Existing behavior must be unchanged for accounts with no start date.
- If an existing Manager pending entry has an invalid Manager date, stale detection should handle it conservatively without throwing a defect; tests must document the chosen behavior.

### DateTime Requirements

- Use Effect's `DateTime` module for every parse, format, comparison, and manipulation of Akahu transaction dates, Manager custom date values, Manager receipt/payment dates, and Akahu `start` query dates introduced or touched by this feature.
- Do not use `new Date`, `Date.parse`, `Date.now`, local timezone conversion, epoch-millisecond arithmetic, or lexicographic string comparison for feature logic.
- Exact `YYYY-MM-DD` shape checks may exist only as input-shape guards before DateTime parsing; they must not replace DateTime validation of real calendar components.
- Date comparisons must compare DateTime-derived calendar-date values. If a helper returns an ordering decision, tests must prove equality is inclusive and older/newer decisions are stable across near-midnight timezone cases.
- Existing code paths that already use `DateTime.formatIsoDate` for Manager transaction dates should remain on that boundary rather than introducing a second date-formatting mechanism.

### Foreign-Currency Accounts

- Start-date filtering applies before unsupported foreign-currency summary counting.
- For unsupported foreign-currency accounts with a valid start date, fetched Akahu rows before the start date must not increment `settledFetched`, `pendingFetched`, or `unsupportedSkipped`.
- For unsupported foreign-currency accounts with no start date, existing unsupported-count behavior remains unchanged.
- For unsupported foreign-currency accounts with a malformed start date, malformed-date handling wins and no Akahu reads are performed.

### Malformed Start-Date Handling

- Malformed non-empty "Akahu Start Date" values must be detected from setup-linked account metadata before account sync begins.
- A malformed account must return a per-account summary with `errors` incremented once and a clear error message naming "Akahu Start Date".
- A malformed account must not perform Manager receipt/payment sync reads.
- A malformed account must not perform Akahu settled or pending reads.
- A malformed account must not perform Manager receipt/payment writes.

### Summary Counts

- Do not add a new count key for start-date-skipped rows.
- Do not increment `unsupportedSkipped`, `duplicatesSkipped`, or `zeroAmountSkipped` for rows ignored only because they are before "Akahu Start Date".
- `settledFetched` and `pendingFetched` should count eligible rows that enter normal processing, not raw rows discarded solely by start-date filtering.
- Existing summary count names and UI rendering should remain compatible.

## Implementation Plan

### Task 1: Add Shared Calendar-Date And Start-Date Types (Completed)

- Add or reuse one shared domain calendar-date schema/parser backed by Effect `DateTime` that validates exact `YYYY-MM-DD` dates and real calendar components.
- Add a start-date state type in `packages/domain/src/Manager/AkahuCustomFields.ts` that can represent valid, unset, and malformed values without yet exposing it through `LinkedAccount` UI.
- Add tests proving the parser does not rely on JavaScript `Date` or lexicographic string comparison for validity.
- Add focused domain tests or typetests for valid dates, invalid calendar components, unset handling helpers, and malformed value preservation.
- Keep this task non-user-visible so no account can configure a start date before sync enforcement exists.
- Validation: `pnpm lint-fix`, `pnpm --filter @app/domain build`, and any focused domain runtime/type tests added in this task.
- Completed in `packages/domain/src/shared.ts`, `packages/domain/src/Manager/AkahuCustomFields.ts`, and `packages/domain/tests/AkahuCustomFields.test.ts`.

### Task 2: Add Settled Start Query Boundary (Completed)

- Extend the domain/RPC request shape for `AccountTransactions` with optional start date.
- Update `packages/domain/src/Akahu.ts` settled transaction endpoint query schema with optional `start`.
- Update `apps/server/src/rpc.ts` to forward optional `start` from the RPC request into the Akahu service.
- Update `apps/server/src/Akahu.ts` to include `start` only when supplied, while preserving cursor pagination.
- Keep pending request query shape unchanged.
- Add server/RPC tests for settled requests with no start, settled requests with start across cursor pages, and pending requests without start.
- Validation: `pnpm lint-fix`, `pnpm test "apps/server/tests/Akahu.test.ts"`, `pnpm --filter @app/domain build`, and `pnpm --filter server build`.
- Completed in `packages/domain/src/rpc.ts`, `packages/domain/src/Akahu.ts`, `apps/server/src/rpc.ts`, `apps/server/src/Akahu.ts`, and `apps/server/tests/Akahu.test.ts`.
- Validation note: `pnpm lint-fix` is not defined in this workspace; `pnpm exec vp fmt` and `pnpm exec vp lint` were run instead, with `vp lint` passing after building internal package outputs.

### Task 3: Add Pure Start-Date Policies (Completed)

- Add a pure eligibility helper in `packages/manager-api/src/ManagerAkahuTransactionSync.ts` for optional start-date comparison.
- Use Effect `DateTime` parsing/formatting/comparison for eligibility decisions; do not use calendar-date string comparison as the decision mechanism.
- Extend stale-pending detection to ignore pre-start existing pending entries.
- Extend pending-to-settled matching to ignore pre-start existing pending candidates.
- Add pure tests for inclusive equality, newer eligibility, older ineligibility, no-start pass-through, timezone-stable calendar handling, DateTime-backed malformed date rejection, and pre-start stale-pending filtering.
- Validation: `pnpm lint-fix`, `pnpm test "packages/manager-api/tests/ManagerAkahuTransactionSync.test.ts"`, `pnpm --filter @app/domain build`, and `pnpm --filter @app/manager-api build`.
- Completed in `packages/manager-api/src/ManagerAkahuTransactionSync.ts` and `packages/manager-api/tests/ManagerAkahuTransactionSync.test.ts`.
- Validation note: `pnpm lint-fix` is not defined in this workspace; `pnpm exec vp fmt` and `pnpm exec vp lint` were run instead. `pnpm --filter @app/domain build` was run before the focused manager-api Vitest command because the test imports domain package exports.

### Task 4: Add Custom Field Setup, Linked Metadata, UI, And Sync Enforcement

- Extend `LinkedAccount` with the start-date state from Task 1 and update all source/test fixtures that construct `LinkedAccount`. (Completed for setup/metadata scope.)
- Add Manager Date custom-field lookup/update/creation to `apps/website/src/Manager/Flows.ts` using `GET/api4/date-custom-field-batch`, `POST/api4/date-custom-field`, and `PUT/api4/date-custom-field` for inactive or wrong-placement existing fields. (Completed for setup/metadata scope.)
- Update account selection collection to read `customFields2.dates` by the new field key. (Completed for setup/metadata scope.)
- Update setup/ready UI to show start-date state.
- Update `ManagerSyncFlows` to pass valid linked-account start dates to settled transaction reads. (Completed for valid start-date enforcement scope.)
- Return a per-account error with no Manager receipt/payment reads, Akahu reads, or Manager writes when the linked account has a malformed start date. (Completed for malformed-account scope.)
- Apply the pure eligibility helper before settled count/classification/duplicate/matching/write logic. (Completed for valid start-date enforcement scope.)
- Apply the pure eligibility helper before pending count/fingerprint/duplicate/update/create logic. (Completed for valid start-date enforcement scope.)
- Pass the optional start date into stale-pending detection. (Completed for valid start-date enforcement scope.)
- Apply start-date filtering to unsupported foreign-currency account summary counting before `unsupportedSkipped` increments. (Completed for valid start-date enforcement scope.)
- Add mocked sync-flow tests for settled on-date/newer imports, settled older rows ignored, five-overlap stop still winning when reached first, malformed date safe failure, pending on-date/newer processing, pending older rows ignored, and pre-start pending Manager entries ignored for stale warnings. (Completed for malformed date safe-failure coverage and valid start-date enforcement coverage for settled on-date/newer imports, settled older rows ignored, pending on-date/newer processing, pending older rows ignored, and pre-start pending Manager entries ignored for stale warnings.)
- Add focused setup tests for field creation/reuse/update and valid/unset/malformed account date values. (Completed for setup/metadata scope.)
- Include fixture updates and focused coverage for `apps/website/tests/ManagerAkahuSyncController.test.ts` if `LinkedAccount` construction changes affect controller tests. (Completed for setup/metadata scope.)
- Validation: `pnpm lint-fix`, `pnpm test "apps/website/tests/ManagerFlows.test.ts"`, `pnpm test "apps/website/tests/ManagerSyncFlows.test.ts"`, `pnpm test:website-sync-controller`, `pnpm --filter @app/domain build`, `pnpm --filter @app/manager-api build`, and `pnpm --filter website build`.
- Validation note for setup/metadata scope: `pnpm lint-fix` is not defined in this workspace; `pnpm exec vp fmt` and `pnpm exec vp lint` were run instead. Also ran `pnpm test "apps/website/tests/ManagerFlows.test.ts"`, `pnpm test "apps/website/tests/ManagerSyncFlows.test.ts"`, `pnpm test:website-sync-controller`, `pnpm --filter @app/domain build`, `pnpm --filter @app/manager-api build`, and `pnpm --filter website build`.
- Validation note for malformed-account sync scope: `pnpm exec vp fmt`, `pnpm test "apps/website/tests/ManagerSyncFlows.test.ts"`, `pnpm --filter @app/domain build`, `pnpm --filter @app/manager-api build`, `pnpm --filter website build`, and `pnpm exec vp lint` passed. The website build emitted Vite's existing large-chunk warning.
- Validation note for valid start-date enforcement scope: `pnpm test "apps/website/tests/ManagerSyncFlows.test.ts"`, `pnpm exec vp fmt`, `pnpm --filter @app/domain build`, `pnpm --filter @app/manager-api build`, `pnpm --filter website build`, and `pnpm exec vp lint` passed. The website build emitted Vite's existing large-chunk warning.
- Remaining Task 4 work after these setup/metadata, malformed-account sync, and valid start-date enforcement changes: setup/ready UI display and any broader sync-flow regression coverage not yet added, such as five-overlap stop ordering.

### Task 5: Surface Start Date In Sync Confirmation

- Update sync confirmation copy/view model to show each selected account's start-date behavior.
- Keep completion summaries on existing count keys.
- Preserve credential redaction, duplicate-start prevention, and running-state close guards.
- Add focused controller or pure UI-state tests for the start-date copy where practical. If the current test harness cannot render DOM dialog content, document that limitation and test the pure boundary.
- Validation: `pnpm lint-fix`, `pnpm test:website-sync-controller`, `pnpm --filter website build`, then attempt `pnpm ready` and document any pre-existing failures.

## Open Questions

None. The interview resolved all behavior needed for implementation.
