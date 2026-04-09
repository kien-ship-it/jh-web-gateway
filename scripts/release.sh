#!/usr/bin/env bash
set -e

VERSION=$1

if [ -z "$VERSION" ]; then
  echo "Usage: npm run release <version>"
  echo "Examples:"
  echo "  npm run release 1.0.1"
  echo "  npm run release 1.1.0"
  echo "  npm run release 2.0.0"
  exit 1
fi

# Validate semver format
if ! [[ "$VERSION" =~ ^[0-9]+\.[0-9]+\.[0-9]+$ ]]; then
  echo "Error: version must be in semver format (e.g. 1.0.1)"
  exit 1
fi

echo "Releasing v$VERSION..."

# Ensure working tree is clean
if [ -n "$(git status --porcelain)" ]; then
  echo "Error: working tree is dirty. Commit or stash changes first."
  exit 1
fi

# Bump version in package.json, commit, and tag
npm version "$VERSION" --message "chore: release v%s"

# Push commit + tag — this triggers the GitHub Actions workflow
git push && git push --tags

echo ""
echo "Done. GitHub Actions will now:"
echo "  1. Run tests"
echo "  2. Build"
echo "  3. Publish to npm"
echo "  4. Create a GitHub release"
echo ""
echo "Watch progress at: https://github.com/$(git remote get-url origin | sed 's/.*github.com[:/]//' | sed 's/\.git$//')/actions"
