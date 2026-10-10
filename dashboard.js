import { MODES, flattenTree, groupDuplicates } from './lib/normalize.js';

const MODE_STORAGE_KEY = 'bookmark-dedup.mode';
const TOAST_MS = 8000;

const $ = (sel) => document.querySelector(sel);
const els = {
  summary: $('#summary'),
  hint: $('#mode-hint'),
  groups: $('#groups'),
  empty: $('#empty'),
  search: $('#search'),
  rescan: $('#rescan'),
  toast: $('#toast'),
  toastText: $('#toast-text'),
  toastUndo: $('#toast-undo'),
  groupTpl: $('#group-tpl'),
  rowTpl: $('#row-tpl'),
};

const state = {
  mode: loadMode(),
  query: '',
  total: 0,
  groups: [],
  keep: new Map(), // group key -> id of the bookmark to keep
  undo: [], // stack of batches of removed bookmarks
  busy: false,
};

const dateFmt = new Intl.DateTimeFormat(undefined, { dateStyle: 'medium' });

// ---------- scanning ----------

async function scan() {
  try {
    const tree = await chrome.bookmarks.getTree();
    const items = flattenTree(tree);
    state.total = items.length;
    state.groups = groupDuplicates(items, state.mode);
    render();
  } catch (err) {
    console.error(err);
    els.summary.textContent = `Could not read bookmarks: ${err.message}`;
  }
}

let rescanTimer;
function scheduleScan() {
  clearTimeout(rescanTimer);
  rescanTimer = setTimeout(scan, 200);
}

for (const evt of ['onCreated', 'onRemoved', 'onChanged', 'onMoved']) {
  chrome.bookmarks[evt].addListener(scheduleScan);
}

// ---------- rendering ----------

function render() {
  const { groups } = state;
  const extra = groups.reduce((n, g) => n + g.items.length - 1, 0);

  els.summary.replaceChildren(
    strong(groups.length), ` duplicate group${groups.length === 1 ? '' : 's'} · `,
    strong(extra), ` extra bookmark${extra === 1 ? '' : 's'} · `,
    `${state.total} scanned`,
  );

  els.hint.textContent = state.mode === MODES.EXACT
    ? 'Exact: URLs must match character for character.'
    : 'Normalized: ignores http/https, "www.", default ports, #fragments and trailing slashes. The query string still counts.';

  const q = state.query.trim().toLowerCase();
  const visible = q ? groups.filter((g) => matches(g, q)) : groups;

  els.groups.replaceChildren(...visible.map(renderGroup));

  els.empty.hidden = visible.length > 0;
  els.empty.textContent = groups.length === 0
    ? 'No duplicate bookmarks 🎉'
    : 'No duplicate groups match your filter.';
}

function matches(group, q) {
  if (group.key.toLowerCase().includes(q)) return true;
  return group.items.some((it) =>
    it.title.toLowerCase().includes(q) ||
    it.url.toLowerCase().includes(q) ||
    it.path.toLowerCase().includes(q));
}

function renderGroup(group, idx) {
  const node = els.groupTpl.content.firstElementChild.cloneNode(true);
  node.querySelector('.group-key').textContent = group.key;
  node.querySelector('.badge').textContent = `${group.items.length}×`;

  let keepId = state.keep.get(group.key);
  if (!group.items.some((it) => it.id === keepId)) {
    keepId = group.items[0].id; // oldest
    state.keep.set(group.key, keepId);
  }

  const rows = node.querySelector('.rows');
  for (const item of group.items) {
    rows.append(renderRow(group, item, `keep-${idx}`, item.id === keepId));
  }

  const deleteOthers = node.querySelector('.delete-others');
  deleteOthers.textContent = `Delete ${group.items.length - 1} other${group.items.length > 2 ? 's' : ''}`;
  deleteOthers.addEventListener('click', () => {
    const keep = state.keep.get(group.key);
    removeBookmarks(group.items.filter((it) => it.id !== keep));
  });

  return node;
}

function renderRow(group, item, radioName, kept) {
  const row = els.rowTpl.content.firstElementChild.cloneNode(true);
  row.classList.toggle('kept', kept);

  const radio = row.querySelector('.keep input');
  radio.name = radioName;
  radio.checked = kept;
  radio.addEventListener('change', () => {
    state.keep.set(group.key, item.id);
    render();
  });

  row.querySelector('.favicon').src = faviconUrl(item.url);

  const title = row.querySelector('.title');
  title.textContent = item.title || '(untitled)';
  title.classList.toggle('untitled', !item.title);

  const url = row.querySelector('.url');
  if (/^(https?|file):/i.test(item.url)) {
    const a = document.createElement('a');
    a.href = item.url;
    a.target = '_blank';
    a.rel = 'noopener noreferrer';
    a.textContent = item.url;
    url.append(a);
  } else {
    url.textContent = item.url; // never make javascript: etc. clickable
  }

  const folder = row.querySelector('.folder');
  folder.textContent = `📁 ${item.path || '(root)'}`;
  folder.addEventListener('click', () => {
    chrome.tabs.create({ url: `chrome://bookmarks/?id=${encodeURIComponent(item.parentId)}` });
  });

  row.querySelector('.date').textContent = item.dateAdded
    ? `Added ${dateFmt.format(item.dateAdded)}`
    : '';

  row.querySelector('.delete').addEventListener('click', () => removeBookmarks([item]));
  return row;
}

function strong(text) {
  const el = document.createElement('strong');
  el.textContent = String(text);
  return el;
}

function faviconUrl(pageUrl) {
  const url = new URL(chrome.runtime.getURL('/_favicon/'));
  url.searchParams.set('pageUrl', pageUrl);
  url.searchParams.set('size', '32');
  return url.toString();
}

// ---------- delete / undo ----------

async function removeBookmarks(items) {
  if (state.busy || items.length === 0) return;
  setBusy(true);
  const removed = [];
  const failed = [];
  try {
    for (const item of items) {
      try {
        await chrome.bookmarks.remove(item.id);
        removed.push(item);
      } catch (err) {
        console.error('remove failed', item, err);
        failed.push(item);
      }
    }
  } finally {
    setBusy(false);
  }

  if (removed.length) state.undo.push(removed);
  let msg = `Deleted ${removed.length} bookmark${removed.length === 1 ? '' : 's'}.`;
  if (failed.length) msg += ` ${failed.length} could not be deleted.`;
  showToast(msg, removed.length > 0);
  await scan();
}

async function undoLast() {
  if (state.busy) return;
  const batch = state.undo.pop();
  if (!batch) return;
  setBusy(true);
  let restored = 0;
  try {
    // Recreate in ascending index order so earlier indexes stay valid.
    for (const item of [...batch].sort((a, b) => a.index - b.index)) {
      if (await recreate(item)) restored++;
    }
  } finally {
    setBusy(false);
  }
  showToast(`Restored ${restored} of ${batch.length} bookmark${batch.length === 1 ? '' : 's'}.`, state.undo.length > 0);
  await scan();
}

async function recreate({ parentId, index, title, url }) {
  const attempts = [
    { parentId, index, title, url },
    { parentId, title, url }, // index no longer valid
    { title, url }, // parent folder gone → "Other bookmarks"
  ];
  for (const props of attempts) {
    try {
      await chrome.bookmarks.create(props);
      return true;
    } catch (err) {
      console.warn('create failed', props, err);
    }
  }
  return false;
}

let toastTimer;
function showToast(message, canUndo) {
  els.toastText.textContent = message;
  els.toastUndo.hidden = !canUndo;
  els.toast.hidden = false;
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => { els.toast.hidden = true; }, TOAST_MS);
}

function setBusy(busy) {
  state.busy = busy;
  document.body.toggleAttribute('aria-busy', busy);
  for (const btn of document.querySelectorAll('.delete, .delete-others, #toast-undo')) {
    btn.disabled = busy;
  }
}

// ---------- controls ----------

function loadMode() {
  try {
    const saved = localStorage.getItem(MODE_STORAGE_KEY);
    if (saved === MODES.EXACT || saved === MODES.NORMALIZED) return saved;
  } catch { /* storage unavailable */ }
  return MODES.NORMALIZED;
}

for (const radio of document.querySelectorAll('input[name="mode"]')) {
  radio.checked = radio.value === state.mode;
  radio.addEventListener('change', () => {
    state.mode = radio.value;
    try { localStorage.setItem(MODE_STORAGE_KEY, state.mode); } catch { /* ignore */ }
    scan();
  });
}

els.search.addEventListener('input', () => {
  state.query = els.search.value;
  render();
});

els.rescan.addEventListener('click', scan);
els.toastUndo.addEventListener('click', undoLast);

document.addEventListener('keydown', (e) => {
  if ((e.ctrlKey || e.metaKey) && e.key === 'z' && e.target !== els.search) {
    e.preventDefault();
    undoLast();
  }
});

scan();
