// js/db.js
// Data layer with two backends:
//   1. File System Access API  — reads/writes real .json files in a chosen folder
//   2. localStorage fallback   — used on GitHub Pages or when no folder is connected

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
  settings: { homeDesc: '', activeCalendar: 'hcc', importanceColors: {} },

  // File system handles (null when using localStorage)
  _dirHandle: null,
  _articlesHandle: null,
  _mode: 'localStorage', // 'filesystem' | 'localStorage'

  // ── INITIALISATION ──────────────────────────────────────────────────

  async init() {
    // Try to restore a previously granted directory handle
    try {
      const stored = localStorage.getItem('eomt_dir_handle');
      if (stored) {
        // IndexedDB stores the handle; we use localStorage as a flag only
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
    if (!this.articles)           this.articles = [];
    if (!this.categories)         this.categories = [];
    if (!this.timelines)          this.timelines = [];
    if (!this.events)             this.events = [];
    if (!this.eras)               this.eras = [];
    if (!this.timelineCategories) this.timelineCategories = [];
    if (!this.wikiboxTemplates)   this.wikiboxTemplates = [];
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
  },

  // ── SAVE ─────────────────────────────────────────────────────────────

  async save(changedArticleId = null) {
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
        wikiboxTemplates: this.wikiboxTemplates, settings: this.settings,
      };
      localStorage.setItem('eomt_db', JSON.stringify(snapshot));
    } catch (e) {
      console.warn('localStorage save failed (quota?):', e);
    }
  },

  // ── EXPORT / IMPORT ──────────────────────────────────────────────────

  exportAll() {
    const data = {
      articles: this.articles, categories: this.categories,
      timelines: this.timelines, events: this.events, eras: this.eras,
      timelineCategories: this.timelineCategories,
      wikiboxTemplates: this.wikiboxTemplates, settings: this.settings,
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
    this.settings = { homeDesc: '', activeCalendar: 'hcc' };
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
