import type { Pose } from "./motion";
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
        `attribute vec2 position;varying vec2 uv;uniform vec3 angles;uniform vec2 offset;uniform float aspect;uniform float distance;uniform float scale;
      void main(){uv=vec2((position.x+1.0)*.5,(1.0-position.y)*.5);vec3 v=vec3(position.x*aspect,position.y,0.0);vec3 c=cos(angles),s=sin(angles);v=vec3(v.x,v.y*c.x-v.z*s.x,v.y*s.x+v.z*c.x);v=vec3(v.x*c.y+v.z*s.y,v.y,-v.x*s.y+v.z*c.y);v=vec3(v.x*c.z-v.y*s.z,v.x*s.z+v.y*c.z,v.z);float w=distance-v.z;gl_Position=vec4((v.x/aspect*scale+offset.x*2.0)*distance,(v.y*scale-offset.y*2.0)*distance,0.0,w);}`,
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
  render(source: HTMLCanvasElement, pose: Pose) {
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
      1 / Math.tan((pose.perspective * Math.PI) / 360) + aspect * 0.6,
    );
    gl.uniform1f(gl.getUniformLocation(p, "scale"), pose.scale);
    gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, gl.RGBA, gl.UNSIGNED_BYTE, source);
    gl.drawArrays(gl.TRIANGLES, 0, 6);
    return this.canvas;
  }
  dispose() {
    this.gl?.getExtension("WEBGL_lose_context")?.loseContext();
  }
}
