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

document.getElementById('check').addEventListener('click', () => {
  statusEl.textContent = '확인 중...';
  chrome.runtime.sendMessage({ type: 'CHECK_SERVER' }, (res) => {
    statusEl.textContent = res?.ok
      ? '✅ 서버 연결 정상 (localhost:3001)'
      : `❌ 서버 응답 없음 — npm run dev:server 실행 여부 확인\n${res?.error ?? ''}`;
  });
});
