#!/bin/zsh
# Builds the macOS app for an existing GitHub release on this Mac, signed with the
# local Developer ID and notarized, then replaces CI's ad-hoc Mac files on that release.
#
#   scripts/publish-mac.sh            # latest release
#   scripts/publish-mac.sh v1.0.50    # a specific release
#
# Needs: Developer ID Application certificate in the login keychain, the App Store
# Connect key in ~/.appstoreconnect/private_keys, and `gh` logged in as gabrielrvf.
set -euo pipefail

REPO=yanoliveira16/Noctan
GH_ACCOUNT=gabrielrvf
export APPLE_API_KEY_ID=P667925ATS
export APPLE_API_ISSUER=0e35adf1-3ddf-467c-9212-448ab074602c
export APPLE_API_KEY=~/.appstoreconnect/private_keys/AuthKey_$APPLE_API_KEY_ID.p8
export GH_TOKEN="$(gh auth token -u $GH_ACCOUNT)"

cd "$(dirname "$0")/.."
security find-identity -v -p codesigning | grep -q "Developer ID Application" || { echo "Certificado Developer ID não encontrado no Acesso às Chaves."; exit 1; }
[[ -f $APPLE_API_KEY ]] || { echo "Chave $APPLE_API_KEY não encontrada."; exit 1; }

TAG=${1:-$(gh release view --repo $REPO --json tagName -q .tagName)}
VERSION=${TAG#v}
git fetch -q origin --tags
git cat-file -e "$TAG:build/entitlements.mac.plist" 2>/dev/null || { echo "$TAG é anterior à assinatura Developer ID; use uma release mais nova."; exit 1; }

# Build the tag in a throwaway worktree so this checkout (and this script) stay untouched.
WORK=$(mktemp -d -t noctan-mac)
trap 'git worktree remove --force "$WORK" 2>/dev/null; rm -rf "$WORK"' EXIT
git worktree add -q --detach "$WORK" "$TAG"
cd "$WORK"

npm ci
npm version --allow-same-version --no-git-tag-version "$VERSION" >/dev/null
npm run dist:mac -- --arm64 --publish never

APP=dist/mac-arm64/Noctan.app
xcrun stapler validate "$APP"
spctl -a -t exec "$APP"

gh release upload "$TAG" --repo $REPO --clobber \
  "dist/Noctan-$VERSION-mac-arm64.dmg" \
  "dist/Noctan-$VERSION-mac-arm64.zip" \
  "dist/Noctan-$VERSION-mac-arm64.zip.blockmap" \
  dist/latest-mac.yml
echo "Mac assinado e notarizado publicado em $TAG."
