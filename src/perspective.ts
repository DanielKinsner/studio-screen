import type { Pose } from "./motion";

/** A rectangle on the flat screen layer, in the quad's -1..1 space (y up). */
export type CardRect = {
  left: number;
  top: number;
  right: number;
  bottom: number;
};
/** Share of the frame kept clear around a fitted 3D card. */
export const FIT_MARGIN = 0.02;

/** How far the virtual camera sits from the screen plane (matches the shader). */
export const cameraDistance = (perspective: number, aspect: number) =>
  1 / Math.tan((perspective * Math.PI) / 360) + aspect * 0.6;

/**
 * Where a point of the flat layer (-1..1, y up) lands on the canvas after the
 * 3D pose, in the same -1..1 space: exactly the vertex shader's math, then the
 * fit-to-frame scale.
 */
/** Rotate a point by the pose's X, Y then Z angles, as the shader does. */
function rotate(pose: Pose, x: number, y: number, z: number) {
  const rad = Math.PI / 180;
  const cx = Math.cos(pose.x * rad),
    sx = Math.sin(pose.x * rad),
    cy = Math.cos(pose.y * rad),
    sy = Math.sin(pose.y * rad),
    cz = Math.cos(pose.z * rad),
    sz = Math.sin(pose.z * rad);
  [y, z] = [y * cx - z * sx, y * sx + z * cx];
  [x, z] = [x * cy + z * sy, -x * sy + z * cy];
  [x, y] = [x * cz - y * sz, x * sz + y * cz];
  return [x, y, z] as const;
}

export function project(
  pose: Pose,
  aspect: number,
  px: number,
  py: number,
  fit = 1,
) {
  const [x, y, z] = rotate(pose, px * aspect, py, 0);
  const distance = cameraDistance(pose.perspective, aspect);
  const w = distance - z;
  return {
    x: ((((x / aspect) * pose.scale + (pose.offsetX / 100) * 2) * distance) / w) * fit,
    y: (((y * pose.scale - (pose.offsetY / 100) * 2) * distance) / w) * fit,
    w,
  };
}

/**
 * The inverse of `project`: which point of the flat layer (-1..1, y up) is
 * shown at a canvas point. A tilted plane seen in perspective is a
 * homography, so this solves two linear equations.
 */
export function unproject(
  pose: Pose,
  aspect: number,
  qx: number,
  qy: number,
  fit = 1,
) {
  const [ax, ay, az] = rotate(pose, aspect, 0, 0);
  const [bx, by, bz] = rotate(pose, 0, 1, 0);
  const d = cameraDistance(pose.perspective, aspect),
    k = fit * d * pose.scale,
    ox = fit * d * ((pose.offsetX / 100) * 2),
    oy = fit * d * ((pose.offsetY / 100) * 2);
  // qx·(d − z) = k·x/aspect + ox and qy·(d − z) = k·y − oy, with x, y, z
  // linear in the layer point (px, py).
  const a11 = -qx * az - (k * ax) / aspect,
    a12 = -qx * bz - (k * bx) / aspect,
    b1 = ox - qx * d;
  const a21 = -qy * az - k * ay,
    a22 = -qy * bz - k * by,
    b2 = -oy - qy * d;
  const det = a11 * a22 - a12 * a21;
  return {
    x: (b1 * a22 - a12 * b2) / det,
    y: (a11 * b2 - b1 * a21) / det,
  };
}

/**
 * The largest scale (at most 1) that keeps all four corners of the card inside
 * the frame, with a small margin. The margin fades in with the amount of 3D,
 * so a flat card that already touches the edges (padding 0) never jumps.
 */
export function fitScale(
  pose: Pose,
  aspect: number,
  margin = FIT_MARGIN,
  card: CardRect = { left: -1, top: 1, right: 1, bottom: -1 },
) {
  const amount = Math.min(
    1,
    (Math.abs(pose.x) +
      Math.abs(pose.y) +
      Math.abs(pose.z) +
      Math.abs(pose.offsetX) +
      Math.abs(pose.offsetY)) /
      4,
  );
  const limit = 1 - margin * amount;
  let fit = 1;
  for (const px of [card.left, card.right])
    for (const py of [card.top, card.bottom]) {
      const q = project(pose, aspect, px, py);
      if (q.w <= 1e-6) return 0.05;
      const extent = Math.max(Math.abs(q.x), Math.abs(q.y));
      if (extent > limit) fit = Math.min(fit, limit / extent);
    }
  return fit;
}

/** A textured screen plane projected in 3D; this canvas is also used by video exports. */
export class PerspectiveRenderer {
  canvas = document.createElement("canvas");
  gl: WebGLRenderingContext | null;
  program: WebGLProgram | null = null;
  constructor() {
    const gl = this.canvas.getContext("webgl", {
      alpha: true,
      premultipliedAlpha: true,
      preserveDrawingBuffer: true,
      antialias: true,
    });
    this.gl = gl;
    if (!gl) return;
    const shader = (type: number, source: string) => {
      const s = gl.createShader(type)!;
      gl.shaderSource(s, source);
      gl.compileShader(s);
      if (!gl.getShaderParameter(s, gl.COMPILE_STATUS))
        throw new Error(gl.getShaderInfoLog(s) || "3D shader error");
      return s;
    };
    const p = gl.createProgram()!;
    gl.attachShader(
      p,
      shader(
        gl.VERTEX_SHADER,
        `attribute vec2 position;varying vec2 uv;uniform vec3 angles;uniform vec2 offset;uniform float aspect;uniform float distance;uniform float scale;uniform float fit;
      void main(){uv=vec2((position.x+1.0)*.5,(1.0-position.y)*.5);vec3 v=vec3(position.x*aspect,position.y,0.0);vec3 c=cos(angles),s=sin(angles);v=vec3(v.x,v.y*c.x-v.z*s.x,v.y*s.x+v.z*c.x);v=vec3(v.x*c.y+v.z*s.y,v.y,-v.x*s.y+v.z*c.y);v=vec3(v.x*c.z-v.y*s.z,v.x*s.z+v.y*c.z,v.z);float w=distance-v.z;gl_Position=vec4((v.x/aspect*scale+offset.x*2.0)*distance*fit,(v.y*scale-offset.y*2.0)*distance*fit,0.0,w);}`,
      ),
    );
    gl.attachShader(
      p,
      shader(
        gl.FRAGMENT_SHADER,
        `precision mediump float;varying vec2 uv;uniform sampler2D frame;void main(){gl_FragColor=texture2D(frame,uv);}`,
      ),
    );
    gl.linkProgram(p);
    if (!gl.getProgramParameter(p, gl.LINK_STATUS))
      throw new Error("Cannot initialize 3D rendering.");
    this.program = p;
    gl.useProgram(p);
    gl.bindBuffer(gl.ARRAY_BUFFER, gl.createBuffer());
    gl.bufferData(
      gl.ARRAY_BUFFER,
      new Float32Array([-1, -1, 1, -1, -1, 1, -1, 1, 1, -1, 1, 1]),
      gl.STATIC_DRAW,
    );
    const a = gl.getAttribLocation(p, "position");
    gl.enableVertexAttribArray(a);
    gl.vertexAttribPointer(a, 2, gl.FLOAT, false, 0, 0);
    gl.bindTexture(gl.TEXTURE_2D, gl.createTexture());
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.LINEAR);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
    gl.pixelStorei(gl.UNPACK_PREMULTIPLY_ALPHA_WEBGL, true);
  }
  /** Draw the layer at this pose; `fit` shrinks the result to stay in frame. */
  render(source: HTMLCanvasElement, pose: Pose, fit = 1) {
    const gl = this.gl,
      p = this.program;
    if (!gl || !p || gl.isContextLost())
      throw new Error(
        "3D rendering needs WebGL. Enable graphics acceleration or switch the effect to 2D.",
      );
    if (
      this.canvas.width !== source.width ||
      this.canvas.height !== source.height
    ) {
      this.canvas.width = source.width;
      this.canvas.height = source.height;
    }
    gl.viewport(0, 0, source.width, source.height);
    gl.clearColor(0, 0, 0, 0);
    gl.clear(gl.COLOR_BUFFER_BIT);
    gl.useProgram(p);
    gl.uniform3f(
      gl.getUniformLocation(p, "angles"),
      (pose.x * Math.PI) / 180,
      (pose.y * Math.PI) / 180,
      (pose.z * Math.PI) / 180,
    );
    gl.uniform2f(
      gl.getUniformLocation(p, "offset"),
      pose.offsetX / 100,
      pose.offsetY / 100,
    );
    const aspect = source.width / source.height;
    gl.uniform1f(gl.getUniformLocation(p, "aspect"), aspect);
    gl.uniform1f(
      gl.getUniformLocation(p, "distance"),
      cameraDistance(pose.perspective, aspect),
    );
    gl.uniform1f(gl.getUniformLocation(p, "scale"), pose.scale);
    gl.uniform1f(gl.getUniformLocation(p, "fit"), fit);
    gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, gl.RGBA, gl.UNSIGNED_BYTE, source);
    gl.drawArrays(gl.TRIANGLES, 0, 6);
    return this.canvas;
  }
  dispose() {
    this.gl?.getExtension("WEBGL_lose_context")?.loseContext();
  }
}
