# Encyclopedia of Many Things
### Phodd Communications

A local-first worldbuilding wiki with articles, wikilinks, wikiboxes, nested categories, vertical timelines, era bands, and five in-universe calendars.

---

## Quick Start

**Requirements:** Python 3 (built into macOS and most Linux; [download for Windows](https://python.org)) and Chrome, Edge, or Arc.

1. Open a terminal and `cd` into this folder:
   ```
   cd path/to/encyclopedia
   ```

2. Start the local server:
   ```
   python -m http.server 8000
   ```

3. Open **http://localhost:8000** in your browser.

4. Click the **No folder** button (top right) and select the `data/` subfolder inside this folder. The app will read and write your data as real JSON files from that point on.

That's it. You only need to run the server command once per session.

---

## File Structure

```
encyclopedia/
  index.html              Homepage
  article.html            Article viewer
  editor.html             Article editor
  manager.html            Article & category manager
  timeline-manager.html   Timeline & event category manager
  timeline.html           Timeline viewer
  article-templates.html  Article-template manager (for AI generation)
  data.html               Data management, backup, and AI settings
  help.html               Help & guide

  css/
    main.css              All shared styles

  js/
    db.js                 Data layer (File System API + localStorage fallback)
    calendar.js           Calendar conversion (5 in-universe calendars)
    ui.js                 Shared header, sidebar, modal, toast
    ai.js                 OpenAI-compatible AI client (Infinite Wiki)

  data/                   Created automatically on first use
    settings.json
    categories.json
    timelines.json
    events.json
    eras.json
    timeline-categories.json
    wikibox-templates.json
    article-templates.json
    articles/
      art_XXXXX.json      One file per article
```

---

## Moving to Another Device

Copy the entire `encyclopedia/` folder. On the new device, run the server and connect the `data/` subfolder. Everything is there — no import needed.

## GitHub Pages

Push the folder to a GitHub repo and enable Pages in Settings. The site will be read-only (no file writes), falling back to localStorage for any edits.

## Backup

Use **Data → Export All Data** to download a single JSON file containing everything. This works in all environments and is the recommended disaster-recovery backup.

---

## Calendar Reference

All dates stored internally as CE years. Display-only conversions:

| Calendar | Positive Era | Negative Era | Offset from CE |
|---|---|---|---|
| Human Common Calendar | CE | BCE | 0 |
| Republic Foundational Reference | PRF | BRF | −1335 |
| Equestrian Lunar Banishment | CYP | BLB | −1325 |
| Tzenki Imperial Epoch | ET | BET | −1707 |
| Preserver Activation Chronometer | SA | BA | +68870 |

Example: 2428 CE = 1093 PRF = 1103 CYP = 721 ET = 71298 SA

---

## Infinite Wiki — AI Article Generation

Any OpenAI-compatible chat + embedding endpoint can be hooked up to write new articles on demand.

### How it works

1. In any article, click a **broken wikilink** (a red link to an article that doesn't exist yet).
2. A dialog asks how you want to create it:
   - **Create Manually** — opens the blank editor with the title pre-filled (original behaviour).
   - **Generate with AI** — opens the AI generation dialog.
3. The AI dialog collects:
   - **Title** (pre-filled from the link).
   - **Template** — picks an article-template from [`article-templates.html`](article-templates.html) (Character, Nation, Event, Timeline, Location, Species, Technology, Generic, or any you've added).
   - **Additional guidance** — free-form notes for the model.
   - **Related articles** — a searchable picker; the AI uses these articles' summaries as authoritative context.
4. The AI also automatically retrieves the most relevant existing articles using vector search (cosine similarity against stored embeddings) and appends their summaries to the prompt.
5. When the model replies, the draft opens in the editor — you tweak it, save it, and on save its summary + embedding are regenerated in the background so the next AI-generated article has fresh context.

### Configuration

Open **Data → AI (Infinite Wiki)** and set:

| Field | Example |
|---|---|
| Base URL | `https://api.openai.com/v1` (or any compatible endpoint) |
| API Key | `sk-…` |
| Chat model | `gpt-4o-mini`, `claude-3-5-sonnet` via a proxy, etc. |
| Embedding model | `text-embedding-3-small` |
| Temperature | `0.7` |
| Max output tokens | `2000` |
| Semantic top-K | `5` (how many related articles to auto-retrieve) |
| Auto-refresh on save | Rebuilds summary + embedding in the background when you save |

Use **Test Connection** to verify the chat endpoint, then **Re-index All Articles…** to generate summaries and embedding vectors for every existing article. This is the one-time bootstrap that makes semantic context retrieval useful — after that, it happens article-by-article on save.

### Where the API key lives

**The API key is stored only in your browser's localStorage** (key: `eomt_ai_key`). It is:

- Never written to `data/settings.json` on disk.
- Never included in `Export All Data`.
- Automatically scrubbed from imported backups if one ever had it.

If you want to remove it, click the **✕** button next to the API key field. Disconnecting the data folder does **not** clear the key — that's a separate action.

### Article Templates

Open **Article Templates** (in the sidebar) to manage the per-template "how to write this kind of article" instructions. Each template has:

- **Name** — shown in the AI dialog dropdown.
- **Wikibox template** (optional) — if set, the AI fills in the wikibox fields too.
- **Article prompt** — free-form instructions ("Write a biographical article covering…").
- **Section outline** (optional, one per line) — suggested `<h1>/<h2>` headings.
- **Default tags** — auto-added to generated articles.

The seed templates cover Character, Nation/Faction, Event, Timeline, Location, Species, Technology, and a Generic catch-all.

### Cost and safety tips

- Embeddings are cheap but chat generations aren't. Expect roughly the cost of one chat completion per new article plus one embedding per save.
- Broken-link clicks do **not** call the API — only the "Generate with AI" button does.
- You can cancel a Re-index mid-run; articles already processed are saved.
- If the endpoint rejects `response_format: json_object`, the client automatically retries without it.
