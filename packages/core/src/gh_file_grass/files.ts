import type { FileEntry } from '../schema'

/** FileEntry + position saved by GHFileGrassBase._px()/_py() */
export interface FileDatum extends FileEntry {
  px: number
  py: number
}

export default class GHLogFiles {
  files: FileDatum[]
  all: FileDatum[] // alias
  length: number

  constructor(files: FileEntry[]) {
    this.files = files.map((f) => ({ ...f, px: 0, py: 0 }))
    this.all = this.files
    this.length = this.files.length
  }

  maxFileNameLength(): number {
    const fileLengthList = this.files.map((d) => d.name.length)
    return Math.max(0, ...fileLengthList)
  }

  indexOf(fileName: string): number {
    return this.files.map((d) => d.name).indexOf(fileName) + 1
  }
}
