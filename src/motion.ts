import type { Zoom } from "./types";
export { cameraAt, poseAt, type Pose } from "./camera";
export {
  pointerAt,
  smoothPointer,
  cursorOpacity,
  clickAt,
  shortcutAt,
} from "./cursorPath";
export const tiltPresets: { name: string; value: Partial<Zoom> }[] = [
  { name: "Left", value: { tiltX: -8, tiltY: 22, tiltZ: -3 } },
  { name: "Right", value: { tiltX: -8, tiltY: -22, tiltZ: 3 } },
  { name: "Overhead", value: { tiltX: 25, tiltY: 0, tiltZ: 0 } },
  { name: "Hero", value: { tiltX: -16, tiltY: 24, tiltZ: -5 } },
];
