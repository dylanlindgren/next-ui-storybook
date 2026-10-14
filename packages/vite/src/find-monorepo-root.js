import { existsSync, readFileSync } from 'node:fs'
import { dirname, join } from 'node:path'

// Walk up the directory tree from startPath looking for a monorepo root marker:
// pnpm-workspace.yaml, lerna.json, or a package.json with a `workspaces` field.
// Returns the first matching directory, or null if none is found.
export function findMonorepoRoot(startPath) {
  let dir = startPath
  let prev = null

  while (dir !== prev) {
    if (existsSync(join(dir, 'pnpm-workspace.yaml'))) return dir
    if (existsSync(join(dir, 'lerna.json'))) return dir

    const pkgPath = join(dir, 'package.json')
    if (existsSync(pkgPath)) {
      try {
        const pkg = JSON.parse(readFileSync(pkgPath, 'utf8'))
        if (pkg.workspaces) return dir
      } catch {
        // Malformed package.json — keep walking.
      }
    }

    prev = dir
    dir = dirname(dir)
  }

  return null
}
