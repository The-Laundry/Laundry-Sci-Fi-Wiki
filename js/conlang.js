// js/conlang.js
// Conlang feature helpers: language lookups, family-tree, lexicon search,
// inline {{Lang:word}} parser, CSV import/export, and backlink scanning.
//
// Depends on the global DB object (js/db.js) and uses escHtml() from ui.js.
// Expose everything on the global `Conlang` object — consistent with the
// project's no-modules style.

'use strict';

const Conlang = {

  // ── LOOKUPS ──────────────────────────────────────────────────────────

  /** Find a language by name or native-name (case-insensitive, trimmed). */
  findLanguage(name) {
    if (!name) return null;
    const needle = String(name).trim().toLowerCase();
    if (!needle) return null;
    return DB.languages.find(l => {
      const n  = (l.name        || '').trim().toLowerCase();
      const nn = (l.nativeName  || '').trim().toLowerCase();
      return n === needle || (nn && nn === needle);
    }) || null;
  },

  /** Find a language by id. */
  getLanguage(id) {
    return DB.languages.find(l => l.id === id) || null;
  },

  /** Find a lexicon entry by word OR romanization (case-insensitive). */
  findEntry(lang, word) {
    if (!lang || !word) return null;
    const needle = String(word).trim().toLowerCase();
    if (!needle) return null;
    return (lang.lexicon || []).find(e => {
      const w = (e.word         || '').trim().toLowerCase();
      const r = (e.romanization || '').trim().toLowerCase();
      return w === needle || (r && r === needle);
    }) || null;
  },

  // ── FAMILY TREE ──────────────────────────────────────────────────────

  /** Direct children (one level). */
  getDescendants(langId) {
    return DB.languages.filter(l => l.parentId === langId);
  },

  /** Walk the parent chain. Returns an ordered array [parent, grandparent, ...]. */
  getAncestors(langId) {
    const chain = [];
    const seen  = new Set();
    let cur = this.getLanguage(langId);
    while (cur && cur.parentId && !seen.has(cur.parentId)) {
      seen.add(cur.parentId);
      const parent = this.getLanguage(cur.parentId);
      if (!parent) break;
      chain.push(parent);
      cur = parent;
    }
    return chain;
  },

  // ── BACKLINKS ────────────────────────────────────────────────────────

  /**
   * Scan all articles for `{{LangName:...}}` references to this language,
   * plus any article whose id matches lang.articleId or is in
   * lang.speakerArticleIds. Returns an array of { article, occurrences }.
   */
  findBacklinks(lang) {
    if (!lang) return [];
    const names = [lang.name, lang.nativeName]
      .filter(Boolean)
      .map(s => s.trim().toLowerCase());
    if (!names.length) return [];

    const refRe = /\{\{([^:{}|]+):([^|{}]+?)(?:\|([^{}]+?))?\}\}/g;
    const out = [];

    DB.articles.forEach(art => {
      if (!art) return;
      const haystack = (art.content || '')
        + ' ' + (art.wikibox?.fields || []).map(f => f.val || '').join(' ');
      let occurrences = 0;
      refRe.lastIndex = 0;
      let m;
      while ((m = refRe.exec(haystack)) !== null) {
        const langName = (m[1] || '').trim().toLowerCase();
        if (names.includes(langName)) occurrences++;
      }
      const isPinnedArticle = lang.articleId && art.id === lang.articleId;
      const isSpeakerLink   = (lang.speakerArticleIds || []).includes(art.id);
      if (occurrences || isPinnedArticle || isSpeakerLink) {
        out.push({
          article: art,
          occurrences,
          pinned: !!isPinnedArticle,
          speaker: !!isSpeakerLink,
        });
      }
    });

    // Sort: pinned first, then most occurrences, then title
    out.sort((a, b) => {
      if (a.pinned !== b.pinned) return a.pinned ? -1 : 1;
      if (b.occurrences !== a.occurrences) return b.occurrences - a.occurrences;
      return (a.article.title || '').localeCompare(b.article.title || '');
    });
    return out;
  },

  // ── INLINE PARSER ────────────────────────────────────────────────────
  //
  // Syntax:
  //   {{LangName:word}}              → tooltip-bearing span; display = word
  //   {{LangName:word|display text}} → display override; tooltip still resolves to word
  //
  // Misses (unknown language or unknown word) still render as a styled
  // span with a red dotted underline so the author sees what's broken.

  REF_REGEX: /\{\{([^:{}|<>]+):([^|{}<>]+?)(?:\|([^{}<>]+?))?\}\}/g,

  /**
   * Apply the parser to a raw HTML string. Only matches outside HTML tags;
   * we split on `<...>` boundaries to keep attribute values safe.
   */
  parseHtml(html) {
    if (!html || typeof html !== 'string') return html || '';
    if (html.indexOf('{{') === -1) return html;

    // Split into alternating "text" and "tag" segments, only transform the text.
    const parts = html.split(/(<[^>]*>)/g);
    for (let i = 0; i < parts.length; i++) {
      // Even indices are text outside tags (because the regex captured the tag).
      if (i % 2 === 0 && parts[i].indexOf('{{') !== -1) {
        parts[i] = this._transformText(parts[i]);
      }
    }
    return parts.join('');
  },

  /**
   * Walk an Element's text nodes and replace conlang refs in place.
   * Safer than string-replace on innerHTML for already-rendered DOM.
   */
  applyToElement(root) {
    if (!root) return;
    const walker = document.createTreeWalker(root, NodeFilter.SHOW_TEXT, {
      acceptNode(node) {
        if (!node.nodeValue || node.nodeValue.indexOf('{{') === -1) {
          return NodeFilter.FILTER_SKIP;
        }
        // Skip text inside scripts/styles
        const p = node.parentElement;
        if (p) {
          const tag = p.tagName;
          if (tag === 'SCRIPT' || tag === 'STYLE' || tag === 'CODE' || tag === 'PRE') {
            return NodeFilter.FILTER_SKIP;
          }
        }
        return NodeFilter.FILTER_ACCEPT;
      }
    });
    const targets = [];
    let n;
    while ((n = walker.nextNode())) targets.push(n);
    targets.forEach(node => {
      const html = Conlang._transformText(node.nodeValue);
      if (html === node.nodeValue) return;
      const tmp = document.createElement('span');
      tmp.innerHTML = html;
      const frag = document.createDocumentFragment();
      while (tmp.firstChild) frag.appendChild(tmp.firstChild);
      node.parentNode.replaceChild(frag, node);
    });
  },

  /** Internal: transform plain text by replacing matches with spans. */
  _transformText(text) {
    this.REF_REGEX.lastIndex = 0;
    return text.replace(this.REF_REGEX, (full, langName, word, display) => {
      const lang = Conlang.findLanguage(langName);
      const cleanWord    = (word || '').trim();
      const cleanDisplay = (display || cleanWord).trim();
      const langSlug     = (langName || '').trim();

      if (!lang) {
        return `<span class="conlang-ref conlang-miss"
          data-conlang-lang="${esc(langSlug)}"
          data-conlang-word="${esc(cleanWord)}"
          title="Unknown language: ${esc(langSlug)}">${esc(cleanDisplay)}</span>`;
      }

      const entry = Conlang.findEntry(lang, cleanWord);
      const href  = `languages.html?id=${encodeURIComponent(lang.id)}`
                  + (entry ? `&word=${encodeURIComponent(entry.id)}` : '');

      if (!entry) {
        const tip = `${cleanWord} — not yet defined in ${lang.name}`;
        return `<a class="conlang-ref conlang-miss"
          href="${esc(href)}"
          data-conlang-lang="${esc(lang.id)}"
          data-conlang-word="${esc(cleanWord)}"
          title="${esc(tip)}">${esc(cleanDisplay)}</a>`;
      }

      const ipa  = entry.ipa ? `/${entry.ipa}/` : '';
      const pos  = entry.partOfSpeech ? ` (${entry.partOfSpeech})` : '';
      const defs = (entry.definitions && entry.definitions.length)
        ? entry.definitions.join('; ') : 'no definition';
      const tipText = `${entry.word}${ipa ? ' ' + ipa : ''}${pos}\n${defs}\n— ${lang.name}`;
      const tipHtml = buildTooltipHtml(lang, entry);

      return `<a class="conlang-ref"
        href="${esc(href)}"
        data-conlang-lang="${esc(lang.id)}"
        data-conlang-word="${esc(entry.id)}"
        title="${esc(tipText)}"
        data-conlang-tip="${esc(tipHtml)}">${esc(cleanDisplay)}</a>`;
    });

    function esc(s) {
      return String(s == null ? '' : s)
        .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
        .replace(/"/g, '&quot;').replace(/'/g, '&#39;');
    }

    function buildTooltipHtml(lang, entry) {
      const ipa  = entry.ipa ? `<span class="ct-ipa">/${esc(entry.ipa)}/</span>` : '';
      const pos  = entry.partOfSpeech ? `<span class="ct-pos">${esc(entry.partOfSpeech)}</span>` : '';
      const defs = (entry.definitions && entry.definitions.length)
        ? `<ul class="ct-defs">${entry.definitions.map(d => `<li>${esc(d)}</li>`).join('')}</ul>`
        : '<div class="ct-defs-none">no definition</div>';
      return `<div class="ct-head"><strong>${esc(entry.word)}</strong> ${ipa} ${pos}</div>${defs}<div class="ct-foot">${esc(lang.name)}</div>`;
    }
  },

  // ── CSV IMPORT / EXPORT ──────────────────────────────────────────────
  // Columns: word,romanization,ipa,partOfSpeech,definitions,etymology,tags,notes
  // Definitions and tags are pipe-separated within their cell.

  CSV_COLS: ['word', 'romanization', 'ipa', 'partOfSpeech', 'definitions', 'etymology', 'tags', 'notes'],

  lexiconToCsv(lexicon) {
    const head = this.CSV_COLS.join(',');
    const rows = (lexicon || []).map(e => this.CSV_COLS.map(col => {
      let v = e[col];
      if (col === 'definitions' || col === 'tags') {
        v = Array.isArray(v) ? v.join('|') : (v || '');
      }
      return csvCell(v == null ? '' : String(v));
    }).join(','));
    return [head, ...rows].join('\n');

    function csvCell(s) {
      if (s.indexOf('"') !== -1 || s.indexOf(',') !== -1 || s.indexOf('\n') !== -1) {
        return '"' + s.replace(/"/g, '""') + '"';
      }
      return s;
    }
  },

  /**
   * Parse CSV text and return an array of partial lexicon entries (no ids).
   * The caller is responsible for assigning ids and merging into a lexicon.
   */
  csvToLexicon(text) {
    const rows = parseCsvRows(text);
    if (!rows.length) return [];
    const head = rows[0].map(c => c.trim().toLowerCase());
    const colIdx = (name) => head.indexOf(name.toLowerCase());
    const entries = [];
    for (let i = 1; i < rows.length; i++) {
      const r = rows[i];
      if (!r || r.every(c => !c.trim())) continue;
      const get = (name) => {
        const idx = colIdx(name);
        return idx >= 0 ? (r[idx] || '') : '';
      };
      entries.push({
        word: get('word').trim(),
        romanization: get('romanization').trim(),
        ipa: get('ipa').trim(),
        partOfSpeech: get('partOfSpeech').trim() || get('part of speech').trim(),
        definitions: splitMulti(get('definitions')),
        etymology: get('etymology').trim(),
        tags: splitMulti(get('tags')),
        notes: get('notes').trim(),
        examples: [],
      });
    }
    return entries.filter(e => e.word);

    function splitMulti(s) {
      return String(s || '').split('|').map(t => t.trim()).filter(Boolean);
    }

    function parseCsvRows(text) {
      const rows = [];
      let row = [];
      let cell = '';
      let inQ = false;
      for (let i = 0; i < text.length; i++) {
        const c = text[i];
        if (inQ) {
          if (c === '"') {
            if (text[i + 1] === '"') { cell += '"'; i++; }
            else inQ = false;
          } else cell += c;
        } else {
          if (c === '"') inQ = true;
          else if (c === ',') { row.push(cell); cell = ''; }
          else if (c === '\n') { row.push(cell); rows.push(row); row = []; cell = ''; }
          else if (c === '\r') { /* skip */ }
          else cell += c;
        }
      }
      if (cell.length || row.length) { row.push(cell); rows.push(row); }
      return rows;
    }
  },

  // ── MISC ─────────────────────────────────────────────────────────────

  /** Suggest a clean display label for a language (name + native, if different). */
  displayName(lang) {
    if (!lang) return '';
    if (lang.nativeName && lang.nativeName !== lang.name) {
      return `${lang.name} (${lang.nativeName})`;
    }
    return lang.name || '(unnamed)';
  },

  /** Default-shape for a brand-new language. */
  newLanguageRecord(name = 'New Language') {
    const now = Date.now();
    return {
      id: mkId('lang'),
      name,
      nativeName: '',
      romanization: '',
      status: 'constructed',
      parentId: null,
      articleId: null,
      speakerArticleIds: [],
      description: '',
      writingSystem: { name: '', notes: '', sampleImage: '' },
      phonology: { consonants: [], vowels: [], notes: '' },
      grammar: '',
      lexicon: [],
      sampleTexts: [],
      created: now,
      updated: now,
    };
  },
};

// Expose globally — consistent with DB / UI / AI patterns.
window.Conlang = Conlang;
