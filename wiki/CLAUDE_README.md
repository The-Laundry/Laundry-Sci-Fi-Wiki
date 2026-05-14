# CLAUDE_README.md
# AI Context Document — Encyclopedia of Many Things
# For AI assistant use only. Human readme is README.md.
# Optimization roadmap is in optimization-roadmap.md.

## PROJECT SUMMARY
Local-first worldbuilding wiki for "Phodd Communications". Vanilla HTML/CSS/JS,
no frameworks. Runs via `python -m http.server 8000`, uses File System Access API
(Chrome/Edge/Arc) to read/write real JSON files; falls back to localStorage.
Also deployed on GitHub Pages as a read-only public view.

## TECH CONSTRAINTS — CRITICAL
- NO React, Vue, or build tools. Pure vanilla JS only.
- NO npm packages. CDN only (Quill.js for editor, Google Fonts).
- Single CSS file: css/main.css. Page-specific overrides in <style> blocks.
- Shared JS modules: js/db.js, js/calendar.js, js/ui.js, js/ai.js.
- Every page loads db.js, calendar.js, ui.js. AI pages also load ai.js.
- No ES modules, no import/export. All objects (DB, UI, AI, CALENDARS) are global.
- Global helpers: escHtml(), mkId(), dateToDays(), ceToDisplay(), formatDate(), calendarToCE().

## FILE MAP & LINE COUNTS
  article.html            358  Article viewer. Wikilinks [[Name]] or [[Name|text]].
                               Backlinks panel — scans articleCache only (cached this session).
                               Uses DB.loadArticle(id) for full content.
  editor.html            1117  Article editor. Quill.js WYSIWYG, custom cat dropdown,
                               wikibox builder (contenteditable, stable _id drag-reorder),
                               article template picker. In-flight save guard (_articleSaving).
                               Uses DB.loadArticle(editingId) on load.
  manager.html            526  Article + category manager. Drag-drop tree. Wikibox
                               templates + article templates (sections + fields, drag-reorder).
                               Uses DB.articleMeta for display, updates both meta + cache.
  article-templates.html  231  Article template manager. Templates store: name,
                               categoryId, tags[], content(HTML), wikibox{...}.
                               Split-pane: list on left, editor on right.
  index.html              113  Homepage. Stats, recent articles, category list.
  search.html             604  Search page. Index-backed fast search + async content snippets.
                               Index built from articleMeta on load (no file reads).
                               Falls back to metadata scan if index not ready.
  timeline.html          1105  Timeline viewer. Full-page, fixed panels, 5-column layout.
                               Importance icons (SVG shapes), color picker, era custom calendars.
  timeline-manager.html   329  Timeline/era/event-category manager. Importance colors.
  ai.html                 508  AI settings. Uses DB.saveSettings().
  ai-generate.html       1457  AI Generator — tabbed interface:
                               • Article Generator: generate full article from prompt
                               • Semantic Search: embedding-based similarity search
                               • Content Expander: expand article sections with AI
                               • Article Linker: suggest wikilinks for an article
                               • Conlang: vocab gen, sentence translate, etymology
                               Iterates DB.articleMeta, loads via DB.loadArticle.
  languages.html               Languages manager + viewer + editor (split-pane).
                               Tabs: Overview / Phonology / Lexicon / Grammar /
                               Texts / Used In. Auto-saves on blur. Quill for
                               description and grammar. Honors DB.isReadOnly.
  data.html               141  Export/import/clear. Read-only notice on GitHub Pages.
  help.html               111  Usage guide.
  css/main.css            922  All shared styles. Dark mode via [data-theme="dark"].
  js/db.js                617  DB object. THREE backends + SCOPED SAVES + LAZY LOADING.
                               See SAVE SYSTEM and ARTICLE LOADING sections below.
                               Also manages languages (lightweight index + per-language files).
  js/calendar.js           52  Calendar conversions. CALENDARS object, 5 calendars.
  js/ui.js                521  Shell injection. Lazy sidebar tree. Theme from localStorage.
                               Header search uses DB.articleMeta only.
                               Nav includes Search, AI, Article Templates, Languages links.
  js/ai.js               1612  AI helper module. OpenAI-compatible API.
                               AI.chat(), AI.chatStream(), AI.embed(), AI.cosine(),
                               AI.generateSummary(), AI.generateEmbedding(),
                               AI.reindexAll() (uses DB.loadArticle per article).
                               API key stored only in localStorage ('eomt_ai_key'),
                               never in settings.json.
  js/conlang.js                Conlang helpers. Conlang.findLanguage(name),
                               Conlang.findEntry(lang, word), getDescendants/Ancestors,
                               findBacklinks(lang), parseHtml(html) (string),
                               applyToElement(root) (text-node walker, never
                               touches existing wikilink anchors), CSV import/export.
                               Used by languages.html, article.html, ai-generate.html.

## SAVE SYSTEM (Phase 1 — complete)
ALWAYS use scoped saves. Never call DB.save() without an article ID except for
the one intentional exception: article delete (handled by DB.deleteArticleFile).

Scoped save methods in db.js:
  DB.save(articleId)          — writes one article file + updates index.json metadata
  DB.saveSettings()           — writes settings.json only
  DB.saveCategories()         — writes categories.json only
  DB.saveTimelines()          — writes timelines.json only
  DB.saveEvents()             — writes events.json only
  DB.saveEras()               — writes eras.json only
  DB.saveTimelineCategories() — writes timeline-categories.json only
  DB.saveWikiboxTemplates()   — writes wikibox-templates.json only
  DB.saveArticleTemplates()   — writes article-templates.json only
  DB.save() (no arg)          — writes EVERYTHING. AVOID. Only in: importAll, clearAll.

Call site reference:
  Category CRUD              → DB.saveCategories()
  Timeline CRUD              → DB.saveTimelines()
  Event CRUD                 → DB.saveEvents()
  Era CRUD                   → DB.saveEras()
  Event category CRUD        → DB.saveTimelineCategories()
  Importance colors          → DB.saveSettings()
  Wikibox templates          → DB.saveWikiboxTemplates()
  Article templates          → DB.saveArticleTemplates()
  Homepage description       → DB.saveSettings()
  Calendar selection         → DB.saveSettings()
  AI config                  → DB.saveSettings()
  Article save/create        → DB.save(articleId)
  Article delete             → DB.deleteArticleFile(id) — handles everything including index.json
  Theme toggle               → localStorage only, NO disk write
  Category collapse toggle   → localStorage only, NO disk write

## ARTICLE LOADING SYSTEM (Phase 2 — complete)
Two-layer architecture. DB.articles is a backward-compat getter → returns articleMeta.

  DB.articleMeta[]     Always loaded at init. Lightweight: {id, title, categoryId,
                       tags, summary, updated, hasImage}. Source: articles/index.json.
  DB.articleCache{}    Full articles keyed by id. Populated on demand via loadArticle().
                       Never persisted — session only.
  DB.articles          Getter returning articleMeta. Setter updates articleMeta.
                       All metadata reads (title, category, tags) work unchanged.
  DB.loadArticle(id)   async. Checks cache → reads file → caches result → returns.
                       Use for any page needing content, wikibox.fields, or embedding.
  DB._extractMeta(art) Returns lightweight metadata object from a full article.

When to use what:
  Metadata reads (display, lists, search, sidebar) → DB.articleMeta or DB.articles getter
  Full content needed (viewer, editor, AI, backlinks content) → await DB.loadArticle(id)
  Write/update article → update DB.articleCache[id], then DB.save(id)
  New article → add to DB.articleCache[id] + DB.articleMeta, then DB.save(id)

articles/index.json format (NEW — metadata objects, not just IDs):
  [{id, title, categoryId, tags[], summary, updated, hasImage}, ...]
  Written by DB.save(articleId) on every save.
  DB.deleteArticleFile(id) also updates it.
  Auto-migrates from old [id, id...] format on first load with new code.

Regenerate manually if needed:
  python3 << 'EOF'
  import os, json
  arts_dir = 'encyclopedia/data/articles'
  metas = []
  for fn in sorted(os.listdir(arts_dir)):
      if not fn.endswith('.json') or fn in ('index.json', 'undefined.json'): continue
      a = json.load(open(os.path.join(arts_dir, fn)))
      metas.append({'id':a.get('id',fn[:-5]),'title':a.get('title',''),
        'categoryId':a.get('categoryId'),'tags':a.get('tags',[]),
        'summary':a.get('summary',''),'updated':a.get('updated',0),
        'hasImage':bool(a.get('wikibox',{}).get('image'))})
  json.dump(metas, open(os.path.join(arts_dir,'index.json'),'w'), indent=2)
  print(f'{len(metas)} entries written')
  EOF

## SIDEBAR (Phase 3 — complete)
Lazy expansion: children not built until first expand click.
Collapsed by default (DB.getCatCollapsed returns true if id absent from localStorage).
Each category header shows name + article count hint.
Children built once on first expand, reused on subsequent toggle.
Stable alphabetical sort at every level.

Category collapse state:
  DB.getCatCollapsed(id)          → true if collapsed (default)
  DB.setCatCollapsed(id, bool)    → writes localStorage('eomt_cat_open')
  Format: {catId: true} for OPEN categories only. Absent = collapsed.

## SEARCH INDEX (Phase 4 — complete)
Built asynchronously in search.html after page load. No blocking.
Source: DB.articleMeta (titles, tags, summary) + DB.events (title, description).
Structure: Map<token, Map<id, score>>
  Article tokens: title (×3), tags (×2), summary (×1)
  Event tokens:   prefixed 'ev:' — title (×3), description (×1)
Stop words removed. HTML stripped. Prefix matching (partial words work).
Multi-word: intersect result sets, sum scores.

Search flow:
  1. Index lookup → results with metadata + summary snippet (immediate)
  2. loadSnippetsAsync() → loads matching article files, updates snippets in place
  3. Aborts async loading if query changes before completion
  Fallback if index not ready: metadata scan (title + tags only)

Header search (ui.js): metadata only, title + tags, no file reads.

## DARK MODE / THEME
Theme stored in localStorage('eomt_theme') ONLY.
DB.settings.theme may exist in old data but is only a fallback, never written.
UI._applyTheme() reads localStorage first. UI.toggleTheme() writes localStorage only.
CSS: [data-theme="dark"] block in main.css overrides all :root CSS variables.
ALWAYS use CSS variables for colors — never hardcode rgba/hex values.

## IN-FLIGHT SAVE GUARDS
  editor.html:      _articleSaving boolean, button disabled during save
  timeline.html:    btn._saving flag on event + era modal save buttons

## WIKIBOX SYSTEM
Stable runtime _id per field (e.g. 'wb_a3f9k2'). Assigned on load, stripped before save.
DOM uses data-wbid — never numeric indices. Reads/writes by _id lookup.
contenteditable value editors: .wb-value-editor[data-wbid="..."]
Mini-toolbar (B/I/U/↵) appears on text selection via selectionchange.
Drag-reorder: flushes active editor synchronously before splice, uses _id for lookups.
collectWbFields() — flushes active editor + strips _id before save.
>>>>>>> main

## DATA SCHEMA
settings.json:     { homeDesc, activeCalendar, importanceColors:{imp:hex},
                     ai:{ enabled, baseUrl, chatModel, embeddingModel,
                          temperature, maxTokens, autoRefreshOnSave, topK } }
                   NOTE: apiKey NEVER in settings.json (localStorage 'eomt_ai_key' only).
                         theme NEVER in settings.json (localStorage 'eomt_theme' only).
categories.json:   [{id, name, parentId}]  — 'collapsed' field ignored if present
timelines.json:    [{id, name, description, startYear, endYear}]
events.json:       [{id, title, year, month, day, yearEnd, monthEnd, dayEnd,
                     importance, eventCategoryId, timelineIds[], articleId,
                     description, tlColumn(1-5), customColor(hex|null)}]
eras.json:         [{id, name, startYear, endYear, color, timelineId,
                     customCalAbbrev, customCalOffset, hasYearZero, countsBackward}]
timeline-categories.json: [{id, name, color, defaultColor}]
wikibox-templates.json:   [{id, name, fields:[{type:'field'|'section', key}]}]
article-templates.json:   [{id, name, categoryId, tags[], content(HTML),
                             wikibox:{enabled,title,subtitle,image,fields[]}}]
articles/index.json:      [{id,title,categoryId,tags[],summary,updated,hasImage}]
                           REQUIRED for GitHub Pages. Written on every article save.
languages.json:           lightweight summary array — auto-regenerated on save:
                          [{id, name, nativeName, status, parentId, articleId,
                            wordCount, updated}]
languages/index.json:     [array of language IDs] — REQUIRED for GitHub Pages
languages/lang_ID.json:   {id, name, nativeName, romanization, status,
                            parentId, articleId, speakerArticleIds[],
                            description(HTML), writingSystem{name,notes,sampleImage},
                            phonology{consonants[],vowels[],notes},
                            grammar(HTML),
                            lexicon[{id,word,romanization,ipa,partOfSpeech,
                                     definitions[],etymology,notes,tags[],examples[]}],
                            sampleTexts[{id,title,text,translation,gloss}],
                            created, updated}
articles/art_ID.json:     {id, title, content(HTML), categoryId, tags[],
                            wikibox:{enabled,title,subtitle,image,imagePath,imgCaption,
                            fields:[{type,key,val(HTML)}]}, created, updated,
                            summary?(str), embedding?(number[]), embeddingModel?(str)}

## CALENDAR SYSTEM
All dates stored as CE integers. Display is cosmetic conversion only.
  hcc:  CE/BCE,   offset 0
  brf:  PRF/BRF,  offset -1335
  cyp:  CYP/BLB,  offset -1325
  et:   ET/BET,   offset -1707
  sa:   SA/BA,    offset +68870
Formula: displayYear = ceYear + offset (negative = negEra, positive = posEra)
calendarToCE(yearNum, eraString, calKey) converts back to CE.
Era custom calendars: customCalOffset = CE year that equals year 1.
  Forwards: year = ceYear - offset (+ 1 if no year zero)
  Backwards (countsBackward=true): year = offset - ceYear (+ 1 if no year zero)
  Default offset: era.startYear (forwards) or era.endYear (backwards)

## TIMELINE PAGE ARCHITECTURE
Full-page layout. Browser scrolls natively. Fixed viewport panels.
CSS variables: --tl-toolbar-h:52px, --tl-nav-h:48px, --tl-detail-w:280px,
               --tl-toggle-w:22px, --tl-mini-w:64px
               --tl-top: calc(var(--header-h) + var(--tl-toolbar-h))

Fixed elements:
  #tl-toolbar:      fixed, top:56px,  left:264px, right:0, h:52px
  #tl-detail-panel: fixed, top:108px, left:264px, w:280px, bottom:48px
                    Collapsed: opacity:0; visibility:hidden — NEVER slides left
                    (sliding would cover the sidebar — this was a persistent bug)
  #tl-panel-toggle: fixed, left:544px open / left:264px collapsed
  #tl-minimap:      fixed, top:108px, right:0, w:64px, bottom:48px
  #tl-nav-bar:      fixed, bottom:0,  left:264px, right:0, h:48px

5-column layout: .tl-zone-1 through .tl-zone-5 (each 20% wide, position:absolute).
Cards fill zone via width:100%. Icon embedded in card, no connector lines.
Col 1,2=left (spine accent right), col 3=center (accent top), col 4,5=right (accent left).
Event color: resolveEvColor(ev) → ev.customColor → category.defaultColor → importanceColor[imp]
Duration lines: left = column center % (10/30/50/70/90%), color = resolveEvColor.

Key JS: renderTL(), resolveEvColor(ev), customEraYear(ceYear, era),
        selectEv(id), renderDetailPanel(ev, calKey), navEvent(dir),
        updateNavYear(), openEventModal(id), openEraModal(id),
        openColorPicker(anchor, color, cb), _bd (cached build params)

Importance icons: SVG shapes — circle (insignificant), larger circle (trivial),
rounded square (minor), triangle (notable), star (major), 10-point burst (milestone).

## AI SYSTEM (js/ai.js)
OpenAI-compatible. Configurable base URL (works with local models).
API key: localStorage('eomt_ai_key') only. Never on disk. Never in settings.json.
Features: article generation, semantic search (embeddings), content expansion,
          wikilink suggestion, auto-summary + embedding on save, full reindex.
reindexAll() iterates DB.articleMeta, calls DB.loadArticle() per article.
gatherContext() uses DB.articleCache for embedding search, DB.articleMeta for lexical.
AI busy indicator: #ai-busy-indicator in header.

## DB READ-ONLY / STATIC MODE
DB.isReadOnly — true on any non-localhost hostname (GitHub Pages).
DB._mode: 'filesystem' | 'localStorage' | 'static'
Static mode: all JSON fetched via fetch(), all save methods are NO-OPs.
articles/index.json must be in new metadata format for GitHub Pages to work.

Pages that REDIRECT to index.html when read-only:
  editor.html, manager.html, timeline-manager.html, article-templates.html,
  ai-generate.html

Pages that HIDE edit controls when read-only:
  article.html     — hides #article-edit-actions
  index.html       — plain <p> instead of editable textarea, hides folder prompt
  timeline.html    — hides #tl-edit-btns
  data.html        — shows read-only notice, hides .ro-hide sections
  languages.html   — hides "+ New" / "Save" / "Delete" / CSV-import; inputs disabled;
                     shows banner. Read-only viewer is identical structure with disabled
                     inputs (no separate viewer page).
  ai-generate.html — link hidden from sidebar on read-only

## CONLANG FEATURE (languages.html, js/conlang.js)
Inline syntax in any article: {{LangName:word}} or {{LangName:word|display}}
  - Resolved against DB.languages by name (case-insensitive, also matches nativeName).
  - Word matched against lexicon[].word and lexicon[].romanization.
  - Hits render <a class="conlang-ref"> with a hover tooltip (CSS data-conlang-tip).
  - Misses render <span class="conlang-ref conlang-miss"> with red dotted underline.
  - Parser runs AFTER processWikilinks() in article.html — never touches [[...]].
  - applyToElement() walks text nodes only, so HTML attributes are safe.
Storage layout mirrors articles/: lightweight index (languages.json) + per-language
files in languages/ + languages/index.json for static-fetch mode.
DB methods: saveLanguage(id), deleteLanguageFile(id), _writeLanguagesIndex().
AI tools (ai-generate.html "Conlang" tab):
  - Generate Vocabulary (jsonMode) — accepts rows individually or all
  - Translate Sentence (jsonMode, EN↔Lang) — interlinear gloss + unknown words
  - Suggest Etymology (plain text) — saves or appends to entry.etymology

## KNOWN BUGS / WATCH OUT
- undefined.json in data/articles/ — old save bug. Safe to delete.
- DO NOT call DB.save() with no args for routine ops — writes everything.
- DB.articleCache is session-only. Never persisted. Backlinks only find
  articles opened this session (articles not yet loaded won't appear).
- Search index built from metadata only — content search works only for
  articles that happen to have their content in articleCache. Full content
  search requires loading articles first (future: Phase 4 enhancement).
- articles/index.json must stay in sync. See regeneration command above.
- ALWAYS use CSS variables for colors (dark mode compatibility).

## EDITING CONVENTIONS
- str_replace for targeted edits. Full rewrites only when >60% of file changes.
- Re-view file before further str_replace — output goes stale after edits.
- CSS: main.css for shared styles. Page <style> blocks for page-specific.
- Modal body is #modal-body. Checkboxes: `#modal-body input[type=checkbox]`.
- DB.save(articleId) writes one article. See SAVE SYSTEM for all other ops.
- Check DB.isReadOnly before adding any edit UI element.
- Test dark mode when adding new visual elements.

## SESSION WORKFLOW
1. User uploads encyclopedia.zip
2. unzip -o /mnt/user-data/uploads/encyclopedia.zip -d /home/claude/
3. find /home/claude/encyclopedia/data/images -type f ! -name "*.md" -delete
4. Edit with str_replace
5. cd /home/claude && zip -r encyclopedia.zip encyclopedia/ -x "*.DS_Store"
   cp encyclopedia.zip /mnt/user-data/outputs/encyclopedia.zip
6. present_files to deliver

## CURRENT WORLD DATA (as of last sync)
  33 articles, 45 categories, 1 timeline (Equestrian History),
  active calendar: HCC, theme: dark (localStorage),
  AI: configured (disabled), 8 article templates,
  datapack backup: lau_wiki_datapack_05_08_2026.json
  Optimization: ALL FOUR PHASES COMPLETE.
    Phase 1: Scoped saves, localStorage for theme/collapse
    Phase 2: Lazy article loading (articleMeta + articleCache + loadArticle)
    Phase 3: Lazy sidebar tree (children built on first expand)
    Phase 4: Search index (Map-based, async content snippets)
  Next planned: Phase 5 — Category pages
