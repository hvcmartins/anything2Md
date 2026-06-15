'use strict';

const dropZone = document.getElementById('drop-zone');
const fileInput = document.getElementById('file-input');
const fileList = document.getElementById('file-list');
const itemsEl = document.getElementById('items');
const fileCount = document.getElementById('file-count');
const btnZip = document.getElementById('btn-download-zip');
const btnClear = document.getElementById('btn-clear');

// name -> { state: 'pending'|'converting'|'done'|'error', mdName, chars, error }
const files = new Map();

const EXT_ICONS = {
  pdf: '📄', doc: '📝', docx: '📝', xls: '📊', xlsx: '📊',
  ppt: '📑', pptx: '📑', html: '🌐', htm: '🌐', csv: '📋',
  json: '🔧', xml: '🔧', txt: '📃', md: '📃',
  jpg: '🖼', jpeg: '🖼', png: '🖼', gif: '🖼', webp: '🖼',
  mp3: '🎵', wav: '🎵', mp4: '🎬',
};

function iconFor(filename) {
  const ext = filename.split('.').pop().toLowerCase();
  return EXT_ICONS[ext] || '📁';
}

function fmtSize(bytes) {
  if (bytes < 1024) return bytes + ' B';
  if (bytes < 1024 * 1024) return (bytes / 1024).toFixed(1) + ' KB';
  return (bytes / 1024 / 1024).toFixed(1) + ' MB';
}

function updateHeader() {
  const done = [...files.values()].filter(f => f.state === 'done').length;
  const total = files.size;
  fileCount.textContent = `${total} / ${MAX_FILES} files`;
  btnZip.disabled = done === 0;
  fileList.classList.toggle('hidden', total === 0);
}

function renderItem(name, info) {
  let li = document.getElementById(`item-${CSS.escape(name)}`);
  if (!li) {
    li = document.createElement('li');
    li.className = 'item';
    li.id = `item-${CSS.escape(name)}`;
    li.innerHTML = `
      <div class="item-icon">${iconFor(name)}</div>
      <div class="item-info">
        <div class="item-name" title="${escHtml(name)}">${escHtml(name)}</div>
        <div class="item-meta"></div>
        <div class="item-progress"><div class="item-progress-bar"></div></div>
      </div>
      <div class="item-actions"></div>`;
    itemsEl.appendChild(li);
  }

  li.className = `item ${info.state}`;
  const meta = li.querySelector('.item-meta');
  const actions = li.querySelector('.item-actions');

  if (info.state === 'pending') {
    meta.textContent = 'Waiting…';
    actions.innerHTML = '';
  } else if (info.state === 'converting') {
    meta.textContent = 'Converting…';
    actions.innerHTML = '';
  } else if (info.state === 'done') {
    meta.innerHTML = `<span class="status-dot">●</span> ${escHtml(info.mdName)} · ${info.chars.toLocaleString()} chars`;
    actions.innerHTML = `
      <button class="btn-icon" title="Download ${escHtml(info.mdName)}" onclick="downloadOne(${JSON.stringify(info.mdName)})">
        <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="none"
             stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"
             width="16" height="16">
          <path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"/>
          <polyline points="7 10 12 15 17 10"/>
          <line x1="12" y1="15" x2="12" y2="3"/>
        </svg>
      </button>`;
  } else if (info.state === 'error') {
    meta.innerHTML = `<span class="status-dot">●</span> ${escHtml(info.error)}`;
    actions.innerHTML = '';
  }
}

function escHtml(s) {
  return s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
}

async function uploadFile(file) {
  if (files.size >= MAX_FILES) {
    alert(`Maximum of ${MAX_FILES} files reached.`);
    return;
  }
  const name = file.name;
  if (files.has(name)) return; // already queued

  files.set(name, { state: 'pending' });
  renderItem(name, files.get(name));
  updateHeader();

  // small delay so UI paints before heavy work
  await new Promise(r => setTimeout(r, 30));

  files.set(name, { state: 'converting' });
  renderItem(name, files.get(name));

  const fd = new FormData();
  fd.append('file', file);

  try {
    const res = await fetch('/convert', { method: 'POST', body: fd });
    const data = await res.json();
    if (!res.ok) throw new Error(data.error || 'Unknown error');
    files.set(name, { state: 'done', mdName: data.name, chars: data.chars });
  } catch (err) {
    files.set(name, { state: 'error', error: err.message });
  }

  renderItem(name, files.get(name));
  updateHeader();
}

function addFiles(fileList) {
  const arr = [...fileList].slice(0, MAX_FILES - files.size);
  arr.forEach(f => uploadFile(f));
}

// ── Drag & drop ──
dropZone.addEventListener('dragover', e => {
  e.preventDefault();
  dropZone.classList.add('drag-over');
});
['dragleave', 'dragend'].forEach(ev =>
  dropZone.addEventListener(ev, () => dropZone.classList.remove('drag-over'))
);
dropZone.addEventListener('drop', e => {
  e.preventDefault();
  dropZone.classList.remove('drag-over');
  if (e.dataTransfer.files.length) addFiles(e.dataTransfer.files);
});

dropZone.addEventListener('click', () => fileInput.click());
dropZone.addEventListener('keydown', e => { if (e.key === 'Enter' || e.key === ' ') fileInput.click(); });
fileInput.addEventListener('change', () => {
  if (fileInput.files.length) addFiles(fileInput.files);
  fileInput.value = '';
});

// ── Downloads ──
function downloadOne(mdName) {
  const a = document.createElement('a');
  a.href = `/download/${encodeURIComponent(mdName)}`;
  a.download = mdName;
  a.click();
}

btnZip.addEventListener('click', async () => {
  const doneNames = [...files.values()]
    .filter(f => f.state === 'done')
    .map(f => f.mdName);
  if (!doneNames.length) return;

  const res = await fetch('/download-zip', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ files: doneNames }),
  });
  if (!res.ok) { alert('Failed to create zip.'); return; }
  const blob = await res.blob();
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = 'converted.zip';
  a.click();
  URL.revokeObjectURL(url);
});

// ── Clear ──
btnClear.addEventListener('click', async () => {
  if (!confirm('Clear all files?')) return;
  await fetch('/clear', { method: 'POST' });
  files.clear();
  itemsEl.innerHTML = '';
  updateHeader();
});
