# Conlang Feature — Design Reference

Branch: feature/conlang
Status: In progress

This is the implementation reference for the "Languages" feature: tracking
fictional languages, their phonology, lexicon, grammar, and sample texts,
with inline-translation tooltips inside articles and AI-assisted vocabulary
generation.

---

## Goals

1. Let the worldbuilder track one or more constructed languages alongside
   existing articles, with full lexicon and grammar notes.
2. Make conlang words *citable* inside ordinary articles via a lightweight
   syntax that produces hover tooltips with definitions.
3. Provide AI-assisted vocabulary generation, sentence translation, and
   etymology suggestion using existing `js/ai.js` infrastructure.
4. Stay consistent with the project's tech constraints — no frameworks,
   no build tools, vanilla JS only, three storage backends (filesystem /
   localStorage / static read-only).
5. Keep edits to existing files small. Prefer new files over modifications.

---

## On-disk layout

```
data/
  languages.json                # lightweight index (always loaded)
  languages/
    index.json                  # ID list (required for static/GitHub Pages mode)
    lang_XXXXX.json             # one file per language with full lexicon + grammar
```

`languages.json` is a denormalized summary used to populate sidebar lists
and link pickers without forcing a load of every per-language file. It is
regenerated automatically whenever any language is saved.

```jsonc
// data/languages.json
[
  {
    "id": "lang_1730000000000_abcd",
    "name": "Tzenki",
    "nativeName": "Tzeñki",
    "status": "living",
    "parentId": null,
    "articleId": "art_1778223427027_5mql",
    "wordCount": 137,
    "updated": 1730000000000
  }
]
```

```jsonc
// data/languages/lang_XXXXX.json
{
  "id": "lang_…",
  "name": "Tzenki",
  "nativeName": "Tzeñki",
  "romanization": "Latin script with diacritics; ñ = palatal nasal.",
  "status": "living",                  // 'living'|'dead'|'extinct'|'proto'|'constructed'
  "parentId": null,                    // ancestor language id, for family tree
  "articleId": "art_…",                // optional in-universe wiki article
  "speakerArticleIds": ["art_…"],      // species/nation/character articles
  "description": "<p>HTML…</p>",       // Quill output
  "writingSystem": {
    "name": "Tzenki Script",
    "notes": "Abugida; left-to-right.",
    "sampleImage": ""                  // url or data path
  },
  "phonology": {
    "consonants": [
      { "ipa": "p",  "romanization": "p",  "notes": "" }
    ],
    "vowels": [
      { "ipa": "a",  "romanization": "a",  "notes": "" }
    ],
    "notes": "(C)V(C) syllables; no consonant clusters."
  },
  "grammar": "<h2>Word Order</h2><p>SOV…</p>",   // Quill HTML
  "lexicon": [
    {
      "id": "lex_…",
      "word": "kalor",
      "romanization": "kalor",
      "ipa": "ka.lor",
      "partOfSpeech": "noun",          // free string; conventional values suggested
      "definitions": ["fire", "passion"],
      "etymology": "From proto-Tzenki *kalo-",
      "notes": "",
      "tags": ["element", "common"],
      "examples": ["Kalor narana. — The fire is burning."]
    }
  ],
  "sampleTexts": [
    {
      "id": "txt_…",
      "title": "Babel Text",
      "text": "Kalor sahar nara…",
      "translation": "And the whole earth was of one language…",
      "gloss": "fire-NOM all earth-ACC be-PAST one language…"
    }
  ],
  "created": 1730000000000,
  "updated": 1730000000000
}
```

### Why two-tier?

Loading 50 languages × 5000 lexicon entries each on every page would be
wasteful. The lightweight index lets the sidebar, link pickers, and the
article-tooltip parser resolve language *names* and *IDs* without paying
for every word's data. Per-language files load only when opened.

---

## Module split

| File | Role | Existing? |
|---|---|---|
| `languages.html` | List + viewer + editor (single page, tabbed) | new |
| `js/conlang.js` | Parser, lookups, family-tree, CSV utils | new |
| `js/db.js` | Add `languages` array + load/save methods | edit |
| `js/ui.js` | Sidebar link | edit (1 line) |
| `article.html` | Call `parseConlangRefs()` after `processWikilinks()` | edit (2 lines) |
| `css/main.css` | `.conlang-ref` tooltip styles | edit (small block) |
| `data.html` | Mention languages in export blurb | edit (1 line) |
| `ai-generate.html` | New "Conlang" tab | edit (new tab block) |
| `data/languages.json` + `data/languages/` | Storage | new |

---

## Inline-translation syntax

Used inside any article's content (or wikibox values).

```
{{Tzenki:kalor}}              shows: kalor (fire)
{{Tzenki:kalor|hello}}        shows: hello   (tooltip still resolves to kalor)
```

Rules:

- Match `\{\{([^:{}|]+):([^|{}]+?)(?:\|([^{}]+?))?\}\}`
- Lang name match is **case-insensitive** against `language.name` and
  `language.nativeName`.
- Word match is **case-insensitive** against `lexicon[].word` and
  `lexicon[].romanization`.
- Misses still render as a styled span (red dotted underline) so the
  author sees what's broken — but they remain plain text content.
- The parser runs **after** `processWikilinks()` in `article.html`, so it
  never touches `[[…]]`. The syntaxes don't overlap (square vs. curly).
- HTML attributes are skipped because Quill never produces `{{` inside
  attributes; we apply the regex to text-content of the rendered DOM
  rather than raw HTML to be safe.

### Tooltip content

```
┌─────────────────────────┐
│ kalor /ka.lor/   (noun) │
│─────────────────────────│
│ • fire                  │
│ • passion               │
│                         │
│ Tzenki  →  open language│
└─────────────────────────┘
```

Pure CSS hover tooltip for the static (no-JS-needed) case; with JS, click
opens the language page focused on that word.

---

## UI: `languages.html`

Layout matches `article-templates.html` (split pane, list left, editor
right). Right pane has tabs:

1. **Overview** — name, native name, status, parent language, associated
   article, speakers, description (Quill), writing system, romanization
   notes, family-tree mini-view ("Descendants").
2. **Phonology** — editable consonant + vowel tables, phonotactics notes.
3. **Lexicon** — sortable filterable table, inline-edit row, CSV
   import/export, search box, tag chips, word-count stat.
4. **Grammar** — single Quill rich-text editor.
5. **Texts** — sample texts cards (title / original / translation /
   gloss), useful for Babel-text comparisons.

### Read-only mode

When `DB.isReadOnly === true`, the page renders the same tabs but every
input is disabled, "+ New", "Save", and "Delete" buttons are hidden, and
CSV import is hidden. The CSV export remains available.

---

## AI integration (`ai-generate.html` "Conlang" tab)

Three tools, all gated on `AI.isConfigured()`:

1. **Generate Vocabulary**
   - Inputs: target language, semantic field, phonotactic notes (autofilled
     from the language's phonology), N words to generate, optional
     pinned-article picker.
   - Output: candidate words with proposed definitions; user can accept
     individual rows into the lexicon.
2. **Translate Sentence**
   - Inputs: source language, English sentence, optional pinned-article
     picker.
   - Output: word-by-word + interlinear gloss + free translation, using
     the existing lexicon and grammar notes as context.
3. **Suggest Etymology**
   - Inputs: target language, selected word, optional pinned-article
     picker.
   - Output: etymology paragraph; can be saved into the entry's
     `etymology` field.

### Context-gathering phase (added in feature/conlang-context)

Each tool runs the same four-phase flow as the article generator:

```
Phase: context  →  Conlang.gather*Context()    →  onContextReady(ctx)
Phase: writing  →  AI.chatStream() with prompt →  onRawDelta(delta, accum)
Phase: parsing  →  JSON / prose normalization
Phase: done     →  render results
```

The gather step bundles:

- **Wiki articles** retrieved via the same [`AI.gatherContext()`](../js/ai.js:455)
  pipeline used for article generation (explicit + semantic-search hits).
- **Family-tree neighbours** from [`Conlang.getAncestors`](../js/conlang.js:52)
  / [`Conlang.getSiblings`](../js/conlang.js:420) /
  [`Conlang.getDescendants`](../js/conlang.js:47) — parent + siblings + descendants
  for vocab, parent + siblings for translation, full ancestor chain + sibling
  cognates for etymology.
- **Sample texts** from `lang.sampleTexts` (canonical phrasing).
- Tool-specific extras: lexicon stats for vocab, lexical pre-matches for
  translation, peer-etymologies for etymology.

The result is rendered as on-screen chips by
[`renderCtxInto()`](../ai-generate.html:744) before the model call begins,
so the user can see exactly what is being passed in.

### Module split

- New gatherers: [`Conlang.gatherVocabContext`](../js/conlang.js:499),
  [`Conlang.gatherTranslationContext`](../js/conlang.js:562),
  [`Conlang.gatherEtymologyContext`](../js/conlang.js:654).
- New shared blocks: [`Conlang.buildContextBlock`](../js/conlang.js:379),
  [`Conlang.buildLexiconSummary`](../js/conlang.js:404).
- New AI wrappers: [`AI.generateVocabularyStreaming`](../js/ai.js:800),
  [`AI.translateSentenceStreaming`](../js/ai.js:907),
  [`AI.suggestEtymologyStreaming`](../js/ai.js:998) — each owns its prompt
  assembly and streamed chat call.
- New prompt-override slots in `AI.DEFAULT_PROMPTS`: `vocabSystem` /
  `vocabUserPreamble`, `translateSystem` / `translateUserPreamble`,
  `etymologySystem` / `etymologyUserPreamble`. They show up automatically
  in the AI settings prompt editor alongside `articleSystem` etc.
- Per-tool UI in [`ai-generate.html`](../ai-generate.html:413): each tool gets
  its own progress line, context-chip wrap, stream preview pane, and
  related-article picker (state lives in `State.cl{Gv,Tr,Et}RelatedIds`).

The tab is **hidden** when `DB.isReadOnly`.

For full implementation reference see
[`plans/conlang-context-gathering.md`](conlang-context-gathering.md).

---

## Backlinks

On a language's Overview tab, list articles that reference it via:

- `{{LangName:…}}` syntax in their content or wikibox values, or
- have `articleId === language.articleId` (the explicit pinned article).

This mirrors the existing "Referenced by" panel in `article.html`.

---

## Migration

`DB._ensureDefaults()` adds `languages: []` for users whose localStorage
payload predates this feature. No schema rewrite is required for existing
articles; conlang refs simply don't exist in older content.

---

## Future work (out of scope for this branch)

- Virtualized lexicon table for 5k+ entry languages
- Phoneme inventory IPA-grid editor (currently flat tables)
- Bulk translation of an entire article
- Language family tree visualization (Mermaid/SVG)
- Per-word audio attachments
- Diff/version history for lexicon entries
