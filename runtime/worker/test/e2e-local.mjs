import { readFile } from 'node:fs/promises';

const baseUrl = process.env.DK_TRENDS_TEST_URL ?? 'http://127.0.0.1:8787';
const token = process.env.DK_TRENDS_TEST_TOKEN ?? 'local-dk-trends-ingest-test-token-2026';
const operationId = process.env.DK_TRENDS_TEST_OPERATION_ID ?? '550e8400-e29b-41d4-a716-446655440000';
const radar = JSON.parse(await readFile(new URL('./synthetic-radar.json', import.meta.url), 'utf8'));
const envelope = {
  contractVersion: 'dk.radar-ingest.v1',
  operation: 'UPSERT_RADAR',
  requestedAtKst: '2026-09-08T15:31:00+09:00',
  radar,
  metadata: {
    producer: 'chatgpt-plus-drive-handoff',
    producerVersion: '1.0',
    driveFileId: 'synthetic-local-test',
  },
};
const headers = {
  Authorization: `Bearer ${token}`,
  'Idempotency-Key': operationId,
  'Content-Type': 'application/json',
};

const postResponse = await fetch(`${baseUrl}/v1/radar-ingestions`, {
  method: 'POST', headers, body: JSON.stringify(envelope),
});
const post = await postResponse.json();
const getResponse = await fetch(`${baseUrl}/v1/radar-ingestions/${operationId}`, {
  headers: { Authorization: `Bearer ${token}` },
});
const get = await getResponse.json();

console.log(JSON.stringify({ postStatus: postResponse.status, post, getStatus: getResponse.status, get }, null, 2));
if (postResponse.status !== 200 || getResponse.status !== 200 || post.status !== 'DONE' || post.verified !== true || get.status !== 'DONE') {
  process.exitCode = 1;
}
