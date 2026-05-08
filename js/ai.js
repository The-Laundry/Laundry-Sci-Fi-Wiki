// js/ai.js
// OpenAI-compatible AI helper used by the "Infinite Wiki" feature.
//
// Public surface:
//   AI.isConfigured()             — chat is ready to call
//   AI.isEmbeddingConfigured()    — embedding endpoint is ready to call
//   AI.getConfig()                — returns { ...settings.ai, apiKey }
//   AI.saveConfig(partial)        — patches settings.ai and persists, handles apiKey
//   AI.getApiKey() / setApiKey(v) / clearApiKey()
//   AI.chat(messages, opts)       — POST /chat/completions, returns the message content
//   AI.chatStream(messages, opts, onChunk)
//                                 — POST /chat/completions with stream:true; emits token
//                                   deltas via onChunk(delta, accumulated). Falls back to
//                                   AI.chat() transparently if the server rejects streaming.
//   AI.embed(texts)               — POST /embeddings, returns number[][]
//   AI.cosine(a, b)               — cosine similarity on two number[] vectors
//   AI.testConnection()           — cheap chat ping, returns {ok, error?}
//   AI.generateSummary(article)   — returns a short summary string
//   AI.generateEmbedding(article) — returns { vector, model }
//   AI.reindexAll(progressCb)     — rebuild summaries+embeddings for every article
//   AI.gatherContext(spec)        — { relatedArticles, semanticMatches } for prompt
//   AI.generateArticle(spec)      — returns a normalized article draft object (non-streaming
//                                   convenience wrapper around generateArticleStreaming)
//   AI.generateArticleStreaming(spec, callbacks)
//                                 — runs context-gather + streamed chat; fires callbacks
//                                   { onContextReady, onPhase, onTitle, onSummary,
//                                     onContentDelta, onRawDelta, onComplete, onError }
//                                   honours settings.ai.streaming (default true).
//
// The API key is stored ONLY in localStorage under 'eomt_ai_key' and is never
// written to settings.json or exported. DB.exportAll() scrubs settings.ai.apiKey
// defensively in case an older file ever had one.

'use strict';

const AI = {

  // ── CONFIG ──────────────────────────────────────────────────────────

  _KEY_STORAGE: 'eomt_ai_key',

  // ── PROMPT DEFAULTS ─────────────────────────────────────────────────
  //
  // These are the built-in prompt strings the AI helper uses. Users can
  // override any subset of them via DB.settings.ai.prompts (edited on the
  // AI settings page). An override that matches the default (or is empty)
  // is treated as "no override" so settings.json stays minimal.
  //
  // Supported placeholders per prompt:
  //   summaryUserTemplate  → {title}, {content}
  //   articleUserPreamble  → {title}
  //   (all other prompts are literal strings, no substitutions.)
  DEFAULT_PROMPTS: _DEFAULT_PROMPTS_BUILDER(),

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
    // Merge saved prompt overrides over defaults so callers see a complete set.
    const savedPrompts = (ai.prompts && typeof ai.prompts === 'object') ? ai.prompts : {};
    const prompts = {};
    Object.keys(this.DEFAULT_PROMPTS).forEach(k => {
      const v = savedPrompts[k];
      prompts[k] = (typeof v === 'string' && v.length > 0) ? v : this.DEFAULT_PROMPTS[k];
    });
    return {
      enabled:           !!ai.enabled,
      baseUrl:           ai.baseUrl           || 'https://api.openai.com/v1',
      chatModel:         ai.chatModel         || 'gpt-4o-mini',
      embeddingModel:    ai.embeddingModel    || 'text-embedding-3-small',
      temperature:       typeof ai.temperature === 'number' ? ai.temperature : 0.7,
      maxTokens:         typeof ai.maxTokens  === 'number' ? ai.maxTokens  : 2000,
      autoRefreshOnSave: ai.autoRefreshOnSave !== false,
      topK:              typeof ai.topK       === 'number' ? ai.topK       : 5,
      streaming:         ai.streaming !== false, // default on
      prompts,
      apiKey:            this.getApiKey(),
    };
  },

  // Returns the effective prompt string for `key`, applying {placeholder}
  // substitutions from the optional `vars` map. Falls back to the built-in
  // default when no override is set (or the override is empty).
  getPrompt(key, vars) {
    const fallback = this.DEFAULT_PROMPTS[key] || '';
    const saved = ((DB.settings && DB.settings.ai && DB.settings.ai.prompts) || {})[key];
    const str = (typeof saved === 'string' && saved.length > 0) ? saved : fallback;
    return vars ? _applyTemplate(str, vars) : str;
  },

  async saveConfig(partial) {
    if (!DB.settings.ai) DB.settings.ai = {};
    const allowed = ['enabled','baseUrl','chatModel','embeddingModel','temperature','maxTokens','autoRefreshOnSave','topK','streaming'];
    allowed.forEach(k => { if (k in partial) DB.settings.ai[k] = partial[k]; });

    // Prompts: accept a partial map, merge into settings.ai.prompts, and
    // strip any entry that equals the default or is empty so settings.json
    // stays minimal. If the resulting map is empty, delete the key entirely.
    if (partial && partial.prompts && typeof partial.prompts === 'object') {
      if (!DB.settings.ai.prompts || typeof DB.settings.ai.prompts !== 'object') {
        DB.settings.ai.prompts = {};
      }
      Object.keys(partial.prompts).forEach(k => {
        if (!(k in this.DEFAULT_PROMPTS)) return; // ignore unknown keys
        const v = partial.prompts[k];
        if (typeof v !== 'string' || v.length === 0 || v === this.DEFAULT_PROMPTS[k]) {
          delete DB.settings.ai.prompts[k];
        } else {
          DB.settings.ai.prompts[k] = v;
        }
      });
      if (Object.keys(DB.settings.ai.prompts).length === 0) {
        delete DB.settings.ai.prompts;
      }
    }

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

  // ── STREAMING CHAT ──────────────────────────────────────────────────

  // Streamed variant of .chat(). Posts to /chat/completions with stream:true,
  // consumes the SSE response body, and calls onChunk(deltaString, accumulatedString)
  // for every new token fragment. Returns the final accumulated string.
  //
  // Falls back to the non-streaming .chat() transparently if:
  //   • onChunk is not a function
  //   • the server rejects the request (400 / "stream"/"unsupported")
  //   • the environment lacks ReadableStream (extremely unlikely)
  //
  // opts: { model, temperature, maxTokens, jsonMode, stop, signal, timeoutMs }
  async chatStream(messages, opts = {}, onChunk) {
    if (typeof onChunk !== 'function') {
      // No consumer for deltas — just use the regular chat path.
      return this.chat(messages, opts);
    }
    const c = this.getConfig();
    const body = {
      model:       opts.model       || c.chatModel,
      messages,
      temperature: typeof opts.temperature === 'number' ? opts.temperature : c.temperature,
      max_tokens:  typeof opts.maxTokens   === 'number' ? opts.maxTokens   : c.maxTokens,
      stream:      true,
    };
    if (opts.stop) body.stop = opts.stop;
    if (opts.jsonMode) body.response_format = { type: 'json_object' };

    if (!c.baseUrl) throw new Error('AI base URL is not configured.');
    if (!c.apiKey)  throw new Error('AI API key is not set.');
    const url = this._joinUrl(c.baseUrl, '/chat/completions');

    const timeoutMs = typeof opts.timeoutMs === 'number' ? opts.timeoutMs : 180000;
    const ctrl = new AbortController();
    const t = setTimeout(() => ctrl.abort(), timeoutMs);
    const signal = opts.signal || ctrl.signal;

    let res;
    try {
      res = await fetch(url, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': 'Bearer ' + c.apiKey,
          'Accept': 'text/event-stream',
        },
        body: JSON.stringify(body),
        signal,
      });
    } catch (e) {
      clearTimeout(t);
      throw e;
    }

    if (!res.ok) {
      clearTimeout(t);
      let detail = '';
      try { detail = await res.text(); } catch (_e) {}
      const msg = `HTTP ${res.status} ${res.statusText}${detail ? ': ' + detail.slice(0, 400) : ''}`;
      // Attempt graceful fallback if the endpoint doesn't accept stream / response_format.
      if (/stream|response_format|json_object|unsupported|invalid/i.test(msg)) {
        const retryOpts = { ...opts };
        // If jsonMode was the likely culprit we let .chat()'s own retry handle it.
        const fallback = await this.chat(messages, retryOpts);
        onChunk(fallback, fallback);
        return fallback;
      }
      throw new Error(msg);
    }
    if (!res.body || typeof res.body.getReader !== 'function') {
      clearTimeout(t);
      // No streaming body — fallback to plain text parse.
      const text = await res.text();
      const parsed = _parseNonStreamChunk(text);
      if (parsed) { onChunk(parsed, parsed); return parsed; }
      // Last resort: re-call non-streaming.
      const fallback = await this.chat(messages, opts);
      onChunk(fallback, fallback);
      return fallback;
    }

    const reader = res.body.getReader();
    const decoder = new TextDecoder('utf-8');
    let buffer = '';
    let accumulated = '';

    try {
      while (true) {
        const { value, done } = await reader.read();
        if (done) break;
        buffer += decoder.decode(value, { stream: true });

        // SSE frames are separated by blank lines. Process whole frames only;
        // any trailing partial frame stays in the buffer for the next chunk.
        let sepIdx;
        while ((sepIdx = _findSseFrameEnd(buffer)) !== -1) {
          const frame = buffer.slice(0, sepIdx);
          buffer = buffer.slice(sepIdx).replace(/^(\r?\n)+/, '');
          const delta = _parseSseFrame(frame);
          if (delta === '[DONE]') { /* end marker */ }
          else if (delta) {
            accumulated += delta;
            try { onChunk(delta, accumulated); } catch (cbErr) { console.warn('chatStream onChunk threw:', cbErr); }
          }
        }
      }
      // Flush any residual buffer as a final frame.
      if (buffer.trim()) {
        const delta = _parseSseFrame(buffer);
        if (delta && delta !== '[DONE]') {
          accumulated += delta;
          try { onChunk(delta, accumulated); } catch (cbErr) { console.warn('chatStream onChunk threw:', cbErr); }
        }
      }
    } finally {
      clearTimeout(t);
      try { reader.releaseLock(); } catch (_e) {}
    }

    return accumulated;
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
          { role: 'system', content: this.getPrompt('testSystem') },
          { role: 'user',   content: this.getPrompt('testUser') },
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
    const system = this.getPrompt('summarySystem');
    const user = this.getPrompt('summaryUserTemplate', {
      title,
      content: truncated || '(no body yet)',
    });
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

  // Streaming article generation.
  //
  // spec:
  //   { title, guidance?, templateId?, relatedIds?: string[] }
  //
  // callbacks (all optional):
  //   onPhase(phaseString)                — 'context' | 'writing' | 'parsing' | 'done'
  //   onContextReady({ explicit, semantic, query })
  //                                       — fired once, after context-gather finishes
  //   onRawDelta(delta, accumulated)      — raw text tokens as they stream in
  //   onTitle(fullTitleSoFar)             — partial title string as it's decoded
  //   onSummary(fullSummarySoFar)         — partial summary string
  //   onContentDelta(htmlSoFar, newChars) — partial contentHTML with newly-arrived chars
  //   onComplete(draft)                   — final normalized draft
  //   onError(err)                        — fatal error (still throws too)
  //
  // Returns the final normalized draft (same shape as the old AI.generateArticle).
  async generateArticleStreaming(spec, callbacks = {}) {
    const cb = {
      onPhase:         typeof callbacks.onPhase === 'function'         ? callbacks.onPhase         : () => {},
      onContextReady:  typeof callbacks.onContextReady === 'function'  ? callbacks.onContextReady  : () => {},
      onRawDelta:      typeof callbacks.onRawDelta === 'function'      ? callbacks.onRawDelta      : () => {},
      onTitle:         typeof callbacks.onTitle === 'function'         ? callbacks.onTitle         : () => {},
      onSummary:       typeof callbacks.onSummary === 'function'       ? callbacks.onSummary       : () => {},
      onContentDelta:  typeof callbacks.onContentDelta === 'function'  ? callbacks.onContentDelta  : () => {},
      onComplete:      typeof callbacks.onComplete === 'function'      ? callbacks.onComplete      : () => {},
      onError:         typeof callbacks.onError === 'function'         ? callbacks.onError         : () => {},
    };

    try {
      if (!this.isConfigured()) throw new Error('AI is not configured.');
      const c = this.getConfig();

      const template = (spec.templateId && DB.articleTemplates.find(t => t.id === spec.templateId)) || null;
      const wbTemplate = template && template.wikiboxTemplateId
        ? DB.wikiboxTemplates.find(w => w.id === template.wikiboxTemplateId) || null
        : null;

      // ── Phase 1: context gather ───────────────────────────────────────
      cb.onPhase('context');
      const ctx = await this.gatherContext({
        title: spec.title,
        guidance: spec.guidance,
        relatedIds: spec.relatedIds,
        topK: c.topK,
      });
      cb.onContextReady({
        explicit: ctx.explicit.map(x => ({ id: x.id, title: x.title, summary: x.summary, snippet: x.snippet })),
        semantic: ctx.semantic.map(x => ({ id: x.id, title: x.title, summary: x.summary, snippet: x.snippet, score: x.score })),
        query: ctx.query,
      });

      // ── Phase 2: streamed chat ────────────────────────────────────────
      cb.onPhase('writing');
      const existingTitles = DB.articles.map(a => a.title).filter(Boolean).slice(0, 200);
      const messages = _buildArticlePromptMessages({
        spec, template, wbTemplate, context: ctx, existingTitles,
      });

      const extractor = new _ProgressiveJsonExtractor();
      extractor.onField = (field, partial, deltaChars) => {
        if (field === 'title')       cb.onTitle(partial);
        else if (field === 'summary') cb.onSummary(partial);
        else if (field === 'contentHTML') cb.onContentDelta(partial, deltaChars);
      };

      let raw = '';
      const onChunk = (delta, accumulated) => {
        raw = accumulated;
        cb.onRawDelta(delta, accumulated);
        try { extractor.ingest(delta); } catch (e) { console.warn('progressive extractor error:', e); }
      };

      const chatOpts = {
        temperature: c.temperature,
        maxTokens: c.maxTokens,
        jsonMode: true,
      };
      if (c.streaming !== false) {
        raw = await this.chatStream(messages, chatOpts, onChunk);
      } else {
        // User disabled streaming — fall back to single-shot, then feed the whole
        // reply through the extractor in one go so onContentDelta still fires once.
        raw = await this.chat(messages, chatOpts);
        onChunk(raw, raw);
      }

      // ── Phase 3: parse & normalize ────────────────────────────────────
      cb.onPhase('parsing');
      const parsed = _extractJsonObject(raw);
      if (!parsed) throw new Error('AI returned no valid JSON object. Raw reply:\n' + _truncateChars(raw, 400));

      const draft = _normalizeArticleDraft(parsed, { spec, template, wbTemplate });
      draft.sourceSpec = { ...spec };
      draft.contextUsed = {
        explicit: ctx.explicit.map(x => ({ id: x.id, title: x.title })),
        semantic: ctx.semantic.map(x => ({ id: x.id, title: x.title })),
      };
      cb.onPhase('done');
      cb.onComplete(draft);
      return draft;
    } catch (err) {
      cb.onError(err);
      throw err;
    }
  },

  // Convenience wrapper: non-streaming, returns just the final draft.
  // Kept for back-compat with older call sites that don't need live deltas.
  // spec: { title, guidance?, templateId?, relatedIds?: string[] }
  async generateArticle(spec) {
    return this.generateArticleStreaming(spec, {});
  },
};

// ── PRIVATE HELPERS ────────────────────────────────────────────────────

// Simple {key} substitution. Unknown keys are left untouched so placeholder-
// like text inside a prompt body (e.g. example JSON fragments) isn't mangled.
function _applyTemplate(str, vars) {
  if (!str || !vars) return str || '';
  return String(str).replace(/\{(\w+)\}/g, (m, k) =>
    Object.prototype.hasOwnProperty.call(vars, k) ? String(vars[k]) : m);
}

// Builds the AI.DEFAULT_PROMPTS object. Defined as a function so the long
// strings (which contain ``` fences and other tricky characters) can live
// down here with the rest of the private helpers instead of cluttering the
// top of the AI object literal.
function _DEFAULT_PROMPTS_BUILDER() {
  const articleSystemLines = [
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
    'NEVER wrap the JSON in triple-backtick fences or add commentary before/after it.',
  ];
  return {
    articleSystem:        articleSystemLines.join('\n'),
    articleUserPreamble:  'ARTICLE TITLE: {title}',
    articleGuidanceLabel: 'ADDITIONAL GUIDANCE FROM USER:',
    summarySystem:        'You write short, factual, in-universe encyclopedia summaries. Output plain text only — no headings, no wikilinks, no HTML, no markdown. 1 to 3 sentences. Do not invent facts that are not present in the source.',
    summaryUserTemplate:  'Title: {title}\n\nArticle:\n{content}\n\nWrite a 1–3 sentence summary for search-index use.',
    testSystem:           'You are a terse connection-test echo.',
    testUser:             'Reply with the single word: PONG',
  };
}

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
  const system = AI.getPrompt('articleSystem');

  const parts = [];
  parts.push(AI.getPrompt('articleUserPreamble', { title: spec.title || '(untitled)' }));
  if (spec.guidance && spec.guidance.trim()) {
    parts.push(AI.getPrompt('articleGuidanceLabel') + '\n' + spec.guidance.trim());
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

// ── SSE + PROGRESSIVE JSON HELPERS ─────────────────────────────────────

// Find the end of the next complete SSE frame in the buffer, or -1 if none.
// A frame terminates at "\n\n" or "\r\n\r\n".
function _findSseFrameEnd(buf) {
  const i1 = buf.indexOf('\n\n');
  const i2 = buf.indexOf('\r\n\r\n');
  if (i1 === -1) return i2;
  if (i2 === -1) return i1;
  return Math.min(i1, i2);
}

// Parses a single SSE frame into its delta text.
// A frame is one or more lines; the data: lines carry the payload JSON.
// Returns the content delta string, '[DONE]' if that sentinel was sent,
// or '' if the frame carried no usable data.
function _parseSseFrame(frame) {
  const lines = frame.split(/\r?\n/);
  let out = '';
  for (const line of lines) {
    if (!line || line.startsWith(':')) continue; // comment / keepalive
    const idx = line.indexOf(':');
    const field = idx === -1 ? line : line.slice(0, idx);
    let value   = idx === -1 ? ''   : line.slice(idx + 1);
    if (value.startsWith(' ')) value = value.slice(1);
    if (field !== 'data') continue;
    if (value === '[DONE]') return '[DONE]';
    if (!value) continue;
    try {
      const obj = JSON.parse(value);
      const delta =
        obj?.choices?.[0]?.delta?.content ??
        obj?.choices?.[0]?.message?.content ??
        '';
      if (typeof delta === 'string') out += delta;
    } catch (_e) {
      // Some endpoints emit plain text after "data: "; treat it as literal.
      out += value;
    }
  }
  return out;
}

// For non-streaming responses that came back as a plain JSON body.
// Extracts the final message content if possible.
function _parseNonStreamChunk(text) {
  try {
    const obj = JSON.parse(text);
    const c = obj?.choices?.[0]?.message?.content;
    if (typeof c === 'string') return c;
  } catch (_e) {}
  return '';
}

// ── PROGRESSIVE JSON FIELD EXTRACTOR ───────────────────────────────────
//
// Consumes raw text as it streams in (a JSON object from an LLM) and fires
// `onField(fieldName, partialValueSoFar, newDeltaChars)` whenever new
// characters are appended to a watched top-level string field.
//
// Watched fields (hardcoded for the article contract): title, summary, contentHTML.
//
// Only handles the subset of JSON we actually expect: a single top-level object
// with string/array/object values. It tracks string-escape state so `\"` and
// `\\` inside string literals don't fool the boundary detector. Escape sequences
// are resolved to their real characters before emission (`\n` → newline, etc.),
// so the extractor's output is ready to render.
function _ProgressiveJsonExtractor() {
  this._buf = '';          // accumulated raw text
  this._scanIdx = 0;       // next index in _buf we haven't inspected yet
  this._state = 'seek';    // 'seek' | 'key' | 'afterKey' | 'beforeValue' | 'value-string' | 'value-skip'
  this._depth = 0;         // nesting depth for non-watched values we're skipping over
  this._inString = false;  // inside a string literal while skipping
  this._escaped = false;   // previous char was a backslash inside a string
  this._keyBuf = '';       // decoded current key
  this._keyRaw = '';       // raw (still escaped) current key — used only for internal fsm state
  this._currentField = null;
  this._watched = new Set(['title', 'summary', 'contentHTML']);
  this._partial = { title: '', summary: '', contentHTML: '' };
  this.onField = null;
}

_ProgressiveJsonExtractor.prototype.ingest = function (chunk) {
  if (!chunk) return;
  this._buf += chunk;
  this._drain();
};

_ProgressiveJsonExtractor.prototype._emit = function (field, delta) {
  if (!delta) return;
  this._partial[field] += delta;
  if (typeof this.onField === 'function') {
    try { this.onField(field, this._partial[field], delta); } catch (e) { console.warn(e); }
  }
};

_ProgressiveJsonExtractor.prototype._drain = function () {
  const buf = this._buf;
  const n = buf.length;
  while (this._scanIdx < n) {
    const st = this._state;

    if (st === 'seek') {
      // Looking for an opening quote of a key, or the final '}' of the object.
      // Skip whitespace, '{', ',', ':' (any separators at depth 0).
      const ch = buf[this._scanIdx];
      if (ch === '"') {
        this._scanIdx++;
        this._state = 'key';
        this._keyBuf = '';
        this._keyRaw = '';
      } else {
        // just advance past anything that isn't a key-opening quote
        this._scanIdx++;
      }
      continue;
    }

    if (st === 'key') {
      // Decode key characters until unescaped closing quote.
      const ch = buf[this._scanIdx];
      if (ch === undefined) return;
      if (this._escaped) {
        this._keyBuf += _jsonUnescapeChar(ch);
        this._escaped = false;
        this._scanIdx++;
      } else if (ch === '\\') {
        this._escaped = true;
        this._scanIdx++;
      } else if (ch === '"') {
        this._scanIdx++;
        this._state = 'afterKey';
      } else {
        this._keyBuf += ch;
        this._scanIdx++;
      }
      continue;
    }

    if (st === 'afterKey') {
      // Skip whitespace + colon.
      const ch = buf[this._scanIdx];
      if (ch === undefined) return;
      if (ch === ':' || /\s/.test(ch)) { this._scanIdx++; continue; }
      this._state = 'beforeValue';
      continue;
    }

    if (st === 'beforeValue') {
      // Decide: watched string field, unwatched string field, or non-string value.
      const ch = buf[this._scanIdx];
      if (ch === undefined) return;
      if (/\s/.test(ch)) { this._scanIdx++; continue; }
      if (ch === '"') {
        this._scanIdx++;
        if (this._watched.has(this._keyBuf)) {
          this._currentField = this._keyBuf;
          this._state = 'value-string';
          this._escaped = false;
        } else {
          // Skip a non-watched string value.
          this._state = 'value-skip';
          this._depth = 0;
          this._inString = true;
          this._escaped = false;
        }
      } else {
        // Non-string value (array, object, number, bool, null). Skip it entirely.
        this._state = 'value-skip';
        this._depth = 0;
        this._inString = false;
        this._escaped = false;
        // Do NOT advance — let value-skip process this char.
      }
      continue;
    }

    if (st === 'value-string') {
      // Watched field: emit decoded characters as we go. Terminates on unescaped ".
      const ch = buf[this._scanIdx];
      if (ch === undefined) return;
      if (this._escaped) {
        this._emit(this._currentField, _jsonUnescapeChar(ch));
        this._escaped = false;
        this._scanIdx++;
      } else if (ch === '\\') {
        // Need the next char to know what to emit; wait if we don't have it.
        if (this._scanIdx + 1 >= n) return;
        this._escaped = true;
        this._scanIdx++;
      } else if (ch === '"') {
        this._scanIdx++;
        this._currentField = null;
        this._state = 'seek';
      } else {
        this._emit(this._currentField, ch);
        this._scanIdx++;
      }
      continue;
    }

    if (st === 'value-skip') {
      // Consume a value we don't care about (string, array, object, primitive).
      const ch = buf[this._scanIdx];
      if (ch === undefined) return;

      if (this._inString) {
        if (this._escaped) { this._escaped = false; this._scanIdx++; continue; }
        if (ch === '\\')  { this._escaped = true; this._scanIdx++; continue; }
        if (ch === '"')   {
          this._inString = false;
          this._scanIdx++;
          if (this._depth === 0) { this._state = 'seek'; }
          continue;
        }
        this._scanIdx++;
        continue;
      }
      if (ch === '"') { this._inString = true; this._scanIdx++; continue; }
      if (ch === '{' || ch === '[') { this._depth++; this._scanIdx++; continue; }
      if (ch === '}' || ch === ']') {
        if (this._depth === 0) {
          // End of outer object or end of the value itself at depth 0 — either way,
          // let the outer 'seek' state take over. Don't consume the '}' here; seek
          // will skip past it.
          this._state = 'seek';
          continue;
        }
        this._depth--;
        this._scanIdx++;
        if (this._depth === 0) this._state = 'seek';
        continue;
      }
      if (ch === ',' && this._depth === 0) {
        this._state = 'seek';
        continue;
      }
      // Any primitive char (numbers, true/false/null, whitespace) — consume.
      this._scanIdx++;
      continue;
    }

    // Fallback: advance to avoid an infinite loop if we ever end up here.
    this._scanIdx++;
  }
};

function _jsonUnescapeChar(ch) {
  switch (ch) {
    case 'n': return '\n';
    case 't': return '\t';
    case 'r': return '\r';
    case 'b': return '\b';
    case 'f': return '\f';
    case '"': return '"';
    case '\\': return '\\';
    case '/': return '/';
    // \uXXXX isn't perfectly supported here (we'd need to see 4 more chars).
    // That's OK for live preview; the final strict JSON.parse handles it.
    default:  return ch;
  }
}
