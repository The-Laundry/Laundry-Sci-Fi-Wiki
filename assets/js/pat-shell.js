/* ══════════════════════════════════════════════════════════════════
   Public Access Terminal — Shell Injector
   Runs on every PAT page (wiki/*, map/index.html, root index.html).
   Responsibilities:
     1. Apply saved theme immediately (avoids FOUC)
     2. Determine active tab from URL path
     3. Build and prepend the PAT header to <body>
     4. Expose window.PAT for theme toggling
   ══════════════════════════════════════════════════════════════════ */

(function () {
  'use strict';

  const THEME_KEY = 'emt_theme';

  // ── 1. Apply theme immediately ───────────────────────────────────
  // Mirrors the early-apply IIFE already in wiki/js/ui.js so the two
  // never fight — they both read/write the same localStorage key.
  (function applyThemeEarly() {
    try {
      const saved = localStorage.getItem(THEME_KEY);
      const theme = (saved === 'dark' || saved === 'light')
        ? saved
        : (window.matchMedia && window.matchMedia('(prefers-color-scheme: dark)').matches
            ? 'dark' : 'light');
      document.documentElement.setAttribute('data-theme', theme);
    } catch (_) { /* storage blocked */ }
  })();

  // ── 2. Derive asset root from this script's own URL ──────────────
  // Script always lives at  <root>/assets/js/pat-shell.js
  // so stripping  /js/pat-shell.js  gives the assets/ folder URL,
  // and stripping  /assets/js/pat-shell.js  gives the site root URL.
  const scriptSrc = (document.currentScript && document.currentScript.src) || '';
  const assetsRoot = scriptSrc.replace(/\/js\/pat-shell\.js.*$/, '');
  const siteRoot   = assetsRoot.replace(/\/assets$/, '');

  // ── 3. Determine active tab and root-relative href prefix ────────
  const path = window.location.pathname;

  function getTab() {
    if (path.includes('/wiki/'))  return 'wiki';
    if (path.includes('/map/'))   return 'map';
    if (path.includes('/tools/')) return 'tools';
    return ''; // portal / root
  }

  // href prefix so links work from any depth
  function getRoot() {
    if (path.includes('/wiki/') ||
        path.includes('/map/')  ||
        path.includes('/tools/')) {
      return '../';
    }
    return '';
  }

  const tab  = getTab();
  const root = getRoot();
  const isMap = tab === 'map';

  const ATTRIBUTION = {
    wiki:  'Published by Phodd Communications',
    map:   'Compiled by the Institute of Galactic Cultures',
    tools: '',
    '':    '',
  };

  // ── 4. Build header HTML ─────────────────────────────────────────
  function buildHeader() {
    const attr = ATTRIBUTION[tab] || '';

    const themeBtn = !isMap ? `
      <button class="pat-theme-btn" id="pat-theme-btn"
              onclick="PAT.toggleTheme()"
              title="Toggle light / dark mode"
              aria-label="Toggle light / dark mode">
        <svg class="icon-moon" viewBox="0 0 24 24" fill="none"
             stroke="currentColor" stroke-width="2"
             stroke-linecap="round" stroke-linejoin="round">
          <path d="M21 12.79A9 9 0 1 1 11.21 3 7 7 0 0 0 21 12.79z"/>
        </svg>
        <svg class="icon-sun" viewBox="0 0 24 24" fill="none"
             stroke="currentColor" stroke-width="2"
             stroke-linecap="round" stroke-linejoin="round">
          <circle cx="12" cy="12" r="4"/>
          <path d="M12 2v2M12 20v2M4.93 4.93l1.41 1.41M17.66 17.66l1.41 1.41
                   M2 12h2M20 12h2M4.93 19.07l1.41-1.41M17.66 6.34l1.41-1.41"/>
        </svg>
      </button>` : '';

    return `
      <a class="pat-seal" href="${root}index.html" title="Public Access Terminal — Home">
        <div class="pat-seal-emblem">◆</div>
        <div class="pat-seal-text">
          <span class="pat-class">Republic Information Relay</span>
          <span class="pat-name">Public Access Terminal</span>
        </div>
      </a>
      <nav class="pat-tabs" aria-label="Terminal sections">
        <a href="${root}wiki/index.html"
           class="pat-tab${tab === 'wiki'  ? ' active' : ''}">Encyclopedia of Many Things</a>
        <a href="${root}map/index.html"
           class="pat-tab${tab === 'map'   ? ' active' : ''}">Reference Atlas</a>
        <a href="${root}tools/index.html"
           class="pat-tab${tab === 'tools' ? ' active' : ''}">Tools</a>
      </nav>
      ${attr ? `<div class="pat-attribution">${attr}</div>` : ''}
      ${themeBtn}
    `;
  }

  // ── 5. Inject header into DOM ────────────────────────────────────
  function inject() {
    // Guard against double injection
    if (document.getElementById('pat-header')) return;

    const header = document.createElement('div');
    header.id = 'pat-header';
    if (isMap) header.classList.add('on-map');

    header.innerHTML = buildHeader();
    document.body.insertBefore(header, document.body.firstChild);

    // Map-specific: add class to body so shell.css can apply layout fixes
    if (isMap) document.body.classList.add('pat-map-page');
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', inject);
  } else {
    inject();
  }

  // ── 6. Public API ────────────────────────────────────────────────
  window.PAT = {
    toggleTheme() {
      const isDark = document.documentElement.getAttribute('data-theme') === 'dark';
      const next = isDark ? 'light' : 'dark';
      document.documentElement.setAttribute('data-theme', next);
      try { localStorage.setItem(THEME_KEY, next); } catch (_) {}
      // Sync with wiki UI if it's loaded on this page
      if (window.UI && typeof UI.setTheme === 'function') {
        UI.setTheme(next);
      }
    },
  };
})();
