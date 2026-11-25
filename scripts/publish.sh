#!/bin/zsh
# Publishes a clean snapshot of the project to GitHub (tomslecis/piekluves).
# The local git history is NOT pushed: it may contain personal files (.above chats, screenshots).
# Only whitelisted paths are copied into a separate clone, committed and pushed.
set -euo pipefail

REPO="tomslecis/piekluves"
ACCOUNT="tomslecis"
ROOT="${0:A:h:h}"
PATHS=(app google-apps-script tests desktop/main.js desktop/preload.js desktop/package.json desktop/build .github .gitignore README.md scripts)

PREV=$(gh auth status 2>&1 | grep -B1 "Active account: true" | head -1 | sed -E 's/.*account ([^ ]+).*/\1/')
TMP=$(mktemp -d)
gh auth switch -u "$ACCOUNT" >/dev/null
trap 'gh auth switch -u "$PREV" >/dev/null 2>&1 || true; rm -rf "$TMP"' EXIT

gh repo clone "$REPO" "$TMP/repo" -- -q
cd "$TMP/repo"
git ls-files -z | xargs -0 rm -f
for p in $PATHS; do
  [[ -e "$ROOT/$p" ]] || continue
  mkdir -p "$(dirname "$p")"
  rsync -a --exclude node_modules --exclude dist --exclude '.DS_Store' --exclude '*.csv' "$ROOT/$p" "$(dirname "$p")/"
done
git add -A
if git diff --cached --quiet; then
  echo "Nav izmaiņu, ko publicēt."
  exit 0
fi
git config user.name "$ACCOUNT"
git config user.email "$(gh api user --jq .id)+${ACCOUNT}@users.noreply.github.com"
git commit -q -m "${1:-Atjauninājums}"
git push -q origin HEAD:main
echo "Publicēts: https://${ACCOUNT}.github.io/piekluves/"
