# Bookmark Dedup

A Chrome extension (Manifest V3, plain JS, no build step) that finds bookmarks pointing at the same URL, shows them grouped side by side, and lets you choose which ones to delete.

## Install (unpacked)

1. Open `chrome://extensions`.
2. Turn on **Developer mode** (top right).
3. Click **Load unpacked** and select this folder.
4. Pin the extension and click its icon. The dashboard opens in a new tab.

After editing files, click the reload ↻ button on the extension card and refresh the dashboard tab.

## Using it

- Each card is one group of duplicates. Every row shows the title, the full URL, the folder it's in and the date it was added.
- **Keep** (radio) marks the bookmark you want to keep. It defaults to the oldest one. **Delete N others** removes every other bookmark in that group.
- **Delete** on a row removes just that bookmark.
- Every delete can be undone from the toast or with <kbd>Ctrl</kbd>+<kbd>Z</kbd>, as long as the dashboard tab stays open. Restored bookmarks go back into their original folder and position, but they get a new id and "date added".
- Click the 📁 folder path to open that folder in the bookmark manager.
- The list updates live when bookmarks change anywhere in Chrome.

### Matching modes

| Mode | Treated as duplicates |
| --- | --- |
| **Normalized** (default) | Ignores `http` vs `https`, a leading `www.`, host case, default ports (`:80`/`:443`), the `#fragment` and trailing slashes. The query string **does** count. Non-http(s) URLs are compared exactly. |
| **Exact** | Only URLs that are identical character for character. |

## Permissions

- `bookmarks`: read and delete bookmarks.
- `favicon`: show site icons from Chrome's favicon cache.

There are no host permissions, so nothing leaves your browser.

## Project layout

```
manifest.json       extension manifest (MV3)
background.js       toolbar click → opens dashboard.html
dashboard.html/css/js  the UI
lib/normalize.js    pure logic: URL normalization, tree flattening, grouping
tests/              node:test unit tests for lib/
icons/              toolbar / store icons
```

## Tests

```
npm test
```

This needs only Node 18+ and has no dependencies.
