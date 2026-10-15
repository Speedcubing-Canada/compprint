# Regional presets

Every `.json` file in this folder becomes a preset on the **What to generate** step. A preset
pre-selects the options a region normally uses — it only moves *defaults*, so the organizer can still
change anything afterwards. "Default" is always offered first and is what's selected out of the box.

**Adding a preset is a file drop.** Copy an existing one, edit it, open a PR. No `.ts`/`.tsx` file needs
to change — `index.ts` globs this folder at build time.

## Shape

```jsonc
{
  "id": "ontario",            // required, unique, kebab-case
  "name": "Ontario",          // required, shown on the card (plain text, not translated)
  "region": "Canada",         // optional, shown under the name
  "documents": { },           // which PDFs to generate (the /scope step)
  "settings": { }             // print settings (the /settings step)
}
```

Names and regions are plain display strings on purpose: place names don't translate, and a contributor
adding a JSON file shouldn't have to touch four locale files.

Omit a field and it keeps the app default. `"documents": {}` / `"settings": {}` are fine.

### `documents`

All booleans. App defaults in brackets.

| Key | Default | PDF |
|---|---|---|
| `scorecards` | `true` | Scorecards |
| `scheduleTracker` | `true` | Schedule tracker |
| `nametags` | `true` | Name tags |
| `roundChecklist` | `false` | Round Checklist |
| `firstTimerSlips` | `false` | First-timer slips |
| `groupOverview` | `false` | Group Overview |

Note: mid-competition, `scheduleTracker` and `nametags` default to `false` instead.

### `settings`

| Key | Values | Default |
|---|---|---|
| `language` | `"en"` `"fr"` `"es"` `"pt"` | interface language |
| `secondaryLanguage` | as above, or `null` | `null` |
| `paperFormat` | `"A4"` `"LETTER"` | `"LETTER"` |
| `secondRoundMode` | `"prefilled"` `"blanks"` | `"prefilled"` |
| `useDefaultLogo` | boolean | on for `fr`/`en` interface |
| `hideWcaLiveId` | boolean | `false` - when on, only blank/extra cards lose the line; named cards keep their ID |
| `nametagLogoMode` | `"hidden"` `"with-name"` `"logo-only"` | `"with-name"` |
| `nametagQrMode` | `"back-only"` `"both-sides"` | `"back-only"` |
| `nametagLayout` | `"vertical"` `"horizontal"` | `"vertical"` |
| `scorecardCheckMode` | `"per-group-card"` `"per-round-card"` `"none"` | `"per-group-card"` |
| `scrambleDoubleCheckRegionTop` | positive integer (top N in the country, regulation 11i) | off |
| `mergeScorecardRounds` | boolean (one scorecard PDF for every round) | `false` |
| `logo` | a filename in `logos/`, e.g. `"abracm.png"` | none |

For `logo`, drop a PNG or JPEG in `logos/` (other types are ignored; resize it first, ~600px wide is plenty for print). It seeds the
logo upload on the settings page, so it is for organizations that print the same logo at every
competition.

Competition-specific things (custom events, WCA Live ID, round scope) are deliberately not
seedable — they differ per competition, not per region.

## Validation

Unknown keys and out-of-range values are **silently dropped**, and a preset without an `id` and a `name`
is skipped entirely, so a typo can't corrupt someone's settings. `presets.test.ts` asserts that every
shipped preset survives validation with all its fields intact — so if you misspell a key, the test
fails rather than the preset quietly doing nothing.
