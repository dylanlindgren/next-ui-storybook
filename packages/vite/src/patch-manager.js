import { existsSync, readFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import semver from 'semver'

// Applies user-defined code patches to npm package files during bundling.
//
// Patches are keyed by package-relative path — the portion of the file's
// absolute path after `node_modules/`. For example:
//   '@servicenow/now-collapse/src/now-collapse.js'
//
// Supported operations (applied in this order if multiple are present):
//   replacePattern + replaceWith  — global regex replace
//   prependCode                   — insert code before the file content
//   appendCode                    — insert code after the file content
//
// All operations can be restricted to a semver range via `applyToVersions`
// (e.g. '>=25.0.0 <26.0.0'). If the file's package.json version doesn't
// satisfy the range the patch is skipped for that file.
export class PatchManager {
  #rules
  #matched // Set<ruleKey> — rules that matched at least once

  constructor(rules = {}) {
    this.#rules = rules
    this.#matched = new Set()
  }

  // Strip the node_modules/ prefix from an absolute path to get the
  // package-relative path used as the rule key.
  #relativeKey(absolutePath) {
    const marker = 'node_modules/'
    const idx = absolutePath.lastIndexOf(marker)
    return idx === -1 ? null : absolutePath.slice(idx + marker.length)
  }

  // Walk up from filePath to find the nearest package.json and return its
  // `version` field, or null if unavailable.
  #resolveVersion(filePath) {
    let dir = dirname(filePath)
    let prev = null
    while (dir !== prev) {
      const candidate = join(dir, 'package.json')
      if (existsSync(candidate)) {
        try {
          return JSON.parse(readFileSync(candidate, 'utf8')).version ?? null
        } catch {
          return null
        }
      }
      prev = dir
      dir = dirname(dir)
    }
    return null
  }

  // Apply any matching patch rule to `content` for the given absolute file
  // path. Returns the patched string, or null if no patch applies.
  applyPatch(absolutePath, content) {
    const key = this.#relativeKey(absolutePath)
    if (!key || !(key in this.#rules)) return null

    const rule = this.#rules[key]

    if (rule.applyToVersions != null) {
      const version = this.#resolveVersion(absolutePath)
      if (!version || !semver.satisfies(version, rule.applyToVersions)) return null
    }

    this.#matched.add(key)

    let out = content

    if (rule.replacePattern != null && rule.replaceWith != null) {
      out = out.replace(new RegExp(rule.replacePattern, 'g'), rule.replaceWith)
    }
    if (rule.prependCode) out = `${rule.prependCode}\n${out}`
    if (rule.appendCode) out = `${out}\n${rule.appendCode}`

    return out
  }

  // Log a summary of applied and never-matched rules.
  printStats() {
    const total = Object.keys(this.#rules).length
    const matched = this.#matched.size
    console.log(`[sn-next-ui] patch-manager: ${matched}/${total} rules matched`)
    const unmatched = Object.keys(this.#rules).filter((k) => !this.#matched.has(k))
    if (unmatched.length > 0) {
      console.log(
        `[sn-next-ui] patch-manager: rules never matched:\n${unmatched.map((k) => `  - ${k}`).join('\n')}`,
      )
    }
  }
}
