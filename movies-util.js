// Pure helpers for the Movies tab (no Electron): used by main.js modules and movies.js,
// unit-tested in test/movies-util.test.js
const { parse } = require('tldts');

const MOVIES_PARTITION = 'persist:movies';
const SEARCH_URL = 'https://www.google.com/search?q=';
// Clicking a result on these goes to another site on purpose, so the redirect guard skips them
const SEARCH_ENGINES = new Set(['google', 'bing', 'duckduckgo']);

const LOCAL_HOST = /^(localhost|\d{1,3}(\.\d{1,3}){3})(:\d+)?([/?#]|$)/i;
const DOMAIN_LIKE = /^[^/?#]+\.[a-z]{2,}(:\d+)?([/?#]|$)/i;

function isHttpUrl(url) {
  try {
    return /^https?:$/.test(new URL(url).protocol);
  } catch (e) {
    return false;
  }
}

// Address bar text → URL to load (domain → https, localhost/IP → http, anything else → Google search)
function normalizeInput(text) {
  const input = String(text ?? '').trim();
  if (!input) return null;
  if (/^https?:\/\//i.test(input)) {
    try { return new URL(input).href; } catch (e) { /* not a valid URL: search for it */ }
  }
  if (!/\s/.test(input)) {
    try {
      if (LOCAL_HOST.test(input)) return new URL(`http://${input}`).href;
      if (DOMAIN_LIKE.test(input)) return new URL(`https://${input}`).href;
    } catch (e) { /* fall through to search */ }
  }
  return SEARCH_URL + encodeURIComponent(input);
}

// Registrable domain (a.example.co.th → example.co.th); the hostname for localhost / IPs
function siteOf(url) {
  const { domain, hostname } = parse(url);
  return domain || hostname || null;
}

function isSameSite(a, b) {
  if (!isHttpUrl(a) || !isHttpUrl(b)) return false;
  const site = siteOf(a);
  return !!site && site === siteOf(b);
}

// Pages the redirect guard leaves alone: our own favourites page (file:) / blank, and search engines
function isGuardExempt(url) {
  if (!isHttpUrl(url)) return true;
  return SEARCH_ENGINES.has(parse(url).domainWithoutSuffix);
}

// Frame holding the clip the user is watching: playing first, then the biggest on screen
function pickBestFrame(probes) {
  let best = null;
  probes.forEach((probe, i) => {
    if (!probe || !probe.hasVideo) return;
    if (best === null) { best = i; return; }
    const current = probes[best];
    const better = probe.playing !== current.playing ? probe.playing : probe.area > current.area;
    if (better) best = i;
  });
  return best;
}

module.exports = { MOVIES_PARTITION, normalizeInput, isSameSite, isGuardExempt, pickBestFrame };
