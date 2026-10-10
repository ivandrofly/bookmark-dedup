import { test } from 'node:test';
import assert from 'node:assert/strict';
import { normalizeUrl, flattenTree, groupDuplicates, MODES } from '../lib/normalize.js';

const same = (a, b) => assert.equal(normalizeUrl(a), normalizeUrl(b), `${a} vs ${b}`);
const differ = (a, b) => assert.notEqual(normalizeUrl(a), normalizeUrl(b), `${a} vs ${b}`);

test('trailing slash is ignored', () => {
  same('https://example.com/docs/', 'https://example.com/docs');
  same('https://example.com/', 'https://example.com');
  same('https://example.com/a//', 'https://example.com/a');
});

test('http and https are the same', () => {
  same('http://example.com/a', 'https://example.com/a');
});

test('www. prefix and host case are ignored', () => {
  same('https://www.Example.COM/a', 'https://example.com/a');
});

test('fragment is ignored', () => {
  same('https://example.com/a#section', 'https://example.com/a');
});

test('default ports are ignored, other ports are not', () => {
  same('http://example.com:80/a', 'https://example.com:443/a');
  differ('https://example.com:8080/a', 'https://example.com/a');
});

test('query string is kept', () => {
  differ('https://example.com/a?x=1', 'https://example.com/a?x=2');
  differ('https://example.com/a?x=1&y=2', 'https://example.com/a?y=2&x=1');
  same('https://example.com/a/?x=1#top', 'https://example.com/a?x=1');
});

test('path case matters', () => {
  differ('https://example.com/A', 'https://example.com/a');
});

test('non-http schemes are compared verbatim', () => {
  const js = 'javascript:alert(1)/';
  assert.equal(normalizeUrl(js), js);
  differ('chrome://settings/', 'chrome://settings');
  differ('file:///C:/a.txt#x', 'file:///C:/a.txt');
});

test('malformed URL falls back to the raw string', () => {
  assert.equal(normalizeUrl('not a url'), 'not a url');
});

test('exact mode returns the URL unchanged', () => {
  const url = 'https://www.Example.com/a/#x';
  assert.equal(normalizeUrl(url, MODES.EXACT), url);
});

test('flattenTree builds folder paths and skips folders', () => {
  const tree = [{
    id: '0', title: '', children: [
      { id: '1', parentId: '0', index: 0, title: 'Bookmarks bar', children: [
        { id: '10', parentId: '1', index: 0, title: 'A', url: 'https://a.com', dateAdded: 5 },
        { id: '11', parentId: '1', index: 1, title: 'Dev', children: [
          { id: '20', parentId: '11', index: 0, title: '', url: 'https://b.com' },
        ] },
      ] },
    ],
  }];
  const items = flattenTree(tree);
  assert.deepEqual(items.map((i) => [i.id, i.path]), [
    ['10', 'Bookmarks bar'],
    ['20', 'Bookmarks bar › Dev'],
  ]);
  assert.equal(items[1].dateAdded, 0);
});

test('groupDuplicates keeps only duplicates, largest group first, oldest item first', () => {
  const items = [
    { id: '1', url: 'https://example.com/', dateAdded: 30 },
    { id: '2', url: 'http://www.example.com', dateAdded: 10 },
    { id: '3', url: 'https://example.com/#x', dateAdded: 20 },
    { id: '4', url: 'https://b.com/x', dateAdded: 1 },
    { id: '5', url: 'https://b.com/x/', dateAdded: 2 },
    { id: '6', url: 'https://unique.com', dateAdded: 3 },
  ];
  const groups = groupDuplicates(items);
  assert.deepEqual(groups.map((g) => g.items.map((i) => i.id)), [['2', '3', '1'], ['4', '5']]);

  const exact = groupDuplicates(items, MODES.EXACT);
  assert.equal(exact.length, 0);
});
