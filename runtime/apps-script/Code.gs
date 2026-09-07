/**
 * DK Trends Drive handoff poller.
 *
 * Install this file in the existing DK_Trends Apps Script project, set the two
 * Script Properties documented in README.md, and add a time-driven trigger for
 * DK_TRENDS_processRadarHandoffs.
 */

const DK_TRENDS_CONFIG_ = Object.freeze({
  rootName: 'DK_Trends',
  handoffName: 'Radar_Handoff',
  inboxName: 'Inbox',
  processingName: 'Processing',
  processedName: 'Processed',
  failedName: 'Failed',
  resultsName: 'Results',
  radarMimeType: MimeType.GOOGLE_DOCS,
  producer: 'chatgpt-plus-drive-handoff',
  producerVersion: '1.0',
  maxHttpAttempts: 3,
});

function DK_TRENDS_processRadarHandoffs() {
  const lock = LockService.getScriptLock();
  if (!lock.tryLock(1000)) return;

  try {
    const folders = DK_TRENDS_resolveFolders_();

    // Recovery items are checked before new Inbox work.
    DK_TRENDS_listRadarDocs_(folders.processing).forEach(function (file) {
      DK_TRENDS_processRadarItem_(file, folders, true);
    });

    DK_TRENDS_listRadarDocs_(folders.inbox).forEach(function (file) {
      DK_TRENDS_moveFile_(file.getId(), folders.inbox.getId(), folders.processing.getId());
      DK_TRENDS_processRadarItem_(file, folders, false);
    });
  } finally {
    lock.releaseLock();
  }
}

function DK_TRENDS_processRadarItem_(file, folders, isRecovery) {
  let titleInfo;
  let radar;

  try {
    titleInfo = DK_TRENDS_parseRadarTitle_(file.getName());
    const text = DocumentApp.openById(file.getId()).getBody().getText().trim();
    radar = JSON.parse(text);
    DK_TRENDS_validateRadarHandoff_(radar, titleInfo);
  } catch (error) {
    const result = DK_TRENDS_failureResult_(
      titleInfo && titleInfo.operationId,
      titleInfo && titleInfo.radarId,
      'VALIDATE_HANDOFF',
      'INVALID_HANDOFF',
      false
    );
    DK_TRENDS_finishItem_(file, folders, result, false);
    return;
  }

  try {
    if (isRecovery) {
      const status = DK_TRENDS_getIngestionStatus_(titleInfo.operationId);
      if (status && status.status === 'DONE') {
        DK_TRENDS_finishItem_(file, folders, status, true);
        return;
      }
      if (status && status.status === 'PROCESSING') return;
      if (status && status.status === 'FAILED' && status.retryable === false) {
        DK_TRENDS_finishItem_(file, folders, status, false);
        return;
      }
    }

    const envelope = DK_TRENDS_buildIngestEnvelope_(radar, file.getId());
    const result = DK_TRENDS_callIngestWorker_(envelope, titleInfo.operationId);

    if (result.status === 'DONE') {
      DK_TRENDS_finishItem_(file, folders, result, true);
    } else if (result.status === 'FAILED' && result.retryable === false) {
      DK_TRENDS_finishItem_(file, folders, result, false);
    }
    // PROCESSING or retryable FAILED remains in Processing for the next poll.
  } catch (error) {
    console.error(JSON.stringify({
      event: 'radar_handoff_transient_failure',
      fileId: file.getId(),
      operationId: titleInfo.operationId,
      message: String(error && error.message || error),
    }));
  }
}

function DK_TRENDS_parseRadarTitle_(title) {
  const match = /^RADAR__(\d{8}-\d{4})__([0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12})$/i.exec(title);
  if (!match) throw new Error('INVALID_RADAR_TITLE');
  return { radarId: match[1], operationId: match[2].toLowerCase() };
}

function DK_TRENDS_validateRadarHandoff_(radar, titleInfo) {
  if (!radar || typeof radar !== 'object' || Array.isArray(radar)) throw new Error('RADAR_NOT_OBJECT');
  if (typeof radar.radarId !== 'string' || !/^\d{8}-\d{4}$/.test(radar.radarId)) throw new Error('INVALID_RADAR_ID');
  if (typeof radar.timeKst !== 'string' || !/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d{1,3})?\+09:00$/.test(radar.timeKst)) throw new Error('INVALID_TIME_KST');
  if (!Array.isArray(radar.themes)) throw new Error('THEMES_NOT_ARRAY');
  if (radar.radarId !== titleInfo.radarId) throw new Error('TITLE_RADAR_ID_MISMATCH');

  const expectedId = radar.timeKst.slice(0, 10).replace(/-/g, '') + '-' + radar.timeKst.slice(11, 16).replace(':', '');
  if (expectedId !== radar.radarId) throw new Error('RADAR_TIME_MISMATCH');

  radar.themes.forEach(function (theme) {
    if (theme.stocks === undefined) return;
    if (!Array.isArray(theme.stocks)) throw new Error('STOCKS_NOT_ARRAY');
    theme.stocks.forEach(function (stock) {
      if (!stock || typeof stock.code !== 'string' || !/^\d{6}$/.test(stock.code)) {
        throw new Error('INVALID_STOCK_CODE');
      }
    });
  });
}

function DK_TRENDS_buildIngestEnvelope_(radar, fileId) {
  return {
    contractVersion: 'dk.radar-ingest.v1',
    operation: 'UPSERT_RADAR',
    requestedAtKst: DK_TRENDS_nowKst_(),
    radar: radar,
    metadata: {
      producer: DK_TRENDS_CONFIG_.producer,
      producerVersion: DK_TRENDS_CONFIG_.producerVersion,
      driveFileId: fileId,
    },
  };
}

function DK_TRENDS_callIngestWorker_(envelope, operationId) {
  const url = DK_TRENDS_requiredProperty_('DK_TRENDS_INGEST_URL').replace(/\/$/, '') + '/v1/radar-ingestions';
  return DK_TRENDS_fetchJson_(url, {
    method: 'post',
    contentType: 'application/json',
    payload: JSON.stringify(envelope),
    headers: DK_TRENDS_headers_(operationId),
    muteHttpExceptions: true,
  });
}

function DK_TRENDS_getIngestionStatus_(operationId) {
  const url = DK_TRENDS_requiredProperty_('DK_TRENDS_INGEST_URL').replace(/\/$/, '') +
    '/v1/radar-ingestions/' + encodeURIComponent(operationId);
  const result = DK_TRENDS_fetchJson_(url, {
    method: 'get',
    headers: DK_TRENDS_headers_(null),
    muteHttpExceptions: true,
  }, true);
  return result && result.notFound ? null : result;
}

function DK_TRENDS_writeResult_(result, folders) {
  const title = 'RESULT__' + result.radarId + '__' + result.operationId;
  const matches = folders.results.getFilesByName(title);
  let document;

  if (matches.hasNext()) {
    const file = matches.next();
    if (matches.hasNext()) throw new Error('DUPLICATE_RESULT_DOCUMENTS');
    document = DocumentApp.openById(file.getId());
  } else {
    document = DocumentApp.create(title);
    DriveApp.getFileById(document.getId()).moveTo(folders.results);
  }

  const publicResult = {
    operationId: result.operationId,
    radarId: result.radarId,
    status: result.status,
    verified: result.status === 'DONE' && result.verified === true,
    completedAtKst: result.completedAtKst || DK_TRENDS_nowKst_(),
  };

  if (result.status === 'FAILED') {
    publicResult.stage = result.stage || 'UNKNOWN';
    publicResult.retryable = result.retryable === true;
    publicResult.error = { code: result.error && result.error.code || 'UNKNOWN_ERROR' };
  }

  document.getBody().setText(JSON.stringify(publicResult));
  document.saveAndClose();
}

function DK_TRENDS_moveFile_(fileId, fromFolderId, toFolderId) {
  const file = DriveApp.getFileById(fileId);
  const currentParents = file.getParents();
  let hasFrom = false;
  while (currentParents.hasNext()) {
    if (currentParents.next().getId() === fromFolderId) hasFrom = true;
  }
  if (!hasFrom) throw new Error('SOURCE_PARENT_NOT_FOUND');
  file.moveTo(DriveApp.getFolderById(toFolderId));
}

function DK_TRENDS_finishItem_(file, folders, result, succeeded) {
  DK_TRENDS_writeResult_(result, folders);
  DK_TRENDS_moveFile_(
    file.getId(),
    folders.processing.getId(),
    succeeded ? folders.processed.getId() : folders.failed.getId()
  );
}

function DK_TRENDS_listRadarDocs_(folder) {
  const files = folder.getFilesByType(DK_TRENDS_CONFIG_.radarMimeType);
  const result = [];
  while (files.hasNext()) {
    const file = files.next();
    if (/^RADAR__\d{8}-\d{4}__[0-9a-f-]{36}$/i.test(file.getName())) result.push(file);
  }
  return result;
}

function DK_TRENDS_resolveFolders_() {
  const root = DK_TRENDS_uniqueChildFolder_(DriveApp.getRootFolder(), DK_TRENDS_CONFIG_.rootName);
  const handoff = DK_TRENDS_uniqueChildFolder_(root, DK_TRENDS_CONFIG_.handoffName);
  return {
    root: root,
    handoff: handoff,
    inbox: DK_TRENDS_uniqueChildFolder_(handoff, DK_TRENDS_CONFIG_.inboxName),
    processing: DK_TRENDS_uniqueChildFolder_(handoff, DK_TRENDS_CONFIG_.processingName),
    processed: DK_TRENDS_uniqueChildFolder_(handoff, DK_TRENDS_CONFIG_.processedName),
    failed: DK_TRENDS_uniqueChildFolder_(handoff, DK_TRENDS_CONFIG_.failedName),
    results: DK_TRENDS_uniqueChildFolder_(handoff, DK_TRENDS_CONFIG_.resultsName),
  };
}

function DK_TRENDS_uniqueChildFolder_(parent, exactName) {
  const matches = parent.getFoldersByName(exactName);
  if (!matches.hasNext()) throw new Error('MISSING_FOLDER_' + exactName);
  const folder = matches.next();
  if (matches.hasNext()) throw new Error('DUPLICATE_FOLDER_' + exactName);
  return folder;
}

function DK_TRENDS_headers_(operationId) {
  const headers = { Authorization: 'Bearer ' + DK_TRENDS_requiredProperty_('DK_TRENDS_INGEST_TOKEN') };
  if (operationId) headers['Idempotency-Key'] = operationId;
  return headers;
}

function DK_TRENDS_fetchJson_(url, options, allow404) {
  let lastError;
  for (let attempt = 1; attempt <= DK_TRENDS_CONFIG_.maxHttpAttempts; attempt += 1) {
    try {
      const response = UrlFetchApp.fetch(url, options);
      const status = response.getResponseCode();
      if (allow404 && status === 404) return { notFound: true };
      const text = response.getContentText();
      const parsed = text ? JSON.parse(text) : {};
      if (status >= 200 && status < 300) return parsed;
      if (status < 500 && status !== 408 && status !== 429) return parsed;
      lastError = new Error('HTTP_' + status);
    } catch (error) {
      lastError = error;
    }
    if (attempt < DK_TRENDS_CONFIG_.maxHttpAttempts) Utilities.sleep(attempt * 500);
  }
  throw lastError || new Error('HTTP_REQUEST_FAILED');
}

function DK_TRENDS_requiredProperty_(name) {
  const value = PropertiesService.getScriptProperties().getProperty(name);
  if (!value) throw new Error('MISSING_SCRIPT_PROPERTY_' + name);
  return value;
}

function DK_TRENDS_nowKst_() {
  return Utilities.formatDate(new Date(), 'Asia/Seoul', "yyyy-MM-dd'T'HH:mm:ssXXX");
}

function DK_TRENDS_failureResult_(operationId, radarId, stage, code, retryable) {
  return {
    operationId: operationId || 'unknown',
    radarId: radarId || 'unknown',
    status: 'FAILED',
    verified: false,
    stage: stage,
    retryable: retryable === true,
    error: { code: code },
    completedAtKst: DK_TRENDS_nowKst_(),
  };
}
