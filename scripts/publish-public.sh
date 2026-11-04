#!/usr/bin/env bash
# Publishes a snapshot of the current commit to the public repo github.com/tronsave/tronsave-mcp:
# one commit per release on top of the public `main` (no private history, author tronsave), plus
# a GitHub release for the package.json version with that version's CHANGELOG section as notes.
# Appending (not force-pushing) keeps release history and commit SHAs stable for registries
# such as Glama, which score maintenance on recent commits and build pinned SHAs.
#
#   scripts/publish-public.sh            # publish HEAD
#   PUBLIC_REPO=owner/name scripts/publish-public.sh
#
# Requires a clean working tree and `gh` signed in as an account that can push to PUBLIC_REPO.
set -euo pipefail

PUBLIC_REPO="${PUBLIC_REPO:-tronsave/tronsave-mcp}"
# Internal store-submission notes stay private.
EXCLUDE=(listing)

root="$(git rev-parse --show-toplevel)"
cd "$root"
if [[ -n "$(git status --porcelain)" ]]; then
  echo "Working tree is not clean; commit or stash first." >&2
  exit 1
fi

version="$(node -p "require('./package.json').version")"
tag="v${version}"
work="$(mktemp -d)"
trap 'rm -rf "$work"' EXIT

gh auth setup-git >/dev/null 2>&1 || true
git clone -q --depth 1 "https://github.com/${PUBLIC_REPO}.git" "$work"
# Replace the tracked tree with this snapshot; the clone's .git keeps the public history.
git -C "$work" rm -rq --ignore-unmatch .
git archive HEAD | tar -x -C "$work"
for path in "${EXCLUDE[@]}"; do rm -rf "${work:?}/$path"; done

# Release notes: the CHANGELOG section for this version.
awk -v v="$version" '
  $0 ~ "^## " v "( |$)" { on = 1; next }
  on && /^## / { exit }
  on { print }
' CHANGELOG.md > "$work/.release-notes.md"
notes="$(cat "$work/.release-notes.md")"
rm "$work/.release-notes.md"

cd "$work"
git add -A
if git diff --cached --quiet; then
  echo "Public tree already matches ${tag}; no new commit."
else
  git -c user.name=tronsave -c user.email=121288350+tronsave@users.noreply.github.com \
    commit -q -m "Release ${tag}"
  git push -q origin main
fi
git tag -f "$tag"
git push -q --force origin "$tag"

if gh release view "$tag" -R "$PUBLIC_REPO" >/dev/null 2>&1; then
  gh release edit "$tag" -R "$PUBLIC_REPO" --title "$tag" --notes "$notes" --latest >/dev/null
else
  gh release create "$tag" -R "$PUBLIC_REPO" --title "$tag" --notes "$notes" --latest >/dev/null
fi
echo "Published ${tag} to https://github.com/${PUBLIC_REPO}"
