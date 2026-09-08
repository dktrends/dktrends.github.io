export interface Evidence {
  text: string;
  url: string;
}

export interface RadarStock {
  code: string;
  name?: string;
  market?: string;
  confidence?: string;
  why?: string;
  evidence?: Evidence[];
  [key: string]: unknown;
}

export interface RadarTheme {
  id?: string;
  name?: string;
  state?: string;
  confidence?: string;
  summary?: string;
  evidence?: Evidence[];
  stocks?: RadarStock[];
  [key: string]: unknown;
}

export interface Radar {
  schema?: string;
  radarId: string;
  timeKst: string;
  themes: RadarTheme[];
  [key: string]: unknown;
}

export interface IngestEnvelope {
  contractVersion: 'dk.radar-ingest.v1';
  operation: 'UPSERT_RADAR';
  requestedAtKst: string;
  radar: Radar;
  metadata: {
    producer: string;
    producerVersion: string;
    driveFileId: string;
  };
}

export type OperationStatus = 'PENDING' | 'PROCESSING' | 'DONE' | 'FAILED';

export interface PublicResult {
  operationId: string;
  radarId: string;
  status: OperationStatus;
  verified: boolean;
  completedAtKst?: string;
  stage?: string;
  retryable?: boolean;
  error?: { code: string };
}

export interface StoredOperation {
  operationId: string;
  radarId: string;
  payloadHash: string;
  status: OperationStatus;
  result: PublicResult;
}

export interface PeriodIndex {
  updatedAt: string;
  items: Radar[];
}

export interface PricePoint {
  observedAtKst: string;
  price: number;
}

export interface PriceSnapshotStock {
  code: string;
  price: number;
  changePct?: number;
  intraday?: PricePoint[];
}

export interface PriceSnapshot {
  radarId: string;
  observedAtKst: string;
  stocks: PriceSnapshotStock[];
}
