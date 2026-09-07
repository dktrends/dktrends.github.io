# DK Trends Apps Script poller

Add `Code.gs` to the existing `DK_Trends` Apps Script project. The function
prefix is intentionally fixed to `DK_TRENDS_` to avoid collisions.

## Script Properties

- `DK_TRENDS_INGEST_URL`: deployed Worker base URL, without a trailing slash.
- `DK_TRENDS_INGEST_TOKEN`: the same secret stored as the Worker's
  `INGEST_TOKEN` secret.

Do not put either value in Drive documents or source control.

## Trigger

Create one time-driven trigger for `DK_TRENDS_processRadarHandoffs`. A five
minute interval is sufficient for the two-hour Radar schedule.

The poller resolves the exact folder lineage on every run. It ignores every
document whose title is not `RADAR__{radarId}__{UUID}`. `Processing` is the
recovery queue; no separate queue or database is used.

## Installation check

Before adding this file, search the existing project for `DK_TRENDS_`. If any
matching functions already exist, compare them rather than creating duplicates.
