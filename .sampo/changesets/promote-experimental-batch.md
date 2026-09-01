---
npm/@listmonk-ops/operations: minor
---

Promoted the seven experimental descriptors to stable (104 → 111 stable contracts, no experimental descriptors remain): the bounce family (`bounces.list`, `bounces.get`, `bounces.delete`, `bounces.prune`) and the campaign preview, test-send, and analytics operations (`campaigns.preview`, `campaigns.test`, `campaigns.analytics`). Their observed Listmonk 6.2 response and acknowledgement shapes — the flat single-bounce record, the missing-id delete acknowledgement, the repeated-id analytics parameters, and the campaign-form test-send rebinding — were verified against the local stack across the introducing PRs, and the stable compatibility baseline was re-accepted (111 contracts).
