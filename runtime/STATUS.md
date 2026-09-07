# Runtime deployment status

Updated: 2026-09-08 KST

- Drive folders: created under `DK_Trends/Radar_Handoff`.
- Apps Script: `DriveRadarPoller.gs` installed in the existing `DK_Trends`
  project.
- Apps Script time zone: Korean Standard Time / Seoul.
- Poller trigger: every 5 minutes.
- Staging Worker: deployed and bound to `dk-trends-ingest-staging`.
- Production Worker: deployed and bound to `dk-trends`.
- Secrets: stored only in Cloudflare Worker secrets and Apps Script
  Properties.
- Staging end-to-end test: PASS for operation
  `20083b3a-a550-4b72-b609-e036ad477009`.
- Production synthetic write: intentionally not run.

The staging test verified Drive Inbox -> Processing -> Worker -> Durable Object
-> original/latest/daily/weekly/monthly R2 objects -> RESULT DONE -> Processed.
