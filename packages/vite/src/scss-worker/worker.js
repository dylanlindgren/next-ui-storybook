import { parentPort, workerData } from 'node:worker_threads'
import { createRequire } from 'node:module'
import { pathToFileURL } from 'node:url'
import path from 'node:path'

import { createNodeFileImporter } from './node-file-importer.js'

if (!parentPort) throw new Error('This file must be run as a worker thread.')

// Resolve sass from the consumer project so the version matches what the
// main thread uses — same approach as requireFrom() in plugins.js.
const require = createRequire(path.join(workerData.projectRoot, 'package.json'))
let compileString

function getSassCompile() {
  if (!compileString) compileString = require('sass').compileString
  return compileString
}

parentPort.on('message', ({ content, filePath, loadPaths, urlHref, quietDeps }) => {
  try {
    const compile = getSassCompile()
    const { css } = compile(content, {
      loadPaths: loadPaths ?? [path.dirname(filePath)],
      importers: [createNodeFileImporter(filePath)],
      url: urlHref ? new URL(urlHref) : pathToFileURL(filePath),
      quietDeps: !!quietDeps,
    })
    parentPort.postMessage({ css })
  } catch (err) {
    parentPort.postMessage({ error: err instanceof Error ? err.message : String(err) })
  }
})
