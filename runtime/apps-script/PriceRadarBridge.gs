/**
 * DK Trends — PriceRadarBridge.gs
 *
 * Adds a live-price overlay to the current Radar without rewriting Radar,
 * archive, Drive handoff, or R2 index objects.
 */
const DK_PRICE_RADAR_BRIDGE = Object.freeze({
  R2_BASE: 'https://pub-90c04d7ea8c243e4830ffc8ba8bfd594.r2.dev',
  MAX_POINTS: 20,
  TIMEZONE: 'Asia/Seoul',
});

function DK_TRENDS_getLatestRadarPriceWatchlist_() {
  const radar = DK_TRENDS_readLatestRadarForPrices_();
  const seen = {};
  (radar.themes || []).forEach(function(theme) {
    (theme.stocks || []).forEach(function(stock) {
      if (!stock || !/^\d{6}$/.test(String(stock.code || '')) || seen[stock.code]) return;
      seen[stock.code] = {
        name: stock.name || stock.code,
        code: String(stock.code),
        ticker: (stock.market === 'KOSDAQ' ? 'KOSDAQ:' : 'KRX:') + String(stock.code),
      };
    });
  });
  return Object.keys(seen).map(function(code) { return seen[code]; });
}

function DK_TRENDS_publishCurrentRadarPrices(collection) {
  collection = collection || collectPriceObservations_(DK_TRENDS_getLatestRadarPriceWatchlist_());
  const radar = DK_TRENDS_readLatestRadarForPrices_();
  const successful = (collection && collection.observations || []).filter(function(row) {
    return row && /^\d{6}$/.test(String(row.code || '')) && Number(row.price) > 0;
  });
  if (!successful.length) return { ok: false, reason: 'NO_PRICE_OBSERVATIONS' };

  const sheet = getOrCreatePriceStore_().getSheetByName(DK_PRICE.SHEET_NAME);
  const payload = {
    radarId: radar.radarId,
    observedAtKst: DK_TRENDS_priceNowKst_(),
    stocks: successful.map(function(row) {
      return {
        code: String(row.code),
        price: Number(row.price),
        changePct: DK_TRENDS_optionalNumber_(row.changePct),
        intraday: DK_TRENDS_intradayPoints_(sheet, String(row.code)),
      };
    }),
  };
  payload.stocks.forEach(function(stock) { if (stock.changePct == null) delete stock.changePct; });

  const url = PropertiesService.getScriptProperties().getProperty('DK_TRENDS_INGEST_URL').replace(/\/$/, '') + '/v1/price-snapshots';
  const response = UrlFetchApp.fetch(url, {
    method: 'post', contentType: 'application/json', muteHttpExceptions: true,
    headers: { Authorization: 'Bearer ' + PropertiesService.getScriptProperties().getProperty('DK_TRENDS_INGEST_TOKEN') },
    payload: JSON.stringify(payload),
  });
  const body = response.getContentText();
  if (response.getResponseCode() < 200 || response.getResponseCode() >= 300) throw new Error('PRICE_PUBLISH_FAILED: ' + body);
  return JSON.parse(body);
}

/** Manually refresh the current Radar outside the scheduled collection slots. */
function A_refreshCurrentRadarPrices() {
  const collection = collectPriceObservations_(DK_TRENDS_getLatestRadarPriceWatchlist_());
  if (!collection || !collection.succeeded) throw new Error('NO_PRICE_OBSERVATIONS_COLLECTED');
  return DK_TRENDS_publishCurrentRadarPrices(collection);
}

function DK_TRENDS_readLatestRadarForPrices_() {
  const response = UrlFetchApp.fetch(DK_PRICE_RADAR_BRIDGE.R2_BASE + '/radar/latest.json?ts=' + Date.now(), { muteHttpExceptions: true });
  if (response.getResponseCode() !== 200) throw new Error('LATEST_RADAR_UNAVAILABLE');
  const radar = JSON.parse(response.getContentText());
  if (!radar || !/^\d{8}-\d{4}$/.test(radar.radarId || '')) throw new Error('INVALID_LATEST_RADAR');
  return radar;
}

function DK_TRENDS_intradayPoints_(sheet, code) {
  const rows = sheet.getDataRange().getValues().slice(1).filter(function(row) { return String(row[3]) === code && Number(row[5]) > 0; }).slice(-DK_PRICE_RADAR_BRIDGE.MAX_POINTS);
  return rows.map(function(row) { return { observedAtKst: DK_TRENDS_normalizeObservedAt_(row[0]), price: Number(row[5]) }; });
}

function DK_TRENDS_normalizeObservedAt_(value) {
  if (value instanceof Date) return Utilities.formatDate(value, DK_PRICE_RADAR_BRIDGE.TIMEZONE, "yyyy-MM-dd'T'HH:mm:ss+09:00");
  const text = String(value || '');
  if (/\+09:00$/.test(text)) return text;
  return DK_TRENDS_priceNowKst_();
}

function DK_TRENDS_priceNowKst_() {
  return Utilities.formatDate(new Date(), DK_PRICE_RADAR_BRIDGE.TIMEZONE, "yyyy-MM-dd'T'HH:mm:ss+09:00");
}

function DK_TRENDS_optionalNumber_(value) {
  if (value == null || value === '') return null;
  const number = Number(String(value).replace(/,/g, '').replace(/%$/, ''));
  return isFinite(number) ? number : null;
}
