const assert = require('node:assert/strict');
const { recommendArticles } = require('../cards.js');
const article = (slug, tags = []) => ({ slug, tags, title: slug, category: 'Tech', excerpt: 'Resumo', image: 'assets/a.jpg' });
const current = article('current', ['shared']);
const related = [article('a', ['shared']), article('b', ['shared']), article('c', ['shared']), article('d', ['shared'])];
const other = [article('e'), article('f', ['other'])];
const zero = () => 0;
assert.deepEqual(recommendArticles(null, current), []);
for (let n = 0; n <= 3; n++) {
  assert.equal(recommendArticles([current, ...other.slice(0, n)], current, zero).length, Math.min(n, 2));
}
assert.deepEqual(recommendArticles([current, ...related, ...other], current, zero).map(a => a.slug), ['a', 'b', 'c']);
assert.deepEqual(recommendArticles([current, related[0], related[1], ...other], current, zero).map(a => a.slug), ['a', 'b', 'e']);
assert.deepEqual(recommendArticles([current, related[0], related[0], ...other], current, zero).map(a => a.slug), ['a', 'e', 'f']);
assert.deepEqual(recommendArticles([current, { ...other[0], tagLabels: ['shared'] }, related[0]], current, zero).map(a => a.slug), ['a', 'e']);
assert.equal(recommendArticles([current, { ...related[0], title: '' }], current, zero).length, 0);
assert.equal(recommendArticles([current, ...related], article('current'), zero).length, 3);
// A seeded generator provides a repeatable distribution check for selection.
let seed = 123456789;
const random = () => ((seed = (Math.imul(seed, 1664525) + 1013904223) >>> 0) / 2 ** 32);
const counts = new Map(related.map(item => [item.slug, 0]));
for (let i = 0; i < 12000; i++) for (const item of recommendArticles([current, ...related], current, random)) counts.set(item.slug, counts.get(item.slug) + 1);
for (const count of counts.values()) assert(Math.abs(count - 9000) < 250, `biased sample: ${count}`);
console.log('PASS: recommendation priority, uniqueness, fallback and sampling.');
