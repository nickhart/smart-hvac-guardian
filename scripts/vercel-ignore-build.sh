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

# Fetch one ref (a branch or a commit) into FETCH_HEAD. Vercel's checkout has no
# usable "origin" remote, which is why every preview built until this fell back
# to the repository's public URL (from Vercel's system variables). A private
# repository fails both ways, and so builds. Git's own error output is dropped
# deliberately: a remote URL can carry an access token.
fetch_ref() {
  if git remote get-url origin >/dev/null 2>&1 &&
    git fetch --quiet --depth=1 origin "$1" 2>/dev/null; then
    echo "Fetched $1 from origin."
    return 0
  fi
  if [ "${VERCEL_GIT_PROVIDER:-}" = "github" ] &&
    [ -n "${VERCEL_GIT_REPO_OWNER:-}" ] && [ -n "${VERCEL_GIT_REPO_SLUG:-}" ] &&
    git fetch --quiet --depth=1 \
      "https://github.com/${VERCEL_GIT_REPO_OWNER}/${VERCEL_GIT_REPO_SLUG}.git" "$1" 2>/dev/null; then
    echo "Fetched $1 from the repository's public URL."
    return 0
  fi
  echo "Could not fetch $1."
  return 1
}

base=""
if [ "${VERCEL_ENV:-}" = "production" ]; then
  base="${VERCEL_GIT_PREVIOUS_SHA:-}"
  # After several skipped docs-only merges the last deployed commit can be
  # deeper than the clone; fetch it by SHA if so.
  if [ -n "$base" ] && ! git cat-file -e "${base}^{commit}" 2>/dev/null; then
    fetch_ref "$base" || base=""
  fi
else
  if fetch_ref main; then
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
