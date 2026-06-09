# Manager Akahu Transfer Rules Specification

## Overview

Add an `Akahu Transfer Rules` Manager custom field alongside the existing `Akahu Account` field on Manager bank/cash accounts. The field allows users to mark Akahu transactions whose description contains a configured keyword as Manager inter-account transfers instead of ordinary receipts or payments.

The sync flow must load and validate these rules during setup/sync, match rules against settled and pending Akahu transactions, create Manager inter-account transfers for matching transactions, and safely merge mirrored Akahu transactions from both sides into a single Manager transfer.

## User Decisions

- Transfer direction is inferred from the signed Akahu transaction amount.
- The rule target is the other Manager bank/cash account in the transfer.
- Matching is a case-insensitive substring match against the Akahu transaction `description` only.
- Rules apply to both settled and pending Akahu transactions.
- If both Akahu accounts are synced and both sides match transfer rules, the implementation must merge them into one Manager inter-account transfer instead of creating two transfers.
- Rules are entered one per line in a multiline Manager text custom field.
- The Manager custom field should use field `type: 1` for multiline text.
- Rule format is `keyword,destination account key`.
- Destination accounts are resolved by Manager bank/cash account key, not by account name, so rules survive account renames.

## Current Implementation Findings

- `apps/website/src/Manager/Flows.ts` ensures the credential custom fields and the `Akahu Account` dropdown field, then reads Manager bank/cash accounts and builds linked account setup state.
- `collectManagerAkahuAccountSelections` reads the selected `Akahu Account` field and the multiline `Akahu Transfer Rules` field from `customFields2.strings`, validates rule destinations against the same Manager bank/cash account batch, and attaches non-blocking warnings to linked accounts.
- `packages/domain/src/Manager/AkahuCustomFields.ts` models `LinkedAccount`, stale Akahu account selections, setup-state variants, the pure `AkahuTransferRule` parser/matcher, and setup-scoped linked-account transfer rule metadata.
- `apps/website/src/Manager/SyncFlows.ts` orchestrates sync account-by-account. For each account it reads complete Manager receipts/payments, processes settled Akahu transactions first, then pending transactions when supported.
- `packages/manager-api/src/ManagerAkahuTransactionSync.ts` contains pure sync helpers for amount normalization, pending fingerprints, duplicate decisions, pending-to-settled matching, stale pending detection, and summary counts.
- `packages/manager-api/src/ManagerBatchPagination.ts` reads complete receipt/payment batches for one bank/cash account and indexes existing `fdxTransactionId` values.
- Existing receipt/payment de-duplication only indexes `Receipt.fdxTransactionId` and `Payment.fdxTransactionId`.
- The generated Manager client exposes inter-account transfer APIs and payload fields:
  - `POST/api4/inter-account-transfer`
  - `PUT/api4/inter-account-transfer`
  - `GET/api4/inter-account-transfer-batch`
  - Transfer fields include `paidFrom`, `receivedIn`, `creditAmount`, `debitAmount`, `creditClearStatus`, `debitClearStatus`, `creditClearDate`, `debitClearDate`, `fdxCreditTransactionId`, and `fdxDebitTransactionId`.
- Existing Manager receipt/payment compatibility helpers already define clearance status constants: `onSameDate = 0` and `onLaterDate = 1`.
- Existing frontend ready-state UI shows linked accounts and sync controls in `LinkedAccountsSyncSection.tsx`.

## Goals

- Ensure the `Akahu Transfer Rules` custom field exists on Manager bank/cash accounts.
- Parse transfer rules from each linked Manager bank/cash account.
- Validate rule syntax and destination bank/cash account keys.
- Surface invalid rule warnings without blocking setup or unrelated account sync.
- Match transfer rules against Akahu settled and pending transaction descriptions.
- Create Manager inter-account transfers for matching transactions instead of receipts/payments.
- Preserve existing receipt/payment sync behavior for non-matching transactions.
- De-duplicate transfer imports using Manager transfer `fdxCreditTransactionId` and `fdxDebitTransactionId`.
- Merge mirrored transfer transactions from both synced accounts into one Manager inter-account transfer when safe.
- Include transfer activity in sync summaries and UI.
- Cover parsing, transfer payloads, de-duplication, merging, settled sync, pending sync, and UI/controller behavior with focused tests.

## Non-Goals

- Do not add a separate rule-management UI outside Manager custom fields.
- Do not add category rules or receipt/payment categorization.
- Do not support regex matching in the first implementation.
- Do not match against merchant, transaction title, or other non-description fields in the first implementation.
- Do not support escaped commas or CSV quoting in the first implementation.
- Do not support transfer rules targeting non-bank/cash Manager accounts.
- Do not import foreign-currency inter-account transfers until Manager transfer currency/exchange-rate behavior is verified.
- Do not delete stale or duplicate Manager transfers automatically.

## Functional Requirements

### Custom Field Setup

- During setup discovery, ensure a Manager custom field named `Akahu Transfer Rules` exists alongside `Akahu Account` on Manager bank/cash accounts.
- The field must be a multiline text custom field using Manager field `type: 1`.
- The field placement must match Manager bank/cash accounts, using the same placement boundary as the existing `Akahu Account` field.
- Existing field values must be preserved when the field already exists.
- If an existing `Akahu Transfer Rules` field has the wrong type or placement, update the field in place while preserving account-level values. If Manager rejects the update, enter the existing setup error state.
- If field creation/update fails, setup should enter the existing generic setup error path.

### Rule Format

- Each non-blank line in `Akahu Transfer Rules` is one rule.
- Each rule line must be parsed as `keyword,destination account key`.
- Split on the first comma only.
- Trim whitespace around both parts.
- A rule is invalid when the comma is missing, the keyword is blank, the destination key is blank, the destination key does not exist in the current Manager bank/cash account batch, or the destination key equals the source linked account key.
- Invalid rules must be reported as non-fatal warnings attached to the source Manager account.
- Duplicate valid rules on one source account are allowed but should be de-duplicated after trimming and case-folding the keyword plus exact destination key.
- If more than one valid rule matches a transaction, use the first valid rule in field order and add a warning that later matches were ignored.
- Overlapping-rule warnings should be aggregated per source account and ignored rule combination per sync run, not emitted once per transaction.

### Linked Account Model

- Extend domain setup models so each `LinkedAccount` includes parsed transfer rule data and rule warnings.
- A valid transfer rule should include:
  - Source Manager bank/cash account key.
  - Source Manager bank/cash account name.
  - Source Manager bank/cash account currency and pending capability.
  - Keyword as entered after trimming.
  - Normalized keyword for matching.
  - Destination Manager bank/cash account key.
  - Destination Manager bank/cash account display name for UI/warnings.
  - Destination Manager bank/cash account currency and pending capability.
- Rule warnings should contain safe text only; never include Akahu credentials.

### Setup UI

- Ready-state account cards must show whether transfer rules are configured for each linked account.
- Ready-state account cards must show each Manager bank/cash account key so users can copy it into `Akahu Transfer Rules`.
- If rule warnings exist, show them in the existing setup/ready UI as non-blocking warnings.
- The UI must continue to show stale Akahu account selection warnings.
- Sync buttons remain available when rule warnings exist; invalid rules are skipped.

### Matching Semantics

- For each settled or pending Akahu transaction, normalize the transaction description by trimming, lowercasing, and collapsing whitespace.
- Normalize rule keywords by trimming, lowercasing, and collapsing whitespace.
- A rule matches when the normalized description contains the normalized keyword as a substring.
- Match transfer rules before receipt/payment classification.
- Transfer rule matching must use raw `transaction.description`, not the merchant/name fallback used by ordinary receipt/payment descriptions.
- A matched transfer rule must bypass ordinary receipt/payment creation, pending fingerprint creation, and pending-to-settled receipt/payment replacement for that transaction.
- Zero-amount matched transactions must be skipped with the existing zero-amount behavior and must not create transfers.
- Invalid amount matched transactions must be skipped with an unsupported warning.

### Transfer Direction And Payloads

- Treat the currently synced linked account as the transaction source account and the rule destination key as the other account.
- If the signed Akahu amount is negative:
  - `paidFrom` is the source Manager account key.
  - `receivedIn` is the destination Manager account key.
  - `creditAmount` and `debitAmount` use the absolute normalized amount.
  - `fdxCreditTransactionId` is the Akahu transaction identifier or pending fingerprint for the source-side transaction.
- If the signed Akahu amount is positive:
  - `paidFrom` is the destination Manager account key.
  - `receivedIn` is the source Manager account key.
  - `creditAmount` and `debitAmount` use the absolute normalized amount.
  - `fdxDebitTransactionId` is the Akahu transaction identifier or pending fingerprint for the source-side transaction.
- For settled matched transactions, both `creditClearStatus` and `debitClearStatus` should be Manager `onSameDate` unless Manager API validation proves a different settled-transfer payload is required.
- For pending matched transactions, set the source side's clear status to Manager `onLaterDate` with no clear date. The other side should also use `onLaterDate` unless Manager API validation proves an unmatched pending side needs a different status.
- Pending transfer creation/update is supported only when both source and destination Manager bank/cash accounts have `canHavePendingTransactions === true`. If the destination account does not support pending transactions, skip that pending transfer with a warning.
- Use Akahu transaction calendar date as the Manager transfer `date`.
- Use the Akahu transaction description as Manager transfer `description`.
- Use the Akahu settled transaction ID for settled transfer-side FDX fields.
- Use a transfer-specific pending fingerprint for pending transfer-side FDX fields. Do not reuse the receipt/payment pending prefix for transfer entries unless pure-helper tests prove stale-pending and duplicate decisions remain unambiguous.

### Existing Transfer Read Model

- Extend Manager sync reads to include inter-account transfers relevant to the selected bank/cash account.
- Because `GET/api4/inter-account-transfer-batch` does not expose a `BankOrCashAccount` filter in the generated client, fetch all inter-account transfer pages and filter locally to transfers whose `paidFrom` or `receivedIn` equals the selected account key.
- Index both `fdxCreditTransactionId` and `fdxDebitTransactionId`.
- Existing transfer entries in the index must retain which side the FDX ID belongs to: credit or debit.
- Receipt/payment entries and transfer entries must share a common duplicate lookup boundary so a transaction imported under any Akahu-created Manager object involving the selected Manager account is not re-imported as another object.
- The first implementation does not attempt a global business-wide receipt/payment duplicate scan.

### Transfer De-Duplication

- Before creating or updating a matched transfer, check the common FDX index for the current settled transaction ID or pending transfer fingerprint.
- If the current FDX ID already exists on exactly one transfer side, count it as a duplicate unless the existing transfer is missing the opposite side's mirrored FDX ID and the current transaction safely matches that missing side.
- If the current FDX ID already exists on a receipt or payment, skip transfer creation and warn that the transaction was previously imported as a receipt/payment.
- If the current FDX ID exists on multiple Manager objects, skip and warn as ambiguous.
- Same-run processed FDX IDs must prevent duplicate creates/updates when Akahu returns repeated rows.

### Mirror-Side Merge

- When a matched transaction does not already exist by its own FDX ID, search existing inter-account transfers for a safe mirrored candidate.
- A mirrored candidate is safe only when all of these match:
  - The transfer has the same `paidFrom` and `receivedIn` keys implied by the current transaction and rule.
  - The transfer date equals the current transaction calendar date.
  - The transfer amount equals the absolute normalized current amount on both debit and credit sides.
  - The FDX field for the current side is blank.
  - The opposite-side FDX field is present.
- If exactly one mirrored candidate is found, update that Manager transfer with the current side's FDX field populated and increment a `transfersMerged` summary count.
- Do not exclude a mirrored candidate solely because its opposite-side FDX was processed earlier in the same sync-all run. Exclude only when the current side FDX was already processed or the transfer was already updated for the current side.
- If multiple mirrored candidates are found, skip the current transaction and add an ambiguous merge warning.
- If no mirrored candidate is found, create a new Manager inter-account transfer.
- Mirror merging applies to settled and pending transfer entries.

### Pending Transfer Behavior

- Pending transfer fingerprints must include enough information to avoid collisions:
  - Prefix/version.
  - Akahu account ID.
  - Source Manager account key.
  - Destination Manager account key.
  - Akahu calendar date.
  - Signed normalized amount.
  - Normalized description.
  - Matched normalized keyword.
- Exact pending transfer fingerprint matches should update the existing Manager inter-account transfer with the canonical pending transfer payload, following the current receipt/payment pending-update replacement policy.
- Transfer `PUT` updates used for mirror merges must start from the existing Manager transfer item and change only the missing current-side FDX field and any clear-status fields required for that side. Tests must assert description, amounts, accounts, custom fields, and the opposite-side FDX field are preserved.
- Exact pending transfer fingerprint updates may continue the current canonical replacement policy, but tests must explicitly cover what fields are replaced or preserved.
- Pending transfer entries that are absent from a later successful pending endpoint response and were not replaced/merged by a settled transaction in the same run should be reported as stale pending transfer warnings. They must not be deleted automatically.
- A settled matched transfer should be able to replace a safe pending transfer candidate by updating clear statuses and replacing the pending FDX side with the settled Akahu transaction ID when account direction, absolute amount, and normalized description match. Use the same bounded pending-to-settled date window as the existing receipt/payment pending-to-settled helper unless tests prove exact-date matching is sufficient for Akahu transfer pending rows.

### Foreign Currency

- Preserve the existing first-pass behavior for foreign-currency Manager bank/cash accounts.
- If the source Manager bank/cash account has a non-empty currency value, preserve the existing account-level unsupported skip behavior before normal receipt/payment/transfer processing.
- If the source account is importable but a matched rule targets a destination Manager bank/cash account with a non-empty currency value, skip that transfer transaction with a warning until Manager inter-account transfer currency/exchange-rate behavior is verified.
- Unsupported foreign-currency transfer skips must increment `unsupportedSkipped` and `warnings`.

### Sync Summary And UI Counts

- Extend `ManagerAkahuSyncSummaryCounts` with transfer-specific counts:
  - `transfersCreated`
  - `transfersUpdated`
  - `transfersMerged`
  - `transferRulesMatched`
  - `stalePendingTransfersDetected`
- Existing receipt/payment counts must remain unchanged for non-transfer transactions.
- Completion UI must show transfer counts in overall and per-account summaries.
- Warnings/errors for invalid rules, ambiguous duplicates, ambiguous merges, unsupported currencies, and Manager transfer write failures must be shown using the existing sanitized warning/error display path.

Count semantics:

- `transferRulesMatched` increments once for each transaction with at least one valid matching transfer rule, before later duplicate/zero/unsupported decisions.
- `transfersCreated` increments for each successful Manager inter-account transfer `POST`, including pending transfers.
- `transfersUpdated` increments for each successful exact pending transfer update or settled replacement update.
- `transfersMerged` increments for each successful mirror-side merge that adds the current side FDX to an existing transfer.
- `stalePendingTransfersDetected` increments for each stale pending transfer warning.
- Existing `pendingCreated`, `pendingUpdated`, `pendingSettled`, and `stalePendingDetected` remain aggregate pending lifecycle counts across receipts, payments, and transfers.
- Existing `receiptsCreated` and `paymentsCreated` remain receipt/payment-only counts.

### Sync Freshness

- Sync must use current transfer rules at the moment a sync starts.
- The implementation may satisfy this either by re-reading selected Manager bank/cash account custom-field values at sync start or by refreshing setup state immediately before launching sync.
- Prefer re-reading selected accounts in `ManagerSyncFlows.syncTransactions` so Manager custom-field edits made after setup load do not require a manual UI refresh.

## Validation Requirements

- Pure manager-api tests must cover rule parsing, description matching, amount normalization, transfer direction, transfer payload construction, pending transfer fingerprinting, duplicate decisions, mirror merge decisions, and stale pending transfer detection.
- Manager batch pagination tests must cover inter-account transfer pagination, local account filtering, indexing both transfer FDX fields, and keeping existing receipt/payment pagination behavior unchanged.
- Website setup tests must cover creating/locating `Akahu Transfer Rules`, parsing rules from Manager bank/cash account custom fields, invalid rule warnings, key-based destination lookup, and linked-account model output.
- Website sync-flow tests must cover settled transfer create, pending transfer create/update, duplicate transfer skip, receipt/payment bypass on transfer match, mirror merge, ambiguous merge warning, invalid destination skip, foreign-currency source/destination skip, and summary count roll-up.
- Controller/UI tests must cover rendering transfer-rule metadata and transfer summary count labels without requiring a DOM implementation beyond the existing test harness capabilities.
- Recommended targeted validation after relevant tasks:
  - `pnpm test "packages/domain/tests/ManagerAkahuTransferRules.test.ts"`
  - `pnpm --filter @app/domain build`
  - `pnpm test "packages/manager-api/tests/ManagerAkahuTransactionSync.test.ts"`
  - `pnpm test "packages/manager-api/tests/ManagerBatchPagination.test.ts"`
  - `pnpm test "packages/manager-api/tests/ManagerCompatibility.test.ts"`
  - `pnpm --filter @app/manager-api build`
  - `pnpm test "apps/website/tests/ManagerFlows.test.ts"`
  - `pnpm test "apps/website/tests/ManagerSyncFlows.test.ts"`
  - `pnpm test:website-sync-controller`
  - `pnpm --filter website build`
- Full final validation should run `pnpm ready` when feasible.

## Implementation Plan

### Task 1: Add Transfer Rule Domain Model And Parser

Status: Completed.

- Add transfer-rule schemas/types to `packages/domain/src/Manager/AkahuCustomFields.ts` or a small adjacent domain module.
- Implement pure parsing for newline-delimited `keyword,destination account key` rules.
- Implement normalized keyword matching against descriptions.
- Add tests for blank lines, missing comma, blank keyword, blank destination key, first-comma splitting, whitespace trimming, duplicate rules, and case-insensitive substring matching.
- Do not wire the parser into setup or sync yet.
- Validation: `pnpm test "packages/domain/tests/ManagerAkahuTransferRules.test.ts"` and `pnpm --filter @app/domain build`.

### Task 1 Review: Transfer Rule Parser Code Quality Audit

Status: Completed.

- Review result: no structural follow-up changes required. The parser stays pure, syntax-only, localized in the Manager Akahu domain boundary, and avoids adding setup/sync account-lookup concerns before Task 2 owns them.
- Keep this split in later tasks: destination-key existence checks, self-target rejection, destination display metadata, and user-facing warning text should layer on top of the parser instead of making the pure parser depend on Manager account batches or UI warning formatting.
- Validation: independent review sub-agent reran `pnpm test "packages/domain/tests/ManagerAkahuTransferRules.test.ts"` and `pnpm --filter @app/domain build`; both passed.

### Task 2: Load `Akahu Transfer Rules` During Setup

Status: Completed.

- Add a named constant for the `Akahu Transfer Rules` field.
- Ensure setup creates the multiline bank/cash account custom field using Manager field `type: 1`.
- Read all Manager bank/cash accounts once and use that same batch to validate destination account keys.
- Extend `collectManagerAkahuAccountSelections` to read the transfer-rules field, parse valid rules, attach warnings, and include destination display names.
- Extend `LinkedAccount` to carry valid transfer rules and rule warnings.
- Update ready-state UI to show transfer-rule count and non-blocking rule warnings.
- Keep existing setup states and stale Akahu account selection behavior unchanged.
- Validation: `pnpm test "apps/website/tests/ManagerFlows.test.ts"`, `pnpm --filter @app/domain build`, `pnpm test:website-sync-controller`, `pnpm --filter website build`, `pnpm test "packages/domain/tests/ManagerAkahuTransferRules.test.ts"`, `pnpm test "apps/website/tests/ManagerSyncFlows.test.ts"`, and `pnpm ready`.

### Task 3: Extend Manager Sync Read For Inter-Account Transfers

- Extend `ManagerBatchPagination.ts` to fetch all `inter-account-transfer-batch` pages.
- Filter fetched transfers locally for the selected account key on `paidFrom` or `receivedIn`.
- Extend the sync-read model with transfer items and a common FDX index that includes receipt/payment `fdxTransactionId`, transfer `fdxCreditTransactionId`, and transfer `fdxDebitTransactionId`.
- Preserve existing receipt/payment public behavior and tests.
- Add focused tests for pagination, local filtering, and both transfer FDX sides.
- Update website sync-flow test client mocks to provide `GET/api4/inter-account-transfer-batch` if the public sync-read client type requires it, without changing sync behavior yet.
- Validation: `pnpm test "packages/manager-api/tests/ManagerBatchPagination.test.ts"`, `pnpm --filter @app/manager-api build`, `pnpm test "apps/website/tests/ManagerSyncFlows.test.ts"`, and `pnpm --filter website build`.

### Task 4: Add Pure Transfer Payload And Fingerprint Helpers

- Add manager-api pure helpers for transfer match classification, transfer-specific pending fingerprints, and settled/pending transfer payload construction.
- Reuse existing amount normalization and clearance constants.
- Keep receipt/payment classification behavior unchanged for non-transfer transactions.
- Add focused tests for settled payloads, pending payloads, negative/positive direction, zero/unsupported skips, pending fingerprint contents, and source/destination pending capability skips.
- Validation: `pnpm test "packages/manager-api/tests/ManagerAkahuTransactionSync.test.ts"`, `pnpm test "packages/manager-api/tests/ManagerCompatibility.test.ts"`, and `pnpm --filter @app/manager-api build`.

### Task 5: Add Pure Transfer Duplicate, Merge, Stale, And Count Metadata

- Add pure duplicate decisions for transfer FDX entries in the common sync-read index.
- Add pure safe mirrored-candidate selection helpers.
- Add pure stale pending transfer detection helpers.
- Extend `ManagerAkahuSyncSummaryCounts` with transfer counts and update `SyncUi.ts` labels in the same task so exhaustive `Record<ManagerAkahuSyncSummaryCountKey, string>` typechecking continues to pass.
- Add focused tests for duplicate/ambiguous duplicate decisions, safe merge, ambiguous merge, stale pending transfer entries, and count-label metadata.
- Validation: `pnpm test "packages/manager-api/tests/ManagerAkahuTransactionSync.test.ts"`, `pnpm --filter @app/manager-api build`, `pnpm test:website-sync-controller`, and `pnpm --filter website build`.

### Task 6: Wire Settled Transfer Create And Duplicate Skip

- Extend `ManagerAkahuTransactionSyncManagerClient` with `POST/api4/inter-account-transfer` and `PUT/api4/inter-account-transfer`.
- Re-read selected Manager bank/cash account custom-field values at sync start and parse current transfer rules before transaction processing.
- In settled processing, check transfer rules before receipt/payment classification.
- For settled rule matches, run duplicate decisions and create Manager inter-account transfers when no duplicate exists and no safe mirrored candidate exists.
- If a safe mirrored candidate exists in this task, leave it unmodified and add a temporary warning/count path only if needed to keep behavior explicit; the next task replaces that warning with merge behavior.
- Ensure transfer creates record processed FDX IDs and update transfer summary counts.
- Preserve the existing five-overlap settled stop behavior for ordinary settled duplicates; transfer duplicates by existing Manager transfer FDX IDs should count as duplicates and participate in the same overlap policy when they prove the settled Akahu ID is already imported.
- Add website sync-flow tests for settled transfer create, duplicate skip, receipt/payment bypass, invalid destination skip, destination foreign-currency skip, and summary counts.
- Validation: `pnpm test "apps/website/tests/ManagerSyncFlows.test.ts"` and `pnpm --filter website build`.

### Task 7: Wire Settled Mirror Merge And Pending Replacement

- Use the safe mirrored-candidate helper to update an existing Manager transfer with the current side FDX instead of creating a second transfer.
- Preserve existing transfer fields when adding the missing current-side FDX.
- Add settled-to-pending transfer replacement using the safe helper and pending-to-settled date-window policy.
- Add tests for mirror merge, ambiguous merge warning, same-run mirror merge from sync-all, field preservation during merge, and settled replacement of a pending transfer.
- Validation: `pnpm test "apps/website/tests/ManagerSyncFlows.test.ts"` and `pnpm --filter website build`.

### Task 8: Wire Pending Transfer Sync And Stale Detection

- In pending processing, check transfer rules before receipt/payment pending fingerprint/classification.
- For pending rule matches, use transfer-specific pending fingerprints and create/update Manager inter-account transfers.
- Track current pending transfer fingerprints and include them in stale pending transfer detection after successful pending endpoint reads.
- Add tests for pending transfer create, exact pending update, same-run duplicate suppression, unsupported destination pending capability skip, stale pending transfer warning, and pending transfer summary counts.
- Validation: `pnpm test "apps/website/tests/ManagerSyncFlows.test.ts"` and `pnpm --filter website build`.

## Open Questions

- None.
