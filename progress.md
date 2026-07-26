# 진행 기록

## 2026-07-26 — mock 제거 · 마켓컬리 추가 · 실DOM 셀렉터 검증

WSL(`/mnt/c/Users/CHOI/grocery-agent`)에서 전체 사이클을 처음 실사 구동한 세션.
"담기가 pending에서 안 넘어간다"는 증상에서 출발해 원인 4개를 잡았다.

### 잡은 버그

**1. 서비스 워커가 담기 도중 종료 → 작업 유실**

`executeAction`은 품목당 최대 30초(페이지 로드 20초 + `sleep(1500)` + content script 대기 8초),
상세 재시도까지 하면 60초가 걸린다. MV3 서비스 워커는 확장 API 호출이 30초간 없으면 크롬이
종료시키고, **`setTimeout`/`sleep`은 수명을 연장해주지 않는다.** 워커가 죽으면 결과 보고가
영영 오지 않아 서버에는 `claimed`인 채로 남는다.

- `background.js`: 작업이 도는 동안 20초마다 `chrome.runtime.getPlatformInfo()`를 호출하는
  keepalive 추가 (`startKeepAlive`/`stopKeepAlive`)
- `store.ts`: `claimed_at` 컬럼 추가 + `STALE_CLAIM_MS`(3분) 경과분은 `pending`으로 회수.
  워커가 죽어도 다음 폴링에서 자동 복구된다

**2. mock 폴백이 거짓 성공을 반환**

`addItem`이 상품 카드를 못 찾으면 `{ok: true, mocked: true}`를 돌려줬다. 실제 장바구니엔
아무것도 안 들어갔는데 웹 UI엔 "담김 3/3건"으로 떴다. 개발 환경에서 마트 도메인이 막혔을 때
사이클을 끝까지 돌리려던 폴백이 실사용에서 조용한 거짓말이 됐다.

→ **mock을 전 코드에서 제거.** 원칙: *없는 데이터는 지어내지 않고 실패로 보고한다.*

| 위치 | 이전 | 이후 |
|---|---|---|
| `content/*.js` `addItem` | `{ok:true, mocked:true}` | `{ok:false, reason:'검색 결과 카드 미발견…'}` |
| `content/*.js` `scrapeOffers/Coupons/Slots` | `MOCK_FALLBACK` | `[]` + 콘솔 경고 |
| `background.js` `syncMart` | 0건도 서버로 전송 | 0건이면 전송 안 하고 실패 반환 |
| 서버 최적화 입력 | 미수집 마트를 `MOCK_OFFERS`로 채움 | 비교에서 제외, 전부 미수집이면 **409** |
| `core/mocks.ts` | 가짜 가격/쿠폰/슬롯 export | 삭제 → `catalog.ts`(마트 설정 + 상품 카탈로그) |
| 테스트 고정 데이터 | 프로덕션 모듈에서 import | `test/fixtures.ts`로 분리 |

`MOCK_MARTS`/`MOCK_PRODUCTS`는 사실 mock이 아니라 기준 설정(배송비·무료배송 기준·cartUrl)과
비교 단위였다. `catalog.ts`의 `MARTS`/`PRODUCTS`로 이름을 바로잡고 남겼다.

**3. 홈플러스 수집이 항상 0건**

홈플러스 카드는 schema.org 마이크로데이터를 쓴다:

```html
<article class="unitItem" itemtype="https://schema.org/Product">
  <h3 itemprop="name"><a>…</a></h3>
  <strong itemprop="price" content="6490">6,490</strong>
```

기존 `productName: ['[class*="prodName"]', '[class*="itemName"]', '[class*="name"]']`은
하나도 안 맞는다. 가격만 잡히고 이름이 빈 값이라 `if (!name || !price) return null`로
전부 걸러졌다. → `itemprop`/`itemtype` 앵커로 교체 (CSS 해시 클래스보다 안정적).

**4. 매칭이 컬리 상품명을 통째로 놓침**

실사이트 이름 4건 투입 시 매핑 0/4.

```
"[서울우유] 나 100% 우유 1000mL" → "나100우유1000ml"   (브랜드가 지워짐)
"서울우유 1L"                    → "서울우유1l"
```

**대괄호의 의미가 마트마다 정반대다** — 이마트는 `[이마트]`처럼 노이즈를, 컬리는 `[서울우유]`처럼
브랜드를 넣는다. 여기에 `1000mL` ≠ `1L`까지 겹쳤다.

- `matching.ts`: `nameVariants()` — 대괄호를 버린 해석과 유지한 해석을 모두 만들어 최고 점수 채택
- `normalizeUnits()` — mL를 L로 환산
- 별칭 조회도 변형 전체를 대조
- 실사이트 이름 기반 회귀 테스트 6건 추가

과매칭은 없다: 홈플러스의 `ThePet 연어우유 개껌스틱 160G`, 쿠팡의 `국내산 깐마늘`은 여전히 거부된다.

### 마켓컬리 추가

`extension/content/kurly.js` 신규 + manifest 등록 + `MART_CONFIG`/`MARTS`/별칭 반영.
검색 `?sword=`, 장바구니 `/cart`, 무료배송 기준 40,000원.

셀렉터는 **실사이트 DOM으로 검증** (카드 96개 전부 이름+가격 추출 성공):

```
카드   a[href^="/goods/"]           ← href 패턴
이름   span:has(+ p)                ← 설명 <p> 바로 앞 span
가격   .sales-price .price-number   ← 의미 있는 클래스
담기   .button-wrapper button
```

컬리는 emotion CSS-in-JS라 `css-*` 해시가 배포마다 바뀌므로 해시를 피하고 구조·의미 앵커만 썼다.
**검색 카드에 담기 버튼이 그대로 있어 상세 페이지 경유가 필요 없다** (당초 추측과 반대).

### 자동화 브라우저 접근성 (2026-07-26 측정)

Playwright 헤드리스 크로미움으로 각 마트 검색 페이지를 직접 열어본 결과:

| 마트 | 결과 |
|---|---|
| 마켓컬리 | HTTP 200 — 카드 96개 |
| 홈플러스 | HTTP 200 — 카드 30개 (`front` → `mfront` 리다이렉트) |
| 이마트 | **HTTP 403** |
| 쿠팡 | **"Access Denied"** |

`--headless=new` + `navigator.webdriver` 제거 + 실제 헤더를 붙여도 이마트·쿠팡은 막힌다.

→ **Playwright는 익스텐션을 대체할 수 없다.** 자주 쓰는 이마트·쿠팡이 정확히 막히는 쪽이다.
익스텐션(사용자 로그인 세션)이 존재하는 이유가 이것. 다만 Playwright는 **셀렉터 검증 도구**로는
매우 유효하다 — 위 버그 3·4가 이 방법으로 발견됐다.

### 이마트·쿠팡 셀렉터: 미해결

개발 환경에서 DOM을 볼 수 없어 검증하지 못했다. 대신 사용자 브라우저가 보고하도록 통로를 만들었다:

- `content/common.js`에 `DIAGNOSE` 메시지 — 후보 셀렉터별 매칭 수 + 첫 카드 HTML 반환
- 각 어댑터가 `selectors: SELECTORS` 노출
- 팝업에 **「셀렉터 진단 (현재 탭)」** 버튼 — 결과를 클립보드로 복사

**다음 할 일**: 이마트/쿠팡 검색 페이지를 연 상태에서 이 버튼을 눌러 나온 리포트로
`SELECTORS.productCard` 등을 맞춘다. 현재 이마트 담기는
`검색 결과 카드 미발견`으로 실패 중.

### 환경 메모 (WSL)

- **`/mnt/c`에서는 inotify가 동작하지 않는다.** `tsx watch`와 Vite HMR이 파일 변경을 감지 못 하므로
  서버/웹 코드를 고치면 **수동 재시작**해야 한다. 이 때문에 수정이 반영 안 된 채로 한참 헤맸다.
- 익스텐션 경로(호스트 디스크): `C:\Users\CHOI\grocery-agent\extension`
- Playwright 브라우저는 `~/.cache/ms-playwright/chromium-1228/chrome-linux64/chrome`에 캐시돼 있고,
  실행 시 `--ignore-certificate-errors --no-sandbox`가 필요했다.

### 남은 판단거리

- 컬리 검색의 `[서울우유] 나 100% 우유 1.8L`도 `milk-1l`로 매핑된다. 카탈로그가 용량을 구분하지
  않아서인데, 1L와 1.8L를 다른 상품으로 나눌지는 실제 장보기 습관에 달린 문제라 보류.
- 배송 슬롯은 4개 마트 모두 아직 파싱하지 않는다(배송지 설정 종속). 추정값을 내보내면 배송 시각을
  틀리게 알려주므로 빈 배열을 반환한다.
- 쿠폰은 각 마트 쿠폰함 페이지에서만 수집되고, 할인율/조건 파싱은 아직 이름만 긁는 수준이다.

### 검증 상태

- 단위 테스트 24/24 통과 (optimizer 11 + matching 13)
- `npm run typecheck` 클린
- 익스텐션 문법·manifest 검사 통과
- 서버 API 전 구간 curl 검증: 토큰 인증(401), 카탈로그, ingest 자동 매핑, optimize,
  execute → claim → result → `verified`, 유실 작업 회수
