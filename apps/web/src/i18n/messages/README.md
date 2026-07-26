# Translation Catalogs

Translation copy is stored as UTF-8 JSON and split by product domain:

- `common.json`
- `auth.json`
- `navigation.json`
- `chat.json`
- `settings.json`
- `memory.json`
- `usage.json`
- `projects.json`
- `portability.json`

English is the canonical key schema. Add a new key to the same domain file in
every locale, keep interpolation placeholders such as `{count}` identical, and
do not add comments or trailing commas to JSON.

Each locale `index.ts` is a loader only. It merges domain catalogs and rejects
duplicate keys. `npm run test:i18n` checks exact key parity, non-empty values,
placeholder parity, locale fallback, and document language/direction metadata.
