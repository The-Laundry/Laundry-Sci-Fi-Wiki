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
                            created, updated}

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

## KNOWN ISSUES / RECENT HISTORY
- Detail panel collapse: opacity/visibility only — never slides, never covers sidebar.
- str_replace fails on timeline.html comment lines containing Unicode em-dash (──).
  Use python3 string replacement for those sections.
- Wikibox section collapse bug was fixed: uses currentSectionId not sectionIdx > 0.
- Article viewer had a critical bug from a dropped `function buildTOC(` declaration.
  Always check function declarations when inserting code near other functions.
- Wikibox drag-reorder: flushes contenteditable values synchronously before splice,
  and checks _wbDragIdx in onValueBlur to prevent stale delayed saves overwriting reorder.
- Browser caching: hard refresh (Ctrl+Shift+R) required after replacing JS files.
- articles/index.json must stay in sync with actual article files for GitHub Pages.
  Written automatically by _saveToFilesystem() — but must be manually generated
  if articles are added/removed outside the app (use the python snippet in SESSION WORKFLOW).

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

## CURRENT WORLD DATA (as of last sync)
  19 articles, 45 categories, 1 timeline (Equestrian History), active calendar: CYP
