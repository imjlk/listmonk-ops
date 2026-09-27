---
npm/@listmonk-ops/openapi: minor (Changed)
---

Align the campaign preview SDK wrappers with the Listmonk 6.2 handler. `campaign.updatePreview` and `campaign.previewText` now accept `content_type`, which 6.2 reads on every submitted preview: without it a markdown body is not converted and a plain body is served as HTML. `campaign.updatePreview` is now typed to resolve to the rendered body string it always returned, not a `boolean`, so TypeScript code that treated the result as a boolean must be updated. Both calls already sent their fields form-urlencoded, which is how the handler reads them with `FormValue`; tests now pin that encoding.
