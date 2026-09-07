const escPage = (value="") => String(value).replace(/[&<>'"]/g,c=>({"&":"&amp;","<":"&lt;",">":"&gt;","'":"&#39;",'"':"&quot;"})[c]);
const pageType = document.body.dataset.page;
const dataPath = pageType === "yesterday" ? "../data/yesterday.json" : "../data/historical-events.json";
let pageData = null;

function analysisCard(item) {
  const direction = Number(item.changePct) > 0 ? "up" : Number(item.changePct) < 0 ? "down" : "";
  return `<article class="analysis-card"><div class="analysis-card-art ${escPage(item.art||"")}"></div><div class="analysis-card-body"><div class="analysis-meta"><span>${escPage(item.date||"")}</span><span class="status ${escPage(item.status||"")}">${escPage(item.label||item.status||"REVIEW")}</span></div><h2>${escPage(item.title)}</h2>${item.changePct!=null?`<p class="event-change ${direction}">${Number(item.changePct)>0?"+":""}${item.changePct}%</p>`:""}<p class="analysis-summary">${escPage(item.summary)}</p><dl><div><dt>방향</dt><dd>${escPage(item.direction)}</dd></div><div><dt>핵심 원인</dt><dd>${escPage(item.cause)}</dd></div>${item.comparison?`<div><dt>오늘과 비교</dt><dd>${escPage(item.comparison)}</dd></div>`:""}</dl><div class="analysis-tags">${(item.tags||[]).map(tag=>`<span>${escPage(tag)}</span>`).join("")}</div></div></article>`;
}
function render(items) { document.querySelector("#content-grid").innerHTML = items.length ? items.map(analysisCard).join("") : '<div class="message">표시할 자료가 없습니다.</div>'; }
async function initPage() {
  try { const response=await fetch(dataPath); if(!response.ok) throw new Error(); pageData=await response.json(); document.querySelector("#page-intro").textContent=pageData.description; render(pageData.items||[]); if(pageType==="historical") renderFilters(); }
  catch { document.querySelector("#content-grid").innerHTML='<div class="message">자료를 불러오지 못했습니다.</div>'; }
}
function renderFilters(){ const tags=["전체",...new Set((pageData.items||[]).flatMap(item=>item.tags||[]))]; document.querySelector("#event-filters").innerHTML=tags.map((tag,i)=>`<button type="button" class="archive-control ${i===0?"active":""}" data-tag="${escPage(tag)}">${escPage(tag)}</button>`).join(""); }
document.addEventListener("click",event=>{ const button=event.target.closest("[data-tag]"); if(!button)return; document.querySelectorAll("[data-tag]").forEach(item=>item.classList.toggle("active",item===button)); const tag=button.dataset.tag; render(tag==="전체"?pageData.items:pageData.items.filter(item=>(item.tags||[]).includes(tag))); });
initPage();
