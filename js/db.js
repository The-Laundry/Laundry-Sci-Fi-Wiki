// js/db.js
// Data layer with three backends:
//   1. File System Access API  — reads/writes real .json files in a chosen folder
//   2. localStorage fallback   — used when no folder is connected
//   3. Static fetch (read-only) — used on GitHub Pages; loads data/ files via fetch()

'use strict';

const DB = {
  // In-memory store (always authoritative during a session)
  articles: [],
  categories: [],
  timelines: [],
  events: [],
  eras: [],
  timelineCategories: [],
  wikiboxTemplates: [],
  articleTemplates: [],
  settings: { homeDesc: '', activeCalendar: 'hcc', importanceColors: {}, ai: null },

  // File system handles (null when using localStorage or static)
  _dirHandle: null,
  _articlesHandle: null,
  _mode: 'localStorage', // 'filesystem' | 'localStorage' | 'static'

  // ── READ-ONLY DETECTION ──────────────────────────────────────────────

  get isReadOnly() {
    const h = window.location.hostname;
    return h !== 'localhost' && h !== '127.0.0.1' && h !== '';
  },

  // ── INITIALISATION ──────────────────────────────────────────────────

  async init() {
    // GitHub Pages or any non-local host → static read-only mode
    if (this.isReadOnly) {
      await this._loadFromStatic();
      return;
    }

    // Try to restore a previously granted directory handle
    try {
      const stored = localStorage.getItem('eomt_dir_handle');
      if (stored) {
        const handle = await this._restoreHandle();
        if (handle) {
          const perm = await handle.queryPermission({ mode: 'readwrite' });
          if (perm === 'granted') {
            await this._connectHandle(handle, false);
            return;
          }
        }
      }
    } catch (e) { /* fall through */ }

    // Fallback: load from localStorage
    this._loadFromLocalStorage();
  },

  // ── STATIC FETCH BACKEND ─────────────────────────────────────────────

  async _loadFromStatic() {
    this._mode = 'static';

    const fetchJson = async (path, fallback) => {
      try {
        const res = await fetch(path);
        if (!res.ok) return fallback;
        return await res.json();
      } catch (e) { return fallback; }
    };

    // Determine base path (handles subdirectory deployments e.g. /repo-name/)
    const base = window.location.pathname.replace(/\/[^/]*$/, '') + '/';

    this.settings           = await fetchJson(base + 'data/settings.json',            { homeDesc: '', activeCalendar: 'hcc', importanceColors: {} });
    this.categories         = await fetchJson(base + 'data/categories.json',          []);
    this.timelines          = await fetchJson(base + 'data/timelines.json',           []);
    this.events             = await fetchJson(base + 'data/events.json',              []);
    this.eras               = await fetchJson(base + 'data/eras.json',                []);
    this.timelineCategories = await fetchJson(base + 'data/timeline-categories.json', []);
    this.wikiboxTemplates   = await fetchJson(base + 'data/wikibox-templates.json',   []);
    this.articleTemplates   = await fetchJson(base + 'data/article-templates.json',   []);

    // Load article index then individual article files
    // First try a manifest, then fall back to the bulk export format
    const artIndex = await fetchJson(base + 'data/articles/index.json', null);
    if (artIndex && Array.isArray(artIndex)) {
      // index.json lists all article IDs
      const arts = await Promise.all(
        artIndex.map(id => fetchJson(base + `data/articles/${id}.json`, null))
      );
      this.articles = arts.filter(Boolean);
    } else {
      // No index — try to load articles from the bulk backup if present
      const bulk = await fetchJson(base + 'data/articles.json', null);
      this.articles = bulk || [];
    }

    this._migrate();
  },

  // ── FOLDER CONNECTION ────────────────────────────────────────────────

  async connectFolder() {
    if (!('showDirectoryPicker' in window)) {
      alert('Your browser does not support the File System Access API.\nPlease use Chrome, Edge, or Arc.\n\nFalling back to localStorage.');
      return false;
    }
    try {
      const handle = await window.showDirectoryPicker({ mode: 'readwrite' });
      await this._connectHandle(handle, true);
      return true;
    } catch (e) {
      if (e.name !== 'AbortError') console.error('Folder connection failed:', e);
      return false;
    }
  },

  async _connectHandle(handle, save) {
    this._dirHandle = handle;
    this._mode = 'filesystem';
    if (save) await this._saveHandle(handle);
    await this._ensureSubfolders();
    await this._loadFromFilesystem();
    localStorage.setItem('eomt_dir_handle', '1'); // flag only
  },

  async disconnectFolder() {
    this._dirHandle = null;
    this._articlesHandle = null;
    this._mode = 'localStorage';
    localStorage.removeItem('eomt_dir_handle');
    await this._saveHandle(null);
    this._loadFromLocalStorage();
  },

  get isConnected() { return this._mode === 'filesystem'; },
  get isStatic()    { return this._mode === 'static'; },
  get folderName()  { return this._dirHandle?.name || null; },

  // ── HANDLE PERSISTENCE (IndexedDB) ──────────────────────────────────

  async _saveHandle(handle) {
    return new Promise((resolve, reject) => {
      const req = indexedDB.open('eomt_fs', 1);
      req.onupgradeneeded = e => e.target.result.createObjectStore('handles');
      req.onsuccess = e => {
        const db = e.target.result;
        const tx = db.transaction('handles', 'readwrite');
        if (handle) tx.objectStore('handles').put(handle, 'dir');
        else tx.objectStore('handles').delete('dir');
        tx.oncomplete = resolve;
        tx.onerror = reject;
      };
      req.onerror = reject;
    });
  },

  async _restoreHandle() {
    return new Promise((resolve, reject) => {
      const req = indexedDB.open('eomt_fs', 1);
      req.onupgradeneeded = e => e.target.result.createObjectStore('handles');
      req.onsuccess = e => {
        const db = e.target.result;
        const tx = db.transaction('handles', 'readonly');
        const get = tx.objectStore('handles').get('dir');
        get.onsuccess = () => resolve(get.result || null);
        get.onerror = () => resolve(null);
      };
      req.onerror = () => resolve(null);
    });
  },

  // ── FILESYSTEM HELPERS ───────────────────────────────────────────────

  async _ensureSubfolders() {
    this._articlesHandle = await this._dirHandle.getDirectoryHandle('articles', { create: true });
  },

  async _readJson(dirHandle, filename, fallback = null) {
    try {
      const fh = await dirHandle.getFileHandle(filename);
      const file = await fh.getFile();
      const text = await file.text();
      return JSON.parse(text);
    } catch (e) { return fallback; }
  },

  async _writeJson(dirHandle, filename, data) {
    const fh = await dirHandle.getFileHandle(filename, { create: true });
    const writable = await fh.createWritable();
    await writable.write(JSON.stringify(data, null, 2));
    await writable.close();
  },

  async _deleteFile(dirHandle, filename) {
    try { await dirHandle.removeEntry(filename); } catch (e) {}
  },

  // ── LOAD ─────────────────────────────────────────────────────────────

  async _loadFromFilesystem() {
    const dir = this._dirHandle;
    this.settings          = await this._readJson(dir, 'settings.json',            { homeDesc: '', activeCalendar: 'hcc', importanceColors: {} });
    this.categories        = await this._readJson(dir, 'categories.json',          []);
    this.timelines         = await this._readJson(dir, 'timelines.json',           []);
    this.events            = await this._readJson(dir, 'events.json',              []);
    this.eras              = await this._readJson(dir, 'eras.json',                []);
    this.timelineCategories= await this._readJson(dir, 'timeline-categories.json', []);
    this.wikiboxTemplates  = await this._readJson(dir, 'wikibox-templates.json',   []);
    this.articleTemplates  = await this._readJson(dir, 'article-templates.json',   []);

    // Load individual article files
    this.articles = [];
    try {
      for await (const entry of this._articlesHandle.values()) {
        if (entry.kind === 'file' && entry.name.endsWith('.json')) {
          const data = await this._readJson(this._articlesHandle, entry.name);
          if (data) this.articles.push(data);
        }
      }
    } catch (e) {}

    this._migrate();
  },

  _loadFromLocalStorage() {
    try {
      const raw = localStorage.getItem('eomt_db');
      if (raw) {
        const parsed = JSON.parse(raw);
        Object.assign(this, parsed);
      }
    } catch (e) {}
    this._ensureDefaults();
    this._migrate();
  },

  _ensureDefaults() {
    if (!this.settings) this.settings = { homeDesc: '', activeCalendar: 'hcc', importanceColors: {} };
    if (!this.settings.importanceColors) this.settings.importanceColors = {};
    if (!this.settings.activeCalendar) this.settings.activeCalendar = 'hcc';
    // AI block: never stores apiKey (that lives only in localStorage 'eomt_ai_key')
    if (!this.settings.ai || typeof this.settings.ai !== 'object') {
      this.settings.ai = {
        enabled: false,
        baseUrl: 'https://api.openai.com/v1',
        chatModel: 'gpt-4o-mini',
        embeddingModel: 'text-embedding-3-small',
        temperature: 0.7,
        maxTokens: 2000,
        autoRefreshOnSave: true,
        topK: 5,
      };
    } else {
      const ai = this.settings.ai;
      if (typeof ai.enabled !== 'boolean')            ai.enabled = false;
      if (typeof ai.baseUrl !== 'string')             ai.baseUrl = 'https://api.openai.com/v1';
      if (typeof ai.chatModel !== 'string')           ai.chatModel = 'gpt-4o-mini';
      if (typeof ai.embeddingModel !== 'string')      ai.embeddingModel = 'text-embedding-3-small';
      if (typeof ai.temperature !== 'number')         ai.temperature = 0.7;
      if (typeof ai.maxTokens !== 'number')           ai.maxTokens = 2000;
      if (typeof ai.autoRefreshOnSave !== 'boolean')  ai.autoRefreshOnSave = true;
      if (typeof ai.topK !== 'number')                ai.topK = 5;
      // Scrub any apiKey that may have been imported from an old export
      if ('apiKey' in ai) delete ai.apiKey;
    }
    if (!this.articles)           this.articles = [];
    if (!this.categories)         this.categories = [];
    if (!this.timelines)          this.timelines = [];
    if (!this.events)             this.events = [];
    if (!this.eras)               this.eras = [];
    if (!this.timelineCategories) this.timelineCategories = [];
    if (!this.wikiboxTemplates)   this.wikiboxTemplates = [];
    if (!this.articleTemplates)   this.articleTemplates = [];
  },

  _migrate() {
    this._ensureDefaults();
    // Old string categories → objects
    if (this.categories.length && typeof this.categories[0] === 'string') {
      this.categories = this.categories.map(n => ({ id: mkId('cat'), name: n, parentId: null, collapsed: false }));
    }
    // Old article.category string → categoryId
    this.articles.forEach(a => {
      if (a.category && !a.categoryId) {
        const found = this.categories.find(c => c.name === a.category);
        if (found) a.categoryId = found.id;
      }
    });
    // Old events: ensure timelineIds and importance
    this.events.forEach(e => {
      if (!e.timelineIds) e.timelineIds = [];
      if (!e.importance) e.importance = 'notable';
    });
    // AI-related article fields — optional, leave undefined unless present
    // (summary?: string, embedding?: number[], embeddingModel?: string)
  },

  // ── SAVE ─────────────────────────────────────────────────────────────

  async save(changedArticleId = null) {
    if (this._mode === 'static') return; // read-only on GitHub Pages
    if (this._mode === 'filesystem') {
      await this._saveToFilesystem(changedArticleId);
    } else {
      this._saveToLocalStorage();
    }
  },

  async _saveToFilesystem(changedArticleId) {
    const dir = this._dirHandle;
    // Always write shared files
    await Promise.all([
      this._writeJson(dir, 'settings.json',            this.settings),
      this._writeJson(dir, 'categories.json',          this.categories),
      this._writeJson(dir, 'timelines.json',            this.timelines),
      this._writeJson(dir, 'events.json',               this.events),
      this._writeJson(dir, 'eras.json',                 this.eras),
      this._writeJson(dir, 'timeline-categories.json',  this.timelineCategories),
      this._writeJson(dir, 'wikibox-templates.json',    this.wikiboxTemplates),
      this._writeJson(dir, 'article-templates.json',    this.articleTemplates),
    ]);

    // Write article file(s)
    if (changedArticleId) {
      const art = this.articles.find(a => a.id === changedArticleId);
      if (art) await this._writeJson(this._articlesHandle, `${art.id}.json`, art);
    } else {
      // Write all articles (bulk save)
      await Promise.all(this.articles.map(a =>
        this._writeJson(this._articlesHandle, `${a.id}.json`, a)
      ));
    }

    // Always keep index.json current so GitHub Pages can discover articles
    await this._writeJson(
      this._articlesHandle,
      'index.json',
      this.articles.map(a => a.id)
    );
  },

  async deleteArticleFile(id) {
    if (this._mode === 'filesystem') {
      await this._deleteFile(this._articlesHandle, `${id}.json`);
    }
  },

  _saveToLocalStorage() {
    try {
      const snapshot = {
        articles: this.articles, categories: this.categories,
        timelines: this.timelines, events: this.events, eras: this.eras,
        timelineCategories: this.timelineCategories,
        wikiboxTemplates: this.wikiboxTemplates,
        articleTemplates: this.articleTemplates,
        settings: this.settings,
      };
      localStorage.setItem('eomt_db', JSON.stringify(snapshot));
    } catch (e) {
      console.warn('localStorage save failed (quota?):', e);
    }
  },

  // ── EXPORT / IMPORT ──────────────────────────────────────────────────

  exportAll() {
    // Scrub apiKey from settings.ai before export (defensive; it shouldn't be there).
    const safeSettings = JSON.parse(JSON.stringify(this.settings || {}));
    if (safeSettings.ai && 'apiKey' in safeSettings.ai) delete safeSettings.ai.apiKey;
    const data = {
      articles: this.articles, categories: this.categories,
      timelines: this.timelines, events: this.events, eras: this.eras,
      timelineCategories: this.timelineCategories,
      wikiboxTemplates: this.wikiboxTemplates,
      articleTemplates: this.articleTemplates,
      settings: safeSettings,
    };
    const blob = new Blob([JSON.stringify(data, null, 2)], { type: 'application/json' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = 'eomt-backup-' + new Date().toISOString().split('T')[0] + '.json';
    a.click();
    URL.revokeObjectURL(url);
  },

  async importAll(jsonText) {
    const data = JSON.parse(jsonText);
    if (!data.articles || !Array.isArray(data.articles)) throw new Error('Invalid format');
    Object.assign(this, data);
    this._ensureDefaults();
    await this.save();
  },

  async clearAll() {
    this.articles = []; this.categories = []; this.timelines = [];
    this.events = []; this.eras = []; this.timelineCategories = [];
    this.wikiboxTemplates = [];
    this.articleTemplates = [];
    this.settings = { homeDesc: '', activeCalendar: 'hcc' };
    this._ensureDefaults();
    if (this._mode === 'filesystem') {
      // Delete all article files
      try {
        for await (const entry of this._articlesHandle.values()) {
          if (entry.kind === 'file') await this._articlesHandle.removeEntry(entry.name);
        }
      } catch (e) {}
    }
    await this.save();
  },

  // ── CATEGORY HELPERS ─────────────────────────────────────────────────

  getCatById(id)       { return this.categories.find(c => c.id === id) || null; },
  getCatName(id)       { const c = this.getCatById(id); return c ? c.name : 'Uncategorized'; },
  getRootCats()        { return this.categories.filter(c => !c.parentId); },
  getChildCats(pid)    { return this.categories.filter(c => c.parentId === pid); },
  getArticlesInCat(id) { return this.articles.filter(a => a.categoryId === id); },
  getUncategorized()   { return this.articles.filter(a => !a.categoryId); },

  countInSubtree(cid) {
    let n = this.getArticlesInCat(cid).length;
    this.getChildCats(cid).forEach(c => { n += this.countInSubtree(c.id); });
    return n;
  },

  getCatPath(cid) {
    const path = [];
    let c = this.getCatById(cid);
    while (c) { path.unshift(c.name); c = this.getCatById(c.parentId); }
    return path.join(' › ');
  },
};

// Shared ID generator
function mkId(prefix) {
  return prefix + '_' + Date.now() + '_' + Math.random().toString(36).slice(2, 6);
}
