# Source-Code Sale Readiness Review

Date: 2026-10-26 · Reviewer: Codex · Status: Partially Verified

## Recommendation

The project has potentially saleable engineering assets. The most defensible current offer is an **unfinished local-first AI agency desktop application, supplied as source code with documented limitations**. A developer or agency with engineering capacity is a more plausible buyer than a nontechnical operator expecting a finished autonomous business.

This is a technical assessment and a buyer-fit hypothesis, not evidence of demand, a valuation, or a commitment to sell. No listing, outreach, ownership transfer, rebrand, or application-code repair was performed.

## Review coverage and limits

Inventoried the workspace and tracked repository (327 tracked files at the start). Read current governance, README, security policy, recent ledger entries, app routing, core runtime/worker execution and approval paths, chat persistence, selected data/security modules, build pipeline, generation/payment/packaging paths, native configuration and secret storage, SQLCipher connection/key handling, and CI configuration. Surveyed worker, screen, and data-module interfaces and brand references across the source tree.

This is **not an exhaustive line-by-line review of every file**, an image/archive inspection, a full dependency-license audit, a Git-history secret scan, or a complete native acceptance/security audit. Dependencies, generated files, binaries, archived design assets, and every screen/worker branch were not individually inspected. Source findings below were read directly; most affected branches were not reproduced in the native application.

## Verification performed in this session

| Layer | Result | Meaning |
|---|---|---|
| Existing JS unit/integration/component suite | 383 tests, 33 files passed | Existing assertions pass; they do not cover every business path. |
| Frontend production build | Passed | Buildable frontend; large-chunk and ineffective-dynamic-import warnings remain. |
| Existing browser E2E suite | 28 passed using system Chrome | Development-preview browser flows pass. This does not exercise the real desktop SQLite/Rust/provider integrations. |
| Rust type/build checking | `cargo check --offline` passed | Native source checks; this is not an installer, linked release binary, or desktop runtime test. |
| Fresh-machine install and full client delivery | Not Yet Verified | No claim of production readiness. |
| Live providers, WhatsApp, payments, FTP/deployment | Not Yet Verified | No real transaction, message, upload, or deployment was performed. |

## Assets a buyer would receive

- Tauri v2/Rust desktop shell, React 18/Vite/Tailwind interface, React Context, and local SQLite data layer.
- A registry of 24 specialist workers, shared worker lifecycle, concurrency limiting, and human approval infrastructure.
- Multi-provider LLM routing and usage/cache/cost infrastructure; live behavior still needs separate acceptance.
- Leads, clients, projects, finance/invoice/product/retainer interfaces and domain data helpers.
- Chat orchestration and persistence, document/PDF and ZIP-generation paths, and workflow/marketing interfaces.
- Existing tests, native configuration, CI workflows, governance and brand materials.

These are implementation assets, not independently verified proof that every advertised service works or earns revenue. No customer, revenue, or ownership evidence was validated.

## Material findings before any finished-product claim

1. **Developer worker has an unresolved identifier.** `src/engine/workers/developerWorker.js:54` passes `productType` to the complexity analyzer although the local variable is named `projectType`. A valid-project execution reaching this expression can fail before generation. Existing green tests did not establish this path works.

2. **Failed AI calls can become synthetic success.** `src/services/llmManager.js` returns fixed emergency specification text and logs `SUCCESS_OFFLINE` after every provider fails. This is not an actual local model response. The E2E run also logged the simulated emergency path. Website generation separately contains a fallback template with unsupported marketing claims and an unconfigured form endpoint.

3. **Pipeline success reporting is unreliable.** `BaseWorker.run()` returns `{ success: false, error }` for failures. `BuildScreen.jsx`'s `handleRunTier()` does not check this flag before marking the tier completed. It also prefers a selected lead ID even for workers expecting a project ID; the downstream handoff needs an end-to-end check.

4. **Client ZIP can expose internal material.** `packagerWorker.js` explicitly adds `blueprints/PRD.md`, `TRD.md`, architecture, and database schema to the deliverable. This conflicts with the current client-visibility rules.

5. **Packaging may mark delivery before successful handover.** The packager catches ZIP/file-write errors, continues, and updates project stage to `Delivered`. Its local file/download and delivery-state effects execute before the registry's post-generation approval wait. Approval timing and failure handling require review, not just another approval popup.

6. **WhatsApp delivery is simulated.** `whatsappService.js` simulates QR connection and transmission, waits 500 ms, and records `sent`. This does not prove a message reached WhatsApp. `socialSchedulerWorker.js` creates local calendar records; those records alone do not establish live publishing. Ad campaign functionality includes simulation.

7. **Encryption claims need qualification.** SQLCipher is configured in the vendored SQL plugin, but native secret storage serializes values into local `secrets.json`; the DB key is stored there too. Unix file permissions are set, but this is not evidence of encrypted key storage or an OS credential vault. JSON database backups are plaintext. App-lock enforcement is explicitly disabled by an existing owner decision. Do not silently re-enable it or call the entire installation encrypted and locked.

8. **Buyer-facing documentation is stale.** README still describes encryption and locking as planned, while newer code/docs differ. SECURITY.md is an unfilled template with unrelated version numbers. CI declares several platforms while native bundle targets are configured as `deb`; platform release support must be demonstrated rather than inferred from workflow presence.

9. **Rights and transfer scope remain unverified.** No top-level project license was found in the file search; vendored SQL code includes upstream license files. Confirm authorship, third-party assets/fonts/code permissions, transfer scope, and buyer support obligations before offering ownership. Preserve upstream notices. This review does not establish legal title.

## Sale routes researched

**Direct source-code asset transfer:** Best current fit in this reviewer's judgment. Target a developer or development agency capable of finishing and maintaining a Tauri/React application. Describe defects, simulations, included assets, excluded brand/personal data, and the support boundary clearly. Buyer interest and price are untested.

**Codester:** Its seller information supports scripts/code and app-source submissions, with marketplace review. Its standard model licenses items while the author retains ownership; this is different from an exclusive sale. Desktop/Tauri category acceptance is not confirmed. Sources: https://www.codester.com/info/seller/ and https://www.codester.com/info/licenses

**Acquire.com:** Its current pre-revenue rules require a functional SaaS/AI product with a defined customer/problem and transferable assets. Broad or generic AI products may not qualify; pre-revenue agencies are excluded. Acceptance of this private desktop application is not confirmed, so it is not a dependable immediate exit route. Source: https://help.acquire.com/what-pre-revenue-businesses-are-allowed

No valuation is asserted. Development effort, file count, and passing tests are not evidence of market price. No paid service was purchased.

## Rebrand scope — proposed, not executed

A search of `src`, `src-tauri/src`, native/package metadata, index.html, docs and README found **83 text files** mentioning Mabishion, Nexious, Adii, or Ashu. This is not a count of all brand occurrences, and binary/logo assets and Git history are additional scope.

- Replace product/window names, package metadata, logos/icons, banners, HTML metadata, sidebar/login copy, and native descriptions.
- Audit prompts/personas, PDF headers/footers, proposal/invoice templates, generated website footers, ZIP contents, filenames, and fallback text.
- Replace owner-specific company/contact/social/payment defaults with buyer-owned configuration. Do not hand over personal accounts, real client records, API keys, backups, or the installed database.
- Plan identifier/data migration: `com.mabishion.factory`, `mabishion.db`, localStorage keys, backup locations, and `MABISHION_*` environment names affect storage and recovery. Blind replacement could make existing data or secrets appear lost.
- Keep historical governance separate from current buyer documentation; do not erase upstream attribution or use renaming to conceal third-party provenance.
- Choose a new name only after owner selection and availability checks. Renaming alone will not resolve reliability or buyer demand.

## Smallest practical next milestone

Agree whether the offer is one exclusive source-code transfer or repeat nonexclusive licenses. Prepare a clean, owner-approved sale copy with a truthful feature/limitation list, reproducible setup instructions, and one recorded real end-to-end workflow. For a finished-product offer, repair the material execution/privacy/approval defects first and verify desktop installation, restart, output, failure handling, and delivery. Keep the original brand and working checkout intact while preparing a separate transfer package.
