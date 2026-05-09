// js/ui.js
// Injects the shared shell (header, sidebar, modal, toast) into every page.
// Each page calls UI.init() after DB.init().

'use strict';

// Apply persisted theme as early as possible to avoid a flash of the wrong
// palette. This runs during script parse, before paint in most cases.
(function applyThemeEarly() {
  try {
    const saved = localStorage.getItem('emt_theme');
    const theme = (saved === 'dark' || saved === 'light')
      ? saved
      : (window.matchMedia && window.matchMedia('(prefers-color-scheme: dark)').matches ? 'dark' : 'light');
    document.documentElement.setAttribute('data-theme', theme);
  } catch (_) { /* ignore */ }
})();

const UI = {

  // ── SHELL INJECTION ──────────────────────────────────────────────────

  init(opts = {}) {
    this._applyTheme();
    this._injectHeader(opts.activePage || '');
    this._injectSidebar();
    this._injectModal();
    this._injectToast();
    this._bindSearch();
    this._bindModalClose();
    this._updateFolderStatus();
    this._updateThemeToggle();
  },

  // ── THEME ────────────────────────────────────────────────────────────

  getTheme() {
    return document.documentElement.getAttribute('data-theme') || 'light';
  },

  setTheme(theme) {
    const t = (theme === 'dark') ? 'dark' : 'light';
    document.documentElement.setAttribute('data-theme', t);
    try { localStorage.setItem('emt_theme', t); } catch (_) {}
    this._updateThemeToggle();
  },

  toggleTheme() {
    this.setTheme(this.getTheme() === 'dark' ? 'light' : 'dark');
  },

  _updateThemeToggle() {
    const btn = document.getElementById('theme-toggle-btn');
    if (!btn) return;
    const isDark = this.getTheme() === 'dark';
    btn.setAttribute('aria-label', isDark ? 'Switch to light mode' : 'Switch to dark mode');
    btn.setAttribute('title', isDark ? 'Switch to light mode' : 'Switch to dark mode');
  },

  _injectHeader(activePage) {
    const header = document.getElementById('app-header');
    if (!header) return;
    const pages = [
      { id: 'articles',  label: 'Articles',  href: DB.isReadOnly ? 'index.html' : 'manager.html' },
      { id: 'timelines', label: 'Timelines', href: 'timeline-manager.html' },
      { id: 'search',    label: 'Search',    href: 'search.html' },
      { id: 'ai',        label: 'AI',        href: 'ai.html' },
      { id: 'data',      label: 'Data',      href: 'data.html' },
      { id: 'help',      label: 'Help',      href: 'help.html' },
    ];
    const readOnlyBadge = DB.isReadOnly
      ? `<div style="display:flex;align-items:center;gap:5px;padding:4px 10px;background:var(--accent-light);border:1px solid var(--accent);border-radius:var(--radius);font-size:11.5px;font-weight:600;color:var(--accent);flex-shrink:0;">
           <svg width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5"><rect x="3" y="11" width="18" height="11" rx="2"/><path d="M7 11V7a5 5 0 0 1 10 0v4"/></svg>
           Read Only
         </div>`
      : '';
    const folderBtn = DB.isReadOnly ? '' : `
        <div class="header-divider"></div>
        <button class="folder-status" id="folder-status-btn" onclick="UI.handleFolderClick()">
          <span class="dot"></span>
          <span id="folder-status-label">No folder</span>
        </button>`;
    const newArticleBtn = DB.isReadOnly ? '' : `
        <a href="editor.html?id=new" class="btn btn-primary">
          <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><line x1="12" y1="5" x2="12" y2="19"/><line x1="5" y1="12" x2="19" y2="12"/></svg>
          New Article
        </a>`;
    const themeBtn = `
        <button class="theme-toggle-btn" id="theme-toggle-btn" onclick="UI.toggleTheme()" title="Toggle dark mode" aria-label="Toggle dark mode">
          <span id="theme-toggle-icon">${(DB.settings.theme === 'dark') ? '☀️' : '🌙'}</span>
        </button>`;
    header.innerHTML = `
      <a class="header-brand" href="index.html">
        <span class="corp">Phodd Communications</span>
        <span class="title">Encyclopedia of Many Things</span>
      </a>
      <div class="header-divider"></div>
      <div class="header-search-wrap">
        <svg class="search-icon" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><circle cx="11" cy="11" r="8"/><path d="M21 21l-4.35-4.35"/></svg>
        <input id="header-search" type="text" placeholder="Search articles…" autocomplete="off">
        <div id="search-results"></div>
      </div>
      <div class="header-actions">
        ${pages.map(p => `
          <a href="${p.href}" class="btn btn-ghost ${activePage === p.id ? 'active' : ''}" style="${activePage === p.id ? 'color:var(--accent);' : ''}">
            ${p.label}
          </a>`).join('')}
        ${themeBtn}
        ${folderBtn}
        ${readOnlyBadge}
        ${newArticleBtn}
        <button class="theme-toggle" id="theme-toggle-btn" onclick="UI.toggleTheme()" title="Toggle theme" aria-label="Toggle theme">
          <svg class="icon-moon" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M21 12.79A9 9 0 1 1 11.21 3 7 7 0 0 0 21 12.79z"/></svg>
          <svg class="icon-sun" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="12" r="4"/><path d="M12 2v2M12 20v2M4.93 4.93l1.41 1.41M17.66 17.66l1.41 1.41M2 12h2M20 12h2M4.93 19.07l1.41-1.41M17.66 6.34l1.41-1.41"/></svg>
        </button>
        <span class="ai-busy-indicator" id="ai-busy-indicator" title="AI is working…">
          <span class="ai-spinner sm"></span>
          <span class="ai-busy-label" id="ai-busy-label">AI…</span>
        </span>
      </div>`;
  },

  // ── THEME ─────────────────────────────────────────────────────────────

  _applyTheme() {
    // Theme lives in localStorage only — never written to settings.json
    const theme = localStorage.getItem('eomt_theme') || DB.settings.theme || 'light';
    document.documentElement.setAttribute('data-theme', theme === 'dark' ? 'dark' : 'light');
  },

  toggleTheme() {
    const isDark = document.documentElement.getAttribute('data-theme') === 'dark';
    const next = isDark ? 'light' : 'dark';
    // Store in localStorage only — no disk write
    localStorage.setItem('eomt_theme', next);
    document.documentElement.setAttribute('data-theme', next);
    const icon = document.getElementById('theme-toggle-icon');
    if (icon) icon.textContent = next === 'dark' ? '☀️' : '🌙';
    // Update the SVG toggle button state too
    const btn = document.getElementById('theme-toggle-btn');
    if (btn) btn.setAttribute('data-theme', next);
  },

  _injectSidebar() {
    const sidebar = document.getElementById('sidebar');
    if (!sidebar) return;
    const aiGenLink = DB.isReadOnly
      ? ''
      : `<a class="sidebar-nav-item" href="ai-generate.html">🪄 AI Generator</a>`;
    sidebar.innerHTML = `
      <div class="sidebar-section">
        <div class="sidebar-label">Navigation</div>
        <a class="sidebar-nav-item" href="index.html">🏠 Homepage</a>
        <a class="sidebar-nav-item" href="manager.html">📂 Article Manager</a>
        <a class="sidebar-nav-item" href="timeline-manager.html">📅 Timelines</a>
        <a class="sidebar-nav-item" href="search.html">🔍 Search</a>
        <a class="sidebar-nav-item" href="article-templates.html">🧩 Article Templates</a>
        ${aiGenLink}
        <a class="sidebar-nav-item" href="ai.html">🤖 AI Settings</a>
        <a class="sidebar-nav-item" href="help.html">❓ Help &amp; Guide</a>
      </div>
      <div class="sidebar-section">
        <div class="sidebar-label">Timelines</div>
        <div id="sidebar-timelines"></div>
      </div>
      <div class="sidebar-section">
        <div class="sidebar-label">Tags</div>
        <div id="sidebar-tags"></div>
      </div>
      <div class="sidebar-section" style="flex:1;">
        <div class="sidebar-label">Articles</div>
        <div id="sidebar-tree"></div>
      </div>`;
    this.renderSidebar();
  },

  renderSidebar() {
    this._renderSidebarTimelines();
    this._renderSidebarTags();
    this._renderSidebarTree();
  },

  _renderSidebarTags() {
    const el = document.getElementById('sidebar-tags');
    if (!el) return;
    const currentTag = new URLSearchParams(location.search).get('tag') || '';
    const allTags = [...new Set(DB.articles.flatMap(a => a.tags || []))].sort();
    el.innerHTML = '';
    if (!allTags.length) {
      el.innerHTML = '<div style="font-size:12px;color:var(--text-faint);padding:4px;">No tags yet.</div>';
      return;
    }
    const wrap = document.createElement('div');
    wrap.style.cssText = 'display:flex;flex-wrap:wrap;gap:5px;padding:2px 0;';
    allTags.forEach(t => {
      const a = document.createElement('a');
      a.className = 'tag' + (t === currentTag ? ' tag-active' : '');
      a.href = `search.html?tag=${encodeURIComponent(t)}`;
      a.textContent = t;
      a.style.textDecoration = 'none';
      wrap.appendChild(a);
    });
    el.appendChild(wrap);
  },

  _renderSidebarTimelines() {
    const el = document.getElementById('sidebar-timelines');
    if (!el) return;
    const currentTlId = new URLSearchParams(location.search).get('id');
    el.innerHTML = '';
    if (!DB.timelines.length) {
      el.innerHTML = '<div style="font-size:12px;color:var(--text-faint);padding:4px;">No timelines yet.</div>';
      return;
    }
    DB.timelines.forEach(tl => {
      const a = document.createElement('a');
      a.className = 'sb-timeline-item' + (tl.id === currentTlId ? ' active' : '');
      a.href = `timeline.html?id=${tl.id}`;
      a.textContent = '📅 ' + tl.name;
      el.appendChild(a);
    });
  },

  _renderSidebarTree() {
    const container = document.getElementById('sidebar-tree');
    if (!container) return;
    const currentArtId = new URLSearchParams(location.search).get('id');
    container.innerHTML = '';

    // Renders article links into a container element
    const renderArticles = (articles, depth, parentEl) => {
      articles.sort((a, b) => (a.title||'').localeCompare(b.title||''));
      articles.forEach(a => {
        const el = document.createElement('a');
        el.className = 'sb-article' + (a.id === currentArtId ? ' active' : '');
        el.href = `article.html?id=${a.id}`;
        el.style.paddingLeft = (depth + 1) * 12 + 8 + 'px';
        el.textContent = a.title || 'Untitled';
        parentEl.appendChild(el);
      });
    };

    // Lazy category renderer — children not built until first expand
    const renderCat = (cid, depth) => {
      const cat = DB.getCatById(cid);
      if (!cat) return null;

      const articles = DB.getArticlesInCat(cid).sort((a, b) => (a.title||'').localeCompare(b.title||''));
      const children = DB.getChildCats(cid).sort((a, b) => a.name.localeCompare(b.name));
      const hasKids   = children.length + articles.length > 0;
      const isOpen    = !DB.getCatCollapsed(cid);

      const wrap = document.createElement('div');
      wrap.style.paddingLeft = depth * 12 + 'px';

      // Header row
      const header = document.createElement('div');
      header.className = 'sb-cat-row';
      const countHint = hasKids
        ? `<span class="sb-cat-count">${DB.countInSubtree(cid)}</span>`
        : '';
      header.innerHTML = `
        <span class="sb-toggle ${hasKids ? (isOpen ? 'open' : '') : 'leaf'}">▶</span>
        <span style="font-size:12px;margin-right:2px;">📁</span>
        <span class="sb-cat-name">${escHtml(cat.name)}</span>
        ${countHint}`;

      // Children container — may be empty until first expand
      const childWrap = document.createElement('div');
      childWrap.className = 'sb-children' + (isOpen ? ' open' : '');
      let childrenBuilt = false;

      const buildChildren = () => {
        if (childrenBuilt) return;
        childrenBuilt = true;
        children.forEach(c => {
          const el = renderCat(c.id, depth + 1);
          if (el) childWrap.appendChild(el);
        });
        renderArticles(articles, depth, childWrap);
      };

      // If open by default, build immediately
      if (isOpen) buildChildren();

      if (hasKids) {
        header.onclick = () => {
          const nowCollapsed = DB.getCatCollapsed(cid);
          DB.setCatCollapsed(cid, !nowCollapsed);
          const tog = header.querySelector('.sb-toggle');
          if (nowCollapsed) {
            // Opening — build children if not yet done
            buildChildren();
            childWrap.classList.add('open');
            tog.classList.add('open');
          } else {
            childWrap.classList.remove('open');
            tog.classList.remove('open');
          }
        };
      }

      wrap.appendChild(header);
      wrap.appendChild(childWrap);
      return wrap;
    };

    if (!DB.categories.length && !DB.articleMeta.length) {
      container.innerHTML = '<div style="font-size:12.5px;color:var(--text-faint);padding:4px;">No articles yet.</div>';
      return;
    }

    DB.getRootCats().sort((a, b) => a.name.localeCompare(b.name))
      .forEach(c => { const el = renderCat(c.id, 0); if (el) container.appendChild(el); });

    const uncat = DB.getUncategorized();
    if (uncat.length) {
      const wrap = document.createElement('div');
      const lbl = document.createElement('div');
      lbl.className = 'sidebar-label'; lbl.style.marginTop = '10px'; lbl.textContent = 'Uncategorized';
      wrap.appendChild(lbl);
      uncat.sort((a, b) => (a.title||'').localeCompare(b.title||'')).forEach(a => {
        const el = document.createElement('a');
        el.className = 'sb-article' + (a.id === currentArtId ? ' active' : '');
        el.href = `article.html?id=${a.id}`;
        el.textContent = a.title || 'Untitled';
        wrap.appendChild(el);
      });
      container.appendChild(wrap);
    }
  },

  // ── MODAL ────────────────────────────────────────────────────────────

  _injectModal() {
    if (document.getElementById('modal-overlay')) return;
    const el = document.createElement('div');
    el.id = 'modal-overlay';
    el.innerHTML = `<div class="modal"><h2 class="modal-title" id="modal-title"></h2><div id="modal-body"></div><div class="modal-actions" id="modal-actions"></div></div>`;
    document.body.appendChild(el);
  },

  _injectToast() {
    if (document.getElementById('toast')) return;
    const el = document.createElement('div');
    el.id = 'toast';
    document.body.appendChild(el);
  },

  _bindModalClose() {
    document.addEventListener('click', e => {
      const overlay = document.getElementById('modal-overlay');
      if (overlay && e.target === overlay) this.closeModal();
    });
    document.addEventListener('keydown', e => {
      if (e.key === 'Escape') this.closeModal();
    });
  },

  showModal(title, bodyHTML, buttons) {
    document.getElementById('modal-title').textContent = title;
    document.getElementById('modal-body').innerHTML = bodyHTML;
    const actions = document.getElementById('modal-actions');
    actions.innerHTML = '';
    buttons.forEach(({ label, cls, action }) => {
      const btn = document.createElement('button');
      btn.className = 'btn ' + (cls || 'btn-secondary');
      btn.textContent = label;
      btn.onclick = action;
      actions.appendChild(btn);
    });
    document.getElementById('modal-overlay').classList.add('open');
  },

  closeModal() {
    const el = document.getElementById('modal-overlay');
    if (el) el.classList.remove('open');
  },

  // ── TOAST ────────────────────────────────────────────────────────────

  toast(msg) {
    const el = document.getElementById('toast');
    if (!el) return;
    el.textContent = msg;
    el.classList.add('show');
    clearTimeout(this._toastTimer);
    this._toastTimer = setTimeout(() => el.classList.remove('show'), 2400);
  },

  // ── AI ACTIVITY INDICATOR ────────────────────────────────────────────
  // Reference-counted busy state: every aiBusyBegin() must be paired with
  // aiBusyEnd(). The indicator stays visible as long as any counter is live,
  // and shows the label of the most recent Begin call. Use aiBusyUpdate()
  // from inside a running operation to change the tooltip (e.g. mid-phase).
  //
  // These are safe to call before UI.init() — they quietly no-op until the
  // header element exists.

  _aiBusy: { count: 0, labels: [] },

  aiBusyBegin(label) {
    const id = ++this._aiBusy._seq || (this._aiBusy._seq = 1);
    this._aiBusy.count++;
    this._aiBusy.labels.push({ id, label: String(label || 'AI working…') });
    this._aiBusyRender();
    return id;
  },

  aiBusyUpdate(id, label) {
    const ent = this._aiBusy.labels.find(x => x.id === id);
    if (ent) { ent.label = String(label || ent.label); this._aiBusyRender(); }
  },

  aiBusyEnd(id) {
    if (this._aiBusy.count <= 0) return;
    this._aiBusy.count = Math.max(0, this._aiBusy.count - 1);
    if (id != null) {
      const i = this._aiBusy.labels.findIndex(x => x.id === id);
      if (i >= 0) this._aiBusy.labels.splice(i, 1);
    } else if (this._aiBusy.labels.length) {
      this._aiBusy.labels.pop();
    }
    this._aiBusyRender();
  },

  _aiBusyRender() {
    const el = document.getElementById('ai-busy-indicator');
    if (!el) return;
    const lbl = document.getElementById('ai-busy-label');
    const on = this._aiBusy.count > 0;
    el.classList.toggle('on', on);
    if (on) {
      const top = this._aiBusy.labels[this._aiBusy.labels.length - 1];
      const text = (top && top.label) || 'AI working…';
      if (lbl) lbl.textContent = text;
      el.title = text + (this._aiBusy.count > 1 ? `  (+${this._aiBusy.count - 1} more)` : '');
    }
  },

  // ── FOLDER STATUS ─────────────────────────────────────────────────────

  _updateFolderStatus() {
    const btn = document.getElementById('folder-status-btn');
    const lbl = document.getElementById('folder-status-label');
    if (!btn || !lbl) return;
    if (DB.isConnected) {
      btn.classList.add('connected');
      lbl.textContent = DB.folderName || 'Connected';
    } else {
      btn.classList.remove('connected');
      lbl.textContent = 'No folder';
    }
  },

  async handleFolderClick() {
    if (DB.isConnected) {
      if (confirm(`Disconnect folder "${DB.folderName}"?\n\nData will fall back to browser storage.`)) {
        await DB.disconnectFolder();
        this._updateFolderStatus();
        this.toast('Folder disconnected.');
      }
    } else {
      const connected = await DB.connectFolder();
      if (connected) {
        this._updateFolderStatus();
        this.renderSidebar();
        this.toast(`Connected to "${DB.folderName}".`);
        // Reload the current page to reflect new data
        location.reload();
      }
    }
  },

  // ── SEARCH ───────────────────────────────────────────────────────────

  _bindSearch() {
    const input = document.getElementById('header-search');
    if (!input) return;
    input.addEventListener('keydown', e => {
      if (e.key === 'Enter') {
        const q = input.value.trim();
        if (q) location.href = `search.html?q=${encodeURIComponent(q)}`;
      }
    });
    input.addEventListener('input', () => {
      const q = input.value.trim().toLowerCase();
      const res = document.getElementById('search-results');
      if (!q) { res.classList.remove('open'); return; }
      // Header search uses metadata only (fast, no file reads) — title + tags
      const matches = DB.articleMeta.filter(a =>
        (a.title || '').toLowerCase().includes(q) ||
        (a.tags || []).some(t => t.toLowerCase().includes(q))
      ).slice(0, 6);
      const fullSearchLink = `<a class="search-result-item search-result-full" href="search.html?q=${encodeURIComponent(input.value.trim())}" style="border-top:1px solid var(--border-light);color:var(--accent);font-size:12.5px;padding:8px 14px;">
        <span>🔍 Full search for <strong>${escHtml(input.value.trim())}</strong></span>
      </a>`;
      res.innerHTML = (matches.length
        ? matches.map(a => `
            <a class="search-result-item" href="article.html?id=${a.id}">
              <span class="search-result-title">${escHtml(a.title || 'Untitled')}</span>
              <span class="search-result-cat">${escHtml(DB.getCatPath(a.categoryId) || 'Uncategorized')}</span>
            </a>`).join('')
        : '<div class="search-result-item" style="color:var(--text-faint);">No articles found.</div>')
        + fullSearchLink;
      res.classList.add('open');
    });
    document.addEventListener('click', e => {
      const wrap = document.querySelector('.header-search-wrap');
      if (wrap && !wrap.contains(e.target)) {
        document.getElementById('search-results')?.classList.remove('open');
      }
    });
  },
};

// Shared escape helper available everywhere
function escHtml(s) {
  if (!s) return '';
  return String(s).replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/"/g,'&quot;').replace(/'/g,'&#039;');
}
