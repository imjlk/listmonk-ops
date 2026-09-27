# @listmonk-ops/openapi

## 0.11.0 — 2026-09-27

### Fixed

- [4881c9c](https://github.com/imjlk/listmonk-ops/commit/4881c9c4379d53d6ac389d0fd9320b902ac94aa3) Harden the Listmonk client transport. The per-attempt deadline now stays armed until the response body is read, so a stalled body rejects with a named `TimeoutError` instead of hanging a CLI command or MCP tool call; retried 5xx bodies are cancelled. Writes (`POST`/`PUT`/`PATCH`/`DELETE`) no longer follow redirects and return a `ListmonkRedirectError` instead of a converted `GET` that reports success or a body replayed to another origin. `LISTMONK_TIMEOUT`/`LISTMONK_RETRIES` are validated strictly (`abc` no longer disables every request and `30s` no longer means 30 ms) and now apply to raw-header clients, so the MCP server honors them like the CLI. An explicit `auth` object is never completed from `LISTMONK_USERNAME`/`LISTMONK_API_TOKEN`, readiness reports a non-JSON 200 as `invalid_response`, the Worker runtime rejects a bare trailing `?` or `#` in its base URL, and `createConfig` no longer throws in runtimes without `process`. — Thanks @imjlk!
- [4bb5c4a](https://github.com/imjlk/listmonk-ops/commit/4bb5c4aa963e589f29929fa9384eee6cd9f07407) Fixed the published TypeScript declarations for `"moduleResolution": "node16"` and `"nodenext"`. The declarations imported their sibling files without extensions (for example `./src/client/index`), which only `bundler` resolution follows, so node16 and nodenext consumers could not resolve the typings of any entry point or subpath export, including `@listmonk-ops/openapi/sdk`, `@listmonk-ops/openapi/runtime`, and `@listmonk-ops/operations/specs`. Every relative import in the published declarations now names its runtime file (`./client.js` or `./client/index.js`), and the runtime JavaScript is unchanged. `@listmonk-ops/openapi` and `@listmonk-ops/common` support TypeScript 5.0 or newer; `@listmonk-ops/operations`, `@listmonk-ops/automation`, and `@listmonk-ops/abtest` expose zod 4 types, whose declarations need TypeScript 5.4 or newer when `skipLibCheck` is off. — Thanks @imjlk!
- [4294c37](https://github.com/imjlk/listmonk-ops/commit/4294c372b2aee99633c6ae795f0c607203142ffb) Align campaign and list writes with Listmonk 6.2. `campaigns.update` and `campaigns.schedule` now resend the stored target lists, media attachments, and attributes, because Listmonk's campaign `PUT` does not pre-fill them: every name-only update and every schedule previously failed with "Invalid list IDs", and a successful update would have detached media and overwritten attributes. Lifecycle transitions (schedule, start, pause, cancel) accept Listmonk 6.2's updated-campaign echo from `PUT /campaigns/{id}/status` as the acknowledgement instead of reporting an applied transition as a failure. `campaigns.archive` resends the stored slug, template, and metadata so toggling no longer clears the public archive link, `campaigns.clone` derives a fresh archive slug for archived sources instead of copying the unique slug, and `lists.update` carries the stored name and tags so partial updates neither fail nor clear tags. The OpenAPI overlay documents `archive_slug` on the archive endpoint and the client types the status echo. — Thanks @imjlk!
- [6bb2b1f](https://github.com/imjlk/listmonk-ops/commit/6bb2b1fe9902131dd8d58a6e7dfa706dd6b5b616) Fixed npm packaging. `@listmonk-ops/openapi` no longer declares a `typescript` peer dependency, so it installs into projects pinned to any TypeScript version (the declarations need TypeScript 5.0 or newer with `moduleResolution: "bundler"`), and installing it or the CLI no longer pulls in a TypeScript 7 compiler. The npm `listmonk-cli` bundle now loads the shared `@listmonk-ops/*` packages from its dependencies instead of embedding private copies, so errors thrown by `@listmonk-ops/automation` keep their class identity (for example, `webhooks dispatch` prints its structured recovery handle) and the package shrinks from about 1.9 MB to 0.3 MB unpacked. `@listmonk-ops/operations` no longer publishes its repository-only spec gate artifacts, trimming about 2.6 MB. — Thanks @imjlk!
- [4294c37](https://github.com/imjlk/listmonk-ops/commit/4294c372b2aee99633c6ae795f0c607203142ffb) Align the campaign lifecycle with Listmonk 6.2's `UpdateCampaignStatus` rules and add `campaigns.unschedule` (135 → 136 described operations). A paused campaign (for example one the deliverability guard paused) can now be cancelled or rescheduled instead of being rejected locally, and starting a `scheduled` campaign is rejected before any API call with guidance instead of failing with a server 400. The new stable `campaigns.unschedule` returns a scheduled campaign to `draft` (CLI: `listmonk-cli campaigns unschedule --id N`; MCP: `listmonk_unschedule_campaign`), which is the executable path to send a scheduled campaign early; the OpenAPI overlay accepts `draft` on the status endpoint. Stopping an A/B test now cancels a paused variant campaign instead of deleting it and its delivery history. — Thanks @imjlk!

### Patch changes

- [e9b36ec](https://github.com/imjlk/listmonk-ops/commit/e9b36ec0989981086e5bdc43ac21759d2ccd78d4) Align manifests, redaction, test sends, and reload safety with Listmonk 6.2. `settings.get` now redacts every auth username: the nested `bounce.postmark.username` (Postmark's server token) and the SMTP, messenger, and bounce-mailbox usernames that 6.2 returns unmasked previously reached CLI and MCP output in clear text, because the rule only matched a flat `postmark_username` key that 6.2 never returns. Template manifests now converge: the subject is managed for `tx` templates only, a `campaign` or `campaign_visual` entry that sets `subject` and a `tx` entry without one are rejected before any remote call, and a type change fails during planning, because 6.2 discards campaign-template subjects (rewriting them to the previous name on update), refuses transactional templates without a subject, and never updates a template's type, which made plans report `update` forever or fail partway through an apply. User-role manifests reject `list:get` and `list:manage` before any remote call instead of planning a change that 6.2 refuses partway through an apply; permission arrays continue to deduplicate entries, accept up to 30 raw entries for compatibility, and normalize to the 28 allowed user-role permissions. `LISTMONK_USER_ROLE_PERMISSIONS` and `LISTMONK_LIST_ROLE_PERMISSIONS` expose the two sets. `campaigns.test` sends its `template_id` override as the query parameter the 6.2 handler reads and forwards the stored campaign's attachments, so test messages render with the chosen template and keep their attachments; the SDK's campaign test call now accepts that query parameter. `system.reload` is now declared as what 6.2 does, a full process restart that interrupts running campaigns and drops queued transactional messages: it requires confirmation (`--confirm` in the CLI, `confirm: true` over MCP) and is no longer marked safe to repeat. — Thanks @imjlk!
- [963416a](https://github.com/imjlk/listmonk-ops/commit/963416af4c081cd51218895a832cbed2fd2f029e) Redact credentials embedded in URL-valued Listmonk settings. `settings.get` returned every string outside a credential-named key verbatim, so the userinfo of a messenger postback `root_url` or a basic-auth `app.root_url` (`https://user:pass@host`), secret query values such as `?api_key=`, `?token=`, an Azure SAS `sig`, or a presigned S3 public URL's `X-Amz-Credential` and `X-Amz-Signature`, and an SMTP or POP URL pasted into a `host` field (`smtps://user:pass@host:465`) reached CLI and MCP output in clear text. Every absolute URL in a string value now has its userinfo and credential-named query and fragment values (such as `#access_token=`) replaced by `[redacted]`, with the rest of the URL kept exactly as written; a userinfo containing unencoded spaces is redacted as a whole, and a URL the parser rejects is redacted up to its authority-closing `@`. Credential-named parameter assignments in non-URL strings (such as `token=...` or `api_key=...`) are redacted too; other non-URL text is unchanged. `@listmonk-ops/operations` exports the shared `redactUrlCredentials` helper. `providers.status` and `deliverability.doctor` pass the SMTP hosts and `app.from_email` they echo from settings through the same helper, so an SMTP URL pasted into a host field no longer leaks its credentials there, and the legacy `listmonk_get_server_config` MCP tool redacts the `root_url` and `public_subscription.redirect_urls` that Listmonk 6.2's `/api/config` echoes from settings.
  
  Settings updates and SMTP tests made through the shared OpenAPI client reject redacted credential placeholders before sending a request, preventing a read-redact-write or test cycle from using `[redacted]` as a literal credential. Percent-encoded nested URLs and encoded placeholders are handled without rewriting other encoded text, while non-credential query metadata such as `token_type`, `passwordless`, and `monkey` remains visible. Ambiguous spaced credential values are masked to their explicit delimiter or the end of the value. — Thanks @imjlk!

### Changed

- [5677aaa](https://github.com/imjlk/listmonk-ops/commit/5677aaa1ab413cda9c5018e779652d460f864f82) Map list and analytics inputs to the query parameters Listmonk 6.2 actually honors. Campaign and subscriber lists now accept `asc`/`desc` in either case and send lowercase, because Listmonk silently sorted uppercase `ASC` descending; the SDK's campaign, subscriber, and list `order` types are now lowercase `asc | desc`, so TypeScript callers that passed `ASC`/`DESC` to the generated client must switch to lowercase. `media.list` forwards `page`, a positive-integer `per_page`, and a filename `query` to the paginated media endpoint (CLI `--query`) and returns the server's pagination metadata, so files beyond the first 20 are reachable. The generated media response now exposes a page envelope; raw SDK consumers of the former array response should read the new `data.results` field. `campaigns.analytics` sends the inclusive `to` date as the end of that day, so single-day ranges are no longer empty. Subscriber imports accept `unconfirmed`, and the deprecated `pending` status is sent as `unconfirmed` instead of being rejected by Listmonk. — Thanks @imjlk!
- [95ee6a8](https://github.com/imjlk/listmonk-ops/commit/95ee6a8afa219d373773d6883487effdec5eafc4) Align the campaign preview SDK wrappers with the Listmonk 6.2 handler. `campaign.updatePreview` and `campaign.previewText` now accept `content_type`, which 6.2 reads on every submitted preview: without it a markdown body is not converted and a plain body is served as HTML. `campaign.updatePreview` is now typed to resolve to the rendered body string it always returned, not a `boolean`, so TypeScript code that treated the result as a boolean must be updated. Both calls already sent their fields form-urlencoded, which is how the handler reads them with `FormValue`; tests now pin that encoding. — Thanks @imjlk!

### Added

- [922609d](https://github.com/imjlk/listmonk-ops/commit/922609d7722fa97bd106c536646ab8f52ebd5ffb) Carry A/B opt-outs to the source lists before cleanup: Listmonk's unsubscribe link only marks the campaign's temporary variant or holdout list, so stop, delete, provisioning rollback, and the legacy cleanup helpers now unsubscribe those members from the test's source lists, confirm it, and only then delete the temporary list. A list whose opt-outs cannot be read, carried, or confirmed, or whose test records no source lists, is kept and reported so the cleanup can be retried, and retries now treat Listmonk 6.2's HTTP 400 "Campaign not found" answer as an already-deleted campaign. — Thanks @imjlk!

## 0.10.0 — 2026-09-23

### Minor changes

- [911222f](https://github.com/imjlk/listmonk-ops/commit/911222f21037e9d3f6b7d9e8217d4b51c0053050) Separate public connectivity, authenticated API access, and selected scoped collection reads in shared CLI/MCP status diagnostics. Add status --check for automation, bound probe time and response size, and redact target URL secrets and remote error bodies.
  
  Use workspace references for internal OpenAPI dependencies so release planning updates their ranges with the new client version. — Thanks @imjlk!

## 0.9.0 — 2026-09-22

### Minor changes

- [6ae61e8](https://github.com/imjlk/listmonk-ops/commit/6ae61e80c2cc291a33024cd67c760d536066b54b) Refresh runtime and compiler dependencies, regenerate the Fetch SDK, and align the Gunshi completion peer version. Preserve the OpenAPI generator TypeScript 5.9 compatibility dependency.
  
  The regenerated raw SDK now correctly marks request/response as optional on failures that occur before a request or response exists. Raw SDK consumers must guard these fields when inspecting errors.
  
  Preserve required MCP input metadata under Zod 4.6 and keep transactional serialization failures classified as invalid_message under the regenerated SDK. — Thanks @imjlk!
- [2e23be5](https://github.com/imjlk/listmonk-ops/commit/2e23be540ab9e91a832117e671249bb91b19db4d) Added three shared operations (stable, 128 → 131 total descriptors): `subscribers.bounces.get` reads one subscriber's bounce history (an unknown subscriber answers with an empty collection, not an error), `subscribers.bounces.delete` clears that history in one confirmation-gated request whose boolean acknowledgement is not an existence proof, and `maintenance.gc-analytics` one-shot deletes campaign analytics (`all`/`views`/`clicks`) recorded before an RFC3339 cutoff across every campaign — no server-side preview or count exists, so the gate and the no-preview boundary are stated in the spec. Verified against the observed 6.2 endpoint, which takes the analytics cutoff as a query parameter because echo does not parse form bodies on DELETE; the owned overlay now models that query parameter (and the `all|views|clicks` enum) instead of the upstream form body, and the generated SDK was regenerated. CLI: `listmonk-cli bounces subscriber --subscriber-id 7`, `listmonk-cli bounces delete-subscriber --subscriber-id 7 --confirm`, and `listmonk-cli maintenance gc-analytics --type views --before-date 2026-01-01T00:00:00Z --confirm`; the MCP tools `listmonk_get_subscriber_bounces`, `listmonk_delete_subscriber_bounces`, and `listmonk_gc_analytics` join the shared catalog. The stable baseline was re-accepted (131 contracts). — Thanks @imjlk!
- [b247ea3](https://github.com/imjlk/listmonk-ops/commit/b247ea3986865d6ff55c265bde0c0d38f862b663) Add Fetch-compatible subscriber membership reconciliation that validates exact email identity, preserves suppression and unrelated data, separates eligibility from provider state, and bounds responses and timeouts. — Thanks @imjlk!

### Patch changes

- [a3db6c0](https://github.com/imjlk/listmonk-ops/commit/a3db6c003d80a0e93d51eaea1263a8b948bc4e04) Fix campaign tag filtering with repeated tag parameters and preserve the public tags alias. Verify SDK, CLI and MCP filtering against Listmonk 6.2. — Thanks @imjlk!

## 0.8.0 — 2026-09-07

### Minor changes

- [ab18f19](https://github.com/imjlk/listmonk-ops/commit/ab18f1958d32b5e22bd656f2f00ad53cedbf19bd) Added `campaigns.analytics` (experimental, 110 → 111 total descriptors): a read over Listmonk's campaign analytics facets (`views`, `clicks`, `links`, `bounces`) for 1–20 campaigns over an ISO calendar-date range. The observed endpoint answers views/clicks/bounces with daily `{campaign_id, count, timestamp}` buckets and links with `{url, count}` aggregates — normalized only at the envelope — and accepts campaign ids exclusively as repeated `id` query parameters (a comma-joined value is rejected), now encoded at the OpenAPI boundary (`CampaignOperations.getAnalytics` takes `id: string[]`). CLI: `listmonk-cli campaigns analytics --type views --from ... --to ... --campaign-ids 1,2`. The ISO date pattern and id cap are shared leaf modules referenced by both the Zod schema and the published Typia contract; the spec verb vocabulary gains `analytics`. — Thanks @imjlk!
- [cf7806a](https://github.com/imjlk/listmonk-ops/commit/cf7806a2eab84b8479744ac3098caa4b800f8ddc) Added two stable reads (116 → 118 total descriptors). `subscribers.import.logs` completes the import lifecycle: it reads the raw importer log lines from the most recent session (empty string when none has run), exposed as `listmonk-cli subscribers import-logs` and the `listmonk_get_subscriber_import_logs` MCP tool. `templates.preview` renders the stored template to HTML exactly as campaign content would appear inside it — the observed GET endpoint answers with the rendered document around a dummy campaign body rather than a JSON envelope, and the generated type's spurious request body is absorbed at the wrapper boundary — exposed as `listmonk-cli templates preview --id N` and the `listmonk_preview_template` MCP tool. The stable compatibility baseline was re-accepted (118 contracts) and the spec verb vocabulary gains `logs`. — Thanks @imjlk!
- [3baefd1](https://github.com/imjlk/listmonk-ops/commit/3baefd1917b3b8d68993f9ee775998dbb27d6783) Added `campaigns.preview` and `campaigns.test` (experimental, 108 → 110 total descriptors). `campaigns.preview` renders the stored campaign body to HTML exactly as recipients would see it (a read; the GET endpoint answers with the rendered document rather than a JSON envelope). `campaigns.test` delivers the campaign to 1–10 existing-subscriber emails: the observed Listmonk 6.2 test endpoint rebinds the entire campaign form from the request and requires the recipients under an undocumented `subscribers` key, so the executor derives the form from the stored campaign and overlays explicit caller overrides (subject, template, body, messenger, from address), with unknown recipients rejected remotely and client-side email validation before any request. The test send follows the transactional-send convention — a real single-recipient delivery without a destructive confirmation gate, with retry honestly classified unsafe because every run re-sends. The legacy hand-rolled `listmonk_test_campaign` MCP tool (which took `emails`) is converted to the shared operation under the same name with structured content; the OpenAPI `CampaignTestParams` boundary now layers the observed `subscribers` field instead of distorting generated types. CLI: `listmonk-cli campaigns preview --id N` and `campaigns test --id N --subscribers a@b.c`. — Thanks @imjlk!
- [006a699](https://github.com/imjlk/listmonk-ops/commit/006a69969bc9a51dc8962f6601a888c1b153312b) Added three stable operations (124 → 127 total descriptors) covering the last unused SDK maintenance surface. `maintenance.gc-subscribers` one-shot deletes every orphaned or blocklisted subscriber; `maintenance.gc-unconfirmed` one-shot deletes every subscription unconfirmed before an RFC3339 cutoff — both confirmation-gated destructive collections whose spec states honestly that the server offers **no preview** (one confirmed request deletes the full matching set) and whose retry semantics reconcile: a repeated identical request reports `count: 0` once the set is empty. The unconfirmed cutoff's wire format was corrected in the owned overlay: the upstream spec models it as a form body while the observed 6.2 endpoint takes it as a query parameter, and the RFC3339 pattern is shared between the Zod schema and the published Typia contract through a leaf module. `system.reload` refreshes the app configuration without a restart — a repeatable non-destructive maintenance write replacing the legacy hand-rolled `listmonk_reload_app` tool. CLI: `listmonk-cli maintenance gc-subscribers|gc-unconfirmed` and `system reload`; MCP: `listmonk_gc_subscribers`, `listmonk_gc_unconfirmed_subscriptions`, `listmonk_reload_app`. — Thanks @imjlk!
- [4278da1](https://github.com/imjlk/listmonk-ops/commit/4278da15e86b083d9d8314e747a6b1769a8ada0b) Added the first shared bounce operations: `bounces.list` and `bounces.get` (experimental, 104 → 106 total descriptors). Bounce reads normalize the observed Listmonk 6.2 `/api/bounces` envelope (server-side `page`/`per_page` plus `campaign_id`, `source`, `order_by`, and `order` filters) into the shared page contract, and the single-bounce read tolerates both the observed flat record and the upstream OpenAPI document's collection-shaped response at the handwritten boundary instead of distorting generated types. The CLI gains `listmonk-cli bounces list|get`, and the MCP read tools `listmonk_get_bounces`/`listmonk_get_bounce` keep their legacy names while now projecting the shared operations with structured content. The legacy `subscriber_id` filter argument was dropped because Listmonk has no such query parameter on `/api/bounces` and it never reached the API; the destructive `listmonk_delete_bounce`/`listmonk_delete_bounces` tools remain transport-specific until their shared operations land. The flattened, exported `BounceOperations` client interface surfaces its methods as compiler-graph nodes so the shared read paths are architecture-checked end to end. — Thanks @imjlk!

## 0.7.1 — 2026-08-25

### Fixed

- [ae54654](https://github.com/imjlk/listmonk-ops/commit/ae54654dab146b2bbbf8e7ef09061573a66757b0) Use manual redirect handling for Cloudflare Workers transactional delivery — Thanks @imjlk!

## 0.7.0 — 2026-08-13

### Added

- [3d74ff2](https://github.com/imjlk/listmonk-ops/commit/3d74ff205417f9a2ab8b2b4d1041d564e53fe864) Allow Workers runtime transactional sends to select a validated From address and Listmonk messenger. — Thanks @imjlk!
- [7f8d7bd](https://github.com/imjlk/listmonk-ops/commit/7f8d7bd1190e34639c5a26b1a6a18cb55b47428f) Complete transactional messenger, subject, content-type, and multipart plain-text option parity across the Workers runtime, shared operations, CLI, MCP, and sequence automation. — Thanks @imjlk!

### Fixed

- [1e4644c](https://github.com/imjlk/listmonk-ops/commit/1e4644c3a57b3e08924bc2bc86b7e3a7fd5aa32f) Validate transactional From overrides as one mailbox across shared sends and sequence definitions, and align the published sender, messenger, and subject contracts with runtime parsing. — Thanks @imjlk!

## 0.6.0 — 2026-08-05

### Added

- [35b1354](https://github.com/imjlk/listmonk-ops/commit/35b13543893b7da1c3b97391d54f84e1d7e4029f) Add the tree-shakable `@listmonk-ops/openapi/runtime` entrypoint for Fetch-compatible
  services such as Cloudflare Workers. It normalizes Listmonk API origins, creates
  HTTPS-only token-authenticated clients, and sends single-recipient external
  transactional messages without creating subscribers. Runtime failures expose
  bounded error codes, diagnostic reasons, and HTTP status without copying remote
  bodies or recipient data. Requests use a configurable 30-second default timeout
  and expose aborts and timeouts as ambiguous, non-retry-safe outcomes. — Thanks @imjlk!

### Removed

- [1e16bbb](https://github.com/imjlk/listmonk-ops/commit/1e16bbb6fd8094f00d9558323921d7c3f13b8e65) Remove the `rawSdk` namespace export and replace dynamic CRUD method dispatch
  with direct named imports of the generated SDK functions.
  
  The previous `rawSdk = sdk` re-export and `import * as sdk` namespace usage in
  `crud.ts`, `resource-operations.ts`, and `service-operations.ts` forced
  bundlers to retain every generated SDK function, so consumer bundles always
  carried all 51 Listmonk endpoints even when the enhanced client never exposed
  them. Each CRUD slot now references a specific generated function through a
  named import, and slots with no backing endpoint (for example media
  create/update) fail lazily with a clear error instead of pinning the namespace.
  
  Measured impact on the published `dist/index.js` bundle: 30,453 → 27,127
  bytes (~11% smaller), with nine previously-retained endpoint URLs (public
  subscription, maintenance/GC, i18n, analytics cleanup) now stripped at build
  time.
  
  `rawSdk` was a documented module-level export with no in-repo or graph-traced
  consumers. Its removal is a breaking public API change. To call generated
  functions directly, use the `@listmonk-ops/openapi/sdk` subpath, which remains
  fully tree-shakeable. — Thanks @imjlk!

## 0.5.0 — 2026-08-02

### Added

- [a595f71](https://github.com/imjlk/listmonk-ops/commit/a595f716ba92a95de384e0aa07f6af54ffd90469) Add a typed Listmonk 6.2 user-role facade, declarative least-privilege role
  reconciliation, generic permission presets, and external-subscriber SDK smoke
  coverage. — Thanks @imjlk!

## 0.4.2 — 2026-07-30

### Changed

- [ca7e076](https://github.com/imjlk/listmonk-ops/commit/ca7e07630293cba676ca4962ed005583012ddee0) Update the shared esbuild toolchain to the patched 0.28.1 release — Thanks @imjlk!

## 0.4.1 — 2026-07-27

### Changed

- [a711306](https://github.com/imjlk/listmonk-ops/commit/a711306c3c6dc47b74bb0e262b6689c4bc4794c1) Update the OpenAPI spec README to remove a dangling reference to the deleted MISSING_API_ENDPOINTS.md document. — Thanks @imjlk!

## 0.4.0 — 2026-07-27

### Fixed

- [769ed92](https://github.com/imjlk/listmonk-ops/commit/769ed92f319ff70243d0ba22e6cb68c077ca3c44) Add deterministic SHA-256 assignment and chunked bulk membership to A/B test provisioning so retries and reconciliation never re-split the audience, and correct the subscriber manageLists `target_list_ids` type to an array (the Listmonk v6.2.0 server rejects scalars). Migrate the on-disk store to schema version 2 with backward-compatible v1 reads. Update automation hygiene to wrap targetListId in an array for the corrected manageLists signature. — Thanks @imjlk!

### Changed

- [05c99bc](https://github.com/imjlk/listmonk-ops/commit/05c99bca9bf9213124e60b14ab83b288962bf9a8) Add campaign lifecycle, subscriber bulk, transactional hardening, and media upload operations.
  
  Campaign lifecycle (6 new operations): schedule, start, pause, cancel, clone, stats. A new `campaign-lifecycle.ts` state machine rejects obviously invalid transitions before they reach Listmonk's status endpoint. `clone` copies body/lists/template under a new name and resets runtime fields.
  
  Subscriber bulk (4 new operations): add-to-lists, remove-from-lists, blocklist, unblocklist. The new `subscriber-bulk.ts` executor chunks subscriber IDs (default 500, fail-fast by default, optional continue-on-error) and supports dry-run and max-items cap.
  
  Transactional hardening: tighten recipient validation to exactly one of subscriber_email or subscriber_id (XOR), reject header values that smuggle CR/LF/NUL or other control characters, and block reserved transport headers.
  
  Media upload (1 new operation): upload media from base64-encoded contents with a MIME allowlist and a 10 MiB size cap. CLI `media upload --file <path>` reads via Bun.file and encodes the bytes.
  
  OpenAPI contract cleanup: extract CampaignOperations, SubscriberOperations, and MediaOperations into named interfaces mirroring TemplateOperations so the public types no longer rely on anonymous intersections. — Thanks @imjlk!

## 0.3.0 — 2026-07-23

### Changed

- [1150985](https://github.com/imjlk/listmonk-ops/commit/115098571442844ea837e4a851869a0ca0f7eee3) Route default-template selection through shared CLI and MCP operations with a stable Listmonk acknowledgement — Thanks @imjlk!

## 0.2.0 — 2026-07-20

### Changed

- [1d13791](https://github.com/imjlk/listmonk-ops/commit/1d1379148c9e6b9fe68411f40383cac1b2002962) Target Listmonk v6.2.0 with a reproducible upstream OpenAPI overlay, expose the renamed and newly documented API operations, and provision E2E credentials through Listmonk's hashed API-token flow. — Thanks @imjlk!

### Fixed

- [8ccc103](https://github.com/imjlk/listmonk-ops/commit/8ccc10341381036a05c1eb62241a1000fb563c7b) Stabilize OpenAPI response handling and MCP tools, add regression coverage for Listmonk workflows, and document the updated automation behavior. — Thanks @imjlk!
- [1518101](https://github.com/imjlk/listmonk-ops/commit/151810192825dbe9209c33dd90ed05f1606eacc6) Split the handwritten client into named namespace factories, preserve aborts
  during retry backoff, normalize bounce and media list operations, and add an
  opt-in generated SDK graph contract with direct factory tests. — Thanks @imjlk!

## 0.1.5 — 2026-03-14

### Changed

- [b225654](https://github.com/imjlk/listmonk-ops/commit/b225654b985bc3f5601af131dfccb53e53f2f093) Refresh workspace dependencies, add Renovate-based dependency automation, and generate Sampo changesets automatically for dependency PRs that touch releasable packages. — Thanks @imjlk!

## 0.1.4 — 2026-03-14

### Added

- [3b22b2c](https://github.com/imjlk/listmonk-ops/commit/3b22b2c455c5883e182702eb0bb7355e52528c91) Add a tree-shakable `@listmonk-ops/openapi/sdk` entrypoint, update the generated SDK to `@hey-api/openapi-ts@0.94.1`, and cover the raw client `buildUrl()` behavior with a regression test. — Thanks @imjlk!

## 0.1.3 — 2026-03-14

### Changed

- [55b04d5](https://github.com/imjlk/listmonk-ops/commit/55b04d5489bd19c85891e698903d80c6f64b6fd3) Stabilize external package consumption and release workflow setup.
  
  - `@listmonk-ops/openapi`
    - improved runtime fetch resilience with safer retry policy
    - fixed config merge behavior for explicit `retries: 0`
    - aligned package entrypoints and exports for external Node/Bun usage
  - `@listmonk-ops/automation`
    - package rename from legacy ops scope and workspace path normalization
    - publishable package metadata and docs cleanup for external reuse — Thanks @imjlk!

