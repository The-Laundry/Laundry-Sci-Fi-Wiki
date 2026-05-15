// js/db.js
// Data layer with three backends:
//   1. File System Access API  — reads/writes real .json files in a chosen folder
//   2. localStorage fallback   — used when no folder is connected
//   3. Static fetch (read-only) — used on GitHub Pages; loads data/ files via fetch()
//
// Phase 2: lazy article loading
//   DB.articleMeta[]  — lightweight metadata, always loaded at init
//   DB.articleCache{} — full articles keyed by id, loaded on demand
//   DB.articles       — getter returning articleMeta (backward compat for metadata reads)
//   DB.loadArticle(id)— async, returns full article from cache or file

'use strict';

const DB = {
  // Lightweight metadata — always loaded at init
  articleMeta: [],
  // Full article cache — populated on demand by loadArticle()
  articleCache: {},

  categories: [],
  timelines: [],
  events: [],
  eras: [],
  timelineCategories: [],
  wikiboxTemplates: [],
  articleTemplates: [],
  languages: [],
  settings: { homeDesc: '', activeCalendar: 'hcc', importanceColors: {}, ai: null },

  // DB.articles is a backward-compat getter — returns articleMeta
  // All code reading title/categoryId/tags/summary still works unchanged
  get articles() { return this.articleMeta; },
  set articles(v) { this.articleMeta = v; }, // needed for _migrate and localStorage load

  _dirHandle: null,
  _articlesHandle: null,
  _languagesHandle: null,
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

    // ── Languages: lightweight index + per-language files ────────────
    // Try the lightweight index first; fall back to the static index file.
    const langIndexFull = await fetchJson(base + 'data/languages.json', null);
    const langIds = await fetchJson(base + 'data/languages/index.json', null);
    const idsToLoad = Array.isArray(langIds)
      ? langIds
      : (Array.isArray(langIndexFull) ? langIndexFull.map(l => l.id).filter(Boolean) : []);
    if (idsToLoad.length) {
      const langs = await Promise.all(
        idsToLoad.map(id => fetchJson(base + `data/languages/${id}.json`, null))
      );
      this.languages = langs.filter(Boolean);
    } else {
      this.languages = [];
    }

    // Load article metadata index — full articles fetched on demand
    const artIndex = await fetchJson(base + 'data/articles/index.json', null);
    if (artIndex && Array.isArray(artIndex)) {
      if (artIndex.length && typeof artIndex[0] === 'object') {
        // New format: metadata objects
        this.articleMeta = artIndex;
      } else if (artIndex.length && typeof artIndex[0] === 'string') {
        // Old format: IDs only — load all articles (static = read-only, acceptable once)
        const arts = await Promise.all(
          artIndex.map(id => fetchJson(base + `data/articles/${id}.json`, null))
        );
        this.articleMeta = arts.filter(Boolean).map(a => this._extractMeta(a));
        // Cache them too since we loaded them
        arts.filter(Boolean).forEach(a => { this.articleCache[a.id] = a; });
      } else {
        this.articleMeta = [];
      }
    } else {
      const bulk = await fetchJson(base + 'data/articles.json', null);
      this.articleMeta = (bulk || []).map(a => this._extractMeta(a));
      (bulk || []).forEach(a => { this.articleCache[a.id] = a; });
    }
    this.articleCache = this.articleCache || {};

    this.articleCache = this.articleCache || {};
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
    this._articlesHandle  = await this._dirHandle.getDirectoryHandle('articles',  { create: true });
    this._languagesHandle = await this._dirHandle.getDirectoryHandle('languages', { create: true });
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

    // Load article metadata index only — full articles loaded on demand
    const index = await this._readJson(this._articlesHandle, 'index.json', []);
    if (index.length && typeof index[0] === 'object') {
      // New format: [{id, title, categoryId, tags, summary, updated, hasImage}]
      this.articleMeta = index;
    } else if (index.length && typeof index[0] === 'string') {
      // Old format: [id, id, ...] — load all files to build metadata (one-time migration)
      this.articleMeta = await this._buildMetaFromFiles(index);
      // Immediately write new format so next load is fast
      await this._writeJson(this._articlesHandle, 'index.json', this.articleMeta);
    } else {
      this.articleMeta = [];
    }
    this.articleCache = {};

    // Load individual language files (skip the index.json sidecar if present)
    this.languages = [];
    try {
      for await (const entry of this._languagesHandle.values()) {
        if (entry.kind === 'file' && entry.name.endsWith('.json') && entry.name !== 'index.json') {
          const data = await this._readJson(this._languagesHandle, entry.name);
          if (data) this.languages.push(data);
        }
      }
    } catch (e) {}

    this._migrate();
  },

  async _buildMetaFromFiles(ids) {
    const metas = [];
    for (const id of ids) {
      if (!id || id === 'undefined') continue;
      const art = await this._readJson(this._articlesHandle, `${id}.json`, null);
      if (art) {
        metas.push(this._extractMeta(art));
        // Also cache the full article since we just loaded it
        this.articleCache[id] = art;
      }
    }
    return metas;
  },

  _loadFromLocalStorage() {
    try {
      const raw = localStorage.getItem('eomt_db');
      if (raw) {
        const parsed = JSON.parse(raw);
        Object.assign(this, parsed);
        // In localStorage mode all articles are in the blob
        // Populate both layers from the loaded articles array
        if (Array.isArray(parsed.articles)) {
          this.articleMeta  = parsed.articles.map(a => this._extractMeta(a));
          this.articleCache = {};
          parsed.articles.forEach(a => { this.articleCache[a.id] = a; });
        }
      }
    } catch (e) {}
    this.articleCache = this.articleCache || {};
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
    if (!this.languages)          this.languages = [];
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

  // ── ARTICLE METADATA ─────────────────────────────────────────────────

  // Extract lightweight metadata from a full article object
  _extractMeta(art) {
    return {
      id:         art.id,
      title:      art.title || '',
      categoryId: art.categoryId || null,
      tags:       art.tags || [],
      summary:    art.summary || '',
      updated:    art.updated || 0,
      hasImage:      !!(art.wikibox?.image),
      wikiboxImage:  art.wikibox?.image || null,
    };
  },

  // Load a full article — checks cache first, then reads from file
  async loadArticle(id) {
    if (!id) return null;
    if (this.articleCache[id]) return this.articleCache[id];
    if (this._mode === 'filesystem') {
      const art = await this._readJson(this._articlesHandle, `${id}.json`, null);
      if (art) this.articleCache[id] = art;
      return art;
    }
    if (this._mode === 'static') {
      const base = window.location.pathname.replace(/\/[^/]*$/, '') + '/';
      try {
        const res = await fetch(base + `data/articles/${id}.json`);
        if (res.ok) {
          const art = await res.json();
          this.articleCache[id] = art;
          return art;
        }
      } catch (e) {}
      return null;
    }
    // localStorage mode — full articles already in cache from init
    return this.articleCache[id] || null;
  },

  // ── SAVE ─────────────────────────────────────────────────────────────

  // ── SAVE — scoped methods (always prefer these over save()) ──────────

  async save(changedArticleId = null) {
    if (this._mode === 'static') return;
    if (this._mode === 'filesystem') {
      await this._saveToFilesystem(changedArticleId);
    } else {
      this._saveToLocalStorage();
    }
  },

  // Scoped saves — each writes only its own file(s)
  async saveSettings() {
    if (this._mode === 'static') return;
    if (this._mode === 'filesystem') await this._writeJson(this._dirHandle, 'settings.json', this.settings);
    else this._saveToLocalStorage();
  },
  async saveCategories() {
    if (this._mode === 'static') return;
    if (this._mode === 'filesystem') await this._writeJson(this._dirHandle, 'categories.json', this.categories);
    else this._saveToLocalStorage();
  },
  async saveTimelines() {
    if (this._mode === 'static') return;
    if (this._mode === 'filesystem') await this._writeJson(this._dirHandle, 'timelines.json', this.timelines);
    else this._saveToLocalStorage();
  },
  async saveEvents() {
    if (this._mode === 'static') return;
    if (this._mode === 'filesystem') await this._writeJson(this._dirHandle, 'events.json', this.events);
    else this._saveToLocalStorage();
  },
  async saveEras() {
    if (this._mode === 'static') return;
    if (this._mode === 'filesystem') await this._writeJson(this._dirHandle, 'eras.json', this.eras);
    else this._saveToLocalStorage();
  },
  async saveTimelineCategories() {
    if (this._mode === 'static') return;
    if (this._mode === 'filesystem') await this._writeJson(this._dirHandle, 'timeline-categories.json', this.timelineCategories);
    else this._saveToLocalStorage();
  },
  async saveWikiboxTemplates() {
    if (this._mode === 'static') return;
    if (this._mode === 'filesystem') await this._writeJson(this._dirHandle, 'wikibox-templates.json', this.wikiboxTemplates);
    else this._saveToLocalStorage();
  },
  async saveArticleTemplates() {
    if (this._mode === 'static') return;
    if (this._mode === 'filesystem') await this._writeJson(this._dirHandle, 'article-templates.json', this.articleTemplates);
    else this._saveToLocalStorage();
  },

  // ── LANGUAGE SAVE / DELETE ───────────────────────────────────────────
  // Lightweight index lives in data/languages.json (denormalized summary
  // for fast sidebar / picker rendering). Each full language record lives
  // in data/languages/lang_XXXX.json. data/languages/index.json mirrors
  // articles/index.json so static (GitHub Pages) mode can list IDs to fetch.

  _languageSummary(lang) {
    return {
      id: lang.id,
      name: lang.name || '',
      nativeName: lang.nativeName || '',
      status: lang.status || '',
      parentId: lang.parentId || null,
      articleId: lang.articleId || null,
      wordCount: Array.isArray(lang.lexicon) ? lang.lexicon.length : 0,
      updated: lang.updated || 0,
    };
  },

  async _writeLanguagesIndex() {
    if (this._mode !== 'filesystem') return;
    const summaries = this.languages.map(l => this._languageSummary(l));
    await this._writeJson(this._dirHandle,    'languages.json',         summaries);
    await this._writeJson(this._languagesHandle, 'index.json',          this.languages.map(l => l.id));
  },

  // Save a single language. Pass null to rewrite all languages.
  async saveLanguage(changedLanguageId = null) {
    if (this._mode === 'static') return;
    if (this._mode === 'filesystem') {
      if (changedLanguageId) {
        const lang = this.languages.find(l => l.id === changedLanguageId);
        if (lang) {
          lang.updated = Date.now();
          if (!lang.created) lang.created = lang.updated;
          await this._writeJson(this._languagesHandle, `${lang.id}.json`, lang);
        }
      } else {
        await Promise.all(this.languages.map(l =>
          this._writeJson(this._languagesHandle, `${l.id}.json`, l)
        ));
      }
      await this._writeLanguagesIndex();
    } else {
      // localStorage backend bundles everything together
      const lang = changedLanguageId ? this.languages.find(l => l.id === changedLanguageId) : null;
      if (lang) {
        lang.updated = Date.now();
        if (!lang.created) lang.created = lang.updated;
      }
      this._saveToLocalStorage();
    }
  },

  async deleteLanguageFile(id) {
    this.languages = this.languages.filter(l => l.id !== id);
    if (this._mode === 'filesystem') {
      await this._deleteFile(this._languagesHandle, `${id}.json`);
      await this._writeLanguagesIndex();
    } else if (this._mode === 'localStorage') {
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

    // Write article file(s) and keep cache + meta in sync
    if (changedArticleId) {
      const art = this.articleCache[changedArticleId];
      if (art) {
        await this._writeJson(this._articlesHandle, `${art.id}.json`, art);
        // Update metadata entry
        const idx = this.articleMeta.findIndex(m => m.id === changedArticleId);
        const meta = this._extractMeta(art);
        if (idx >= 0) this.articleMeta[idx] = meta;
        else this.articleMeta.push(meta);
      }
    } else {
      // Bulk save — write all cached articles
      await Promise.all(
        Object.values(this.articleCache).map(a =>
          this._writeJson(this._articlesHandle, `${a.id}.json`, a)
        )
      );
      // Rebuild meta from cache
      this.articleMeta = Object.values(this.articleCache).map(a => this._extractMeta(a));
    }

    // Write expanded metadata index (not just IDs)
    await this._writeJson(this._articlesHandle, 'index.json', this.articleMeta);

    // Write all language files (full save) and refresh the languages index
    await Promise.all(this.languages.map(l =>
      this._writeJson(this._languagesHandle, `${l.id}.json`, l)
    ));
    await this._writeLanguagesIndex();
  },

  // ── CATEGORY COLLAPSE STATE (localStorage only — never written to disk) ──

  // Open categories stored as {id: true}. Absent = collapsed (default).
  getCatCollapsed(id) {
    try {
      const s = localStorage.getItem('eomt_cat_open');
      const open = s ? JSON.parse(s) : {};
      return !open[id]; // collapsed = not open
    } catch (e) { return true; }
  },
  setCatCollapsed(id, collapsed) {
    try {
      const s = localStorage.getItem('eomt_cat_open');
      const open = s ? JSON.parse(s) : {};
      if (collapsed) delete open[id];
      else open[id] = true;
      localStorage.setItem('eomt_cat_open', JSON.stringify(open));
    } catch (e) {}
  },

  async deleteArticleFile(id) {
    // Remove from cache and meta immediately
    delete this.articleCache[id];
    this.articleMeta = this.articleMeta.filter(m => m.id !== id);
    if (this._mode === 'filesystem') {
      await this._deleteFile(this._articlesHandle, `${id}.json`);
      // Update index.json to reflect deletion
      await this._writeJson(this._articlesHandle, 'index.json', this.articleMeta);
    }
  },

  _saveToLocalStorage() {
    try {
      const snapshot = {
        // Store full articles from cache for localStorage mode
        articles: Object.values(this.articleCache),
        categories: this.categories,
        timelines: this.timelines, events: this.events, eras: this.eras,
        timelineCategories: this.timelineCategories,
        wikiboxTemplates: this.wikiboxTemplates,
        articleTemplates: this.articleTemplates,
        languages: this.languages,
        settings: this.settings,
      };
      localStorage.setItem('eomt_db', JSON.stringify(snapshot));
    } catch (e) {
      console.warn('localStorage save failed (quota?):', e);
    }
  },

  // ── EXPORT / IMPORT ──────────────────────────────────────────────────

  exportAll() {
    const safeSettings = JSON.parse(JSON.stringify(this.settings || {}));
    if (safeSettings.ai && 'apiKey' in safeSettings.ai) delete safeSettings.ai.apiKey;
    const data = {
      // Export full articles from cache
      articles: Object.values(this.articleCache),
      categories: this.categories,
      timelines: this.timelines, events: this.events, eras: this.eras,
      timelineCategories: this.timelineCategories,
      wikiboxTemplates: this.wikiboxTemplates,
      articleTemplates: this.articleTemplates,
      languages: this.languages,
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
    // Populate both layers from imported articles
    this.articleMeta  = data.articles.map(a => this._extractMeta(a));
    this.articleCache = {};
    data.articles.forEach(a => { this.articleCache[a.id] = a; });
    // Import everything else
    const { articles, ...rest } = data;
    Object.assign(this, rest);
    this._ensureDefaults();
    await this.save();
  },

  async clearAll() {
    this.articleMeta  = [];
    this.articleCache = {};
    this.categories = []; this.timelines = [];
    this.events = []; this.eras = []; this.timelineCategories = [];
    this.wikiboxTemplates = [];
    this.articleTemplates = [];
    this.languages = [];
    this.settings = { homeDesc: '', activeCalendar: 'hcc' };
    this._ensureDefaults();
    if (this._mode === 'filesystem') {
      try {
        for await (const entry of this._articlesHandle.values()) {
          if (entry.kind === 'file') await this._articlesHandle.removeEntry(entry.name);
        }
      } catch (e) {}
      // Delete all language files
      try {
        for await (const entry of this._languagesHandle.values()) {
          if (entry.kind === 'file') await this._languagesHandle.removeEntry(entry.name);
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
