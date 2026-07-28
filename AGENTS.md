# Repository Agent Instructions

## Synchronize Before Editing

At the start of every coding task in this repository, before editing files:

1. Confirm the working tree is clean. If it is not clean, preserve the existing changes and resolve their ownership before synchronizing.
2. Fetch the latest `master` from `origin` with `git fetch origin master`.
3. Synchronize the working branch with `origin/master`:
   - When on `master`, use a fast-forward-only pull from `origin/master`.
   - When on a feature branch, merge `origin/master` into the feature branch before making changes.
4. If synchronization produces or would require resolving conflicts, stop and report the conflicts. Do not overwrite or discard changes made by Claude, the user, or another agent.
5. Begin editing only after the working branch includes the latest `origin/master`.

