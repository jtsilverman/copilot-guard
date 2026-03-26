// @ts-nocheck
const vscode = acquireVsCodeApi();

function formatTokens(n) {
  if (n >= 1000000) return (n / 1000000).toFixed(1) + 'M';
  if (n >= 1000) return (n / 1000).toFixed(1) + 'K';
  return String(n);
}

function render(data) {
  // Status badge
  const badge = document.getElementById('status-badge');
  badge.className = 'status-badge ' + data.status;
  badge.textContent = data.status === 'safe' ? 'SAFE' : data.status === 'warning' ? 'CAUTION' : 'DANGER';

  // Stats
  document.getElementById('stat-files').textContent = data.stats.filesExposed;
  document.getElementById('stat-sensitive').textContent = data.stats.sensitiveFilesExposed;
  document.getElementById('stat-tokens').textContent = formatTokens(data.stats.estimatedTokens);
  document.getElementById('stat-warnings').textContent = data.stats.warnings;

  // File list
  const list = document.getElementById('file-list');
  if (data.exposures.length === 0) {
    list.innerHTML = '<p class="empty">No files in Copilot\'s context</p>';
    return;
  }

  list.innerHTML = data.exposures.map(f => `
    <div class="file-item">
      <span class="badge ${f.sensitivityLevel}">${f.sensitivityLevel === 'safe' ? 'OK' : f.sensitivityLevel === 'warning' ? '!!' : '!!!'}</span>
      <span class="name" title="${f.fileName}">${f.fileName}</span>
      ${f.sensitivityReason ? `<span class="reason">${f.sensitivityReason}</span>` : ''}
    </div>
  `).join('');
}

window.addEventListener('message', (event) => {
  const message = event.data;
  if (message.type === 'update') {
    render(message.data);
  }
});
