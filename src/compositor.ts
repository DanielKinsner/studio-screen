import { backgrounds } from "./types";
import type { Project } from "./types";
import { clamp } from "./timeline";
import {
  cameraAt,
  clickAt,
  cursorOpacity,
  smoothPointer,
  shortcutAt,
  poseAt,
} from "./motion";
import { PerspectiveRenderer } from "./perspective";
export type Media = {
  video?: HTMLVideoElement | null;
  /** An exactly decoded source frame (export); takes priority over `video`. */
  frame?: { image: CanvasImageSource; width: number; height: number } | null;
  camera?: HTMLVideoElement | null;
  background?: HTMLImageElement | null;
};
export function dimensions(aspect: string, height = 1080) {
  const [a, b] = aspect.split(":").map(Number);
  return { width: Math.round((height * a) / b / 2) * 2, height };
}
function round(
  ctx: CanvasRenderingContext2D,
  x: number,
  y: number,
  w: number,
  h: number,
  r: number,
) {
  ctx.beginPath();
  ctx.roundRect(x, y, w, h, Math.min(r, w / 2, h / 2));
}
function text(
  ctx: CanvasRenderingContext2D,
  value: string,
  x: number,
  y: number,
  size: number,
  color = "#292f2c",
  weight = 400,
) {
  ctx.font = `${weight} ${size}px "Segoe UI", sans-serif`;
  ctx.fillStyle = color;
  ctx.fillText(value, x, y);
}
let sample: HTMLCanvasElement | null = null;
export function demoFrame(t: number) {
  if (!sample) {
    sample = document.createElement("canvas");
    sample.width = 1280;
    sample.height = 800;
  }
  const c = sample.getContext("2d")!;
  c.fillStyle = "#fafbf8";
  c.fillRect(0, 0, 1280, 800);
  c.fillStyle = "#eff0eb";
  c.fillRect(0, 0, 1280, 46);
  ["#e29b8d", "#e0c17d", "#92b391"].forEach((color, i) => {
    c.fillStyle = color;
    c.beginPath();
    c.arc(25 + i * 21, 23, 5, 0, Math.PI * 2);
    c.fill();
  });
  c.fillStyle = "#e4e6df";
  round(c, 453, 10, 370, 26, 6);
  c.fill();
  text(c, "⌑   forma.workspace / your-space", 510, 28, 12, "#788176");
  c.fillStyle = "#f0f2ec";
  c.fillRect(0, 46, 228, 754);
  text(c, "f", 26, 105, 42, "#4f6454", 700);
  text(c, "forma", 55, 101, 27, "#3b4d3f", 650);
  text(c, "A little room to think.", 29, 132, 13, "#7e897d");
  [
    ["◈", "Your space"],
    ["▤", "All projects"],
    ["▧", "Moodboards"],
    ["◷", "Recently opened"],
  ].forEach(([icon, label], i) => {
    if (!i) {
      c.fillStyle = "#dfe6d7";
      round(c, 15, 170, 196, 42, 7);
      c.fill();
    }
    text(c, icon, 29, 197 + i * 49, 19, "#637660");
    text(c, label, 60, 196 + i * 49, 15, "#596554", i ? 400 : 600);
  });
  text(c, "COLLECTIONS", 29, 426, 10, "#919989", 650);
  [
    "Personal projects",
    "A slower kind of Sunday",
    "Things worth keeping",
  ].forEach((v, i) => {
    text(c, "•", 30, 463 + i * 37, 16, ["#bf9c7d", "#889b7c", "#ba9095"][i]);
    text(c, v, 49, 463 + i * 37, 13, "#798273");
  });
  c.fillStyle = "#dfe6d7";
  round(c, 19, 684, 188, 92, 9);
  c.fill();
  text(c, "Good ideas grow here.", 33, 711, 14, "#4f644b", 600);
  text(c, "Make yourself at home.", 33, 735, 12, "#74816e");
  text(c, "Explore your workspace ↗", 33, 759, 12, "#4f644b");
  text(c, "WORKSPACE  /  YOUR SPACE", 280, 96, 10, "#949a8f", 600);
  text(c, "A little less ordinary.", 280, 166, 40, "#374633", 500);
  text(
    c,
    "Collect your thoughts. Connect the dots. Make something good.",
    282,
    199,
    15,
    "#919588",
  );
  c.fillStyle = "#455b42";
  round(c, 1092, 135, 132, 39, 7);
  c.fill();
  text(c, "+  New project", 1106, 160, 13, "#f5f6ed", 500);
  ["All projects", "In progress", "Completed"].forEach((v, i) =>
    text(
      c,
      v,
      281 + i * 120,
      260,
      13,
      i ? "#8d9586" : "#435a3e",
      i ? 400 : 650,
    ),
  );
  c.strokeStyle = "#e3e7dd";
  c.beginPath();
  c.moveTo(280, 278);
  c.lineTo(1224, 278);
  c.stroke();
  c.strokeStyle = "#536b4c";
  c.lineWidth = 2;
  c.beginPath();
  c.moveTo(280, 278);
  c.lineTo(364, 278);
  c.stroke();
  const cards = [
    {
      x: 280,
      title: "The everyday collection",
      sub: "12 ideas · Updated just now",
      color: "#dfdfce",
    },
    {
      x: 606,
      title: "A softer perspective",
      sub: "8 ideas · Updated yesterday",
      color: "#ded0c0",
    },
    {
      x: 932,
      title: "Room to breathe",
      sub: "16 ideas · Updated 2 days ago",
      color: "#c9d5c1",
    },
  ];
  cards.forEach((card, i) => {
    c.save();
    round(c, card.x, 306, 292, 260, 9);
    c.clip();
    c.fillStyle = card.color;
    c.fillRect(card.x, 306, 292, 260);
    if (i === 0) {
      c.fillStyle = "#ebeadd";
      c.fillRect(card.x, 458, 292, 108);
      c.fillStyle = "#68775a";
      c.beginPath();
      c.ellipse(card.x + 147, 491, 66, 17, 0, 0, 7);
      c.fill();
      const g = c.createLinearGradient(card.x + 95, 0, card.x + 180, 0);
      g.addColorStop(0, "#667654");
      g.addColorStop(0.5, "#91a078");
      g.addColorStop(1, "#5c6e4e");
      c.fillStyle = g;
      c.beginPath();
      c.moveTo(card.x + 112, 383);
      c.bezierCurveTo(card.x + 90, 414, card.x + 69, 489, card.x + 120, 505);
      c.bezierCurveTo(card.x + 199, 526, card.x + 211, 465, card.x + 170, 383);
      c.closePath();
      c.fill();
      c.fillStyle = "#4b5f42";
      c.beginPath();
      c.ellipse(card.x + 141, 383, 29, 8, 0, 0, 7);
      c.fill();
      c.strokeStyle = "#657450";
      c.lineWidth = 3;
      c.beginPath();
      c.moveTo(card.x + 143, 385);
      c.quadraticCurveTo(card.x + 175, 329, card.x + 156, 306);
      c.stroke();
    } else if (i === 1) {
      c.translate(card.x + 146, 435);
      c.rotate(-0.14);
      c.fillStyle = "#f3ede0";
      c.shadowColor = "#81684e44";
      c.shadowBlur = 18;
      c.fillRect(-96, -89, 179, 199);
      c.shadowBlur = 0;
      c.fillStyle = "#a7795e";
      c.beginPath();
      c.arc(0, 0, 56, Math.PI, 0);
      c.lineTo(56, 73);
      c.lineTo(-56, 73);
      c.fill();
      c.fillStyle = "#d5b49a";
      c.beginPath();
      c.arc(0, 8, 34, Math.PI, 0);
      c.lineTo(34, 73);
      c.lineTo(-34, 73);
      c.fill();
    } else {
      c.fillStyle = "#e1e5d7";
      c.beginPath();
      c.arc(card.x + 246, 352, 143, 0, 7);
      c.fill();
      for (let n = 0; n < 8; n++) {
        c.save();
        c.translate(card.x + 154, 558);
        c.rotate((n - 4) * 0.16);
        c.strokeStyle = "#677e57";
        c.lineWidth = 2;
        c.beginPath();
        c.moveTo(0, 0);
        c.lineTo(0, -180 + n * 6);
        c.stroke();
        for (let k = 0; k < 5; k++) {
          c.fillStyle = k % 2 ? "#82946e" : "#71885f";
          c.beginPath();
          c.ellipse(
            k % 2 ? 12 : -12,
            -60 - k * 23,
            20,
            7,
            k % 2 ? -0.6 : 0.6,
            0,
            7,
          );
          c.fill();
        }
        c.restore();
      }
    }
    c.restore();
    text(c, card.title, card.x, 599, 17, "#485340", 550);
    text(c, card.sub, card.x, 624, 12, "#989c90");
  });
  text(c, "A thought for today", 280, 704, 13, "#79866d", 600);
  text(
    c,
    "“Almost everything will work again if you unplug it for a few minutes. Including you.”",
    280,
    735,
    16,
    "#7c8872",
  );
  text(c, "— Anne Lamott", 280, 763, 12, "#969f8e");
  if (t > 17 && t < 22) {
    c.fillStyle = "#455b42";
    round(c, 997, 69, 225, 37, 8);
    c.fill();
    text(c, "✓  Your ideas, all in one place", 1013, 92, 13, "#f3f5ea");
  }
  return sample;
}
function drawBackground(
  c: CanvasRenderingContext2D,
  w: number,
  h: number,
  p: Project,
  media: Media,
) {
  const s = p.settings;
  const colors = backgrounds.find((b) => b.id === s.background)?.colors;
  if (colors) {
    const g = c.createLinearGradient(w * 0.15, 0, w * 0.85, h);
    colors.forEach((v, i) => g.addColorStop(i / (colors.length - 1), v));
    c.fillStyle = g;
    c.fillRect(0, 0, w, h);
    c.save();
    c.globalAlpha = 0.1;
    c.fillStyle = "#fff4da";
    c.beginPath();
    c.ellipse(w * 0.12, h * 1.05, w * 0.8, h * 0.46, -0.42, 0, Math.PI * 2);
    c.fill();
    c.restore();
  } else {
    c.fillStyle = s.color;
    c.fillRect(0, 0, w, h);
  }
  if (s.background === "image" && media.background?.complete) {
    const image = media.background;
    const scale = Math.max(w / image.width, h / image.height);
    c.drawImage(
      image,
      (w - image.width * scale) / 2,
      (h - image.height * scale) / 2,
      image.width * scale,
      image.height * scale,
    );
  }
}
function drawScreen(
  c: CanvasRenderingContext2D,
  w: number,
  h: number,
  p: Project,
  t: number,
  media: Media,
) {
  const s = p.settings;
  const frame = media.frame;
  const source = p.demo ? demoFrame(t) : (frame?.image ?? media.video);
  const sw = p.demo ? 1280 : frame?.width || media.video?.videoWidth || 1920,
    sh = p.demo ? 800 : frame?.height || media.video?.videoHeight || 1080;
  const pad = (Math.min(w, h) * s.padding) / 100;
  const fit = Math.min((w - pad * 2) / sw, (h - pad * 2) / sh);
  const fw = sw * fit,
    fh = sh * fit,
    fx = (w - fw) / 2,
    fy = (h - fh) / 2;
  c.save();
  c.shadowColor = `rgba(30,16,22,${s.shadow / 130})`;
  c.shadowBlur = h * 0.06;
  c.shadowOffsetY = h * 0.025;
  round(c, fx, fy, fw, fh, (s.radius * h) / 720);
  c.fillStyle = "#eff0ea";
  c.fill();
  c.restore();
  c.save();
  round(c, fx, fy, fw, fh, (s.radius * h) / 720);
  c.clip();
  const zoom = cameraAt(p, t);
  const scale = zoom.scale * (1 + s.crop / 100);
  const zx = clamp(zoom.x * fw * scale - fw / 2, 0, fw * (scale - 1));
  const zy = clamp(zoom.y * fh * scale - fh / 2, 0, fh * (scale - 1));
  c.translate(fx - zx, fy - zy);
  c.scale(scale, scale);
  if (source && (p.demo || frame || (media.video?.readyState || 0) >= 2))
    c.drawImage(source, 0, 0, fw, fh);
  if (s.showCursor && (p.demo || p.points.length)) {
    const point = smoothPointer(p, t);
    c.save();
    c.globalAlpha = cursorOpacity(p, t);
    c.translate(point.x * fw, point.y * fh);
    const click = clickAt(p, t);
    if (s.cursorHighlight && click !== undefined) {
      c.beginPath();
      c.arc(0, 0, ((12 + (t - click) * 45) * h) / 720, 0, 7);
      c.fillStyle = `rgba(238,139,101,${0.5 - (t - click)})`;
      if (s.clickStyle === "ring") {
        c.strokeStyle = c.fillStyle;
        c.lineWidth = (2 * h) / 720;
        c.stroke();
      } else c.fill();
    }
    const cs = (s.cursorSize * h) / 720;
    c.scale(cs, cs);
    c.rotate((s.cursorAngle * Math.PI) / 180);
    c.beginPath();
    c.moveTo(0, 0);
    c.lineTo(0, 21);
    c.lineTo(5.7, 15.5);
    c.lineTo(10.2, 25);
    c.lineTo(14.4, 23);
    c.lineTo(10, 14);
    c.lineTo(18, 14);
    c.closePath();
    if (s.cursorStyle === "dot") {
      c.beginPath();
      c.arc(0, 0, 6, 0, Math.PI * 2);
    }
    c.fillStyle = s.cursorStyle === "light" ? "#fff9ee" : "#242823";
    c.strokeStyle = s.cursorStyle === "light" ? "#252823" : "#fcfcf7";
    c.lineWidth = 1.6;
    c.stroke();
    c.fill();
    c.restore();
  }
  c.restore();

  if (s.deviceFrame === "browser") {
    c.save();
    round(c, fx, fy, fw, Math.max(18, h * 0.03), (s.radius * h) / 720);
    c.fillStyle = "#f1f0e9";
    c.fill();
    ["#d79280", "#d1b974", "#92ae82"].forEach((color, i) => {
      c.beginPath();
      c.fillStyle = color;
      c.arc(fx + h * 0.015 + i * h * 0.015, fy + h * 0.015, h * 0.0037, 0, 7);
      c.fill();
    });
    c.restore();
  }
}
function drawOverlays(canvas: HTMLCanvasElement, p: Project, t: number) {
  const c = canvas.getContext("2d")!;
  const { width: w, height: h } = canvas;
  const s = p.settings;
  p.annotations
    .filter((a) => t >= a.start && t <= a.end)
    .forEach((a) => {
      const x = a.x * w,
        y = a.y * h,
        aw = a.width * w,
        ah = a.height * h;
      c.save();
      if (a.type === "blur") {
        c.fillStyle = "#25282b";
        round(c, x, y, aw, ah, 5);
        c.fill();
      } else if (a.type === "soft-blur") {
        round(c, x, y, aw, ah, 6);
        c.clip();
        c.filter = `blur(${((a.intensity || 12) * h) / 720}px)`;
        c.drawImage(canvas, 0, 0);
        c.filter = "none";
      } else if (a.type === "rectangle" || a.type === "ellipse") {
        c.strokeStyle = a.color || "#efb18c";
        c.lineWidth = h * 0.005;
        c.beginPath();
        if (a.type === "ellipse")
          c.ellipse(x + aw / 2, y + ah / 2, aw / 2, ah / 2, 0, 0, Math.PI * 2);
        else c.roundRect(x, y, aw, ah, 8);
        c.stroke();
      } else if (a.type === "step") {
        c.beginPath();
        c.arc(x, y, h * 0.025, 0, Math.PI * 2);
        c.fillStyle = a.color || "#efb18c";
        c.fill();
        c.textAlign = "center";
        text(c, a.text, x, y + h * 0.009, h * 0.026, "#29261f", 650);
        c.textAlign = "left";
      } else if (a.type === "spotlight") {
        c.fillStyle = "#12181cb3";
        c.beginPath();
        c.rect(0, 0, w, h);
        c.roundRect(x, y, aw, ah, 12);
        c.fill("evenodd");
      } else if (a.type === "arrow") {
        c.strokeStyle = a.color || "#ffb087";
        c.lineWidth = h / 130;
        c.lineCap = "round";
        c.beginPath();
        c.moveTo(x, y + ah);
        c.lineTo(x + aw, y);
        c.lineTo(x + aw - h * 0.027, y + h * 0.003);
        c.moveTo(x + aw, y);
        c.lineTo(x + aw - h * 0.005, y + h * 0.027);
        c.stroke();
      } else {
        c.font = `600 ${(h * s.captionSize) / 1007}px "Segoe UI", sans-serif`;
        const tw = c.measureText(a.text).width;
        c.fillStyle = "#202528ed";
        round(
          c,
          x - h * 0.012,
          y - h * 0.04,
          tw + h * 0.024,
          h * 0.06,
          h * 0.01,
        );
        c.fill();
        text(c, a.text, x, y, h * 0.037, a.color || "#fff9ef", 600);
      }
      c.restore();
    });
  const caption =
    s.captions && p.captions.find((a) => t >= a.start && t <= a.end);
  if (caption) {
    c.font = `550 ${(h * s.captionSize) / 100}px "Segoe UI", sans-serif`;
    const words = caption.text.split(/\s+/),
      lines: string[] = [];
    let line = "";
    for (const word of words) {
      const next = line ? `${line} ${word}` : word;
      if (c.measureText(next).width > w * 0.8 && line) {
        lines.push(line);
        line = word;
      } else line = next;
    }
    if (line) lines.push(line);
    const lineH = h * (s.captionSize / 100 + 0.015);
    const maxW = Math.min(
      w * 0.85,
      Math.max(...lines.map((l) => c.measureText(l).width)) + h * 0.04,
    );
    const y = (h * s.captionPosition) / 100 - lines.length * lineH;
    c.fillStyle =
      s.captionTheme === "light"
        ? "#f5f1e9ee"
        : s.captionTheme === "minimal"
          ? "#00000000"
          : "#202326df";
    round(
      c,
      (w - maxW) / 2,
      y,
      maxW,
      lines.length * lineH + h * 0.013,
      h * 0.01,
    );
    c.fill();
    c.fillStyle = s.captionTheme === "light" ? "#222b24" : "#fffaf1";
    if (s.captionTheme === "minimal") {
      c.shadowColor = "#111";
      c.shadowBlur = h * 0.006;
    }
    c.textAlign = "center";
    lines.forEach((l, i) => c.fillText(l, w / 2, y + lineH * (i + 0.8)));
    c.textAlign = "left";
  }

  c.shadowBlur = 0;
  const key = s.showShortcuts ? shortcutAt(p, t) : undefined;
  if (key) {
    c.font = `500 ${h * 0.025}px "Segoe UI",sans-serif`;
    const kw = c.measureText(key.shortcut!).width + h * 0.045;
    round(c, (w - kw) / 2, h * 0.065, kw, h * 0.047, h * 0.009);
    c.fillStyle = "#22292bef";
    c.fill();
    c.strokeStyle = "#ffffff35";
    c.lineWidth = 1;
    c.stroke();
    c.fillStyle = "#f8f5ec";
    c.textAlign = "center";
    c.fillText(key.shortcut!, w / 2, h * 0.097);
    c.textAlign = "left";
  }
  if (s.watermark) {
    c.save();
    c.globalAlpha = s.watermarkOpacity / 100;
    c.textAlign = "right";
    text(c, s.watermark, w * 0.97, h * 0.96, h * 0.02, "#fffaf1", 550);
    c.restore();
  }
}

const scenes = new WeakMap<
  HTMLCanvasElement,
  {
    screen: HTMLCanvasElement;
    accum: HTMLCanvasElement;
    perspective?: PerspectiveRenderer;
  }
>();
export function releaseCompositor(canvas: HTMLCanvasElement) {
  scenes.get(canvas)?.perspective?.dispose();
  scenes.delete(canvas);
}
export function renderFrame(
  canvas: HTMLCanvasElement,
  p: Project,
  t: number,
  media: Media = {},
) {
  const c = canvas.getContext("2d")!;
  const { width: w, height: h } = canvas;
  c.setTransform(1, 0, 0, 1, 0, 0);
  c.globalAlpha = 1;
  c.filter = "none";
  c.clearRect(0, 0, w, h);
  drawBackground(c, w, h, p, media);
  const pose = poseAt(p, t),
    active3d =
      Math.abs(pose.x) +
        Math.abs(pose.y) +
        Math.abs(pose.z) +
        Math.abs(pose.offsetX) +
        Math.abs(pose.offsetY) >
      0.001;
  const blur = p.settings.motionBlur || 0;
  if (!active3d && !blur) drawScreen(c, w, h, p, t, media);
  else {
    let scene = scenes.get(canvas);
    if (!scene) {
      scene = {
        screen: document.createElement("canvas"),
        accum: document.createElement("canvas"),
      };
      scenes.set(canvas, scene);
    }
    if (scene.screen.width !== w || scene.screen.height !== h) {
      scene.screen.width = w;
      scene.screen.height = h;
      scene.accum.width = w;
      scene.accum.height = h;
    }
    const sc = scene.screen.getContext("2d")!;
    const count = blur > 0 ? 3 : 1;
    const ac = scene.accum.getContext("2d")!;
    ac.clearRect(0, 0, w, h);
    ac.globalCompositeOperation = "lighter";
    ac.globalAlpha = 1 / count;
    for (let i = 0; i < count; i++) {
      const st = Math.max(0, t - ((count - 1 - i) * blur) / 6000);
      sc.clearRect(0, 0, w, h);
      drawScreen(sc, w, h, p, st, media);
      if (active3d) {
        scene.perspective ??= new PerspectiveRenderer();
        ac.drawImage(
          scene.perspective.render(scene.screen, poseAt(p, st)),
          0,
          0,
        );
      } else ac.drawImage(scene.screen, 0, 0);
    }
    c.drawImage(scene.accum, 0, 0);
  }
  drawOverlays(canvas, p, t);
}
