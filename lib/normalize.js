// Pure helpers (no chrome.* calls) so they can be unit-tested in Node.

export const MODES = Object.freeze({ NORMALIZED: 'normalized', EXACT: 'exact' });

/**
 * Returns the key used to decide whether two bookmark URLs are duplicates.
 *
 * In normalized mode, for http(s) URLs only:
 *  - scheme is ignored (http == https)
 *  - host is lowercased and a leading "www." is dropped
 *  - default ports (80, 443) are dropped
 *  - the #fragment is dropped
 *  - trailing slashes on the path are dropped (root stays "/")
 *  - the query string is kept as-is
 * Any other scheme, or a URL that cannot be parsed, is compared verbatim.
 */
export function normalizeUrl(url, mode = MODES.NORMALIZED) {
  if (mode === MODES.EXACT) return url;

  let u;
  try {
    u = new URL(url);
  } catch {
    return url;
  }
  if (u.protocol !== 'http:' && u.protocol !== 'https:') return url;

  let host = u.hostname.toLowerCase();
  if (host.startsWith('www.')) host = host.slice(4);

  const port = u.port && u.port !== '80' && u.port !== '443' ? `:${u.port}` : '';

  let path = u.pathname;
  if (path.length > 1) path = path.replace(/\/+$/, '') || '/';

  return `${host}${port}${path}${u.search}`;
}

/**
 * Flattens a chrome.bookmarks tree into a list of bookmarks (folders excluded),
 * each annotated with its folder breadcrumb.
 */
export function flattenTree(nodes, trail = []) {
  const out = [];
  for (const node of nodes) {
    if (node.url) {
      out.push({
        id: node.id,
        parentId: node.parentId,
        index: node.index,
        title: node.title || '',
        url: node.url,
        dateAdded: node.dateAdded ?? 0,
        path: trail.join(' › '),
      });
    }
    if (node.children) {
      // The invisible root node has an empty title; keep it out of the breadcrumb.
      const next = node.title ? [...trail, node.title] : trail;
      out.push(...flattenTree(node.children, next));
    }
  }
  return out;
}

/**
 * Groups bookmarks by normalized URL and returns only groups with 2+ entries.
 * Groups are sorted largest first (then by key); entries within a group are
 * sorted oldest first.
 */
export function groupDuplicates(items, mode = MODES.NORMALIZED) {
  const byKey = new Map();
  for (const item of items) {
    const key = normalizeUrl(item.url, mode);
    let list = byKey.get(key);
    if (!list) byKey.set(key, (list = []));
    list.push(item);
  }

  const groups = [];
  for (const [key, list] of byKey) {
    if (list.length < 2) continue;
    list.sort((a, b) => a.dateAdded - b.dateAdded);
    groups.push({ key, items: list });
  }
  groups.sort((a, b) => b.items.length - a.items.length || a.key.localeCompare(b.key));
  return groups;
}
