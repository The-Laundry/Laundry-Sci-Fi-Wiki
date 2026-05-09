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

  // ── AI CONTEXT BLOCKS ────────────────────────────────────────────────
  //
  // Compact text-only renderings of a language's data, suitable for
  // inclusion in AI prompts. Used by `js/ai.js` when assembling prompts
  // for the conlang tools, and by ai-generate.html to keep the language
  // base block consistent across all three tools.

  /** Strip HTML to plain text via a throwaway DOM node. */
  _stripHtml(html) {
    if (!html) return '';
    const tmp = document.createElement('div');
    tmp.innerHTML = String(html);
    return (tmp.textContent || '').replace(/\s+/g, ' ').trim();
  },

  /**
   * Compact context block describing a language: phonology, grammar,
   * romanization, status, parent. Used by every conlang AI prompt.
   */
  buildContextBlock(lang) {
    if (!lang) return '';
    const lines = [];
    const native = lang.nativeName && lang.nativeName !== lang.name
      ? ' (' + lang.nativeName + ')' : '';
    lines.push(`Language: ${lang.name || 'Unnamed'}${native}`);
    if (lang.status) lines.push(`Status: ${lang.status}`);
    if (lang.parentId) {
      const parent = this.getLanguage(lang.parentId);
      if (parent) lines.push(`Parent language: ${parent.name}`);
    }
    if (lang.romanization) lines.push(`Romanization: ${lang.romanization}`);
    const cons = (lang.phonology?.consonants || []).map(c => c.ipa).filter(Boolean);
    const vows = (lang.phonology?.vowels     || []).map(v => v.ipa).filter(Boolean);
    if (cons.length) lines.push(`Consonants (IPA): ${cons.join(' ')}`);
    if (vows.length) lines.push(`Vowels (IPA): ${vows.join(' ')}`);
    if (lang.phonology?.notes) lines.push(`Phonotactics: ${lang.phonology.notes}`);
    if (lang.grammar) {
      const txt = this._stripHtml(lang.grammar).slice(0, 1500);
      if (txt) lines.push(`Grammar notes:\n${txt}`);
    }
    return lines.join('\n');
  },

  /** A short readable lexicon listing for AI prompts. */
  buildLexiconSummary(lang, max = 80) {
    if (!lang) return '(empty lexicon)';
    const lex = (lang.lexicon || []).slice(0, max);
    if (!lex.length) return '(empty lexicon)';
    return lex.map(e => {
      const defs = (e.definitions || []).join('; ');
      const rom  = e.romanization && e.romanization !== e.word
        ? ' [' + e.romanization + ']' : '';
      const pos  = e.partOfSpeech ? ' (' + e.partOfSpeech + ')' : '';
      return `${e.word}${rom}${pos}: ${defs}`;
    }).join('\n');
  },

  // ── FAMILY-TREE NEIGHBOURS ───────────────────────────────────────────

  /** Sibling languages — share the same parentId, exclude self. */
  getSiblings(langId) {
    const me = this.getLanguage(langId);
    if (!me || !me.parentId) return [];
    return DB.languages.filter(l => l.parentId === me.parentId && l.id !== langId);
  },

  /** All languages immediately or transitively descended from langId. */
  getAllDescendants(langId, maxDepth = 6) {
    const out = [];
    const queue = [{ id: langId, depth: 0 }];
    const seen = new Set([langId]);
    while (queue.length) {
      const { id, depth } = queue.shift();
      if (depth >= maxDepth) continue;
      const kids = this.getDescendants(id);
      for (const k of kids) {
        if (seen.has(k.id)) continue;
        seen.add(k.id);
        out.push(k);
        queue.push({ id: k.id, depth: depth + 1 });
      }
    }
    return out;
  },

  /**
   * Internal: build a flat list of related languages with consistent shape.
   * Returns [{ id, name, relation: 'parent'|'ancestor'|'sibling'|'descendant', sampleSize }]
   */
  _buildRelatedLanguages(lang, { siblings = true, descendants = true } = {}) {
    const out = [];
    const ancestors = this.getAncestors(lang.id);
    if (ancestors.length) {
      const a = ancestors[0];
      out.push({
        id: a.id,
        name: a.name || 'Unnamed',
        relation: 'parent',
        sampleSize: (a.lexicon || []).length,
      });
      if (ancestors.length > 1) {
        const root = ancestors[ancestors.length - 1];
        if (root.id !== a.id) {
          out.push({
            id: root.id,
            name: root.name || 'Unnamed',
            relation: 'ancestor',
            sampleSize: (root.lexicon || []).length,
          });
        }
      }
    }
    if (siblings) {
      this.getSiblings(lang.id).slice(0, 4).forEach(s => out.push({
        id: s.id, name: s.name || 'Unnamed', relation: 'sibling',
        sampleSize: (s.lexicon || []).length,
      }));
    }
    if (descendants) {
      this.getDescendants(lang.id).slice(0, 4).forEach(d => out.push({
        id: d.id, name: d.name || 'Unnamed', relation: 'descendant',
        sampleSize: (d.lexicon || []).length,
      }));
    }
    return out;
  },

  // ── AI CONTEXT GATHERERS ─────────────────────────────────────────────
  //
  // Each returns a structured object suitable for both prompt assembly
  // (in js/ai.js) and on-page chip rendering (in ai-generate.html). They
  // all delegate wiki-article retrieval to AI.gatherContext() so the
  // semantic-search pipeline stays the same as for article generation.

  /**
   * spec: { langId, semanticField, notes?, relatedIds?, topK? }
   * → { language, articles:{explicit,semantic,query}, relatedLanguages,
   *     sampleTexts, lexiconStats }
   */
  async gatherVocabContext(spec) {
    const lang = this.getLanguage(spec.langId);
    if (!lang) throw new Error('Language not found: ' + spec.langId);

    const query = [spec.semanticField, spec.notes].filter(Boolean).join('\n').trim();
    const topK  = typeof spec.topK === 'number' ? spec.topK
                 : (window.AI && typeof AI.getConfig === 'function' ? AI.getConfig().topK : 5);

    let articles = { explicit: [], semantic: [], query };
    try {
      if (window.AI && typeof AI.gatherContext === 'function') {
        articles = await AI.gatherContext({
          title:      spec.semanticField || '',
          guidance:   spec.notes || '',
          relatedIds: spec.relatedIds || [],
          topK,
        });
      }
    } catch (e) {
      console.warn('Conlang.gatherVocabContext: AI.gatherContext failed', e);
    }

    const relatedLanguages = this._buildRelatedLanguages(lang, {
      siblings: true, descendants: true,
    });

    const sampleTexts = (lang.sampleTexts || []).slice(0, 3).map(t => ({
      title:       t.title || 'Untitled',
      text:        t.text  || '',
      translation: t.translation || '',
    }));

    const lex = lang.lexicon || [];
    const byPos = {};
    const tagCount = {};
    lex.forEach(e => {
      const pos = (e.partOfSpeech || '').trim().toLowerCase();
      if (pos) byPos[pos] = (byPos[pos] || 0) + 1;
      (e.tags || []).forEach(t => {
        const tt = String(t).trim().toLowerCase();
        if (tt) tagCount[tt] = (tagCount[tt] || 0) + 1;
      });
    });
    const topTags = Object.entries(tagCount)
      .sort((a, b) => b[1] - a[1])
      .slice(0, 8)
      .map(([t]) => t);

    return {
      language: lang,
      articles,
      relatedLanguages,
      sampleTexts,
      lexiconStats: { totalWords: lex.length, byPos, topTags },
    };
  },

  /**
   * spec: { langId, direction: 'en-to-lang'|'lang-to-en', sentence,
   *         relatedIds?, topK? }
   * → { language, articles, relatedLanguages, sampleTexts,
   *     ancestorChain: string[], lexicalPreMatches: entry[] }
   */
  async gatherTranslationContext(spec) {
    const lang = this.getLanguage(spec.langId);
    if (!lang) throw new Error('Language not found: ' + spec.langId);

    const query = (spec.sentence || '').trim();
    const topK  = typeof spec.topK === 'number' ? spec.topK
                 : (window.AI && typeof AI.getConfig === 'function' ? AI.getConfig().topK : 5);

    let articles = { explicit: [], semantic: [], query };
    try {
      if (window.AI && typeof AI.gatherContext === 'function') {
        articles = await AI.gatherContext({
          title:      query,
          guidance:   '',
          relatedIds: spec.relatedIds || [],
          topK:       query ? topK : 0,
        });
      }
    } catch (e) {
      console.warn('Conlang.gatherTranslationContext: AI.gatherContext failed', e);
    }

    const relatedLanguages = this._buildRelatedLanguages(lang, {
      siblings: true, descendants: false,
    });

    const sampleTexts = (lang.sampleTexts || []).slice(0, 5).map(t => ({
      title:       t.title || 'Untitled',
      text:        t.text  || '',
      translation: t.translation || '',
      gloss:       t.gloss || '',
    }));

    const ancestorChain = this.getAncestors(spec.langId)
      .map(a => a.name)
      .filter(Boolean);

    // Lexical pre-match: tokenize the sentence and match against
    // lexicon entries by word, romanization, and (for en-to-lang) by
    // overlap with English definitions.
    const tokens = String(spec.sentence || '')
      .toLowerCase()
      .split(/[^\p{L}\p{N}'\-]+/u)
      .map(t => t.trim())
      .filter(t => t.length > 1);
    const tokenSet = new Set(tokens);
    const lexicalPreMatches = [];
    const seenIds = new Set();
    (lang.lexicon || []).forEach(e => {
      if (seenIds.has(e.id)) return;
      const w = (e.word || '').trim().toLowerCase();
      const r = (e.romanization || '').trim().toLowerCase();
      let hit = false;
      if (w && tokenSet.has(w)) hit = true;
      else if (r && tokenSet.has(r)) hit = true;
      else if (spec.direction === 'en-to-lang') {
        for (const def of (e.definitions || [])) {
          const dt = String(def).toLowerCase().split(/[^\p{L}\p{N}'\-]+/u);
          if (dt.some(d => d && tokenSet.has(d))) { hit = true; break; }
        }
      }
      if (hit) {
        seenIds.add(e.id);
        lexicalPreMatches.push({
          id: e.id,
          word: e.word || '',
          romanization: e.romanization || '',
          ipa: e.ipa || '',
          partOfSpeech: e.partOfSpeech || '',
          definitions: Array.isArray(e.definitions) ? e.definitions.slice() : [],
        });
      }
    });
    if (lexicalPreMatches.length > 30) lexicalPreMatches.length = 30;

    return {
      language: lang,
      articles,
      relatedLanguages,
      sampleTexts,
      ancestorChain,
      lexicalPreMatches,
    };
  },

  /**
   * spec: { langId, wordId, relatedIds?, topK? }
   * → { language, entry, articles,
   *     ancestorChain: [{id,name,sampleLexicon}],
   *     siblingCognates: [{langId,langName,entries:[{word,definitions,etymology}]}],
   *     sampleTexts, peerEtymologies: string[] }
   */
  async gatherEtymologyContext(spec) {
    const lang = this.getLanguage(spec.langId);
    if (!lang) throw new Error('Language not found: ' + spec.langId);
    const entry = (lang.lexicon || []).find(e => e.id === spec.wordId);
    if (!entry) throw new Error('Lexicon entry not found: ' + spec.wordId);

    const defsList = Array.isArray(entry.definitions) ? entry.definitions : [];
    const topK = typeof spec.topK === 'number' ? spec.topK
                : (window.AI && typeof AI.getConfig === 'function' ? AI.getConfig().topK : 4);

    let articles = { explicit: [], semantic: [], query: '' };
    try {
      if (window.AI && typeof AI.gatherContext === 'function') {
        articles = await AI.gatherContext({
          title:      entry.word || '',
          guidance:   defsList.join(', '),
          relatedIds: spec.relatedIds || [],
          topK,
        });
      }
    } catch (e) {
      console.warn('Conlang.gatherEtymologyContext: AI.gatherContext failed', e);
    }

    // Full ancestor chain with sample lexicons.
    const ancestorChain = this.getAncestors(spec.langId).map(a => ({
      id: a.id,
      name: a.name || 'Unnamed',
      sampleLexicon: this.buildLexiconSummary(a, 30),
    }));

    // Sibling cognates: same parentId, share definition tokens.
    const defTokens = new Set();
    defsList.forEach(d => {
      String(d).toLowerCase().split(/[^\p{L}\p{N}'\-]+/u).forEach(tok => {
        if (tok && tok.length > 2) defTokens.add(tok);
      });
    });
    const siblings = this.getSiblings(spec.langId).slice(0, 5);
    const siblingCognates = siblings.map(sib => {
      const matches = [];
      (sib.lexicon || []).forEach(e => {
        const eDefs = Array.isArray(e.definitions) ? e.definitions : [];
        let overlap = false;
        for (const d of eDefs) {
          const dt = String(d).toLowerCase().split(/[^\p{L}\p{N}'\-]+/u);
          if (dt.some(t => t && defTokens.has(t))) { overlap = true; break; }
        }
        if (overlap) {
          matches.push({
            word: e.word || '',
            definitions: eDefs.slice(),
            etymology: e.etymology || '',
          });
        }
      });
      return {
        langId: sib.id,
        langName: sib.name || '',
        entries: matches.slice(0, 5),
      };
    }).filter(s => s.entries.length);

    const sampleTexts = (lang.sampleTexts || []).slice(0, 2).map(t => ({
      title:       t.title || 'Untitled',
      text:        t.text  || '',
      translation: t.translation || '',
    }));

    const peerEtymologies = (lang.lexicon || [])
      .filter(e => e.id !== entry.id
                && typeof e.etymology === 'string'
                && e.etymology.trim())
      .slice(0, 5)
      .map(e => `${e.word}: ${e.etymology.trim()}`);

    return {
      language: lang,
      entry,
      articles,
      ancestorChain,
      siblingCognates,
      sampleTexts,
      peerEtymologies,
    };
  },
};

// Expose globally — consistent with DB / UI / AI patterns.
window.Conlang = Conlang;
