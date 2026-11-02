#!/usr/bin/env bash
# Publishes a snapshot of the current commit to the public repo github.com/tronsave/tronsave-mcp:
# one commit per release (no private history), force-pushed to `main`, plus a GitHub release
# for the package.json version with that version's CHANGELOG section as notes.
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
git init -q -b main
git add -A
git -c user.name=tronsave -c user.email=121288350+tronsave@users.noreply.github.com \
  commit -q -m "Release ${tag}"
git remote add origin "https://github.com/${PUBLIC_REPO}.git"
gh auth setup-git >/dev/null 2>&1 || true
git push -q --force origin main
git tag "$tag"
git push -q --force origin "$tag"

if gh release view "$tag" -R "$PUBLIC_REPO" >/dev/null 2>&1; then
  gh release edit "$tag" -R "$PUBLIC_REPO" --title "$tag" --notes "$notes" --latest >/dev/null
else
  gh release create "$tag" -R "$PUBLIC_REPO" --title "$tag" --notes "$notes" --latest >/dev/null
fi
echo "Published ${tag} to https://github.com/${PUBLIC_REPO}"
