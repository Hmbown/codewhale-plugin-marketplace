---
name: commit-message
description: Write a clear git commit message from the staged changes. Use when the user asks for a commit message, or to summarize what they are about to commit.
---

# Commit message

1. Read the staged change with `git diff --cached --stat` and then
   `git diff --cached`. If nothing is staged, say so and stop; do not stage files.
2. Write the message from what the diff does, not from file names:
   - Subject line: imperative mood, 50 characters or fewer if possible, no
     trailing period ("Fix retry loop on timeout").
   - Blank line, then a body wrapped near 72 columns that explains why the
     change is needed and anything a reviewer could miss. Omit the body for a
     trivial change.
3. Mention behavior changes, migrations and removed options explicitly.
4. Return the message in a code block. Do not run `git commit` unless the user
   asks you to.
