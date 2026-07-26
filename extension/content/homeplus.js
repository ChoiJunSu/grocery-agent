// 홈플러스(front.homeplus.co.kr) 어댑터.
//
// 홈플러스 온라인몰은 CSS-module 해시 클래스를 쓰는 React SPA라
// [class*=...] 부분 일치 셀렉터를 우선 사용한다. 실사이트 최종 확인 필요.
// 어느 셀렉터 후보도 안 맞으면 실패로 보고한다 — 임의의 값으로 대신하지 않는다.

(() => {
  const { q, qa, parsePrice, pickBestCard, setInputValue, sleep, waitFor } = window.__ga;

  // 2026-07-26 실사이트(front.homeplus.co.kr/search → mfront로 리다이렉트) DOM으로 검증.
  // 홈플러스는 상품 카드에 schema.org 마이크로데이터를 붙여둔다 — CSS 해시 클래스보다
  // 훨씬 안정적이므로 itemprop/itemtype을 1순위 앵커로 쓴다.
  // 가격은 <strong itemprop="price" content="6490">6,490</strong> 형태라 content 속성이 정확하다.
  const SELECTORS = {
    productCard: ['article.unitItem', '[itemtype="https://schema.org/Product"]', '[class*="unitItem"]'],
    productName: ['h3[itemprop="name"] a', '[itemprop="name"]', '[class*="prodName"]'],
    productPrice: ['strong[itemprop="price"]', '.priceValue strong', '[class*="priceValue"]'],
    productLink: ['a.linkArea', 'a[href*="itemNo="]', 'a[href*="/item"]'],
    soldOutBadge: ['[class*="soldout"]', '[class*="soldOut"]'],
    cardCartBtn: ['button.btnProdCart', 'button[aria-label*="장바구니"]', 'button[class*="cart"]'],
    detailQtyInput: ['input[class*="quantity"]', 'input[class*="qty"]', 'input[type="number"]'],
    detailCartBtn: ['button[class*="cartBtn"]', 'button[class*="addCart"]'],
    layerClose: ['button[class*="close"]', '[class*="modal"] button[class*="cancel"]'],
    couponRow: ['[class*="couponItem"]', '[class*="couponList"] li'],
    couponName: ['[class*="couponName"]', '[class*="title"]'],
    cartLine: ['[class*="cartItem"]', '[class*="cartProduct"]', '[class*="cartList"] li'],
    cartLineName: ['[class*="prodName"]', '[class*="itemName"]', '[class*="name"]'],
  };


  const isDetailPage = () => /\/item|itemNo=/.test(location.href);
  const isCartPage = () => location.pathname.startsWith('/cart');

  window.__registerMartAdapter({
    martId: 'homeplus',
    selectors: SELECTORS, // DIAGNOSE 메시지가 실페이지에서 후보별 매칭 수를 보고하는 데 사용

    async scrapeOffers() {
      const cards = qa(document, SELECTORS.productCard);
      if (cards.length === 0) {
        console.warn('[장보기 에이전트] homeplus: 상품 카드 셀렉터 미매칭 — 수집 0건 (SELECTORS.productCard 확인 필요)');
        return [];
      }
      return cards
        .map((card) => {
          const name = q(card, SELECTORS.productName)?.textContent?.trim();
          const price = parsePrice(q(card, SELECTORS.productPrice)?.textContent);
          if (!name || !price) return null;
          return { siteName: name, price, available: !q(card, SELECTORS.soldOutBadge) };
        })
        .filter(Boolean);
    },

    async scrapeCoupons() {
      const rows = qa(document, SELECTORS.couponRow);
      if (rows.length === 0) return [];
      return rows.map((row, i) => ({
        id: `homeplus-scraped-${i}`,
        name: q(row, SELECTORS.couponName)?.textContent?.trim() ?? '이름 미상 쿠폰',
        type: 'fixed',
        value: 0,
        minOrder: 0,
      }));
    },

    async scrapeSlots() {
      // 배송 슬롯은 점포/배송지 설정에 종속적이라 아직 파싱하지 않는다.
      // 추정 슬롯을 내보내면 "언제 오는지"를 틀리게 알려주게 되므로 빈 배열을 반환한다.
      return [];
    },

    async addItem(item) {
      if (isDetailPage()) {
        const qty = q(document, SELECTORS.detailQtyInput);
        if (qty) setInputValue(qty, item.quantity);
        const btn = q(document, SELECTORS.detailCartBtn);
        if (!btn) return { ok: false, reason: '상세페이지 장바구니 버튼 미발견' };
        btn.click();
        await sleep(1500);
        q(document, SELECTORS.layerClose)?.click();
        return { ok: true };
      }

      const cards = await waitFor(() => {
        const found = qa(document, SELECTORS.productCard);
        return found.length > 0 ? found : null;
      });
      if (!cards) {
        return {
          ok: false,
          reason: '검색 결과 카드 미발견 (로그인/봇차단 페이지이거나 SELECTORS.productCard 미매칭)',
        };
      }

      const match = pickBestCard(cards, (c) => q(c, SELECTORS.productName)?.textContent, item.name);
      if (!match) return { ok: false, reason: `검색 결과에 '${item.name}' 유사 상품 없음` };
      if (q(match.card, SELECTORS.soldOutBadge)) return { ok: false, reason: '품절' };

      const cartBtn = q(match.card, SELECTORS.cardCartBtn);
      if (cartBtn) {
        for (let i = 0; i < item.quantity; i++) {
          cartBtn.click();
          await sleep(900);
          q(document, SELECTORS.layerClose)?.click();
        }
        return { ok: true };
      }
      const link = q(match.card, SELECTORS.productLink);
      if (link?.href) return { ok: false, navigate: link.href };
      return { ok: false, reason: '담기 버튼/상세 링크 모두 미발견' };
    },

    async scrapeCart() {
      if (!isCartPage()) return null;
      const lines = await waitFor(() => {
        const found = qa(document, SELECTORS.cartLine);
        return found.length > 0 ? found : null;
      });
      if (!lines) return null;
      const names = lines
        .map((line) => q(line, SELECTORS.cartLineName)?.textContent?.trim())
        .filter(Boolean);
      return { names };
    },
  });
})();
