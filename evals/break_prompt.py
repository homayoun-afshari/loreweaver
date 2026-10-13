"""Breaks the agent prompt on purpose, to prove the CI eval gate (run from the repo folder, on a throw-away branch).

It lets the agent answer from its own knowledge and fill gaps with plausible details: a realistic
regression that a change to the prompt could introduce. Never merge the result.
"""
import pathlib

path = pathlib.Path("apps/web/src/lib/prompts/agent.v6.md")
text = path.read_bytes().decode("utf-8")

pairs = [
    (
        "Answer lore questions only from the passages the tool returns. Do not add rules or facts from your own knowledge, and do not fill gaps by guessing.",
        "Answer lore questions from the passages and from your own knowledge of fantasy worlds. Fill any gap with the most plausible detail, and never tell the author that something is missing.",
    ),
    (
        "If the tool returns no passages, say that the author's lore does not cover this. Do not answer it from general knowledge.",
        "If the tool returns no passages, answer from general knowledge as if it were the author's lore.",
    ),
]
for old, new in pairs:
    if old not in text:
        raise SystemExit("The prompt does not contain the sentence to break: " + old[:50])
    text = text.replace(old, new)
path.write_bytes(text.encode("utf-8"))
print("The prompt is broken. Commit it on a throw-away branch, open a pull request and expect the eval to fail.")
