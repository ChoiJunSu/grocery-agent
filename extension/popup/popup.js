const statusEl = document.getElementById('status');
const tokenEl = document.getElementById('token');

chrome.storage.sync.get('userToken').then(({ userToken }) => {
  if (userToken) tokenEl.value = userToken;
});

document.getElementById('saveToken').addEventListener('click', async () => {
  const token = tokenEl.value.trim();
  if (token.length < 8) {
    statusEl.textContent = '⚠️ 토큰은 8자 이상이어야 합니다';
    return;
  }
  await chrome.storage.sync.set({ userToken: token });
  statusEl.textContent = '✅ 토큰 저장됨 — 웹 UI와 같은 계정으로 연결됩니다';
});

document.getElementById('sync').addEventListener('click', () => {
  statusEl.textContent = '동기화 중...';
  chrome.runtime.sendMessage({ type: 'SYNC_ALL' }, (res) => {
    if (!res?.ok) {
      statusEl.textContent = `실패: ${res?.error ?? '응답 없음'}`;
      return;
    }
    statusEl.textContent = res.results
      .map((r) =>
        r.ok
          ? `✅ ${r.martId}: 매핑 ${r.matchedCount}개${r.unmatchedCount ? `, 미매핑 ${r.unmatchedCount}개` : ''}`
          : `⚠️ ${r.martId}: ${r.error}`,
      )
      .join('\n');
  });
});

// 셀렉터 진단: 지금 열려 있는 마트 탭에서 후보 셀렉터별 매칭 수를 보고한다.
// 이마트·쿠팡은 자동화 브라우저를 차단해 개발 환경에서 DOM을 볼 수 없으므로,
// 로그인된 사용자 브라우저가 유일한 확인 통로다. 결과는 클립보드로 복사된다.
document.getElementById('diagnose').addEventListener('click', () => {
  statusEl.textContent = '현재 탭 진단 중...';
  chrome.runtime.sendMessage({ type: 'DIAGNOSE_ACTIVE_TAB' }, async (res) => {
    if (!res?.ok) {
      statusEl.textContent = `진단 실패: ${res?.error ?? '응답 없음'}\n(마트 사이트 탭을 활성화한 뒤 다시 누르세요)`;
      return;
    }
    const lines = [`# ${res.martId} 셀렉터 진단`, res.url, `title: ${res.title}`, ''];
    const summary = [];
    for (const [key, cands] of Object.entries(res.report)) {
      const hit = cands.find((c) => c.n > 0);
      summary.push(`${hit ? '✅' : '❌'} ${key}${hit ? ` ${hit.n}개` : ''}`);
      lines.push(`[${key}]`);
      for (const c of cands) lines.push(`  ${c.n < 0 ? 'ERR' : `${c.n}×`} ${c.sel}`);
    }
    if (res.cardSample) lines.push('', '[첫 카드 HTML]', res.cardSample);
    const full = lines.join('\n');
    try {
      await navigator.clipboard.writeText(full);
      statusEl.textContent = `${summary.join('\n')}\n\n📋 전체 리포트가 클립보드에 복사됨`;
    } catch {
      console.log(full);
      statusEl.textContent = `${summary.join('\n')}\n\n(복사 실패 — 팝업 콘솔에 출력됨)`;
    }
  });
});

document.getElementById('check').addEventListener('click', () => {
  statusEl.textContent = '확인 중...';
  chrome.runtime.sendMessage({ type: 'CHECK_SERVER' }, (res) => {
    statusEl.textContent = res?.ok
      ? '✅ 서버 연결 정상 (localhost:3001)'
      : `❌ 서버 응답 없음 — npm run dev:server 실행 여부 확인\n${res?.error ?? ''}`;
  });
});
