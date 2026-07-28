// 스냅샷을 읽어 코트×날짜 그리드를 그린다.
// 슬롯은 두 형태가 섞여 들어온다:
//   - 날짜 단위 (start=null)  : 월 달력에서 읽은 그 날의 가능 여부
//   - 시간대 단위 (start 있음): 시간표에서 읽은 개별 슬롯
// 그리드 칸은 둘을 합쳐 "그 날 예약 가능한가"로 요약하고, 상세는 패널에서 보여준다.

const DOW = ['일', '월', '화', '수', '목', '금', '토'];
const DAYS = 30;

const el = (id) => document.getElementById(id);
const state = { snapshot: null, dates: [], filtered: [] };

// ---------- 로드 ----------
async function load() {
  let res;
  try {
    res = await fetch('/api/snapshot');
  } catch {
    return showEmpty('서버에 연결하지 못했습니다. <code>npm start</code> 가 떠 있는지 확인하세요.');
  }
  if (!res.ok) {
    return showEmpty(
      '아직 수집된 데이터가 없습니다.<br />터미널에서 <code>npm run collect</code> 를 먼저 실행하세요.',
    );
  }

  state.snapshot = await res.json();
  state.dates = buildDates();
  el('meta').textContent = `${fmtDateTime(state.snapshot.collectedAt)} 기준 · 코트 ${state.snapshot.courts.length}곳`;

  fillDistricts();
  renderUpcoming();
  renderErrors();
  render();
}

function showEmpty(html) {
  el('empty').innerHTML = html;
  el('empty').hidden = false;
  el('meta').textContent = '데이터 없음';
}

function buildDates() {
  const today = new Date();
  return Array.from({ length: DAYS }, (_, i) => {
    const d = new Date(today.getFullYear(), today.getMonth(), today.getDate() + i);
    return {
      key: `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`,
      day: d.getDate(),
      dow: d.getDay(),
      month: d.getMonth() + 1,
    };
  });
}

// ---------- 인덱싱 ----------
/** courtId → date → 슬롯 배열 */
function indexSlots() {
  const byCourt = new Map();
  for (const s of state.snapshot.slots) {
    if (!byCourt.has(s.courtId)) byCourt.set(s.courtId, new Map());
    const byDate = byCourt.get(s.courtId);
    if (!byDate.has(s.date)) byDate.set(s.date, []);
    byDate.get(s.date).push(s);
  }
  return byCourt;
}

/** 그 날 슬롯들을 한 칸으로 요약 */
function summarize(slots) {
  if (!slots || slots.length === 0) return { state: 'none', available: 0, total: 0 };
  const timed = slots.filter((s) => s.start);
  const available = timed.filter((s) => s.state === 'available').length;

  if (timed.length > 0) {
    return { state: available > 0 ? 'available' : 'closed', available, total: timed.length };
  }
  // 날짜 단위 정보뿐이면 상태만 전달한다 (몇 자리인지는 알 수 없다)
  const dayState = slots.find((s) => s.state === 'available') ? 'available' : slots[0].state;
  return { state: dayState, available: 0, total: 0 };
}

// ---------- 필터 ----------
function applyFilters(courts, index) {
  const q = el('q').value.trim().toLowerCase();
  const district = el('district').value;
  const weekday = el('weekday').value;
  const fee = el('fee').value;
  const onlyOpen = el('onlyOpen').checked;

  const dates = state.dates.filter((d) => {
    if (weekday === 'weekend') return d.dow === 0 || d.dow === 6;
    if (weekday === 'weekday') return d.dow !== 0 && d.dow !== 6;
    return true;
  });

  const filtered = courts.filter((c) => {
    if (q && !`${c.name} ${c.place} ${c.district}`.toLowerCase().includes(q)) return false;
    if (district && c.district !== district) return false;
    if (fee === 'free' && c.paid) return false;
    if (fee === 'paid' && !c.paid) return false;
    if (onlyOpen) {
      const byDate = index.get(c.id);
      if (!byDate) return false;
      const hasOpen = dates.some((d) => summarize(byDate.get(d.key)).state === 'available');
      if (!hasOpen) return false;
    }
    return true;
  });

  return { courts: filtered, dates };
}

// ---------- 렌더 ----------
function render() {
  const index = indexSlots();
  const { courts, dates } = applyFilters(state.snapshot.courts, index);
  state.filtered = courts;

  el('count').textContent = `${courts.length}곳 표시`;
  el('gridwrap').hidden = courts.length === 0;
  el('empty').hidden = courts.length !== 0;
  if (courts.length === 0) {
    el('empty').innerHTML = '조건에 맞는 코트가 없습니다. 필터를 완화해 보세요.';
    return;
  }

  // 첫 칸과 매월 1일에는 월을 같이 적어 월 경계를 드러낸다
  const head = `<thead><tr><th class="court">코트</th>${dates
    .map((d, i) => {
      const isMonthStart = i === 0 || d.day === 1;
      const cls = [d.dow === 0 || d.dow === 6 ? 'is-weekend' : '', isMonthStart ? 'is-month' : ''].join(' ');
      return `<th class="${cls}">${isMonthStart ? `${d.month}/` : ''}${d.day}<span class="dow">${DOW[d.dow]}</span></th>`;
    })
    .join('')}</tr></thead>`;

  const rows = courts
    .map((c) => {
      const byDate = index.get(c.id);
      const cells = dates
        .map((d) => {
          const sum = summarize(byDate?.get(d.key));
          const label = sum.total > 0 ? sum.available || '' : sum.state === 'available' ? '○' : '';
          const clickable = sum.state === 'available' || sum.state === 'unknown';
          return `<td class="cell cell--${sum.state}"><button ${clickable ? `data-court="${c.id}" data-date="${d.key}"` : 'disabled'}>${label}</button></td>`;
        })
        .join('');
      return `<tr><th class="court"><span class="court__name">${esc(c.name)}</span><span class="court__place">${esc(c.district)}${c.paid ? '' : ' · 무료'}</span></th>${cells}</tr>`;
    })
    .join('');

  el('grid').innerHTML = `${head}<tbody>${rows}</tbody>`;
}

function fillDistricts() {
  const districts = [...new Set(state.snapshot.courts.map((c) => c.district).filter(Boolean))].sort();
  el('district').insertAdjacentHTML(
    'beforeend',
    districts.map((d) => `<option value="${esc(d)}">${esc(d)}</option>`).join(''),
  );
}

function renderUpcoming() {
  const now = Date.now();
  const soon = state.snapshot.courts
    .filter((c) => c.receiptFrom && new Date(c.receiptFrom).getTime() > now)
    .sort((a, b) => new Date(a.receiptFrom) - new Date(b.receiptFrom))
    .slice(0, 12);
  if (soon.length === 0) return;

  el('upcomingList').innerHTML = soon
    .map(
      (c) =>
        `<li><span class="when">${fmtDateTime(c.receiptFrom)}</span><a href="${esc(c.url)}" target="_blank" rel="noopener">${esc(c.name)}</a><span class="meta">${esc(c.district)}</span></li>`,
    )
    .join('');
  el('upcoming').hidden = false;
}

function renderErrors() {
  const errors = state.snapshot.errors ?? [];
  if (errors.length === 0) return;
  el('errors').querySelector('summary').textContent = `수집 실패 ${errors.length}건 — 이 코트들은 그리드에서 비어 보입니다`;
  el('errorList').innerHTML = errors
    .slice(0, 50)
    .map((e) => `<li>${esc(e.courtId ?? '')} — ${esc(e.error)}</li>`)
    .join('');
  el('errors').hidden = false;
}

// ---------- 상세 패널 ----------
function openPanel(courtId, date) {
  const court = state.snapshot.courts.find((c) => c.id === courtId);
  if (!court) return;
  const slots = state.snapshot.slots
    .filter((s) => s.courtId === courtId && s.date === date)
    .sort((a, b) => String(a.start).localeCompare(String(b.start)));

  el('panelTitle').textContent = court.name;
  el('panelMeta').textContent = `${date} · ${court.district}${court.tel ? ` · ${court.tel}` : ''}`;
  el('panelSlots').innerHTML =
    slots.filter((s) => s.start).length > 0
      ? slots
          .filter((s) => s.start)
          .map(
            (s) =>
              `<li class="${s.state === 'available' ? 'is-available' : ''}"><span>${s.start}~${s.end}</span><span>${s.state === 'available' ? '가능' : s.state === 'closed' ? '마감' : '확인 필요'}</span></li>`,
          )
          .join('')
      : `<li><span>시간대 정보 없음</span><span>${slots[0]?.state === 'available' ? '이 날 예약 가능' : '예약 페이지 확인'}</span></li>`;
  el('panelLink').href = court.url;
  el('panel').hidden = false;
}

// ---------- 유틸 ----------
const esc = (s) =>
  String(s ?? '').replace(/[&<>"']/g, (m) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[m]);

function fmtDateTime(iso) {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return String(iso ?? '');
  return `${d.getMonth() + 1}/${d.getDate()} ${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}`;
}

// ---------- 이벤트 ----------
for (const id of ['q', 'district', 'weekday', 'fee', 'onlyOpen']) {
  el(id).addEventListener(id === 'q' ? 'input' : 'change', render);
}
el('grid').addEventListener('click', (e) => {
  const btn = e.target.closest('button[data-court]');
  if (btn) openPanel(btn.dataset.court, btn.dataset.date);
});
el('panelClose').addEventListener('click', () => (el('panel').hidden = true));
document.addEventListener('keydown', (e) => {
  if (e.key === 'Escape') el('panel').hidden = true;
});

load();
