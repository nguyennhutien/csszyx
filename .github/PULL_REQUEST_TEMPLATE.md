<!--
Title: a Conventional Commit, `type(scope): subject`. It becomes the squash
commit and the changelog line, so name what a user sees.

Open with a paragraph, no heading: what a user saw before, what they see now,
and why it changed. Link the issue it closes (`Closes #123`).

A short change can stop there. A longer one, a change that bundles several
user-visible changes, or one that moves a number, adds:

## What changes

One bullet per change a user sees, by package, and the docs page it updates.

## Numbers

Required for a `perf` change and for any change to a size budget, memory or
work done. A before/after table, `main` against this PR, with units in the
cells, then one line: the machine, how many runs and which statistic, and the
command that reproduces it.

A breaking change ends with one line: `BREAKING CHANGE: …`.

CI shows whether the tests pass, so there is no checklist here. When something
cannot be tested automatically, say in one line what you checked and how.
Commits are signed off (`git commit -s`, see CONTRIBUTING.md).
-->
