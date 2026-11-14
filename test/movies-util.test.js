const test = require('node:test');
const assert = require('node:assert/strict');
const { normalizeInput, isSameSite, isGuardExempt, pickBestFrame, MOVIES_PARTITION } = require('../movies-util');

const SEARCH = 'https://www.google.com/search?q=';

test('MOVIES_PARTITION', () => {
  assert.equal(MOVIES_PARTITION, 'persist:movies');
});

test('normalizeInput: domains get https', () => {
  assert.equal(normalizeInput('example.com'), 'https://example.com/');
  assert.equal(normalizeInput('  example.co.th/movie?id=1 '), 'https://example.co.th/movie?id=1');
});

test('normalizeInput: full URLs are kept', () => {
  assert.equal(normalizeInput('http://x.com/a'), 'http://x.com/a');
  assert.equal(normalizeInput('HTTPS://Example.com/Path'), 'https://example.com/Path');
});

test('normalizeInput: localhost and IPs get http', () => {
  assert.equal(normalizeInput('localhost:3000'), 'http://localhost:3000/');
  assert.equal(normalizeInput('192.168.1.10/x'), 'http://192.168.1.10/x');
});

test('normalizeInput: anything else is a Google search', () => {
  assert.equal(normalizeInput('หนังใหม่'), SEARCH + encodeURIComponent('หนังใหม่'));
  assert.equal(normalizeInput('hello world.com'), SEARCH + 'hello%20world.com');
});

test('normalizeInput: empty input', () => {
  assert.equal(normalizeInput('   '), null);
  assert.equal(normalizeInput(undefined), null);
});

test('isSameSite: subdomains of the same registrable domain', () => {
  assert.equal(isSameSite('https://a.example.co.th/x', 'https://b.example.co.th/y'), true);
  assert.equal(isSameSite('https://www.example.com/', 'http://cdn.example.com/a.js'), true);
});

test('isSameSite: different sites', () => {
  assert.equal(isSameSite('https://example.com/', 'https://example.net/'), false);
  assert.equal(isSameSite('https://a.co.th/', 'https://b.co.th/'), false);
});

test('isSameSite: localhost compares by hostname', () => {
  assert.equal(isSameSite('http://localhost:3000/a', 'http://localhost:3000/b'), true);
});

test('isSameSite: non-http URLs are never the same site', () => {
  assert.equal(isSameSite('about:blank', 'about:blank'), false);
  assert.equal(isSameSite('file:///C:/a.html', 'file:///C:/b.html'), false);
  assert.equal(isSameSite('', 'https://example.com/'), false);
});

test('isGuardExempt: non-http pages and search engines', () => {
  assert.equal(isGuardExempt(''), true);
  assert.equal(isGuardExempt('file:///C:/app/movies-home.html?favs=%5B%5D'), true);
  assert.equal(isGuardExempt('https://www.google.com/search?q=x'), true);
  assert.equal(isGuardExempt('https://www.google.co.th/search?q=x'), true);
  assert.equal(isGuardExempt('https://www.bing.com/search?q=x'), true);
  assert.equal(isGuardExempt('https://duckduckgo.com/?q=x'), true);
});

test('isGuardExempt: ordinary sites are guarded', () => {
  assert.equal(isGuardExempt('https://movie-site.example.com/watch/1'), false);
  assert.equal(isGuardExempt('https://googleads.example.com/'), false);
});

test('pickBestFrame: a playing video wins even if smaller', () => {
  const probes = [
    { hasVideo: true, playing: false, area: 900 },
    { hasVideo: true, playing: true, area: 100 }
  ];
  assert.equal(pickBestFrame(probes), 1);
});

test('pickBestFrame: no playing video → largest', () => {
  const probes = [
    { hasVideo: true, playing: false, area: 100 },
    { hasVideo: false, playing: false, area: 0 },
    { hasVideo: true, playing: false, area: 900 }
  ];
  assert.equal(pickBestFrame(probes), 2);
});

test('pickBestFrame: several playing → largest playing', () => {
  const probes = [
    { hasVideo: true, playing: true, area: 50 },
    { hasVideo: true, playing: false, area: 5000 },
    { hasVideo: true, playing: true, area: 400 }
  ];
  assert.equal(pickBestFrame(probes), 2);
});

test('pickBestFrame: nothing to pick', () => {
  assert.equal(pickBestFrame([]), null);
  assert.equal(pickBestFrame([null, { hasVideo: false, playing: false, area: 0 }]), null);
});
