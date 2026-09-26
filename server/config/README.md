Default sources shown to every user (in addition to any custom source they add
themselves). Each entry:

```json
{
  "host": "unito.prod.up.cineca.it",
  "linkCalendarioId": "<24-hex id>",
  "group": "Primo anno",
  "title": "Canale A",
  "titleEn": "Channel A"
}
```

Get `host` and `linkCalendarioId` from a Cineca "University Planner" public
calendar URL, e.g.
`https://unito.prod.up.cineca.it/calendarioPubblico/linkCalendarioId=<id>`.
Only hosts matching `*.prod.up.cineca.it` are accepted; anything else is
ignored at startup.

- `group` (optional): a folder label shown in the source picker. Entries
  sharing the same `group` are shown together, collapsed by default.
  Omit it to show the source ungrouped, at the top level.
- `title` / `titleEn` (optional): overrides the name shown for this
  source. Omit them to use the title Cineca itself reports for the
  calendar, fetched live on boot. The calendar is always looked up live
  either way (to confirm it actually exists) - these fields only affect
  the label, never which calendar is fetched.

Restart the server after editing this file. Existing default sources are
updated in place (title/group refreshed) rather than duplicated; a source
a user has since customized is left alone.
