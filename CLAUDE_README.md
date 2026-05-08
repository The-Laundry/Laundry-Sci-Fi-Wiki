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
  article.html          190   Article viewer. Renders wikilinks, wikibox, TOC.
  editor.html           628   Article editor. Quill.js WYSIWYG, custom cat dropdown,
                              wikibox builder with contenteditable rich-text fields.
  manager.html          381   Article + category manager. Drag-drop tree, wikibox templates.
  index.html            104   Homepage. Stats, recent articles, cat list.
  timeline.html         977   Timeline viewer. FULL PAGE (not a scroll box). Fixed
                              toolbar, detail panel, minimap, nav bar — all viewport-fixed.
  timeline-manager.html 315   Timeline/era/event-category manager. Importance color settings.
  data.html             125   Export/import/clear.
  help.html             110   Usage guide.
  css/main.css          570   All shared styles + timeline styles + color picker styles.
  js/db.js              338   DB object. Two backends: FileSystem API + localStorage.
                              Key methods: DB.init(), DB.save(articleId?), DB.exportAll(),
                              DB.deleteArticleFile(id), DB.clearAll().
  js/calendar.js         52   ceToDisplay(), ceToCalendar(), calendarToCE(), formatDate(),
                              dateToDays(). CALENDARS object with all 5 calendars.
  js/ui.js              306   UI.init(), UI.renderSidebar(), UI.showModal(), UI.closeModal(),
                              UI.toast(), UI.handleFolderClick(). Injects header+sidebar+modal.

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
                            created, updated}]

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

## KNOWN ISSUES / RECENT HISTORY
- Timeline page underwent major architectural rewrite (full-page layout, fixed panels).
  The nav bar, minimap, and detail panel positions were the main focus.
- Wikibox section collapse bug was fixed (was checking sectionIdx > 0, now uses currentSectionId).
- Article viewer had a critical JS parse error from a dropped `function buildTOC(` declaration —
  watch for this pattern if inserting functions near others.
- Category dropdown in editor uses custom div-based tree (not a <select>) to support collapsing.
- Wikibox field values are contenteditable divs with execCommand formatting (bold/italic/underline)
  and a floating mini-toolbar. Shift+Enter inserts <br>.

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
