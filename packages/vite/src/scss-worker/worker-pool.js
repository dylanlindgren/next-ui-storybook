import { Worker } from 'node:worker_threads'
import { cpus } from 'node:os'
import { fileURLToPath } from 'node:url'
import path from 'node:path'

const WORKER_FILE = path.join(
  path.dirname(fileURLToPath(import.meta.url)),
  'worker.js',
)

// A pool of worker threads that compile SCSS in parallel. Each worker loads
// `sass` from the consumer project's node_modules (via projectRoot) so the
// version matches what the consumer has installed — consistent with how the
// main thread resolves it.
export class ScssWorkerPool {
  #projectRoot
  #size
  #workers = []
  #queue = []
  #started = false

  constructor({ projectRoot, size } = {}) {
    this.#projectRoot = projectRoot
    this.#size = size ?? Math.min(8, Math.max(1, cpus().length - 1))
  }

  // Lazily spin up workers on first use so the pool doesn't block startup.
  #start() {
    if (this.#started) return
    for (let i = 0; i < this.#size; i++) {
      const worker = new Worker(WORKER_FILE, {
        workerData: { projectRoot: this.#projectRoot },
      })
      worker._busy = false
      this.#workers.push(worker)
    }
    this.#started = true
  }

  // Compile `content` (SCSS source for `filePath`) in a worker thread. Options
  // mirror sass.compileString: loadPaths (array of strings), url (URL object),
  // and quietDeps (boolean). Returns a promise that resolves with the
  // compiled CSS string.
  compile(content, filePath, { loadPaths, url, quietDeps } = {}) {
    this.#start()
    return new Promise((resolve, reject) => {
      const task = {
        content,
        filePath,
        loadPaths: loadPaths ?? [path.dirname(filePath)],
        urlHref: url?.href,
        quietDeps: !!quietDeps,
        resolve,
        reject,
      }
      const idle = this.#workers.find((w) => !w._busy)
      if (idle) {
        this.#dispatch(idle, task)
      } else {
        this.#queue.push(task)
      }
    })
  }

  #dispatch(worker, task) {
    worker._busy = true

    const onMessage = (msg) => {
      cleanup()
      worker._busy = false
      if (msg.error) {
        task.reject(new Error(msg.error))
      } else {
        task.resolve(msg.css)
      }
      const next = this.#queue.shift()
      if (next) this.#dispatch(worker, next)
    }

    const onError = (err) => {
      cleanup()
      worker._busy = false
      task.reject(err)
    }

    const cleanup = () => {
      worker.off('message', onMessage)
      worker.off('error', onError)
    }

    worker.on('message', onMessage)
    worker.on('error', onError)
    worker.postMessage({
      content: task.content,
      filePath: task.filePath,
      loadPaths: task.loadPaths,
      urlHref: task.urlHref,
      quietDeps: task.quietDeps,
    })
  }

  terminate() {
    for (const w of this.#workers) w.terminate()
    this.#workers = []
    this.#started = false
  }
}
