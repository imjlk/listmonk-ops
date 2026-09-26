---
npm/@listmonk-ops/openapi: patch (Fixed)
npm/@listmonk-ops/operations: patch (Fixed)
npm/@listmonk-ops/mcp: patch (Fixed)
npm/@listmonk-ops/cli: patch (Fixed)
---

Align campaign and list writes with Listmonk 6.2. `campaigns.update` and `campaigns.schedule` now resend the stored target lists, media attachments, and attributes, because Listmonk's campaign `PUT` does not pre-fill them: every name-only update and every schedule previously failed with "Invalid list IDs", and a successful update would have detached media and overwritten attributes. Lifecycle transitions (schedule, start, pause, cancel) accept Listmonk 6.2's updated-campaign echo from `PUT /campaigns/{id}/status` as the acknowledgement instead of reporting an applied transition as a failure. `campaigns.archive` resends the stored slug, template, and metadata so toggling no longer clears the public archive link, `campaigns.clone` derives a fresh archive slug for archived sources instead of copying the unique slug, and `lists.update` carries the stored name and tags so partial updates neither fail nor clear tags. The OpenAPI overlay documents `archive_slug` on the archive endpoint and the client types the status echo.
