# CLAUDE_README.md
# AI Context Document — Encyclopedia of Many Things
# For AI assistant use only. Human readme is README.md.

## PROJECT SUMMARY
Local-first worldbuilding wiki for "Phodd Communications". Vanilla HTML/CSS/JS,
no frameworks. Runs via `python -m http.server 8000`, uses File System Access API
(Chrome/Edge/Arc) to read/write real JSON files; falls back to localStorage.

## TECH CONSTRAINTS — CRITICAL
- NO React, Vue, or build tools. Pure vanilla JS only.
- NO npm packages. CDN only (Quill.js for editor, Google Fonts).
- Single CSS file: css/main.css. Page-specific overrides in <style> blocks.
- Shared JS modules: js/db.js (data), js/calendar.js (dates), js/ui.js (shell).
- Every page loads all three JS files. No ES modules, no import/export.
- Global helpers available everywhere: escHtml(), mkId(), all CALENDARS constants,
  dateToDays(), ceToDisplay(), formatDate(), calendarToCE().

## FILE MAP & LINE COUNTS (approximate, update after major rewrites)
  article.html          ~300  Article viewer. Renders wikilinks, wikibox, TOC.
                              Broken wikilinks open a choice modal (Manual vs AI-generate)
                              plus the AI-generation modal (title/guidance/template/related).
  editor.html           ~870  Article editor. Quill.js WYSIWYG, custom cat dropdown,
                              wikibox builder with contenteditable rich-text fields.
                              AI & Summary panel + draftKey hydration + auto-refresh on save.
  manager.html          381   Article + category manager. Drag-drop tree, wikibox templates.
  index.html            104   Homepage. Stats, recent articles, cat list.
  timeline.html         977   Timeline viewer. FULL PAGE (not a scroll box). Fixed
                              toolbar, detail panel, minimap, nav bar — all viewport-fixed.
  timeline-manager.html 315   Timeline/era/event-category manager. Importance color settings.
  article-templates.html ~170 CRUD manager for data/article-templates.json. Each template:
                              name, optional wikiboxTemplateId, articlePrompt, sectionOutline,
                              defaultTags.
  data.html             ~300  Export/import/clear + AI (Infinite Wiki) settings + Re-index All.
  help.html             110   Usage guide.
  css/main.css          ~670  All shared styles + timeline + color picker + AI modals/panel.
  js/db.js              ~370  DB object. Two backends: FileSystem API + localStorage.
                              Key methods: DB.init(), DB.save(articleId?), DB.exportAll(),
                              DB.deleteArticleFile(id), DB.clearAll().
                              Also loads/saves data/article-templates.json into DB.articleTemplates.
  js/ai.js              ~350  AI helper for Infinite Wiki. AI.isConfigured(), AI.getConfig(),
                              AI.saveConfig(), AI.chat(), AI.embed(), AI.cosine(),
                              AI.generateSummary(), AI.generateEmbedding(), AI.reindexAll(),
                              AI.gatherContext(), AI.generateArticle(). API key is stored ONLY
                              in localStorage ('eomt_ai_key') — never in settings.json or exports.
  js/calendar.js         52   ceToDisplay(), ceToCalendar(), calendarToCE(), formatDate(),
                              dateToDays(). CALENDARS object with all 5 calendars.
  js/ui.js              ~310  UI.init(), UI.renderSidebar(), UI.showModal(), UI.closeModal(),
                              UI.toast(), UI.handleFolderClick(). Injects header+sidebar+modal.
                              Sidebar now includes an "Article Templates" nav item.

## DATA SCHEMA
All files in data/ directory. Connected via File System Access API.

settings.json:     { homeDesc, activeCalendar, importanceColors:{imp:hexcolor} }
categories.json:   [{id, name, parentId, collapsed}]  — unlimited nesting
timelines.json:    [{id, name, description, startYear, endYear}]  — CE integers
events.json:       [{id, title, year, month, day, yearEnd, monthEnd, dayEnd,
                     importance, eventCategoryId, timelineIds[], articleId,
                     description}]
eras.json:         [{id, name, startYear, endYear, color, timelineId,
                     customCalAbbrev, customCalOffset}]
timeline-categories.json: [{id, name, color}]
wikibox-templates.json:   [{id, name, fields:[{type:'field'|'section', key}]}]
articles/art_ID.json:     [{id, title, content(HTML), categoryId, tags[],
                            wikibox:{enabled, title, subtitle, image(b64 or path),
                            imagePath(bool), imgCaption, fields:[{type, key, val(HTML)}]},
                            created, updated,
                            summary?, embedding?: number[], embeddingModel?,
                            aiSourceSpec?: {title, guidance, templateId, relatedIds[]}}]
article-templates.json:   [{id, name, wikiboxTemplateId?, articlePrompt,
                            sectionOutline: string[], defaultTags: string[]}]
settings.ai (in settings.json):
                          { enabled, baseUrl, chatModel, embeddingModel,
                            temperature, maxTokens, autoRefreshOnSave, topK }
                          — apiKey is NEVER stored here. It lives in
                            localStorage under the key 'eomt_ai_key'.

## CALENDAR SYSTEM
All dates stored as CE integers. Display is cosmetic conversion only.
  hcc:  CE/BCE,   offset 0
  brf:  PRF/BRF,  offset -1335
  cyp:  CYP/BLB,  offset -1325   ← currently active calendar
  et:   ET/BET,   offset -1707
  sa:   SA/BA,    offset +68870
Formula: displayYear = ceYear + offset  (negative = negEra, positive = posEra)
calendarToCE(yearNum, eraString, calKey) converts back to CE.

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
  #tl-panel-toggle:  fixed, top:108px, left:544px (or 264px collapsed), w:22px, bottom:48px
  #tl-minimap:       fixed, top:108px, right:0,    w:64px,     bottom:48px
  #tl-nav-bar:       fixed, bottom:0,  left:264px, right:0,    h:48px

Track margins (in #main, which already has margin-left:264px from sidebar):
  #tl-track-outer: margin-left: 302px (detail+toggle), margin-right: 64px
  When panel collapsed: margin-left: 22px

Spine: 8px wide grey base div full track height, then era-colored segments stacked on top.
Icons: position absolute, left:50%, transform:translate(-50%,-50%), centered ON spine.
Event rows: position absolute, transform:translateY(-50%), flex layout L/R halves.
Duration lines: position absolute, left:50%, transform:translateX(-50%), colored by era or importance.

Key JS functions in timeline.html:
  renderTL()           — main render, rebuilds entire track
  selectEv(id)         — selects event, updates detail panel + card highlights
  renderDetailPanel()  — populates left panel with full event info
  navEvent(dir)        — prev/next navigation using window.scrollY
  updateNavYear()      — reads scroll position, updates center-year display
  updateMmVP()         — updates minimap viewport indicator
  openEventModal(id)   — create/edit event modal
  openEraModal(id)     — create/edit era modal (includes color picker + BCE fix + custom cal)
  openColorPicker()    — reusable popover, hex+RGB inputs, swatch grid
  _bd                  — cached {minD, span, totalH, PAD} from last renderTL() call

## INFINITE WIKI (AI) ARCHITECTURE
Everything sits behind DB (data) and AI (js/ai.js). Load order on every page is:
  db.js → calendar.js → ui.js → ai.js
so pages can freely reference AI.* once DB.init() has run.

Article generation flow:
  1. User clicks a broken [[Wikilink]] in article.html.
  2. processWikilinks() now renders broken links as <a class="broken-link" data-broken-name="…"
     href="#">. A delegated click handler in article.html catches these and calls
     openBrokenLinkChoice(name).
  3. Choice modal offers Manual (→ editor.html?id=new&title=…) or AI (→ openAIGenerateModal).
     The AI button is disabled when !AI.isConfigured().
  4. AI modal collects {title, guidance, templateId, relatedIds[]}, calls AI.generateArticle(),
     validates the JSON, stashes a draft under a random sessionStorage key 'eomt_ai_draft_XXX',
     and navigates to editor.html?id=new&draftKey=XXX.
  5. The editor hydrates from sessionStorage (and sessionStorage.removeItem's the key) so a
     refresh doesn't re-inject an already-used draft. The "AI & Summary" panel shows an
     "AI-generated" banner with a Regenerate… button that opens a compact version of the
     same AI modal inside the editor.
  6. On save, if settings.ai.enabled && autoRefreshOnSave && AI.isEmbeddingConfigured(),
     _backgroundRefreshAI() regenerates summary (only if blank) + embedding and writes the
     article file again. Navigation waits for the background refresh to finish.

Context gathering (AI.gatherContext in js/ai.js):
  - Explicit: user-selected related article IDs — their summaries/snippets are included verbatim.
  - Semantic: when the embedding endpoint is configured, AI.embed the query (title + guidance),
    cosine-search against article.embedding vectors of matching dimension, take top K.
  - Lexical fallback: articles without embeddings get a simple title/tags/summary keyword match.
  - Top K comes from settings.ai.topK (default 5).

Prompt contract (AI.generateArticle):
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

Re-index (data.html → "Re-index All Articles…"):
  Iterates DB.articles, per-article: AI.generateSummary → AI.generateEmbedding → DB.save(id).
  Writes one file at a time so partial runs are safe. Has a Stop button.

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
  OpenAI-compatible endpoint; no streaming yet; apiKey lives only in localStorage.

## EDITING CONVENTIONS
- Always use str_replace for targeted edits. Full rewrites only when >60% of file changes.
- Read the specific section of a file before editing it — don't rely on memory.
- After any str_replace, previous view output for that file is stale.
- CSS lives in main.css for shared styles; page-specific overrides go in <style> in the HTML.
- JS helper functions (escHtml, mkId) are global — defined in db.js and ui.js respectively.
- Modal body is #modal-body (not #modal-content). Checkboxes inside modals are queried
  via `#modal-body input[type=checkbox]`.
- DB.save(articleId) — pass an article ID to write only that article file.
  DB.save() with no args writes everything including all articles.

## SESSION WORKFLOW
1. User uploads encyclopedia.zip
2. Run: unzip -o /mnt/user-data/uploads/encyclopedia.zip -d /home/claude/
3. Scrub images: find /home/claude/encyclopedia/data/images -type f ! -name "*.md" -delete
4. Make targeted edits with str_replace where possible
5. Package: cd /home/claude && zip -r encyclopedia.zip encyclopedia/ -x "*.DS_Store"
             cp encyclopedia.zip /mnt/user-data/outputs/encyclopedia.zip
6. present_files tool to deliver

## CURRENT WORLD DATA (as of last sync)
  19 articles, 45 categories, 1 timeline (Equestrian History), active calendar: CYP
