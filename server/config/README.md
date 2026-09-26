Default sources shown to every user (in addition to any custom source they add
themselves). The file is a list of degree programs, each a tree of folders
and sources:

```json
[
  {
    "program": "Informatica",
    "children": [
      {
        "folder": "Magistrale",
        "children": [
          {
            "folder": "Curriculum A",
            "children": [
              { "host": "unito.prod.up.cineca.it", "linkCalendarioId": "<24-hex id>", "title": "Canale A", "titleEn": "Channel A" }
            ]
          }
        ]
      },
      { "host": "unito.prod.up.cineca.it", "linkCalendarioId": "<24-hex id>" }
    ]
  }
]
```

- `program`: the degree program users opt into as a whole (see
  `POST /api/programs/:program/add`). Every top-level entry needs one.
- `children`: a mix of folder nodes and source (leaf) nodes, in any order,
  nested as deep as needed.
- A folder node is `{ "folder": "<label>", "children": [...] }`. `folder` is
  the label shown in the source picker; entries under it are grouped
  together, collapsed by default.
- A source (leaf) node has `host` and `linkCalendarioId`. Get them from a
  Cineca "University Planner" public calendar URL, e.g.
  `https://unito.prod.up.cineca.it/calendarioPubblico/linkCalendarioId=<id>`.
  Only hosts matching `*.prod.up.cineca.it` are accepted; anything else is
  ignored at startup. Put a source directly in `children` (no wrapping
  folder) to show it ungrouped, at the program's top level.
- `title` / `titleEn` (optional, source nodes only): overrides the name
  shown for this source. Omit them to use the title Cineca itself reports
  for the calendar, fetched live on boot. The calendar is always looked up
  live either way (to confirm it actually exists) - these fields only
  affect the label, never which calendar is fetched.

Restart the server after editing this file. Existing default sources are
updated in place (title/folder path/program refreshed) rather than
duplicated; a source a user has since customized is left alone.
