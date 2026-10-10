# Lore

This folder holds the lore of the worlds that Loreweaver can answer questions about. It is the source of truth: the vector index in the database is built from these files and can always be rebuilt with `pnpm ingest`.

## Layout

```text
data/lore/
  <world_id>/          one folder per world; the folder name is the world's id
    <topic>.md         one Markdown file per topic
```

The folder name must match the world id used by the legacy CMS (`world_aethel`, `world_nox`), because that id is what ties a user's world to its lore and to its characters.

## File format

Each file starts with a front matter block that sets the kind of document, then a `#` title, then `##` and `###` sections:

```md
---
doc_type: rule
---

# Title

## Section

Text.
```

`doc_type` is one of `rule`, `location`, `history` or `character`. Headings matter: a chunk is cut at a heading, and the headings above it become its `heading_path` (for example `The Magic of Aethel > Casting Rules > Teleportation`), which is shown in citations.

## Writing rules

- Describe what is always true of a world. Live character state (where a character is, what they carry) belongs to the CMS, not here.
- Keep each rule in plain, testable words.
- Do not put anything private in these files: they are committed to the repository.
