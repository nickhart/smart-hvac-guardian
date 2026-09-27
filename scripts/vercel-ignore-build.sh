#!/usr/bin/env bash
# Vercel's "Ignored Build Step" (vercel.json → ignoreCommand).
# Exit 0 skips the build; any other exit builds.
#
# Skips only when every changed file is documentation (docs/ or *.md). When in
# doubt — a missing commit, a failed fetch, any git error — it builds: a wrongly
# skipped deploy costs more than a wasted one.
#
# What "changed" is measured against:
# - production: the last deployed commit (VERCEL_GIT_PREVIOUS_SHA).
# - preview: the tip of main. Comparing a branch with its own previous
#   deployment broke whenever the branch was reset after a merge: that commit
#   is no longer in the branch's history, so it isn't in Vercel's shallow clone.
set -u

base=""
if [ "${VERCEL_ENV:-}" = "production" ]; then
  base="${VERCEL_GIT_PREVIOUS_SHA:-}"
  # After several skipped docs-only merges the last deployed commit can be
  # deeper than the clone; fetch it by SHA if so.
  if [ -n "$base" ] && ! git cat-file -e "${base}^{commit}" 2>/dev/null; then
    git fetch --quiet --depth=1 origin "$base" 2>/dev/null || base=""
  fi
else
  if git fetch --quiet --depth=1 origin main 2>/dev/null; then
    base="FETCH_HEAD"
  fi
fi

if [ -z "$base" ]; then
  echo "No base commit to compare with: building."
  exit 1
fi

# --quiet exits 0 for no difference, 1 for a difference, 128 for an error.
if git diff --quiet "$base" HEAD -- . ':(exclude)docs' ':(exclude)*.md'; then
  echo "Only documentation changed since ${base}: skipping the build."
  exit 0
fi

echo "Code changed since ${base} (or the comparison failed): building."
exit 1
