import fs from 'node:fs/promises'

export async function exists(p) {
  try {
    await fs.access(p)
    return true
  } catch {
    return false
  }
}

export async function readJson(file) {
  return JSON.parse(await fs.readFile(file, 'utf8'))
}
