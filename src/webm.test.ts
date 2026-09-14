import { describe, expect, it } from "vitest";
import { finalizeWebm } from "./webm";
describe("Streaming WebM finalization", () => {
  it("inserts duration without altering successive unknown-sized cluster bytes", async () => {
    // Empty EBML header, unknown Segment, Info containing a 1ms timecode scale.
    const prefix = new Uint8Array([
      0x1a, 0x45, 0xdf, 0xa3, 0x80, 0x18, 0x53, 0x80, 0x67, 0x01, 255, 255, 255,
      255, 255, 255, 255, 0x15, 0x49, 0xa9, 0x66, 0x87, 0x2a, 0xd7, 0xb1, 0x83,
      0x0f, 0x42, 0x40,
    ]);
    const clusters = new Uint8Array([
      0x1f, 0x43, 0xb6, 0x75, 0x01, 255, 255, 255, 255, 255, 255, 255, 0xe7,
      0x81, 0, 0x1f, 0x43, 0xb6, 0x75, 0x01, 255, 255, 255, 255, 255, 255, 255,
      0xe7, 0x82, 0x03, 0xe8,
    ]);
    const result = new Uint8Array(
      await (
        await finalizeWebm(
          new Blob([prefix, clusters], { type: "video/webm" }),
          2500,
        )
      ).arrayBuffer(),
    );
    expect(result.length).toBe(prefix.length + clusters.length + 11);
    expect(result.slice(-clusters.length)).toEqual(clusters);
    expect(result.slice(9, 17)).toEqual(prefix.slice(9, 17));
    expect(
      new DataView(result.buffer).getFloat64(prefix.length + 3, false),
    ).toBe(2500);
  });
});
