const statusEl = document.getElementById('status');

document.getElementById('sync').addEventListener('click', () => {
  statusEl.textContent = '동기화 중...';
  chrome.runtime.sendMessage({ type: 'SYNC_ALL' }, (res) => {
    if (!res?.ok) {
      statusEl.textContent = `실패: ${res?.error ?? '응답 없음'}`;
      return;
    }
    statusEl.textContent = res.results
      .map((r) => (r.ok ? `✅ ${r.martId}: ${r.offerCount}개 상품` : `⚠️ ${r.martId}: ${r.error}`))
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
