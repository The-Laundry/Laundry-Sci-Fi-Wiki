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
- Shared JS modules: js/db.js, js/calendar.js, js/ui.js, js/ai.js.
- Every page loads db.js, calendar.js, ui.js. AI pages also load ai.js.
- No ES modules, no import/export. All objects (DB, UI, AI, CALENDARS) are global.
- Global helpers: escHtml(), mkId(), dateToDays(), ceToDisplay(), formatDate(), calendarToCE().

## FILE MAP & LINE COUNTS
  article.html           ~345  Article viewer. Wikilinks [[Name]] or [[Name|text]].
                               Backlinks panel ("Referenced by") computed on load.
  editor.html            1112  Article editor. Quill.js WYSIWYG, custom cat dropdown,
                               wikibox builder (contenteditable, stable _id drag-reorder),
                               article template picker. In-flight save guard (_articleSaving).
  manager.html           ~521  Article + category manager. Drag-drop tree. Wikibox
                               templates + article templates (sections + fields, drag-reorder).
  article-templates.html ~231  Article template manager.
  index.html             ~113  Homepage. Stats, recent articles, category list.
  search.html            ~449  Dedicated search page. Full-text + tag browsing.
  timeline.html          ~1103 Timeline viewer. Full-page, fixed panels, 5-column layout.
  timeline-manager.html  ~330  Timeline/era/event-category manager. Importance colors.
  ai.html                ~505  AI settings. saveConfig() uses DB.saveSettings().
  ai-generate.html       ~1457 AI Generator. Bulk event commit uses DB.saveEvents().
  data.html              ~141  Export/import/clear. Read-only notice on GitHub Pages.
  help.html              ~111  Usage guide.
  css/main.css           ~915  All shared styles. Dark mode via [data-theme="dark"].
  js/db.js                502  DB object. THREE backends + SCOPED SAVE METHODS (Phase 1).
                               See SAVE SYSTEM section below.
  js/calendar.js           52  Calendar conversions. CALENDARS object, 5 calendars.
  js/ui.js                488  Shell injection. Theme from localStorage. Sidebar uses
                               DB.getCatCollapsed/setCatCollapsed (no disk write).
                               Stable alphabetical sort in sidebar tree.
  js/ai.js               ~1605 AI helper module. saveConfig → DB.saveSettings().

## SAVE SYSTEM — CRITICAL (Phase 1 complete)
ALWAYS use scoped saves. Never call DB.save() without an article ID except for
article delete (the one intentional exception — updates index.json, infrequent).

Scoped save methods in db.js:
  DB.save(articleId)          — writes one article file + updates index.json
  DB.saveSettings()           — writes settings.json only
  DB.saveCategories()         — writes categories.json only
  DB.saveTimelines()          — writes timelines.json only
  DB.saveEvents()             — writes events.json only
  DB.saveEras()               — writes eras.json only
  DB.saveTimelineCategories() — writes timeline-categories.json only
  DB.saveWikiboxTemplates()   — writes wikibox-templates.json only
  DB.saveArticleTemplates()   — writes article-templates.json only
  DB.save() (no arg)          — writes ALL shared files + ALL article files. AVOID.
                                Only used in: article delete, data import, clearAll.

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
  Article delete             → DB.save() [intentional, infrequent]
  Theme toggle               → localStorage only, NO disk write
  Category collapse toggle   → localStorage only, NO disk write

## CATEGORY COLLAPSE STATE (localStorage only)
DB.getCatCollapsed(id) → boolean (true = collapsed, default for all categories)
DB.setCatCollapsed(id, collapsed) → writes to localStorage('eomt_cat_open')
Storage format: {catId: true} for OPEN categories only. Absent = collapsed.
Default is collapsed — never stored in categories.json.
The `collapsed` field may still exist on old category objects in data but is ignored.

## DARK MODE / THEME
Theme stored in localStorage('eomt_theme') ONLY — never written to settings.json.
DB.settings.theme may exist from old data but is only a fallback, never written.
UI._applyTheme() reads localStorage first, then DB.settings.theme, then 'light'.
UI.toggleTheme() writes localStorage only — no DB.save(), no disk write.
CSS: [data-theme="dark"] block in main.css overrides all :root variables.

## IN-FLIGHT SAVE GUARDS
Prevents double-saves from impatient clicking:
  editor.html:   _articleSaving boolean flag, button disabled during save
  timeline.html: btn._saving flag on event modal and era modal save buttons

## WIKIBOX SYSTEM (stable _id rewrite)
Each field has a stable runtime _id (e.g. 'wb_a3f9k2') assigned on load/create.
DOM uses data-wbid, never numeric indices. All reads/writes by _id lookup.
_id is stripped by collectWbFields() before saving — not stored in JSON.
contenteditable value editors, identified by .wb-value-editor[data-wbid].
Mini-toolbar (B/I/U/↵) appears on text selection via selectionchange event.
Drag-reorder: flushes active editor synchronously before splice, uses _id for
fromIdx/toIdx lookups. No stale index problems possible.

## DATA SCHEMA
settings.json:     { homeDesc, activeCalendar, importanceColors:{imp:hex},
                     ai:{ enabled, baseUrl, chatModel, embeddingModel,
                          temperature, maxTokens, autoRefreshOnSave, topK } }
                   NOTE: apiKey NEVER in settings.json. theme NEVER in settings.json.
                   Both live in localStorage only.
categories.json:   [{id, name, parentId}]  — 'collapsed' field ignored if present
timelines.json:    [{id, name, description, startYear, endYear}]
events.json:       [{id, title, year, month, day, yearEnd, monthEnd, dayEnd,
                     importance, eventCategoryId, timelineIds[], articleId,
                     description, tlColumn(1-5), customColor(hex|null)}]
eras.json:         [{id, name, startYear, endYear, color, timelineId,
                     customCalAbbrev, customCalOffset, hasYearZero, countsBackward}]
timeline-categories.json: [{id, name, color, defaultColor}]
wikibox-templates.json:   [{id, name, fields:[{type:'field'|'section', key}]}]
article-templates.json:   [{id, name, categoryId, tags[], content(HTML), wikibox{...}}]
articles/index.json:      [array of article IDs] — REQUIRED for GitHub Pages
                           Written by DB.save(articleId) on every article save.
articles/art_ID.json:     {id, title, content(HTML), categoryId, tags[],
                            wikibox:{enabled,title,subtitle,image,imagePath,imgCaption,
                            fields:[{type,key,val(HTML)}]}, created, updated,
                            summary?(string), embedding?(number[]), embeddingModel?(string)}

## PHASE 2 — NEXT SESSION (not yet implemented)
Metadata index + lazy loading. Key changes:
  - DB.articleMeta[] — lightweight metadata loaded at init (replaces loading all articles)
  - DB.articleCache{} — full articles loaded on demand, keyed by id
  - DB.loadArticle(id) — new async method, checks cache then fetches file
  - articles/index.json — expand from [ids] to [{id,title,categoryId,tags,summary,updated}]
  - DB.save(articleId) — after write, update DB.articleMeta entry + rewrite index.json
  - Pages using metadata only: manager.html, index.html, search.html, sidebar, ai link pickers
  - Pages needing full content: article.html, editor.html, ai.js (call DB.loadArticle)
  See optimization-roadmap.md for full step-by-step.

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

## AI SYSTEM (js/ai.js)
OpenAI-compatible. Configurable base URL (works with local models too).
API key: localStorage('eomt_ai_key') only. Never on disk.
Features: article generation, semantic search, content expansion, wikilink suggestion,
auto-summary + embedding on save, full reindex.
AI busy indicator: #ai-busy-indicator in header.
Read-only: AI Generator link hidden, AI settings still visible.

## DB READ-ONLY / STATIC MODE
DB.isReadOnly — true on any non-localhost hostname.
DB._mode: 'filesystem' | 'localStorage' | 'static'
Static mode: fetches all JSON via fetch(), all save methods are NO-OPs.
articles/index.json written by DB.save(articleId) on every local article save.

Pages that REDIRECT to index.html when read-only:
  editor.html, manager.html, timeline-manager.html, article-templates.html

Pages that HIDE edit controls when read-only:
  article.html — hides #article-edit-actions
  index.html   — plain <p> for description, hides folder prompt
  timeline.html — hides #tl-edit-btns
  data.html    — read-only notice, hides .ro-hide sections

## TIMELINE PAGE ARCHITECTURE
Full-page layout. Fixed viewport panels.
CSS variables: --tl-toolbar-h:52px, --tl-nav-h:48px, --tl-detail-w:280px,
               --tl-toggle-w:22px, --tl-mini-w:64px
Fixed elements: toolbar(top:56px), detail panel(top:108px,left:264px,w:280px),
               toggle strip, minimap(right:0,w:64px), nav bar(bottom:0)
Detail panel collapsed: opacity:0; visibility:hidden — never slides (would cover sidebar).
5-column layout: .tl-zone-1..5, each 20% wide. Cards fill zone. Icon embedded in card.
Event color: resolveEvColor(ev) → customColor → category.defaultColor → importanceColor.
Duration lines at column center % (10/30/50/70/90%).
Key functions: renderTL(), resolveEvColor(), customEraYear(), selectEv(),
               navEvent(), updateNavYear(), openEventModal(), openEraModal(),
               openColorPicker(), _bd (cached build params)

## KNOWN BUGS / WATCH OUT
- undefined.json in data/articles/ — old save bug. Safe to delete.
- str_replace fails on timeline.html comment lines with Unicode em-dash (──).
  Use python3 string replacement for those sections.
- articles/index.json must stay in sync with actual article files.
  Regenerate: python3 -c "import os,json; ids=[f[:-5] for f in os.listdir('encyclopedia/data/articles') if f.endswith('.json') and f not in ('index.json','undefined.json')]; open('encyclopedia/data/articles/index.json','w').write(json.dumps(ids,indent=2))"
- DO NOT call DB.save() with no args for routine operations — it writes everything.
  Use scoped methods. See SAVE SYSTEM section.

## EDITING CONVENTIONS
- str_replace for targeted edits; full rewrites only when >60% changes.
- Re-view file before further edits after any str_replace (output goes stale).
- CSS: main.css shared styles, <style> blocks for page-specific.
- Modal body: #modal-body. Checkboxes: `#modal-body input[type=checkbox]`.
- DB.save(articleId) writes one article. See SAVE SYSTEM for all other operations.
- Check DB.isReadOnly before adding any edit UI.
- Use CSS variables, never hardcode colors (dark mode compatibility).

## SESSION WORKFLOW
1. User uploads encyclopedia.zip
2. unzip -o /mnt/user-data/uploads/encyclopedia.zip -d /home/claude/
3. find /home/claude/encyclopedia/data/images -type f ! -name "*.md" -delete
4. Edit with str_replace
5. cd /home/claude && zip -r encyclopedia.zip encyclopedia/ -x "*.DS_Store"
   cp encyclopedia.zip /mnt/user-data/outputs/encyclopedia.zip
6. present_files to deliver

## CURRENT WORLD DATA (as of last sync)
  33 articles (+ undefined.json bug file), 45 categories,
  1 timeline (Equestrian History), active calendar: HCC,
  theme: dark (localStorage), AI: configured,
  8 article templates, datapack backup: lau_wiki_datapack_05_08_2026.json
  Optimization: Phase 1 complete. Phase 2 (lazy loading) is next.
