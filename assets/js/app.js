const R2_BASE = "https://pub-90c04d7ea8c243e4830ffc8ba8bfd594.r2.dev";
const state = { radar: null, view: "now", offset: 0 };
const $ = (selector, root = document) => root.querySelector(selector);
const $$ = (selector, root = document) => [...root.querySelectorAll(selector)];
const esc = (value = "") => String(value).replace(/[&<>'"]/g, char => ({"&":"&amp;","<":"&lt;",">":"&gt;","'":"&#39;",'"':"&quot;"})[char]);
const number = value => Number(value || 0).toLocaleString("ko-KR");
const pct = value => `${Number(value) > 0 ? "+" : ""}${Number(value || 0).toFixed(2).replace(/\.00$/, "")}%`;
const THEME_ART = {
  "ai-infra":"ai-data-center.jpg", "ai":"ai-data-center.jpg", "semiconductor":"ai-data-center.jpg",
  "secondary-battery":"ev-battery.jpg", "ev":"ev-battery.jpg", "renewable-energy":"ev-battery.jpg",
  "market":"market-chart.jpg", "finance":"market-chart.jpg", "value-up":"market-chart.jpg",
  "shipping":"supply-chain.jpg", "supply-chain":"supply-chain.jpg", "raw-materials":"supply-chain.jpg",
  "global-markets":"global-markets.jpg"
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
function themeCard(theme) {
  const status = theme.state === "active" ? "EXPANDING" : theme.state === "observe" ? "OBSERVE" : String(theme.state || "WATCH").toUpperCase();
  return `<div class="theme-card">
    <span class="theme-art" style="background-image:url('${esc(themeArt(theme))}')"></span><span class="theme-content"><span class="status ${esc(theme.state)}">${esc(status)}</span>
    <span class="theme-name">${esc(theme.name)}</span><span class="theme-description">${esc(theme.description || "시장의 관심 흐름을 관찰 중입니다.")}</span>
    <span class="theme-metrics"><span class="metric"><small>검색 관심도</small><strong class="teal">${pct(theme.attentionChange)}</strong></span><span class="metric"><small>관련 종목</small><strong>${number(theme.relatedStocks || theme.stockCodes?.length)}개</strong></span></span></span></div>`;
}
function stockCard(stock) {
  const values = (stock.intraday || []).map(point => Number(point.price));
  const direction = Number(stock.changePct) > 0 ? "up" : Number(stock.changePct) < 0 ? "down" : "";
  const actions = Array.isArray(stock.actions) ? stock.actions : String(stock.actions || "").split(",").filter(Boolean);
  const priceText = stock.price == null ? "₩—" : `₩${number(stock.price)}`;
  return `<a class="stock-card" href="https://stock.naver.com/domestic/stock/${encodeURIComponent(stock.code || "")}/price" target="_blank" rel="noopener noreferrer">
    <span class="stock-top"><span><span class="stock-name">${esc(stock.name || "—")}</span><span class="stock-code">${esc(stock.code || "—")}</span></span><span class="attention-dot"></span></span>
    <span class="stock-main"><span><span class="price">${priceText}</span><span class="change ${direction}">${pct(stock.changePct)}</span></span><svg class="spark" viewBox="0 0 94 34" aria-hidden="true"><polyline points="${sparkPoints(values)}"/></svg></span>
    <span class="stock-actions">${actions.map(action => `<span class="action ${esc(action)}">${esc(actionLabel(action))}</span>`).join("")}</span>
    <span class="stock-meta"><span class="stock-tag">관심도 ${esc(String(stock.attention || "watch").toUpperCase())}</span><span>${esc(stock.market || "KRX")}</span></span></a>`;
}
function renderRadar(data) {
  state.radar = data;
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
    return { url:`${R2_BASE}/indexes/daily/${ymd(date)}.json`, label:ymd(date), button:formatKst(date,{month:"short",day:"numeric"}) };
  }
  if (view === "week") {
    date.setDate(date.getDate() - offset * 7);
    const value = isoWeek(date);
    return { url:`${R2_BASE}/indexes/weekly/${value.year}/week-${String(value.week).padStart(2,"0")}.json`, label:`${value.year}년 ${value.week}주차`, button:`W${value.week}` };
  }
  date.setMonth(date.getMonth() - offset);
  return { url:`${R2_BASE}/indexes/monthly/${date.getFullYear()}/month-${String(date.getMonth()+1).padStart(2,"0")}.json`, label:`${date.getFullYear()}년 ${date.getMonth()+1}월`, button:`${date.getMonth()+1}월` };
}
function normalizeTheme(theme) { return Array.isArray(theme) ? { name:theme[0], state:theme[1] } : theme; }
function normalizeStock(stock) { return Array.isArray(stock) ? { code:stock[0], name:stock[1], changePct:stock[2], actions:stock[3], attention:stock[4] } : stock; }
function archiveTheme(theme) {
  return `<span class="mini-theme"><i aria-hidden="true">◎</i><b>${esc(theme.name || "—")}</b></span>`;
}
function archiveStock(stock) {
  const direction = Number(stock.changePct) > 0 ? "up" : Number(stock.changePct) < 0 ? "down" : "";
  return `<a class="mini-stock" href="https://stock.naver.com/domestic/stock/${encodeURIComponent(stock.code || "")}/price" target="_blank" rel="noopener noreferrer"><b>${esc(stock.name || "—")}</b><small>${esc(stock.code || "—")}</small><i class="${direction}">${pct(stock.changePct)}</i></a>`;
}
function archiveCard(item) {
  const themes = (item.themes || []).slice(0,2).map(normalizeTheme);
  const stocks = (item.stocks || []).slice(0,6).map(normalizeStock);
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
  const controls = Array.from({length:view === "today" ? 7 : 6}, (_,i) => archiveTarget(view,i));
  $("#archive-controls").innerHTML = controls.map((item,i) => `<button class="archive-control ${i===offset?"active":""}" data-offset="${i}" type="button">${esc(item.button)}</button>`).join("");
  try {
    const response = await fetch(target.url, { cache:"no-store" });
    if (!response.ok) throw new Error(`HTTP ${response.status}`);
    const data = await response.json();
    const items = (data.items || []).slice().sort((a,b) => new Date(b.timeKst || b.time || 0) - new Date(a.timeKst || a.time || 0));
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
});
$("#refresh-button").addEventListener("click", loadRadar);
window.addEventListener("hashchange", () => { const view=location.hash.slice(1); if (["now","today","week","month"].includes(view)) setView(view); });
$("#year").textContent = new Date().getFullYear(); updateClock(); setInterval(updateClock,1000); loadRadar();
const initialView = location.hash.slice(1); if (["today","week","month"].includes(initialView)) setView(initialView);
