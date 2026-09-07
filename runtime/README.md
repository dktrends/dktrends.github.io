# DK Trends ingestion runtime

- `apps-script/`: Drive Inbox poller and recovery logic.
- `worker/`: authenticated Worker, global RadarWriter Durable Object, and R2
  original/latest/period-index writer.

Production data is not used for the first test. Follow each subdirectory's
README and validate the staging bucket before configuring production.
