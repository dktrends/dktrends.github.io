const R2_BASE = "https://pub-90c04d7ea8c243e4830ffc8ba8bfd594.r2.dev";
const state = { radar: null, view: "now", offset: 0 };
// The first month retained in R2. Monthly archive controls run from now back to here.
const ARCHIVE_FIRST_MONTH = { year: 2026, month: 2 }; // March (zero-based month)
const $ = (selector, root = document) => root.querySelector(selector);
const $$ = (selector, root = document) => [...root.querySelectorAll(selector)];
const esc = (value = "") => String(value).replace(/[&<>'"]/g, char => ({"&":"&amp;","<":"&lt;",">":"&gt;","'":"&#39;",'"':"&quot;"})[char]);
const number = value => Number(value || 0).toLocaleString("ko-KR");
const pct = value => `${Number(value) > 0 ? "+" : ""}${Number(value || 0).toFixed(2).replace(/\.00$/, "")}%`;
const normalizedState = value => String(value || "watch").toLowerCase();
const THEME_ART = {
  "ai-infra":"ai-data-center.jpg", "ai-memory":"ai-data-center.jpg", "ai":"ai-data-center.jpg", "semiconductor":"ai-data-center.jpg",
  "secondary-battery":"ev-battery.jpg", "ev":"ev-battery.jpg", "renewable-energy":"ev-battery.jpg",
  "market":"market-chart.jpg", "finance":"market-chart.jpg", "value-up":"market-chart.jpg",
  "shipping":"supply-chain.jpg", "supply-chain":"supply-chain.jpg", "raw-materials":"supply-chain.jpg",
  "global-markets":"global-markets.jpg"
};
const THEME_LABELS = {
  "fuel-price-refining-margin":"정유·에너지",
  "kf21-long-range-aam-bid":"방위산업"
};
function themeArt(theme) {
  const key = theme.art || theme.background || theme.id || "market";
  return `assets/images/card-backgrounds/${THEME_ART[key] || THEME_ART.market}`;
}

function kstDate(date = new Date()) {
  return new Date(date.toLocaleString("en-US", { timeZone: "Asia/Seoul" }));
}
function formatKst(value, options) {
  return new Intl.DateTimeFormat("ko-KR", { timeZone: "Asia/Seoul", ...options }).format(new Date(value));
}
function isoWeek(date) {
  const target = new Date(Date.UTC(date.getFullYear(), date.getMonth(), date.getDate()));
  const day = target.getUTCDay() || 7;
  target.setUTCDate(target.getUTCDate() + 4 - day);
  const yearStart = new Date(Date.UTC(target.getUTCFullYear(), 0, 1));
  return { year: target.getUTCFullYear(), week: Math.ceil((((target - yearStart) / 86400000) + 1) / 7) };
}
function ymd(date) {
  return `${date.getFullYear()}-${String(date.getMonth()+1).padStart(2,"0")}-${String(date.getDate()).padStart(2,"0")}`;
}
function hhmm(value) { return formatKst(value, { hour:"2-digit", minute:"2-digit", hour12:false }); }

function updateClock() {
  const now = new Date();
  $("#clock-date").textContent = new Intl.DateTimeFormat("en-US", { timeZone:"Asia/Seoul", month:"short", day:"2-digit", year:"numeric" }).format(now);
  $("#clock-time").textContent = new Intl.DateTimeFormat("en-US", { timeZone:"Asia/Seoul", hour:"2-digit", minute:"2-digit", second:"2-digit", hour12:true }).format(now);
}

function sparkPoints(values) {
  if (!values || values.length < 2) return "2,28 92,28";
  const min = Math.min(...values), max = Math.max(...values), span = max - min || 1;
  return values.map((value, i) => `${2 + (i * 90 / (values.length - 1))},${30 - ((value - min) / span * 26)}`).join(" ");
}
function actionLabel(action) {
  return { detect:"포착", analyze:"분석", insight:"인사이트", risk:"위험", opportunity:"기회" }[action] || action;
}
function themeTitle(theme) {
  return theme.displayName || theme.category || THEME_LABELS[theme.id] || theme.name || "관심 테마";
}
function themeSummary(theme) {
  return theme.summary || theme.description || theme.name || "시장의 관심 흐름을 관찰 중입니다.";
}
function stockNames(theme) {
  return (theme.stocks || []).slice(0, 3).map(stock => stock.name || stock.code).filter(Boolean);
}
function safeUrl(value) {
  try {
    const url = new URL(value);
    return ["https:", "http:"].includes(url.protocol) ? url.href : "";
  } catch (_) { return ""; }
}
function evidenceList(items, emptyMessage) {
  if (!Array.isArray(items) || !items.length) return `<p class="dialog-empty">${esc(emptyMessage)}</p>`;
  return `<ul class="evidence-list">${items.map(item => {
    const url = safeUrl(item.url);
    const text = esc(item.text || "근거 설명 없음");
    return `<li>${url ? `<a href="${esc(url)}" target="_blank" rel="noopener noreferrer">${text}<span aria-hidden="true">↗</span></a>` : `<span>${text}</span>`}</li>`;
  }).join("")}</ul>`;
}
function themeCard(theme) {
  const stateValue = normalizedState(theme.state);
  const status = ["active","expanding"].includes(stateValue) ? "EXPANDING" : stateValue === "observe" ? "OBSERVE" : String(theme.state || "WATCH").toUpperCase();
  const names = stockNames(theme);
  const firstMetric = theme.confidence
    ? `<small>신뢰도</small><strong class="teal">${esc(String(theme.confidence).toUpperCase())}</strong>`
    : `<small>검색 관심도</small><strong class="teal">${pct(theme.attentionChange)}</strong>`;
  return `<button class="theme-card" type="button" data-theme-id="${esc(theme.id || "")}" aria-label="${esc(themeTitle(theme))} 조사 근거 열기">
    <span class="theme-art" style="background-image:url('${esc(themeArt(theme))}')"></span><span class="theme-content"><span class="status ${esc(stateValue)}">${esc(status)}</span>
    <span class="theme-name">${esc(themeTitle(theme))}</span><span class="theme-description">${esc(themeSummary(theme))}</span>
    <span class="theme-metrics"><span class="metric">${firstMetric}</span><span class="metric theme-stocks"><small>관련 종목 ${number(theme.relatedStocks ?? theme.stockCodes?.length ?? theme.stocks?.length)}개</small><strong>${esc(names.join(" · ") || "—")}</strong></span></span></span></button>`;
}
function openThemeDialog(theme) {
  if (!theme) return;
  const dialog = $("#theme-dialog");
  $("#theme-dialog-state").textContent = ["active", "expanding"].includes(normalizedState(theme.state)) ? "EXPANDING" : normalizedState(theme.state) === "observe" ? "OBSERVE" : String(theme.state || "WATCH").toUpperCase();
  $("#theme-dialog-title").textContent = themeTitle(theme);
  $("#theme-dialog-summary").textContent = themeSummary(theme);
  $("#theme-dialog-evidence").innerHTML = evidenceList(theme.evidence, "표시할 테마 근거가 없습니다.");
  $("#theme-dialog-stocks").innerHTML = (theme.stocks || []).map(stock => `<article class="dialog-stock"><div><strong>${esc(stock.name || stock.code || "—")}</strong><small>${esc(stock.code || "")}</small></div><p>${esc(stock.why || "관련 근거를 확인하세요.")}</p>${evidenceList(stock.evidence, "표시할 종목 근거가 없습니다.")}</article>`).join("") || '<p class="dialog-empty">표시할 관련 종목이 없습니다.</p>';
  if (!dialog.open) dialog.showModal();
}
function stockCard(stock) {
  const values = (stock.intraday || []).map(point => Number(point.price));
  const hasChange = stock.changePct != null && stock.changePct !== "";
  const direction = hasChange && Number(stock.changePct) > 0 ? "up" : hasChange && Number(stock.changePct) < 0 ? "down" : "";
  const actions = Array.isArray(stock.actions) ? stock.actions : String(stock.actions || "").split(",").filter(Boolean);
  const priceText = stock.price == null ? "₩—" : `₩${number(stock.price)}`;
  return `<a class="stock-card" href="https://stock.naver.com/domestic/stock/${encodeURIComponent(stock.code || "")}/price" target="_blank" rel="noopener noreferrer">
    <span class="stock-top"><span><span class="stock-name">${esc(stock.name || stock.code || "—")}</span>${stock.name ? `<span class="stock-code">${esc(stock.code || "—")}</span>` : ""}</span><span class="attention-dot"></span></span>
    <span class="stock-main"><span><span class="price">${priceText}</span><span class="change ${direction}">${hasChange ? pct(stock.changePct) : "—"}</span></span><svg class="spark" viewBox="0 0 94 34" aria-hidden="true"><polyline points="${sparkPoints(values)}"/></svg></span>
    <span class="stock-actions">${actions.map(action => `<span class="action ${esc(action)}">${esc(actionLabel(action))}</span>`).join("")}</span>
    <span class="stock-meta"><span class="stock-tag">신뢰도 ${esc(String(stock.confidence || stock.attention || "watch").toUpperCase())}</span><span>${esc(stock.market || "KRX")}</span></span></a>`;
}
function adaptRadar(data) {
  const themes = (data.themes || []).map(theme => ({ ...theme, state:normalizedState(theme.state), description:theme.description || theme.summary }));
  const nestedStocks = themes.flatMap(theme => (theme.stocks || []).map(stock => ({ ...stock, themeId:theme.id, themeName:theme.name })));
  const byCode = new Map();
  [...nestedStocks, ...(data.stocks || [])].forEach(stock => {
    const code = String(stock.code || "");
    if (!code) return;
    byCode.set(code, { ...(byCode.get(code) || {}), ...stock, code });
  });
  return { ...data, themes, stocks:[...byCode.values()] };
}
function renderRadar(data) {
  data = adaptRadar(data); state.radar = data;
  const themes = (data.themes || []).slice(0,2), stocks = (data.stocks || []).slice(0,6);
  $("#theme-grid").innerHTML = themes.length ? themes.map(themeCard).join("") : '<div class="message">현재 표시할 테마가 없습니다.</div>';
  $("#stock-grid").innerHTML = stocks.length ? stocks.map(stockCard).join("") : '<div class="message">현재 표시할 종목이 없습니다.</div>';
  $("#theme-count").textContent = themes.length; $("#stock-count").textContent = stocks.length;
  $("#radar-time").textContent = data.timeKst ? `${formatKst(data.timeKst,{month:"2-digit",day:"2-digit"})} ${hhmm(data.timeKst)} KST` : "—";
}
async function loadRadar() {
  $("#refresh-button").classList.add("loading");
  try {
    const response = await fetch(`${R2_BASE}/radar/latest.json?ts=${Date.now()}`, { cache:"no-store" });
    if (!response.ok) throw new Error(`HTTP ${response.status}`);
    renderRadar(await response.json());
  } catch (error) {
    try {
      const fallback = await fetch("data/radar/latest.json", { cache:"no-store" });
      if (!fallback.ok) throw new Error(`HTTP ${fallback.status}`);
      renderRadar(await fallback.json());
    } catch (_) {
      $("#theme-grid").innerHTML = `<div class="message">최신 Radar를 불러오지 못했습니다.<br>${esc(error.message)}</div>`;
      $("#stock-grid").innerHTML = '<div class="message">잠시 후 다시 시도해 주세요.</div>';
    }
  } finally {
    $("#refresh-button").classList.remove("loading");
    $("#loading-screen").classList.add("hidden");
  }
}

function archiveTarget(view, offset = 0) {
  const date = kstDate();
  if (view === "today") {
    date.setDate(date.getDate() - offset);
    return { url:`${R2_BASE}/indexes/daily/${ymd(date)}.json`, label:ymd(date), button:`${date.getMonth()+1}월 ${date.getDate()}일`, year:date.getFullYear(), month:date.getMonth(), day:date.getDate() };
  }
  if (view === "week") {
    date.setDate(date.getDate() - offset * 7);
    const value = isoWeek(date);
    return { url:`${R2_BASE}/indexes/weekly/${value.year}/week-${String(value.week).padStart(2,"0")}.json`, label:`${value.year}년 ${value.week}주차`, button:`${value.year}-W${value.week}`, year:value.year, week:value.week };
  }
  date.setMonth(date.getMonth() - offset);
  return { url:`${R2_BASE}/indexes/monthly/${date.getFullYear()}/month-${String(date.getMonth()+1).padStart(2,"0")}.json`, label:`${date.getFullYear()}년 ${date.getMonth()+1}월`, button:`${date.getFullYear()}-${date.getMonth()+1}월`, year:date.getFullYear(), month:date.getMonth() };
}
function archiveControlCount(view) {
  if (view === "today") return 7;
  if (view === "week") return 6;
  const now = kstDate();
  const monthsInRetention = (now.getFullYear() - ARCHIVE_FIRST_MONTH.year) * 12
    + now.getMonth() - ARCHIVE_FIRST_MONTH.month + 1;
  return Math.max(1, monthsInRetention);
}
function itemMatchesTarget(item, view, target) {
  const value = item.timeKst || item.time;
  if (!value) return false;
  const date = kstDate(new Date(value));
  if (view === "today") return date.getFullYear() === target.year && date.getMonth() === target.month && date.getDate() === target.day;
  if (view === "week") { const week = isoWeek(date); return week.year === target.year && week.week === target.week; }
  return date.getFullYear() === target.year && date.getMonth() === target.month;
}
function normalizeTheme(theme) { return Array.isArray(theme) ? { name:theme[0], state:theme[1] } : { ...theme, state:normalizedState(theme.state) }; }
function normalizeStock(stock) { return Array.isArray(stock) ? { code:stock[0], name:stock[1], changePct:stock[2], actions:stock[3], attention:stock[4] } : stock; }
function archiveTheme(theme) {
  return `<span class="mini-theme"><i aria-hidden="true">◎</i><b>${esc(theme.name || "—")}</b></span>`;
}
function archiveStock(stock) {
  const hasChange = stock.changePct != null && stock.changePct !== "";
  const direction = hasChange && Number(stock.changePct) > 0 ? "up" : hasChange && Number(stock.changePct) < 0 ? "down" : "";
  return `<a class="mini-stock" href="https://stock.naver.com/domestic/stock/${encodeURIComponent(stock.code || "")}/price" target="_blank" rel="noopener noreferrer"><b>${esc(stock.name || stock.code || "—")}</b>${stock.name ? `<small>${esc(stock.code || "—")}</small>` : ""}<i class="${direction}">${hasChange ? pct(stock.changePct) : "—"}</i></a>`;
}
function archiveCard(item) {
  const themes = (item.themes || []).slice(0,2).map(normalizeTheme);
  const sourceStocks = item.stocks?.length ? item.stocks : themes.flatMap(theme => theme.stocks || []);
  const stocks = [...new Map(sourceStocks.map(normalizeStock).filter(stock => stock.code).map(stock => [stock.code,stock])).values()].slice(0,6);
  const time = item.timeKst || item.time;
  return `<article class="archive-card">
    <header class="archive-time"><small>${time ? formatKst(time,{year:"numeric",month:"2-digit",day:"2-digit"}) : "—"}</small><strong>${time ? hhmm(time) : "—"}</strong><span>RADAR SNAPSHOT</span></header>
    <section class="archive-themes" aria-label="관심 테마"><small>THEMES</small>${themes.map(archiveTheme).join("")}</section>
    <section class="archive-stocks" aria-label="관심 종목">${stocks.map(archiveStock).join("")}</section>
  </article>`;
}
async function loadArchive(view, offset = 0) {
  const target = archiveTarget(view, offset);
  $("#archive-title").textContent = view === "today" ? "Today" : view === "week" ? "This Week" : "This Month";
  $("#archive-range").textContent = `${target.label}의 Radar Snapshot`;
  $("#archive-list").innerHTML = '<div class="message">데이터를 불러오는 중입니다.</div>';
  const controls = Array.from({length:archiveControlCount(view)}, (_,i) => archiveTarget(view,i));
  $("#archive-controls").innerHTML = controls.map((item,i) => `<button class="archive-control ${i===offset?"active":""}" data-offset="${i}" type="button">${esc(item.button)}</button>`).join("");
  try {
    const response = await fetch(target.url, { cache:"no-store" });
    if (!response.ok) throw new Error(`HTTP ${response.status}`);
    const data = await response.json();
    const items = (data.items || []).filter(item => itemMatchesTarget(item, view, target)).sort((a,b) => new Date(b.timeKst || b.time || 0) - new Date(a.timeKst || a.time || 0));
    $("#archive-count").textContent = `${items.length} RADAR${items.length === 1 ? "" : "S"}`;
    $("#archive-list").innerHTML = items.length ? items.map(archiveCard).join("") : '<div class="message">이 기간에 저장된 Radar가 없습니다.</div>';
  } catch (_) {
    $("#archive-count").textContent = "0 RADARS";
    $("#archive-list").innerHTML = '<div class="message">이 기간에 저장된 Radar가 없습니다.</div>';
  }
}
function setView(view) {
  state.view = view; state.offset = 0;
  $$(".period-nav a").forEach(link => link.classList.toggle("active", link.dataset.view === view));
  $("#view-now").classList.toggle("active", view === "now");
  $("#view-archive").classList.toggle("active", view !== "now");
  if (view !== "now") loadArchive(view);
}
document.addEventListener("click", event => {
  const nav = event.target.closest("[data-view], [data-view-link]"); if (nav) { event.preventDefault(); setView(nav.dataset.view || nav.dataset.viewLink); }
  const control = event.target.closest("[data-offset]"); if (control) { state.offset=Number(control.dataset.offset); loadArchive(state.view,state.offset); }
  const theme = event.target.closest("[data-theme-id]");
  if (theme) openThemeDialog((state.radar?.themes || []).find(item => String(item.id || "") === theme.dataset.themeId));
  if (event.target.closest("[data-dialog-close]")) $("#theme-dialog").close();
});
$("#refresh-button").addEventListener("click", loadRadar);
window.addEventListener("hashchange", () => { const view=location.hash.slice(1); if (["now","today","week","month"].includes(view)) setView(view); });
$("#year").textContent = new Date().getFullYear(); updateClock(); setInterval(updateClock,1000); loadRadar();
const initialView = location.hash.slice(1); if (["today","week","month"].includes(initialView)) setView(initialView);
