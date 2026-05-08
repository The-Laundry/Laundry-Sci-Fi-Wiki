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
  data.html               Data management & backup
  help.html               Help & guide

  css/
    main.css              All shared styles

  js/
    db.js                 Data layer (File System API + localStorage fallback)
    calendar.js           Calendar conversion (5 in-universe calendars)
    ui.js                 Shared header, sidebar, modal, toast

  data/                   Created automatically on first use
    settings.json
    categories.json
    timelines.json
    events.json
    eras.json
    timeline-categories.json
    wikibox-templates.json
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
