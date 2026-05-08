# CLAUDE_README.md
# AI Context Document — Encyclopedia of Many Things
# For AI assistant use only. Human readme is README.md.

## PROJECT SUMMARY
Local-first worldbuilding wiki for "Phodd Communications". Vanilla HTML/CSS/JS,
no frameworks. Runs via `python -m http.server 8000`, uses File System Access API
(Chrome/Edge/Arc) to read/write real JSON files; falls back to localStorage.
Also deployed on GitHub Pages as a read-only public view.

## TECH CONSTRAINTS — CRITICAL
- NO React, Vue, or build tools. Pure vanilla JS only.
- NO npm packages. CDN only (Quill.js for editor, Google Fonts).
- Single CSS file: css/main.css. Page-specific overrides in <style> blocks.
- Shared JS modules: js/db.js (data), js/calendar.js (dates), js/ui.js (shell).
- Every page loads all three JS files. No ES modules, no import/export.
- Global helpers available everywhere: escHtml(), mkId(), all CALENDARS constants,
  dateToDays(), ceToDisplay(), formatDate(), calendarToCE().

## FILE MAP & LINE COUNTS (approximate, update after major rewrites)
  article.html          ~430  Article viewer. Renders wikilinks, wikibox, TOC.
                              Broken wikilinks open a choice modal (Manual vs AI-generate)
                              plus the AI-generation modal (title/guidance/template/related).
                              Modal now shows live streaming preview + context chips.
  editor.html           ~915  Article editor. Quill.js WYSIWYG, custom cat dropdown,
                              wikibox builder with contenteditable rich-text fields.
                              AI & Summary panel + draftKey hydration + auto-refresh on save.
                              Regenerate modal streams live into a preview pane.
  manager.html          343   Article + category manager. Drag-drop tree, wikibox templates.
  index.html             93   Homepage. Stats, recent articles, cat list.
  timeline.html         992   Timeline viewer. FULL PAGE (not a scroll box). Fixed
                              toolbar, detail panel, minimap, nav bar — all viewport-fixed.
  timeline-manager.html 300   Timeline/era/event-category manager. Importance color settings.
  article-templates.html 206  CRUD manager for data/article-templates.json. Each template:
                              name, optional wikiboxTemplateId, articlePrompt, sectionOutline,
                              defaultTags.
  data.html             ~325  Export/import/clear + AI (Infinite Wiki) settings + Re-index All.
                              Now includes a "Stream article generation" toggle.
  help.html             100   Usage guide.
  css/main.css          ~730  All shared styles + timeline + color picker + AI modals/panel
                              + streaming preview + context chips + header AI-busy indicator.
  js/db.js              ~340  DB object. Two backends: FileSystem API + localStorage.
                              Key methods: DB.init(), DB.save(articleId?), DB.exportAll(),
                              DB.deleteArticleFile(id), DB.clearAll().
                              Also loads/saves data/article-templates.json into DB.articleTemplates.
  js/ai.js              ~925  AI helper for Infinite Wiki. AI.isConfigured(), AI.getConfig(),
                              AI.saveConfig(), AI.chat(), AI.chatStream(), AI.embed(),
                              AI.cosine(), AI.generateSummary(), AI.generateEmbedding(),
                              AI.reindexAll(), AI.gatherContext(), AI.generateArticle(),
                              AI.generateArticleStreaming(). API key is stored ONLY
                              in localStorage ('eomt_ai_key') — never in settings.json or exports.
  js/calendar.js         46   ceToDisplay(), ceToCalendar(), calendarToCE(), formatDate(),
                              dateToDays(). CALENDARS object with all 5 calendars.
  js/ui.js              ~325  UI.init(), UI.renderSidebar(), UI.showModal(), UI.closeModal(),
                              UI.toast(), UI.handleFolderClick(). Injects header+sidebar+modal.
                              Sidebar now includes an "Article Templates" nav item.
                              Also UI.aiBusyBegin/End/Update — refcounted global AI spinner
                              in the header (visible whenever any AI work is in flight).
  article.html          ~200  Article viewer. Renders wikilinks, wikibox, TOC.
                              Wikilink syntax: [[Article Name]] or [[Article Name|display text]]
  editor.html           ~650  Article editor. Quill.js WYSIWYG, custom cat dropdown,
                              wikibox builder with contenteditable rich-text fields,
                              drag-to-reorder wikibox fields.
  manager.html          ~390  Article + category manager. Drag-drop tree, wikibox templates
                              (templates support sections + fields with drag reorder).
  index.html            ~110  Homepage. Stats, recent articles, cat list.
  timeline.html        ~1080  Timeline viewer. FULL PAGE (not a scroll box). Fixed
                              toolbar, detail panel, minimap, nav bar — all viewport-fixed.
                              5-column event layout, embedded icon cards, color picker.
  timeline-manager.html ~340  Timeline/era/event-category manager. Importance color
                              settings with color picker. Category default event colors.
  data.html             ~130  Export/import/clear. Read-only notice on GitHub Pages.
  help.html             ~115  Usage guide.
  css/main.css          ~620  All shared styles + timeline styles + color picker styles.
  js/db.js              ~390  DB object. THREE backends: FileSystem API + localStorage
                              + static fetch (GitHub Pages). Key methods: DB.init(),
                              DB.save(articleId?), DB.exportAll(), DB.deleteArticleFile(id),
                              DB.clearAll(). Getters: DB.isConnected, DB.isReadOnly,
                              DB.isStatic, DB.folderName.
  js/calendar.js         ~52  ceToDisplay(), ceToCalendar(), calendarToCE(), formatDate(),
                              dateToDays(). CALENDARS object with all 5 calendars.
  js/ui.js              ~320  UI.init(), UI.renderSidebar(), UI.showModal(), UI.closeModal(),
                              UI.toast(), UI.handleFolderClick(). Injects header+sidebar+modal.
                              Header hides edit controls and shows "Read Only" badge when
                              DB.isReadOnly is true.

## DATA SCHEMA
All files in data/ directory. Connected via File System Access API locally,
fetched via fetch() on GitHub Pages.

settings.json:     { homeDesc, activeCalendar, importanceColors:{imp:hexcolor} }
categories.json:   [{id, name, parentId, collapsed}]  — unlimited nesting
timelines.json:    [{id, name, description, startYear, endYear}]  — CE integers
events.json:       [{id, title, year, month, day, yearEnd, monthEnd, dayEnd,
                     importance, eventCategoryId, timelineIds[], articleId,
                     description, tlColumn(1-5), customColor(hex|null)}]
eras.json:         [{id, name, startYear, endYear, color, timelineId,
                     customCalAbbrev, customCalOffset, hasYearZero, countsBackward}]
timeline-categories.json: [{id, name, color, defaultColor}]
wikibox-templates.json:   [{id, name, fields:[{type:'field'|'section', key}]}]
articles/index.json:      [array of article IDs] — REQUIRED for GitHub Pages static mode
articles/art_ID.json:     {id, title, content(HTML), categoryId, tags[],
                            wikibox:{enabled, title, subtitle, image(b64 or path),
                            imagePath(bool), imgCaption, fields:[{type, key, val(HTML)}]},
                            created, updated,
                            summary?, embedding?: number[], embeddingModel?,
                            aiSourceSpec?: {title, guidance, templateId, relatedIds[]}}]
article-templates.json:   [{id, name, wikiboxTemplateId?, articlePrompt,
                            sectionOutline: string[], defaultTags: string[]}]
settings.ai (in settings.json):
                          { enabled, baseUrl, chatModel, embeddingModel,
                            temperature, maxTokens, autoRefreshOnSave, topK,
                            streaming }
                          — apiKey is NEVER stored here. It lives in
                            localStorage under the key 'eomt_ai_key'.
                          — streaming (default true) toggles SSE token streaming
                            on /chat/completions. Disable for servers that don't
                            support stream:true; AI.chatStream falls back to a
                            plain AI.chat call transparently when needed.

## CALENDAR SYSTEM
All dates stored as CE integers. Display is cosmetic conversion only.
  hcc:  CE/BCE,   offset 0
  brf:  PRF/BRF,  offset -1335
  cyp:  CYP/BLB,  offset -1325   <- currently active calendar
  et:   ET/BET,   offset -1707
  sa:   SA/BA,    offset +68870
Formula: displayYear = ceYear + offset  (negative = negEra, positive = posEra)
calendarToCE(yearNum, eraString, calKey) converts back to CE.

Era custom calendars: customCalOffset = the CE year that equals year 1.
  Forwards (default): year = ceYear - offset (+ 1 if no year zero)
  Backwards (countsBackward=true): year = offset - ceYear (+ 1 if no year zero)
  Default offset: era.startYear (forwards) or era.endYear (backwards)

## DB READ-ONLY / STATIC MODE
DB.isReadOnly — true when hostname is not localhost/127.0.0.1 (i.e. GitHub Pages).
DB._mode values: 'filesystem' | 'localStorage' | 'static'

Static mode behaviour:
  - Triggered automatically on non-local hostnames in DB.init()
  - Fetches all JSON files via fetch() relative to current path
  - Reads articles/index.json to discover article IDs, then fetches each individually
  - DB.save() is a NO-OP — never call save() expecting it to persist on Pages
  - articles/index.json is auto-written by _saveToFilesystem() on every local save

Pages that REDIRECT to index.html when read-only:
  editor.html, manager.html, timeline-manager.html

Pages that HIDE edit controls when read-only:
  article.html  — hides #article-edit-actions (Edit + Delete buttons)
  index.html    — replaces editable textarea with plain <p>, hides folder prompt
  timeline.html — hides #tl-edit-btns (Edit, + Era, + Event buttons)
  data.html     — shows read-only notice, hides elements with class .ro-hide

## TIMELINE PAGE ARCHITECTURE (timeline.html) — MOST COMPLEX PAGE
Full-page layout. Track is in normal document flow; browser scrolls natively.
Fixed viewport elements respect header (--header-h: 56px) and sidebar (--sidebar-w: 264px).

CSS variables:
  --tl-toolbar-h: 52px   --tl-nav-h: 48px
  --tl-detail-w: 280px   --tl-toggle-w: 22px   --tl-mini-w: 64px
  --tl-top: calc(56px + 52px) = 108px from top of viewport

Fixed elements:
  #tl-toolbar:       fixed, top:56px,  left:264px, right:0,    h:52px
  #tl-detail-panel:  fixed, top:108px, left:264px, w:280px,    bottom:48px
                     Collapsed: opacity:0, visibility:hidden (NEVER moves left — would cover sidebar)
  #tl-panel-toggle:  fixed, left:544px open / left:264px collapsed, z-index:73
  #tl-minimap:       fixed, top:108px, right:0,    w:64px,     bottom:48px
  #tl-nav-bar:       fixed, bottom:0,  left:264px, right:0,    h:48px

Track margins:
  #tl-track-outer: margin-left:302px (open), margin-right:64px
  Collapsed: margin-left:22px

5-COLUMN EVENT LAYOUT:
  Track divided into 5 zones of 20% (.tl-zone-1 through .tl-zone-5).
  ev.tlColumn (1-5, default 3). Zone wrapper is position:absolute;
  card fills wrapper with width:100%. Icon embedded in card, no connector lines.
  Col 1,2 = left (spine-side accent border on right)
  Col 3   = center on spine (accent border on top, centered)
  Col 4,5 = right (spine-side accent border on left)

Event color hierarchy: ev.customColor -> category.defaultColor -> importanceColor[imp]
resolveEvColor(ev) implements this. Used for icon, card border, duration line.

Duration lines: left = column center % (10/30/50/70/90%), colored by resolveEvColor(ev).

Key JS state/functions in timeline.html:
  _bd                  — {minD, span, totalH, PAD} cached from last renderTL()
  resolveEvColor(ev)   — color hierarchy lookup
  customEraYear(ce, era) — handles forwards/backwards/yearZero
  renderTL()           — full track rebuild
  selectEv(id)         — highlight card + populate detail panel
  navEvent(dir)        — scroll to prev/next event
  updateNavYear()      — update center-year display from scroll position
  openEventModal(id)   — column slider, custom color picker, start+end dates
  openEraModal(id)     — color picker, BCE support, custom calendar toggles
  openColorPicker(anchor, color, cb) — reusable hex+RGB popover

## INFINITE WIKI (AI) ARCHITECTURE
Everything sits behind DB (data) and AI (js/ai.js). Load order on every page is:
  db.js → calendar.js → ui.js → ai.js
so pages can freely reference AI.* once DB.init() has run.

Article generation flow (streaming):
  1. User clicks a broken [[Wikilink]] in article.html.
  2. processWikilinks() renders broken links as <a class="broken-link" data-broken-name="…"
     href="#">. A delegated click handler in article.html catches these and calls
     openBrokenLinkChoice(name).
  3. Choice modal offers Manual (→ editor.html?id=new&title=…) or AI (→ openAIGenerateModal).
     The AI button is disabled when !AI.isConfigured().
  4. AI modal collects {title, guidance, templateId, relatedIds[]} and calls
     AI.generateArticleStreaming() with callbacks. It shows the phases live:
       • onContextReady  → renders two chip rows (#aig-context): "Explicitly referenced"
         (solid accent chips) and "Auto-retrieved" (outlined chips with cosine-similarity
         percentages in the tooltip). Each chip's title attribute is the article summary.
       • onTitle/onSummary → populate the stream header + summary strip.
       • onContentDelta   → appends to the #aig-stream-preview pane as it arrives, with
         a blinking caret (.ai-stream-preview.active) and a character counter. The form
         gets the .ai-streaming class which widens the modal to 760px.
     On completion the final normalized draft is stashed under a random sessionStorage
     key 'eomt_ai_draft_XXX' and the editor is opened at editor.html?id=new&draftKey=XXX.
  5. The editor hydrates from sessionStorage (and sessionStorage.removeItem's the key) so
     a refresh doesn't re-inject an already-used draft. The "AI & Summary" panel shows
     an "AI-generated" banner with a Regenerate… button that opens a compact streaming
     modal inside the editor (openRegenerateAIModal → AI.generateArticleStreaming →
     overwrite editor state on completion).
  6. On save, if settings.ai.enabled && autoRefreshOnSave && AI.isEmbeddingConfigured(),
     _backgroundRefreshAI() regenerates summary (only if blank) + embedding and writes the
     article file again. The header AI-busy indicator stays visible during this background
     work. Navigation waits for the background refresh to finish.

Streaming primitives (js/ai.js):
  - AI.chatStream(messages, opts, onChunk) — POSTs /chat/completions with stream:true,
    reads the SSE response via fetch().body.getReader(), parses `data: {…}` frames, and
    invokes onChunk(delta, accumulated) for each content fragment. Falls back to plain
    AI.chat() transparently if the server rejects the stream flag or the body is not a
    ReadableStream. Handles the '[DONE]' sentinel and tolerates keepalive/comment frames.
  - _ProgressiveJsonExtractor — small hand-written state machine that ingests the raw
    streamed JSON text and emits field-level deltas for the three watched fields (title,
    summary, contentHTML). Skips non-watched values (arrays, nested objects, unknown
    strings) using a depth counter and an in-string flag. Resolves \" \\ \n \t \r \b \f
    and \/ escapes inline so the live preview is immediately renderable. The final
    strict JSON.parse() still runs on the full accumulated reply to build the draft.
  - AI.generateArticleStreaming(spec, callbacks) — orchestrates context-gather →
    streamed chat → progressive-extractor → final _extractJsonObject + _normalizeArticleDraft.
    Callbacks: onPhase, onContextReady, onRawDelta, onTitle, onSummary, onContentDelta,
    onComplete, onError. Honours settings.ai.streaming (default true) — when disabled it
    does a single AI.chat() call and fires onContentDelta once with the full result.
  - AI.generateArticle(spec) is now a thin back-compat wrapper that calls
    generateArticleStreaming with empty callbacks and returns the draft.

Context gathering (AI.gatherContext in js/ai.js):
  - Explicit: user-selected related article IDs — their summaries/snippets are included verbatim.
  - Semantic: when the embedding endpoint is configured, AI.embed the query (title + guidance),
    cosine-search against article.embedding vectors of matching dimension, take top K.
  - Lexical fallback: articles without embeddings get a simple title/tags/summary keyword match.
  - Top K comes from settings.ai.topK (default 5).
  - onContextReady payload includes per-item { id, title, summary, snippet, score? } so the
    modal can show summaries as chip tooltips and cosine scores on auto-retrieved chips.

Global AI-busy indicator (js/ui.js):
  - UI.aiBusyBegin(label) → returns an id. Reference-counted; multiple concurrent
    operations share one visible indicator in the header (.ai-busy-indicator).
  - UI.aiBusyUpdate(id, label) — change the label (e.g. mid-phase "Streaming article…").
  - UI.aiBusyEnd(id) — decrement. Indicator hides when count hits 0.
  - Wired into: the article-page generate flow, the editor regenerate flow + summary
    regenerate + _backgroundRefreshAI, the ai-page testAIConnection + re-index loop.

Prompt contract (AI.generateArticle / AI.generateArticleStreaming):
  The chat model must return a single JSON object:
    { title, summary, contentHTML, tags: string[],
      wikibox: null | { enabled, title, subtitle, imgCaption,
                        fields: [{type:'field'|'section', key, val}] } }
  - contentHTML uses [[wikilink]] syntax (not <a> tags) — article.html's processWikilinks
    handles resolution at render time.
  - Do not emit the article title as <h1> at the top (viewer shows it separately).
  - We ask for response_format: {type:'json_object'} and retry without it if the server
    rejects that field. _extractJsonObject() strips code fences and tolerates a little extra
    prose around the JSON.

Re-index (ai.html → "Re-index All Articles…"):
  Iterates DB.articles, per-article: AI.generateSummary → AI.generateEmbedding → DB.save(id).
  Writes one file at a time so partial runs are safe. Has a Stop button.

Editable prompts (ai.html → Prompts section):
  - AI.DEFAULT_PROMPTS holds the seven built-in prompt strings:
    articleSystem, articleUserPreamble, articleGuidanceLabel,
    summarySystem, summaryUserTemplate, testSystem, testUser.
  - User overrides live in DB.settings.ai.prompts (partial — any missing key
    falls back to default). AI.getPrompt(key, vars?) is the single read path
    and handles {placeholder} substitution ({title}, {content}).
  - AI.saveConfig({ prompts: {...} }) strips any entry equal to default or
    empty so settings.json stays minimal, and removes the prompts key entirely
    when the map is empty.
  - Call sites that read prompts: AI.generateSummary, AI.testConnection,
    _buildArticlePromptMessages (the article generator's system + preamble +
    guidance label — template/wikibox/context injections remain code-driven).

Security note (repeat, because it matters):
  - localStorage key 'eomt_ai_key' holds the API key.
  - DB._ensureDefaults() and DB.exportAll() both scrub settings.ai.apiKey defensively.
  - The "Clear API Key" button in data.html is the only way to remove it.

## KNOWN ISSUES / RECENT HISTORY
- Timeline page underwent major architectural rewrite (full-page layout, fixed panels).
  The nav bar, minimap, and detail panel positions were the main focus.
- Wikibox section collapse bug was fixed (was checking sectionIdx > 0, now uses currentSectionId).
- Article viewer had a critical JS parse error from a dropped `function buildTOC(` declaration —
  watch for this pattern if inserting functions near others.
- Category dropdown in editor uses custom div-based tree (not a <select>) to support collapsing.
- Wikibox field values are contenteditable divs with execCommand formatting (bold/italic/underline)
  and a floating mini-toolbar. Shift+Enter inserts <br>.
- Infinite Wiki (AI generation of broken wikilinks) added 2026-xx: vanilla fetch to any
  OpenAI-compatible endpoint; apiKey lives only in localStorage.
- Streaming + live context chips + global busy indicator added shortly after: token-level
  SSE streaming via AI.chatStream, progressive JSON field extraction for the live preview,
  context chips shown as soon as gatherContext returns, and a refcounted header spinner so
  background AI work is never silent. Settings toggle `streaming` lets users opt out for
  non-streaming servers; AI.chatStream has an automatic fallback path for that case too.

## EDITING CONVENTIONS
- Always use str_replace for targeted edits. Full rewrites only when >60% of file changes.
- Read the specific section before editing — never rely on memory of file content.
- After any str_replace, previous view output is stale. Re-view before further edits.
- CSS: main.css for shared styles, <style> blocks in HTML for page-specific overrides.
- escHtml() and mkId() are globals defined in ui.js and db.js respectively.
- Modal body is #modal-body. Checkboxes inside modals: `#modal-body input[type=checkbox]`.
- DB.save(articleId) writes one article file. DB.save() writes everything.
- Always check DB.isReadOnly before adding any edit UI element.

## SESSION WORKFLOW
1. User uploads encyclopedia.zip
2. Run: unzip -o /mnt/user-data/uploads/encyclopedia.zip -d /home/claude/
3. Scrub images: find /home/claude/encyclopedia/data/images -type f ! -name "*.md" -delete
4. Make targeted edits with str_replace where possible
5. If articles were added/removed outside the app, regenerate index.json:
   python3 -c "import os,json; ids=[f[:-5] for f in os.listdir('encyclopedia/data/articles') if f.endswith('.json') and f!='index.json']; open('encyclopedia/data/articles/index.json','w').write(json.dumps(ids,indent=2))"
6. Package: cd /home/claude && zip -r encyclopedia.zip encyclopedia/ -x "*.DS_Store"
            cp encyclopedia.zip /mnt/user-data/outputs/encyclopedia.zip
7. present_files tool to deliver
