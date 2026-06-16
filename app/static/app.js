'use strict';

const dropZone = document.getElementById('drop-zone');
const fileInput = document.getElementById('file-input');
const fileListEl = document.getElementById('file-list');
const itemsEl = document.getElementById('items');
const fileCount = document.getElementById('file-count');
const btnZip = document.getElementById('btn-download-zip');
const btnClear = document.getElementById('btn-clear');
const modal = document.getElementById('modal');
const modalTitle = document.getElementById('modal-title');
const modalContent = document.getElementById('modal-content');
const btnCopy = document.getElementById('btn-copy');
const btnModalDownload = document.getElementById('btn-modal-download');
const btnCloseModal = document.getElementById('btn-close-modal');

// name -> { state, mdName, chars, content, error }
const files = new Map();

const EXT_ICONS = {
  pdf: '📄', doc: '📝', docx: '📝', xls: '📊', xlsx: '📊',
  ppt: '📑', pptx: '📑', html: '🌐', htm: '🌐', csv: '📋',
  json: '🔧', xml: '🔧', txt: '📃', md: '📃',
  jpg: '🖼', jpeg: '🖼', png: '🖼', gif: '🖼', webp: '🖼',
  mp3: '🎵', wav: '🎵', mp4: '🎬',
};

function iconFor(name) {
  const ext = name.split('.').pop().toLowerCase();
  return EXT_ICONS[ext] || '📁';
}

function escHtml(s) {
  return s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
}

function updateHeader() {
  const done = [...files.values()].filter(f => f.state === 'done').length;
  fileCount.textContent = `${files.size} / ${MAX_FILES} files`;
  btnZip.disabled = done === 0;
  fileListEl.classList.toggle('hidden', files.size === 0);
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
      <button class="btn-icon" title="Preview" onclick="openPreview(${JSON.stringify(name)})">
        <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="none"
             stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"
             width="16" height="16">
          <path d="M1 12s4-8 11-8 11 8 11 8-4 8-11 8-11-8-11-8z"/>
          <circle cx="12" cy="12" r="3"/>
        </svg>
      </button>
      <button class="btn-icon" title="Download ${escHtml(info.mdName)}" onclick="downloadOne(${JSON.stringify(name)})">
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

async function uploadFile(file) {
  if (files.size >= MAX_FILES) {
    alert(`Maximum of ${MAX_FILES} files reached.`);
    return;
  }
  const name = file.name;
  if (files.has(name)) return;

  files.set(name, { state: 'pending' });
  renderItem(name, files.get(name));
  updateHeader();

  await new Promise(r => setTimeout(r, 30));

  files.set(name, { state: 'converting' });
  renderItem(name, files.get(name));

  const fd = new FormData();
  fd.append('file', file);

  try {
    const res = await fetch('/convert', { method: 'POST', body: fd });
    const data = await res.json();
    if (!res.ok) throw new Error(data.error || 'Unknown error');
    // content is stored client-side — no server session needed for download
    files.set(name, { state: 'done', mdName: data.name, chars: data.chars, content: data.content });
  } catch (err) {
    files.set(name, { state: 'error', error: err.message });
  }

  renderItem(name, files.get(name));
  updateHeader();
}

function addFiles(list) {
  [...list].slice(0, MAX_FILES - files.size).forEach(f => uploadFile(f));
}

// ── Drag & drop ──
dropZone.addEventListener('dragover', e => { e.preventDefault(); dropZone.classList.add('drag-over'); });
['dragleave', 'dragend'].forEach(ev => dropZone.addEventListener(ev, () => dropZone.classList.remove('drag-over')));
dropZone.addEventListener('drop', e => {
  e.preventDefault();
  dropZone.classList.remove('drag-over');
  if (e.dataTransfer.files.length) addFiles(e.dataTransfer.files);
});
dropZone.addEventListener('click', () => fileInput.click());
dropZone.addEventListener('keydown', e => { if (e.key === 'Enter' || e.key === ' ') fileInput.click(); });
fileInput.addEventListener('change', () => { if (fileInput.files.length) addFiles(fileInput.files); fileInput.value = ''; });

// ── Download (client-side Blob — no server session needed) ──
function blobDownload(content, filename) {
  const blob = new Blob([content], { type: 'text/markdown' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
  URL.revokeObjectURL(url);
}

function downloadOne(name) {
  const info = files.get(name);
  if (!info || info.state !== 'done') return;
  blobDownload(info.content, info.mdName);
}

btnZip.addEventListener('click', async () => {
  const payload = [...files.values()]
    .filter(f => f.state === 'done')
    .map(f => ({ name: f.mdName, content: f.content }));
  if (!payload.length) return;

  const res = await fetch('/download-zip', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ files: payload }),
  });
  if (!res.ok) { alert('Failed to create zip.'); return; }
  const blob = await res.blob();
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = 'converted.zip';
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
  URL.revokeObjectURL(url);
});

// ── Clear ──
btnClear.addEventListener('click', () => {
  if (!confirm('Clear all files?')) return;
  files.clear();
  itemsEl.innerHTML = '';
  updateHeader();
});

// ── Preview modal ──
let _previewName = null;

function openPreview(name) {
  const info = files.get(name);
  if (!info || info.state !== 'done') return;
  _previewName = name;
  modalTitle.textContent = info.mdName;
  modalContent.textContent = info.content;
  modal.classList.remove('hidden');
  document.body.style.overflow = 'hidden';
  btnCopy.textContent = 'Copy';
  btnCopy.prepend((() => {
    const s = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
    s.setAttribute('viewBox', '0 0 24 24'); s.setAttribute('fill', 'none');
    s.setAttribute('stroke', 'currentColor'); s.setAttribute('stroke-width', '2');
    s.setAttribute('stroke-linecap', 'round'); s.setAttribute('stroke-linejoin', 'round');
    s.setAttribute('width', '14'); s.setAttribute('height', '14');
    s.innerHTML = '<rect x="9" y="9" width="13" height="13" rx="2" ry="2"/><path d="M5 15H4a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v1"/>';
    return s;
  })());
}

function closeModal() {
  modal.classList.add('hidden');
  document.body.style.overflow = '';
  _previewName = null;
}

btnCloseModal.addEventListener('click', closeModal);
modal.addEventListener('click', e => { if (e.target === modal) closeModal(); });
document.addEventListener('keydown', e => { if (e.key === 'Escape') closeModal(); });

btnCopy.addEventListener('click', async () => {
  const text = modalContent.textContent;
  await navigator.clipboard.writeText(text);
  btnCopy.innerHTML = `
    <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="none"
         stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"
         width="14" height="14"><polyline points="20 6 9 17 4 12"/></svg>
    Copied!`;
  setTimeout(() => {
    btnCopy.innerHTML = `
      <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="none"
           stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"
           width="14" height="14">
        <rect x="9" y="9" width="13" height="13" rx="2" ry="2"/>
        <path d="M5 15H4a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v1"/>
      </svg>Copy`;
  }, 2000);
});

btnModalDownload.addEventListener('click', () => {
  if (_previewName) downloadOne(_previewName);
});
