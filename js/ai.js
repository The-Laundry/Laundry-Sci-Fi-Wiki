// js/ai.js
// OpenAI-compatible AI helper used by the "Infinite Wiki" feature.
//
// Public surface:
//   AI.isConfigured()           — chat is ready to call
//   AI.isEmbeddingConfigured()  — embedding endpoint is ready to call
//   AI.getConfig()              — returns { ...settings.ai, apiKey }
//   AI.saveConfig(partial)      — patches settings.ai and persists, handles apiKey
//   AI.getApiKey() / setApiKey(v) / clearApiKey()
//   AI.chat(messages, opts)     — POST /chat/completions, returns the message content
//   AI.embed(texts)             — POST /embeddings, returns number[][]
//   AI.cosine(a, b)             — cosine similarity on two number[] vectors
//   AI.testConnection()         — cheap chat ping, returns {ok, error?}
//   AI.generateSummary(article) — returns a short summary string
//   AI.generateEmbedding(article) — returns { vector, model }
//   AI.reindexAll(progressCb)   — rebuild summaries+embeddings for every article
//   AI.gatherContext(spec)      — { relatedArticles, semanticMatches } for prompt
//   AI.generateArticle(spec)    — returns a normalized article draft object
//
// The API key is stored ONLY in localStorage under 'eomt_ai_key' and is never
// written to settings.json or exported. DB.exportAll() scrubs settings.ai.apiKey
// defensively in case an older file ever had one.

'use strict';

const AI = {

  // ── CONFIG ──────────────────────────────────────────────────────────

  _KEY_STORAGE: 'eomt_ai_key',

  getApiKey() {
    try { return localStorage.getItem(this._KEY_STORAGE) || ''; } catch (e) { return ''; }
  },

  setApiKey(v) {
    try {
      if (v) localStorage.setItem(this._KEY_STORAGE, String(v));
      else   localStorage.removeItem(this._KEY_STORAGE);
    } catch (e) { console.warn('AI.setApiKey failed:', e); }
  },

  clearApiKey() { this.setApiKey(''); },

  getConfig() {
    const ai = (DB.settings && DB.settings.ai) || {};
    return {
      enabled:           !!ai.enabled,
      baseUrl:           ai.baseUrl           || 'https://api.openai.com/v1',
      chatModel:         ai.chatModel         || 'gpt-4o-mini',
      embeddingModel:    ai.embeddingModel    || 'text-embedding-3-small',
      temperature:       typeof ai.temperature === 'number' ? ai.temperature : 0.7,
      maxTokens:         typeof ai.maxTokens  === 'number' ? ai.maxTokens  : 2000,
      autoRefreshOnSave: ai.autoRefreshOnSave !== false,
      topK:              typeof ai.topK       === 'number' ? ai.topK       : 5,
      apiKey:            this.getApiKey(),
    };
  },

  async saveConfig(partial) {
    if (!DB.settings.ai) DB.settings.ai = {};
    const allowed = ['enabled','baseUrl','chatModel','embeddingModel','temperature','maxTokens','autoRefreshOnSave','topK'];
    allowed.forEach(k => { if (k in partial) DB.settings.ai[k] = partial[k]; });
    // Defensive: never persist apiKey to disk.
    if ('apiKey' in DB.settings.ai) delete DB.settings.ai.apiKey;
    await DB.save();
  },

  isConfigured() {
    const c = this.getConfig();
    return !!(c.enabled && c.baseUrl && c.chatModel && c.apiKey);
  },

  isEmbeddingConfigured() {
    const c = this.getConfig();
    return !!(c.enabled && c.baseUrl && c.embeddingModel && c.apiKey);
  },

  // ── LOW-LEVEL HTTP ──────────────────────────────────────────────────

  _joinUrl(base, path) {
    return String(base || '').replace(/\/+$/, '') + path;
  },

  async _postJson(path, body, { signal, timeoutMs = 120000 } = {}) {
    const c = this.getConfig();
    if (!c.baseUrl) throw new Error('AI base URL is not configured.');
    if (!c.apiKey)  throw new Error('AI API key is not set.');
    const url = this._joinUrl(c.baseUrl, path);
    const ctrl = new AbortController();
    const t = setTimeout(() => ctrl.abort(), timeoutMs);
    try {
      const res = await fetch(url, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': 'Bearer ' + c.apiKey,
        },
        body: JSON.stringify(body),
        signal: signal || ctrl.signal,
      });
      clearTimeout(t);
      if (!res.ok) {
        let detail = '';
        try { detail = await res.text(); } catch (e) {}
        throw new Error(`HTTP ${res.status} ${res.statusText}${detail ? ': ' + detail.slice(0, 400) : ''}`);
      }
      return await res.json();
    } finally {
      clearTimeout(t);
    }
  },

  // ── CHAT ────────────────────────────────────────────────────────────

  // opts: { model, temperature, maxTokens, jsonMode, stop }
  async chat(messages, opts = {}) {
    const c = this.getConfig();
    const body = {
      model:       opts.model       || c.chatModel,
      messages,
      temperature: typeof opts.temperature === 'number' ? opts.temperature : c.temperature,
      max_tokens:  typeof opts.maxTokens   === 'number' ? opts.maxTokens   : c.maxTokens,
    };
    if (opts.stop) body.stop = opts.stop;
    if (opts.jsonMode) body.response_format = { type: 'json_object' };

    let data;
    try {
      data = await this._postJson('/chat/completions', body);
    } catch (e) {
      // Some OpenAI-compatible servers don't support response_format. Retry without it.
      if (opts.jsonMode && /response_format|json_object|unsupported|invalid/i.test(String(e.message))) {
        const retryBody = { ...body };
        delete retryBody.response_format;
        data = await this._postJson('/chat/completions', retryBody);
      } else {
        throw e;
      }
    }
    const content = data?.choices?.[0]?.message?.content;
    if (typeof content !== 'string') throw new Error('Chat response has no text content.');
    return content;
  },

  // ── EMBEDDINGS ──────────────────────────────────────────────────────

  // texts: string | string[]  → returns number[][] in the same order
  async embed(texts) {
    const list = Array.isArray(texts) ? texts : [texts];
    if (list.length === 0) return [];
    const c = this.getConfig();
    const data = await this._postJson('/embeddings', {
      model: c.embeddingModel,
      input: list,
    });
    const out = Array.isArray(data?.data) ? data.data : [];
    // Normalise: sort by index (spec says they come back in order, but be safe)
    out.sort((a, b) => (a.index || 0) - (b.index || 0));
    return out.map(row => Array.isArray(row?.embedding) ? row.embedding : []);
  },

  cosine(a, b) {
    if (!Array.isArray(a) || !Array.isArray(b) || a.length !== b.length || a.length === 0) return 0;
    let dot = 0, na = 0, nb = 0;
    for (let i = 0; i < a.length; i++) {
      dot += a[i] * b[i];
      na  += a[i] * a[i];
      nb  += b[i] * b[i];
    }
    const denom = Math.sqrt(na) * Math.sqrt(nb);
    return denom > 0 ? dot / denom : 0;
  },

  // ── TEST CONNECTION ─────────────────────────────────────────────────

  async testConnection() {
    try {
      const reply = await this.chat(
        [
          { role: 'system', content: 'You are a terse connection-test echo.' },
          { role: 'user',   content: 'Reply with the single word: PONG' },
        ],
        { temperature: 0, maxTokens: 8 }
      );
      return { ok: true, reply: (reply || '').trim() };
    } catch (e) {
      return { ok: false, error: String(e.message || e) };
    }
  },

  // ── SUMMARY + EMBEDDING PER ARTICLE ────────────────────────────────

  // article: { id, title, content, tags? }  → short summary string
  async generateSummary(article) {
    const plain = _stripHtml(article?.content || '').trim();
    const truncated = _truncateChars(plain, 3500);
    const title = (article?.title || 'Untitled').trim();
    const system = 'You write short, factual, in-universe encyclopedia summaries. Output plain text only — no headings, no wikilinks, no HTML, no markdown. 1 to 3 sentences. Do not invent facts that are not present in the source.';
    const user =
      `Title: ${title}\n\n` +
      `Article:\n${truncated || '(no body yet)'}\n\n` +
      `Write a 1–3 sentence summary for search-index use.`;
    const reply = await this.chat(
      [
        { role: 'system', content: system },
        { role: 'user',   content: user },
      ],
      { temperature: 0.3, maxTokens: 220 }
    );
    return (reply || '').trim().replace(/^["'`]+|["'`]+$/g, '');
  },

  // article: { id, title, content, summary?, tags? } → { vector, model }
  async generateEmbedding(article) {
    const c = this.getConfig();
    const title   = (article?.title || '').trim();
    const tags    = Array.isArray(article?.tags) ? article.tags.join(', ') : '';
    const summary = (article?.summary || '').trim();
    const plain   = _stripHtml(article?.content || '').trim();
    // Prefer title + summary + tags (cheap, focused). Fall back to a slice of the content.
    const text = [title, tags, summary || _truncateChars(plain, 1200)]
      .filter(Boolean).join('\n');
    const [vec] = await this.embed([text || title || 'untitled']);
    return { vector: Array.isArray(vec) ? vec : [], model: c.embeddingModel };
  },

  // ── RE-INDEX ALL ───────────────────────────────────────────────────

  // progressCb({ done, total, step, articleTitle, error? })
  // step: 'summary' | 'embedding' | 'saved' | 'skipped' | 'complete'
  async reindexAll(progressCb) {
    const cb = typeof progressCb === 'function' ? progressCb : () => {};
    const total = DB.articles.length;
    let done = 0;
    for (const art of DB.articles) {
      try {
        cb({ done, total, step: 'summary', articleTitle: art.title });
        art.summary = await this.generateSummary(art);
        cb({ done, total, step: 'embedding', articleTitle: art.title });
        const { vector, model } = await this.generateEmbedding(art);
        art.embedding = vector;
        art.embeddingModel = model;
        art.updated = Date.now();
        await DB.save(art.id);
        done++;
        cb({ done, total, step: 'saved', articleTitle: art.title });
      } catch (e) {
        done++;
        cb({ done, total, step: 'skipped', articleTitle: art.title, error: String(e.message || e) });
      }
    }
    cb({ done, total, step: 'complete' });
    return { done, total };
  },

  // ── CONTEXT GATHERING ──────────────────────────────────────────────

  // spec: { title, guidance?, relatedIds?: string[], topK?: number }
  // Returns { explicit: ContextItem[], semantic: ContextItem[], query: string }
  // ContextItem: { id, title, summary, snippet }
  async gatherContext(spec) {
    const c = this.getConfig();
    const topK = Math.max(0, typeof spec.topK === 'number' ? spec.topK : c.topK);
    const query = [spec.title, spec.guidance].filter(Boolean).join('\n').trim();

    const explicitIds = new Set((spec.relatedIds || []).filter(Boolean));
    const explicit = [];
    for (const id of explicitIds) {
      const art = DB.articles.find(a => a.id === id);
      if (!art) continue;
      explicit.push(_toContextItem(art));
    }

    let semantic = [];
    const remaining = DB.articles.filter(a => !explicitIds.has(a.id));
    if (topK > 0 && query && this.isEmbeddingConfigured()) {
      try {
        const [qvec] = await this.embed([query]);
        const hasVec = remaining.filter(a => Array.isArray(a.embedding) && a.embedding.length === qvec.length);
        const scored = hasVec.map(a => ({ a, score: this.cosine(qvec, a.embedding) }));
        scored.sort((x, y) => y.score - x.score);
        semantic = scored.slice(0, topK).filter(s => s.score > 0).map(s => _toContextItem(s.a, s.score));
        // Fill remaining slots with lexical matches on articles missing embeddings
        if (semantic.length < topK) {
          const fillers = _lexicalMatches(query, remaining.filter(a => !hasVec.includes(a)), topK - semantic.length);
          semantic = semantic.concat(fillers.map(a => _toContextItem(a)));
        }
      } catch (e) {
        console.warn('Embedding search failed, falling back to lexical:', e);
        semantic = _lexicalMatches(query, remaining, topK).map(a => _toContextItem(a));
      }
    } else if (topK > 0 && query) {
      // Embedding endpoint not configured — use lexical match only.
      semantic = _lexicalMatches(query, remaining, topK).map(a => _toContextItem(a));
    }

    return { explicit, semantic, query };
  },

  // ── ARTICLE GENERATION ─────────────────────────────────────────────

  // spec:
  //   { title, guidance?, templateId?, relatedIds?: string[] }
  // Returns a normalized draft object:
  //   { title, summary, contentHTML, tags: string[],
  //     wikibox: { enabled, title, subtitle, imgCaption, fields: [{type,key,val}] } | null,
  //     sourceSpec, contextUsed: { explicit, semantic } }
  async generateArticle(spec) {
    if (!this.isConfigured()) throw new Error('AI is not configured.');
    const c = this.getConfig();

    const template = (spec.templateId && DB.articleTemplates.find(t => t.id === spec.templateId)) || null;
    const wbTemplate = template && template.wikiboxTemplateId
      ? DB.wikiboxTemplates.find(w => w.id === template.wikiboxTemplateId) || null
      : null;

    const ctx = await this.gatherContext({
      title: spec.title,
      guidance: spec.guidance,
      relatedIds: spec.relatedIds,
      topK: c.topK,
    });

    const existingTitles = DB.articles.map(a => a.title).filter(Boolean).slice(0, 200);
    const messages = _buildArticlePromptMessages({
      spec, template, wbTemplate, context: ctx, existingTitles,
    });

    const raw = await this.chat(messages, {
      temperature: c.temperature,
      maxTokens: c.maxTokens,
      jsonMode: true,
    });

    const parsed = _extractJsonObject(raw);
    if (!parsed) throw new Error('AI returned no valid JSON object. Raw reply:\n' + _truncateChars(raw, 400));

    const draft = _normalizeArticleDraft(parsed, { spec, template, wbTemplate });
    draft.sourceSpec = { ...spec };
    draft.contextUsed = {
      explicit: ctx.explicit.map(x => ({ id: x.id, title: x.title })),
      semantic: ctx.semantic.map(x => ({ id: x.id, title: x.title })),
    };
    return draft;
  },
};

// ── PRIVATE HELPERS ────────────────────────────────────────────────────

function _stripHtml(html) {
  if (!html) return '';
  const tmp = document.createElement('div');
  tmp.innerHTML = String(html);
  // Collapse whitespace
  return (tmp.textContent || tmp.innerText || '').replace(/\s+/g, ' ').trim();
}

function _truncateChars(s, n) {
  if (!s) return '';
  s = String(s);
  return s.length > n ? s.slice(0, n - 1).trimEnd() + '…' : s;
}

function _toContextItem(art, score) {
  const summary = (art.summary || '').trim();
  const body    = _stripHtml(art.content || '');
  const snippet = summary ? summary : _truncateChars(body, 600);
  const item = {
    id:      art.id,
    title:   art.title || 'Untitled',
    summary: summary,
    snippet: snippet,
  };
  if (typeof score === 'number') item.score = score;
  return item;
}

function _lexicalMatches(query, articles, limit) {
  if (!query || limit <= 0) return [];
  const terms = query.toLowerCase().split(/\s+/).filter(t => t.length > 2);
  if (terms.length === 0) return [];
  const scored = articles.map(a => {
    const hay = [
      a.title || '',
      (a.tags || []).join(' '),
      a.summary || '',
    ].join(' ').toLowerCase();
    let s = 0;
    terms.forEach(t => { if (hay.includes(t)) s++; });
    return { a, s };
  }).filter(x => x.s > 0);
  scored.sort((x, y) => y.s - x.s);
  return scored.slice(0, limit).map(x => x.a);
}

// Extracts the first well-formed JSON object from a string.
function _extractJsonObject(raw) {
  if (!raw) return null;
  const s = String(raw).trim();
  // Strip ``` fences
  const fenceMatch = s.match(/```(?:json)?\s*([\s\S]*?)```/i);
  const candidate = fenceMatch ? fenceMatch[1] : s;
  // Try straight parse first
  try { return JSON.parse(candidate); } catch (e) {}
  // Find first { and last matching }
  const start = candidate.indexOf('{');
  const end   = candidate.lastIndexOf('}');
  if (start >= 0 && end > start) {
    const slice = candidate.slice(start, end + 1);
    try { return JSON.parse(slice); } catch (e) {}
  }
  return null;
}

function _normalizeArticleDraft(raw, { spec, template, wbTemplate }) {
  const out = {
    title:       typeof raw.title === 'string' && raw.title.trim() ? raw.title.trim() : (spec.title || 'Untitled'),
    summary:     typeof raw.summary === 'string' ? raw.summary.trim() : '',
    contentHTML: typeof raw.contentHTML === 'string' ? raw.contentHTML : (typeof raw.content === 'string' ? raw.content : ''),
    tags:        Array.isArray(raw.tags) ? raw.tags.map(t => String(t).trim()).filter(Boolean) : [],
    wikibox:     null,
  };

  // Strip obvious code fences if the model wrapped HTML in them
  out.contentHTML = out.contentHTML.replace(/^```(?:html)?\s*/i, '').replace(/\s*```$/i, '').trim();

  // Merge default tags from template
  if (template && Array.isArray(template.defaultTags)) {
    const have = new Set(out.tags.map(t => t.toLowerCase()));
    template.defaultTags.forEach(t => {
      const v = String(t).trim();
      if (v && !have.has(v.toLowerCase())) { out.tags.push(v); have.add(v.toLowerCase()); }
    });
  }

  // Wikibox: accept the model's structure, but enforce field shape.
  const wb = raw.wikibox;
  if (wb && typeof wb === 'object') {
    const fieldsIn = Array.isArray(wb.fields) ? wb.fields : [];
    const fields = fieldsIn.map(f => {
      const type = (f && f.type === 'section') ? 'section' : 'field';
      return {
        type,
        key: typeof f?.key === 'string' ? f.key : '',
        val: type === 'section' ? '' : (typeof f?.val === 'string' ? f.val : ''),
      };
    }).filter(f => f.type === 'section' || f.key || f.val);

    out.wikibox = {
      enabled:    wb.enabled !== false,
      title:      typeof wb.title    === 'string' ? wb.title    : out.title,
      subtitle:   typeof wb.subtitle === 'string' ? wb.subtitle : '',
      image:      null,
      imagePath:  false,
      imgCaption: typeof wb.imgCaption === 'string' ? wb.imgCaption : '',
      fields,
    };
  } else if (wbTemplate) {
    // Model didn't produce a wikibox but template has one — create an empty shell
    out.wikibox = {
      enabled:    true,
      title:      out.title,
      subtitle:   '',
      image:      null,
      imagePath:  false,
      imgCaption: '',
      fields: wbTemplate.fields.map(f => ({
        type: f.type || 'field',
        key:  f.key  || '',
        val:  '',
      })),
    };
  }

  return out;
}

function _buildArticlePromptMessages({ spec, template, wbTemplate, context, existingTitles }) {
  const system = [
    'You are an in-universe worldbuilding encyclopedist for a wiki. Your job is to generate a single new article as a strict JSON object.',
    '',
    'OUTPUT CONTRACT — reply with EXACTLY ONE JSON object, nothing else, no prose, no markdown fences. The object MUST have these keys:',
    '  "title":       string — the article title.',
    '  "summary":     string — 1 to 3 sentences, plain text, no markdown/HTML/wikilinks. Good for search-index use.',
    '  "contentHTML": string — the article body as valid HTML. Use <h1>/<h2>/<h3> for sections, <p> for paragraphs, <ul><li> for lists, <strong>/<em>/<u> for inline emphasis. Do NOT include the article title as an <h1> at the top (the viewer shows it separately). Do NOT include images. Do NOT use markdown.',
    '  "tags":        string[] — 0–6 short lower-case tag strings.',
    '  "wikibox":     object or null — if present, it MUST match this shape: { "enabled": true, "title": string, "subtitle": string, "imgCaption": string, "fields": [ { "type": "field"|"section", "key": string, "val": string } ] }. Only include the "wikibox" key if the template provides a wikibox shape; otherwise set it to null.',
    '',
    'WIKILINKS: inside contentHTML and wikibox field values, link to other articles using [[Article Name]] syntax (double square brackets) — NOT HTML <a> tags. Linked articles do not need to exist yet. Use [[Name|display text]] when you want different display text. Link generously to entities the reader might want to read more about (people, places, factions, events, species).',
    '',
    'STYLE: third person, neutral encyclopedic tone, in-universe (do not mention "the user", "this article", "AI", "writer", or the real world). Stay consistent with facts given in the CONTEXT section. Do not contradict existing articles. If a fact is unknown, either omit it or be clearly vague ("details are lost to history").',
    '',
    'NEVER wrap the JSON in ``` fences or add commentary before/after it.',
  ].join('\n');

  const parts = [];
  parts.push(`ARTICLE TITLE: ${spec.title || '(untitled)'}`);
  if (spec.guidance && spec.guidance.trim()) {
    parts.push('ADDITIONAL GUIDANCE FROM USER:\n' + spec.guidance.trim());
  }

  if (template) {
    parts.push('TEMPLATE: ' + (template.name || 'Generic'));
    if (template.articlePrompt) parts.push('TEMPLATE GUIDELINES:\n' + template.articlePrompt);
    if (Array.isArray(template.sectionOutline) && template.sectionOutline.length) {
      parts.push('SUGGESTED SECTION OUTLINE (use as a guide — feel free to rename/reorder):\n- ' + template.sectionOutline.join('\n- '));
    }
  }

  if (wbTemplate) {
    const lines = (wbTemplate.fields || []).map(f =>
      f.type === 'section' ? `  # ${f.key || 'Section'}` : `  - ${f.key || ''}`
    );
    parts.push(
      'WIKIBOX TEMPLATE (fill values that make sense; leave unknowns as empty strings; keep every field and section; you may add extra fields if strongly relevant):\n' +
      lines.join('\n')
    );
  } else {
    parts.push('WIKIBOX: none for this template. Set "wikibox" to null in the JSON output.');
  }

  // Explicit related articles
  if (context.explicit && context.explicit.length) {
    parts.push('RELATED ARTICLES (explicitly chosen by the user — treat these as authoritative source material):');
    context.explicit.forEach(it => {
      parts.push(`• [[${it.title}]]\n    ${it.snippet}`);
    });
  }
  if (context.semantic && context.semantic.length) {
    parts.push('OTHER POTENTIALLY RELEVANT ARTICLES (retrieved by similarity — may or may not be useful):');
    context.semantic.forEach(it => {
      parts.push(`• [[${it.title}]]\n    ${it.snippet}`);
    });
  }

  if (existingTitles && existingTitles.length) {
    // Help the model prefer linking to real articles over inventing new ones.
    const sample = existingTitles.slice(0, 120).map(t => `[[${t}]]`).join(', ');
    parts.push('EXISTING ARTICLES you can link to with wikilinks:\n' + sample);
  }

  const user = parts.join('\n\n');

  return [
    { role: 'system', content: system },
    { role: 'user',   content: user },
  ];
}
