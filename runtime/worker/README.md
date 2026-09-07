# DK Trends Radar ingest Worker

The Worker exposes only:

- `POST /v1/radar-ingestions`
- `GET /v1/radar-ingestions/{operationId}`

It routes both calls to `RADAR_WRITER.getByName("global-radar-writer")` and uses
the direct `RADAR_BUCKET` binding. R2 credentials are never used in source.

## Environments

- staging bucket: `dk-trends-ingest-staging`
- production bucket: `dk-trends`

Create and test staging first. Never point the synthetic test at production.

## Secret and deploy

From this directory, after authenticating Wrangler:

```text
pnpm install
pnpm exec wrangler r2 bucket create dk-trends-ingest-staging
pnpm exec wrangler secret put INGEST_TOKEN --env staging
pnpm run deploy:staging
```

Copy the staging Worker URL and the same token into the existing Apps Script
project's Script Properties as `DK_TRENDS_INGEST_URL` and
`DK_TRENDS_INGEST_TOKEN`.

Only after staging end-to-end verification:

```text
pnpm exec wrangler secret put INGEST_TOKEN --env production
pnpm run deploy:production
```
