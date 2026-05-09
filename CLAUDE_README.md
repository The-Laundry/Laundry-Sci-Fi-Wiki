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
  article.html           344   Article viewer. Wikilinks [[Name]] or [[Name|text]].
                               Backlinks panel ("Referenced by") at bottom — computed
                               on load by scanning all articles + events.
  editor.html           1065   Article editor. Quill.js WYSIWYG, custom cat dropdown,
                               wikibox builder (contenteditable, drag-reorder fields),
                               article template picker in meta row.
  manager.html           521   Article + category manager. Drag-drop tree. Wikibox
                               templates (sections + fields, drag-reorder).
  article-templates.html 231   Article template manager. Templates store: name,
                               categoryId, tags[], content(HTML), wikibox{...}.
                               Split-pane: list on left, editor on right.
  index.html             113   Homepage. Stats, recent articles, category list.
  search.html            449   Dedicated search page. Full-text across articles +
                               events. Filters: category, tag, type. Browsable tags
                               (clickable on article pages → search.html?tag=X).
  timeline.html         1103   Timeline viewer. Full-page, fixed panels.
                               5-column layout, embedded icon cards, color picker.
  timeline-manager.html  330   Timeline/era/event-category manager. Importance colors.
  ai.html                505   AI settings page. Configure API endpoint, model,
                               temperature, max tokens, embedding model, topK.
                               Test connection. Rebuild all summaries/embeddings.
  ai-generate.html      1457   AI Generator — tabbed interface:
                               • Article Generator: generate full article from prompt
                               • Semantic Search: embedding-based similarity search
                               • Content Expander: expand article sections with AI
                               • Article Linker: suggest wikilinks for an article
                               • Conlang: vocab gen, sentence translate, etymology
  languages.html              Languages manager + viewer + editor (split-pane).
                               Tabs: Overview / Phonology / Lexicon / Grammar /
                               Texts / Used In. Auto-saves on blur. Quill for
                               description and grammar. Honors DB.isReadOnly.
  data.html              141   Export/import/clear. Read-only notice on GitHub Pages.
  help.html              111   Usage guide.
  css/main.css           915   All shared styles. Dark mode via [data-theme="dark"]
                               on <html>. CSS custom properties for all colors.
  js/db.js               443   DB object. THREE backends: filesystem / localStorage /
                               static (GitHub Pages). Now also manages articleTemplates.
                               settings.ai block for AI configuration.
  js/calendar.js          52   Calendar conversions. CALENDARS object, 5 calendars.
  js/ui.js               482   Shell injection. Dark mode toggle. Nav includes Search,
                               AI, Article Templates links. Theme applied before paint
                               to avoid flash.
  js/ai.js              1605   AI helper module. OpenAI-compatible API.
                               AI.chat(), AI.chatStream(), AI.embed(), AI.cosine(),
                               AI.generateSummary(), AI.generateEmbedding(),
                               AI.reindexAll(). API key stored only in localStorage
                               ('eomt_ai_key'), never in settings.json.
  js/conlang.js               Conlang helpers. Conlang.findLanguage(name),
                               Conlang.findEntry(lang, word), getDescendants/Ancestors,
                               findBacklinks(lang), parseHtml(html) (string),
                               applyToElement(root) (text-node walker, never
                               touches existing wikilink anchors), CSV import/export.
                               Used by languages.html, article.html, ai-generate.html.

## DATA SCHEMA
settings.json:     { homeDesc, activeCalendar, importanceColors:{imp:hex},
                     theme:'light'|'dark',
                     ai:{ enabled, baseUrl, chatModel, embeddingModel,
                          temperature, maxTokens, autoRefreshOnSave, topK } }
                   NOTE: apiKey is NEVER in settings.json — localStorage only.
categories.json:   [{id, name, parentId, collapsed}]
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
articles/index.json:      [array of article IDs] — REQUIRED for GitHub Pages
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
                            wikibox:{...}, created, updated,
                            summary?(string), embedding?(number[]),
                            embeddingModel?(string)}
                   NOTE: undefined.json exists in articles/ — appears to be a bug
                   from a save where article.id was undefined. Safe to delete.

## CALENDAR SYSTEM
All dates stored as CE integers. Display is cosmetic conversion only.
  hcc:  CE/BCE,   offset 0          (currently active — settings.json shows hcc)
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

## DARK MODE
Theme stored in localStorage key 'emt_theme' (NOT settings.json).
Applied in ui.js before paint via data-theme attribute on <html>.
CSS: [data-theme="dark"] block in main.css overrides all :root variables.
Toggle: UI.toggleTheme(). Button id: #theme-toggle-btn in header.
Respects prefers-color-scheme on first visit.

## AI SYSTEM (js/ai.js)
OpenAI-compatible. Configurable base URL (works with local models too).
API key: localStorage key 'eomt_ai_key' only. Never persisted to disk/settings.
Features:
  - Article generation from prompt
  - Semantic search via embeddings (cosine similarity)
  - Content expansion
  - Wikilink suggestion
  - Auto-summary + embedding on article save (if autoRefreshOnSave)
  - Full reindex (rebuild all summaries + embeddings)
AI busy indicator in header (#ai-busy-indicator) — shown during AI calls.
Read-only (GitHub Pages): AI Generator link hidden, AI settings still visible.

## DB READ-ONLY / STATIC MODE
DB.isReadOnly — true on any non-localhost hostname.
DB._mode: 'filesystem' | 'localStorage' | 'static'
Static mode: fetches all JSON via fetch(), save() is NO-OP.
articles/index.json auto-written by _saveToFilesystem() on every local save.

Pages that REDIRECT to index.html when read-only:
  editor.html, manager.html, timeline-manager.html, article-templates.html,
  ai-generate.html

Pages that HIDE edit controls when read-only:
  article.html   — hides #article-edit-actions
  index.html     — plain <p> instead of editable textarea, hides folder prompt
  timeline.html  — hides #tl-edit-btns
  data.html      — shows read-only notice, hides .ro-hide sections
  languages.html — hides "+ New" / "Save" / "Delete" / CSV-import; inputs disabled;
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

## TIMELINE PAGE ARCHITECTURE
Full-page layout. Fixed viewport panels.
CSS variables: --tl-toolbar-h:52px, --tl-nav-h:48px, --tl-detail-w:280px,
               --tl-toggle-w:22px, --tl-mini-w:64px
               --tl-top: calc(var(--header-h) + var(--tl-toolbar-h))

Fixed elements:
  #tl-toolbar:      fixed, top:56px,  left:264px, right:0
  #tl-detail-panel: fixed, top:108px, left:264px, w:280px, bottom:48px
                    Collapsed: opacity:0, visibility:hidden (never moves — would cover sidebar)
  #tl-panel-toggle: fixed, left:544px open / 264px collapsed
  #tl-minimap:      fixed, top:108px, right:0, w:64px, bottom:48px
  #tl-nav-bar:      fixed, bottom:0, left:264px, right:0, h:48px

5-COLUMN LAYOUT: .tl-zone-1 through .tl-zone-5 (each 20% wide, position:absolute).
Cards fill zone with width:100%. Icon embedded in card, no connector lines.
Cols 1,2=left, col 3=center on spine, cols 4,5=right.
Event color: resolveEvColor(ev) → customColor → category.defaultColor → importanceColor.
Duration lines: left=column center % (10/30/50/70/90%), color=resolveEvColor.

Key functions: renderTL(), resolveEvColor(ev), customEraYear(ce,era),
               selectEv(id), renderDetailPanel(), navEvent(dir),
               updateNavYear(), openEventModal(id), openEraModal(id),
               openColorPicker(anchor,color,cb), _bd (cached build params)

## KNOWN BUGS / WATCH OUT
- undefined.json in data/articles/ — save bug when article.id was undefined.
  Safe to delete from the data folder. Also won't appear in index.json correctly.
- str_replace fails on timeline.html comment lines with Unicode em-dash (──).
  Use python3 string replacement for those sections.
- Detail panel collapse: opacity/visibility ONLY — never moves left (would cover sidebar).
- Wikibox drag-reorder: flushes contenteditable synchronously before splice;
  onValueBlur checks _wbDragIdx to skip delayed saves during drag.
- Browser caching: hard refresh (Ctrl+Shift+R) after replacing JS files.
- articles/index.json must stay in sync. Auto-maintained by _saveToFilesystem().
  Regenerate manually if needed:
  python3 -c "import os,json; ids=[f[:-5] for f in os.listdir('encyclopedia/data/articles') if f.endswith('.json') and f not in ('index.json','undefined.json')]; open('encyclopedia/data/articles/index.json','w').write(json.dumps(ids,indent=2))"

## EDITING CONVENTIONS
- str_replace for targeted edits; full rewrites only when >60% changes.
- Re-view file before further edits after any str_replace (output goes stale).
- CSS: main.css shared styles, <style> blocks for page-specific.
- Modal body: #modal-body. Checkboxes: `#modal-body input[type=checkbox]`.
- DB.save(articleId) writes one article. DB.save() writes everything.
- Check DB.isReadOnly before adding any edit UI.
- Dark mode: test both themes when adding new CSS color values.
  Use CSS variables, never hardcode colors.

## SESSION WORKFLOW
1. User uploads encyclopedia.zip
2. unzip -o /mnt/user-data/uploads/encyclopedia.zip -d /home/claude/
3. find /home/claude/encyclopedia/data/images -type f ! -name "*.md" -delete
4. Edit with str_replace
5. cd /home/claude && zip -r encyclopedia.zip encyclopedia/ -x "*.DS_Store"
   cp encyclopedia.zip /mnt/user-data/outputs/encyclopedia.zip
6. present_files to deliver

## CURRENT WORLD DATA (as of last sync)
  30 articles (inc. undefined.json bug), 45 categories,
  1 timeline (Equestrian History), active calendar: HCC,
  theme: dark, AI: configured but disabled,
  8 article templates, datapack backup: lau_wiki_datapack_05_08_2026.json
