-- Vector support for lore search. The extension is shipped in the pgvector/pgvector Docker image
-- and is available on Supabase. "if not exists" makes it safe to apply to a database that has it.
CREATE EXTENSION IF NOT EXISTS vector;
