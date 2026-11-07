import type { GitLogData } from './schema'
import GHFileGrass from './gh_file_grass'

export interface DrawOptions {
  /** Element to draw into. Its existing children are left untouched. */
  container: HTMLElement
}

export interface FileGrassHandle {
  /** Remove everything this instance added and restore the container. */
  destroy(): void
}

const CONTAINER_CLASS = 'gh-file-grass'
let instanceSeq = 0

/**
 * Draw the file grass of `data` into `options.container`.
 * `data` is never modified (it is cloned first). To redraw, call `destroy()` and then `draw()`.
 */
export function draw(data: GitLogData, options: DrawOptions): FileGrassHandle {
  const { container } = options
  const hadClass = container.classList.contains(CONTAINER_CLASS)
  const prevPosition = container.style.position
  // The tooltip is positioned relative to the container.
  const needsPosition = getComputedStyle(container).position === 'static'

  container.classList.add(CONTAINER_CLASS)
  if (needsPosition) container.style.position = 'relative'

  const instance = new GHFileGrass(container, `gfg${++instanceSeq}-`)
  let destroyed = false
  const restore = () => {
    instance.destroy()
    if (!hadClass) container.classList.remove(CONTAINER_CLASS)
    if (needsPosition) container.style.position = prevPosition
  }

  try {
    instance.draw(structuredClone(data))
  } catch (e) {
    restore()
    throw e
  }

  return {
    destroy() {
      if (destroyed) return
      destroyed = true
      restore()
    },
  }
}
