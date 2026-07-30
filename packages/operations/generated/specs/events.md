# Email Operations Events

> Generated from `@listmonk-ops/operations/specs`. Do not edit manually.

| Event | Source | Subject | Meaning |
|---|---|---|---|
| `operation.started` | `operation` | `operation` | A shared CLI or MCP operation entered its audited execution. |
| `operation.blocked` | `operation` | `operation` | A shared operation was blocked by confirmation or safety policy. |
| `operation.succeeded` | `operation` | `operation` | A shared operation completed successfully. |
| `operation.failed` | `operation` | `operation` | A shared operation completed with an error. |
| `campaign.scheduled` | `listmonk` | `campaign` | A campaign was scheduled for future delivery. |
| `campaign.started` | `listmonk` | `campaign` | A campaign entered active delivery. |
| `campaign.paused` | `listmonk` | `campaign` | A running or scheduled campaign was paused. |
| `campaign.cancelled` | `listmonk` | `campaign` | A campaign was cancelled. |
| `campaign.finished` | `listmonk` | `campaign` | A campaign completed delivery. |
| `subscriber.created` | `listmonk` | `subscriber` | A subscriber record was created. |
| `subscriber.updated` | `listmonk` | `subscriber` | A subscriber record changed. |
| `subscriber.blocklisted` | `listmonk` | `subscriber` | A subscriber was added to the blocklist. |
| `subscriber.unsubscribed` | `listmonk` | `subscriber` | A subscriber opted out of one or more lists. |
| `delivery.delivered` | `provider` | `message` | A provider reported successful message delivery. |
| `delivery.bounced` | `provider` | `message` | A provider reported a message bounce. |
| `delivery.complained` | `provider` | `message` | A provider reported a recipient complaint. |
| `delivery.delayed` | `provider` | `message` | A provider reported delayed message delivery. |
| `delivery.rejected` | `provider` | `message` | A provider rejected a message before successful delivery. |
| `abtest.started` | `abtest` | `experiment` | An experiment began sending variants. |
| `abtest.ready-for-analysis` | `abtest` | `experiment` | An experiment reached its fixed-horizon analysis gate. |
| `abtest.winner-selected` | `abtest` | `experiment` | An experiment selected a statistically valid winner. |
| `abtest.inconclusive` | `abtest` | `experiment` | An experiment completed without a valid winner. |
| `abtest.failed` | `abtest` | `experiment` | An experiment entered an unrecoverable failure state. |
| `sequence.created` | `sequence` | `sequence` | A durable sequence definition was created. |
| `sequence.revised` | `sequence` | `sequence` | An immutable sequence revision was appended. |
| `sequence.enrolled` | `sequence` | `sequence` | A subscriber was pinned to a sequence revision. |
| `sequence.paused` | `sequence` | `sequence` | A sequence stopped claiming due enrollments. |
| `sequence.resumed` | `sequence` | `sequence` | A paused sequence resumed claiming due enrollments. |
| `sequence.reconciled` | `sequence` | `sequence` | An operator resolved an ambiguous sequence send outcome. |
| `sequence.deleted` | `sequence` | `sequence` | A sequence and its terminal enrollment history were deleted. |
| `webhook.test` | `webhook` | `webhook` | A signed test event was sent to one configured endpoint. |
| `list.created` | `operation` | `list` | A shared operation created a Listmonk subscriber list. |
| `list.updated` | `operation` | `list` | A shared operation changed a subscriber list. |
| `list.deleted` | `operation` | `list` | A shared operation deleted a subscriber list. |
| `subscriber.deleted` | `operation` | `subscriber` | A shared operation deleted a subscriber. |
| `subscriber.membership-updated` | `operation` | `subscriber` | A bulk operation changed subscriber list memberships. |
| `subscriber.unblocklisted` | `operation` | `subscriber` | A bulk operation removed subscribers from the blocklist. |
| `template.created` | `operation` | `template` | A shared operation created an email template. |
| `template.updated` | `operation` | `template` | A shared operation or registry workflow changed a template. |
| `template.default-set` | `operation` | `template` | A shared operation selected the Listmonk default template. |
| `template.deleted` | `operation` | `template` | A shared operation deleted an email template. |
| `media.uploaded` | `operation` | `media` | A validated media asset was uploaded to Listmonk. |
| `media.deleted` | `operation` | `media` | A shared operation deleted a media asset. |
| `audience.drift-detected` | `operation` | `audience` | A segment snapshot crossed its configured drift threshold. |
| `abtest.created` | `abtest` | `experiment` | An experiment definition was persisted. |
| `abtest.stopped` | `abtest` | `experiment` | An experiment was cancelled and cleanup was requested. |
| `abtest.deleted` | `abtest` | `experiment` | An experiment was removed from persisted state. |
| `abtest.reconciled` | `abtest` | `experiment` | Experiment state was compared with its remote resources. |
