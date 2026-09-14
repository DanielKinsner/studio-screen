/** Add duration to MediaRecorder WebM without rewriting unknown-sized clusters. */
function vint(bytes: Uint8Array, at: number, id = false) {
  let length = 1;
  while (length <= 8 && !(bytes[at] & (1 << (8 - length)))) length++;
  if (length > 8 || at + length > bytes.length)
    throw new Error("Invalid WebM header.");
  let value = id ? bytes[at] : bytes[at] & ((1 << (8 - length)) - 1);
  let unknown = !id && value === (1 << (8 - length)) - 1;
  for (let i = 1; i < length; i++) {
    value = value * 256 + bytes[at + i];
    unknown = unknown && bytes[at + i] === 255;
  }
  return { length, value, unknown };
}
function sizeBytes(value: number, minLength = 1) {
  let length = minLength;
  while (value >= 2 ** (7 * length) - 1) length++;
  const result = new Uint8Array(length);
  for (let i = length - 1; i >= 0; i--) {
    result[i] = value % 256;
    value = Math.floor(value / 256);
  }
  result[0] |= 1 << (8 - length);
  return result;
}
export async function finalizeWebm(blob: Blob, durationMs: number) {
  const bytes = new Uint8Array(await blob.arrayBuffer());
  let at = 0,
    segmentSizeAt = 0;
  while (at < bytes.length) {
    const id = vint(bytes, at, true);
    const size = vint(bytes, at + id.length);
    if (id.value === 0x18538067) {
      segmentSizeAt = at + id.length;
      at += id.length + size.length;
      break;
    }
    at += id.length + size.length + size.value;
  }
  if (!segmentSizeAt) return blob;
  const segmentSize = vint(bytes, segmentSizeAt);
  while (at < Math.min(bytes.length, 256000)) {
    const id = vint(bytes, at, true);
    const size = vint(bytes, at + id.length);
    const content = at + id.length + size.length;
    if (id.value === 0x1549a966) {
      let child = content,
        timecodeScale = 1000000;
      while (child < content + size.value) {
        const cid = vint(bytes, child, true),
          cs = vint(bytes, child + cid.length);
        const pos = child + cid.length + cs.length;
        if (cid.value === 0x2ad7b1) {
          timecodeScale = 0;
          for (let i = 0; i < cs.value; i++)
            timecodeScale = timecodeScale * 256 + bytes[pos + i];
        }
        if (cid.value === 0x4489) return blob;
        child = pos + cs.value;
      }
      const duration = new Uint8Array(11);
      duration.set([0x44, 0x89, 0x88]);
      new DataView(duration.buffer).setFloat64(
        3,
        (durationMs * 1000000) / timecodeScale,
        false,
      );
      const infoSize = sizeBytes(size.value + duration.length, size.length);
      const delta = duration.length + infoSize.length - size.length;
      const beforeInfo = bytes.slice(0, at + id.length);
      if (!segmentSize.unknown) {
        const replacement = sizeBytes(
          segmentSize.value + delta,
          segmentSize.length,
        );
        if (replacement.length !== segmentSize.length) return blob;
        beforeInfo.set(replacement, segmentSizeAt);
      }
      return new Blob(
        [
          beforeInfo,
          infoSize,
          bytes.slice(content, content + size.value),
          duration,
          bytes.slice(content + size.value),
        ],
        { type: blob.type },
      );
    }
    if (size.unknown) break;
    at = content + size.value;
  }
  return blob;
}
