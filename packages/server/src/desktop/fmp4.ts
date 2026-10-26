/**
 * Minimal fragmented-MP4 splitter for ffmpeg's `-movflags empty_moov+default_base_moof+frag_keyframe`
 * stdout. Emits the init segment (everything before the first `moof`) once, then one media chunk
 * per `moof` + `mdat` pair. With `frag_keyframe` every fragment starts on a keyframe, so a late
 * subscriber can start at any media chunk after the init segment.
 */

export type Mp4Piece = { readonly kind: "init"; readonly bytes: Uint8Array } | { readonly kind: "media"; readonly bytes: Uint8Array }

const concat = (a: Uint8Array, b: Uint8Array): Uint8Array => {
  if (a.length === 0) return b
  const out = new Uint8Array(a.length + b.length)
  out.set(a, 0)
  out.set(b, a.length)
  return out
}

const readBoxHeader = (buf: Uint8Array): { size: number; type: string } | null => {
  if (buf.length < 8) return null
  const view = new DataView(buf.buffer, buf.byteOffset, buf.byteLength)
  let size = view.getUint32(0)
  const type = String.fromCharCode(buf[4]!, buf[5]!, buf[6]!, buf[7]!)
  if (size === 1) {
    if (buf.length < 16) return null
    size = Number(view.getBigUint64(8))
  } else if (size === 0) {
    // "to end of file": not produced by ffmpeg's streaming muxer; treat as unparseable.
    throw new Error(`mp4 box '${type}' with size 0 is not supported`)
  }
  return { size, type }
}

export class Mp4Splitter {
  private buf: Uint8Array = new Uint8Array(0)
  private head: Uint8Array = new Uint8Array(0)
  private initEmitted = false
  private frag: Uint8Array | null = null

  /** Feed raw bytes; returns completed pieces in stream order. */
  push(data: Uint8Array): Mp4Piece[] {
    this.buf = concat(this.buf, data)
    const out: Mp4Piece[] = []
    for (;;) {
      const h = readBoxHeader(this.buf)
      if (h === null || this.buf.length < h.size) break
      const box = this.buf.slice(0, h.size)
      this.buf = this.buf.subarray(h.size)
      if (h.type === "moof") {
        if (!this.initEmitted) {
          out.push({ kind: "init", bytes: this.head })
          this.head = new Uint8Array(0)
          this.initEmitted = true
        }
        this.frag = box
      } else if (this.frag !== null) {
        this.frag = concat(this.frag, box)
        if (h.type === "mdat") {
          out.push({ kind: "media", bytes: this.frag })
          this.frag = null
        }
      } else if (!this.initEmitted) {
        this.head = concat(this.head, box)
      }
    }
    return out
  }
}

/**
 * Builds the RFC 6381 codec string (`avc1.PPCCLL`) from the avcC box in the init segment,
 * i.e. the profile_idc / constraint flags / level_idc actually written by the encoder.
 */
export const avcCodecString = (init: Uint8Array): string | null => {
  const tag = [0x61, 0x76, 0x63, 0x43] // "avcC"
  for (let i = 0; i + 8 <= init.length; i++) {
    if (init[i] !== tag[0] || init[i + 1] !== tag[1] || init[i + 2] !== tag[2] || init[i + 3] !== tag[3]) continue
    // payload starts after the 'avcC' type: configurationVersion, profile, compat, level
    const p = i + 4
    const hex = (n: number) => n.toString(16).toUpperCase().padStart(2, "0")
    return `avc1.${hex(init[p + 1]!)}${hex(init[p + 2]!)}${hex(init[p + 3]!)}`
  }
  return null
}
