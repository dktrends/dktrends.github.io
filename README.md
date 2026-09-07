# DK Trends

DK Trends의 시장 Radar를 표시하는 GitHub Pages 정적 사이트입니다. 기존 Blogger 테마의 브랜드와 정보 구조를 유지하면서 Blogger 전용 템플릿 코드를 제거했습니다.

## 구조

- `index.html` — Now 및 기간별 Radar 화면
- `assets/css/styles.css` — DK Trends 디자인 시스템과 반응형 레이아웃
- `assets/js/app.js` — 실시간 Radar와 R2 아카이브 렌더링
- `assets/images/` — 공식 심벌, 워드마크, 통합형 SVG 로고

## 데이터

화면은 공개 Cloudflare R2 저장소의 다음 JSON을 읽습니다.

- 현재 Radar: `radar/latest.json`
- 일간 인덱스: `indexes/daily/YYYY-MM-DD.json`
- 주간 인덱스: `indexes/weekly/YYYY/week-NN.json`
- 월간 인덱스: `indexes/monthly/YYYY/month-MM.json`

R2 요청이 브라우저에서 차단되거나 네트워크를 사용할 수 없을 때는 `data/radar/latest.json`을 현재 Radar의 대체 데이터로 사용합니다. GitHub Pages에서 실시간 갱신하려면 R2 CORS 허용 출처에 `https://dktrends.github.io`를 추가해야 합니다.

사이트 자체에는 빌드 과정이나 서버 코드가 없으며 GitHub Pages에서 바로 배포됩니다.
