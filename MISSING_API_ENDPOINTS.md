# Listmonk v6.2 API coverage

**Updated:** 2026-07-20

**Server baseline:** Listmonk `v6.2.0` (`ef0a758e3dd55d0af530701551174a09a860b0e7`)

**Compared:** registered `/api` routes in `cmd/handlers.go` vs the composed `packages/openapi/spec/listmonk.yaml`

The previous report compared the v5.0.3 OpenAPI file only with the public API documentation and incorrectly described that as 100% server coverage. The v6.2.0 server registers more routes than either document exposes.

## Summary

- Registered v6.2.0 `/api` route-method pairs: **104**
- Operations in the composed SDK specification: **74**
- Registered operations not yet described: **30**
- Specification-only operations: **0**

Path parameter names are normalized during comparison, so `/lists/:id` and `/lists/{list_id}` count as the same route.

The local overlay already adds two important routes missing upstream:

- `GET /about`, used to verify the running server version
- `PATCH /subscribers/{id}`, introduced before v6.2 and supported by the current handler

It also corrects optional `GET /templates?no_body` behavior and the transactional `altbody` field. See `packages/openapi/spec/README.md` for provenance.

## Missing operational routes

These are the highest-value candidates for future SDK coverage:

- `DELETE /campaigns`
- `DELETE /lists`
- `GET /maintenance/analytics/{type}/export`
- `GET /subscribers/export`
- `GET /subscribers/{id}/activity`
- `POST /campaigns/{id}/preview/archive`
- `PUT /bounces/blocklist`
- `PUT /settings/{key}`

## Missing identity and administration routes

- `GET /events`
- `GET /profile`
- `PUT /profile`
- `GET /users`
- `GET /users/{id}`
- `POST /users`
- `PUT /users/{id}`
- `DELETE /users`
- `DELETE /users/{id}`
- `POST /logout`
- `GET /users/{id}/twofa/totp`
- `PUT /users/{id}/twofa`
- `DELETE /users/{id}/twofa`
- `GET /roles/users`
- `GET /roles/lists`
- `POST /roles/users`
- `POST /roles/lists`
- `PUT /roles/users/{id}`
- `PUT /roles/lists/{id}`
- `DELETE /roles/{id}`

## Missing public routes

- `GET /public/archive`
- `GET /public/captcha/altcha`

## Policy

The vendored upstream specification remains unmodified. Corrections or selected missing routes must be added to `packages/openapi/spec/listmonk-v6.2.0.overlay.patch`, followed by:

```bash
bun run --cwd packages/openapi generate
bun run --cwd packages/openapi test
```

Adding every registered route is not required for the enhanced client. Raw SDK additions should be prioritized by actual package usage, while the enhanced client should expose stable, task-oriented namespaces.
