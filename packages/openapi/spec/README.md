# Listmonk OpenAPI provenance

The generated SDK targets Listmonk `v6.2.0`.

- Upstream tag: `v6.2.0`
- Upstream commit: `ef0a758e3dd55d0af530701551174a09a860b0e7`
- Source: <https://github.com/knadh/listmonk/blob/v6.2.0/docs/swagger/collections.yaml>
- Vendored SHA-256: `b9bacc15711f1e9c34260075f7226f81ddb672678b1b7c6f9b90757c21295c53`

Files:

- `upstream/listmonk-v6.2.0.yaml` is the unmodified tagged upstream specification.
- `listmonk-v6.2.0.overlay.patch` contains project-owned corrections and selected routes that exist in the tagged server but are absent or incorrect upstream.
- `listmonk.yaml` is the deterministic composed input consumed by Hey API.

Run `bun run --cwd packages/openapi compose:spec` after changing the overlay. The composer verifies the upstream checksum before applying the patch.

The overlay currently:

- keeps the optional `no_body` query parameter for `GET /templates`;
- documents `GET /about` so tests can verify the running Listmonk version;
- documents the v6.1+ `PATCH /subscribers/{id}` route;
- aligns campaign request/response fields with the tagged Go models, including
  visual content, test recipients, headers, media, and nullable timestamps;
- aligns transactional messages with the tagged `TxMessage` model, including
  recipient arrays, subscriber mode, subject, headers, and `altbody`.

The upstream specification does not cover every registered `/api` handler. See the repository-level `MISSING_API_ENDPOINTS.md` for the current coverage boundary.
