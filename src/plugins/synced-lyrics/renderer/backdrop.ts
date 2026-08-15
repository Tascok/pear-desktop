export let currentColors: number[][] = [
  [0.1, 0.1, 0.1],
  [0.15, 0.15, 0.15],
  [0.2, 0.2, 0.2],
  [0.25, 0.25, 0.25],
];

let targetColors: number[][] = [
  [0.1, 0.1, 0.1],
  [0.15, 0.15, 0.15],
  [0.2, 0.2, 0.2],
  [0.25, 0.25, 0.25],
];

let gl: WebGLRenderingContext | null = null;
let program: WebGLProgram | null = null;
let animationFrameId: number | null = null;
let beatValue = 0;
let timeValue = 0;

// Cached uniform locations — getUniformLocation is expensive, call once at init
let uResolution: WebGLUniformLocation | null = null;
let uTime: WebGLUniformLocation | null = null;
let uBeat: WebGLUniformLocation | null = null;
const uColorLocs: WebGLUniformLocation[] = [];

// Debounce to prevent multiple image decodes when songs change rapidly
let colorDebounceTimer: ReturnType<typeof setTimeout> | null = null;

// Reusable temp canvas — avoid allocating a new one on every color update
let tempCanvas: HTMLCanvasElement | null = null;

const vertexShaderSource = `
  attribute vec2 position;
  void main() {
    gl_Position = vec4(position, 0.0, 1.0);
  }
`;

const fragmentShaderSource = `
  precision mediump float;
  uniform vec2 u_resolution;
  uniform float u_time;
  uniform vec3 u_colors[4];
  uniform float u_beat;

  void main() {
    vec2 uv = gl_FragCoord.xy / u_resolution.xy;
    
    float t = u_time * 0.15;
    
    float n1 = sin(uv.x * 2.5 + t) * cos(uv.y * 2.5 + t);
    float n2 = sin(uv.y * 3.5 - t * 1.2) * cos(uv.x * 1.5 + t);
    float n3 = sin((uv.x + uv.y) * 2.0 + t) * 0.5 + 0.5;
    
    vec2 warpedUv = uv + vec2(n1, n2) * 0.2;
    
    vec3 col1 = mix(u_colors[0], u_colors[1], warpedUv.x);
    vec3 col2 = mix(u_colors[2], u_colors[3], warpedUv.y);
    vec3 finalCol = mix(col1, col2, (n3 + sin(t)) * 0.5 + 0.5);
    
    // Smooth beat reaction
    finalCol += vec3(u_beat * 0.08);
    
    // Scale colors to keep text highly legible (dark dimming)
    gl_FragColor = vec4(finalCol * 0.35, 1.0);
  }
`;

function createShader(glCtx: WebGLRenderingContext, type: number, source: string): WebGLShader | null {
  const shader = glCtx.createShader(type);
  if (!shader) return null;
  glCtx.shaderSource(shader, source);
  glCtx.compileShader(shader);
  if (!glCtx.getShaderParameter(shader, glCtx.COMPILE_STATUS)) {
    console.error('Shader compilation error:', glCtx.getShaderInfoLog(shader));
    glCtx.deleteShader(shader);
    return null;
  }
  return shader;
}

export function initBackdrop(canvas: HTMLCanvasElement) {
  destroyBackdrop();

  gl = canvas.getContext('webgl');
  if (!gl) {
    console.warn('WebGL is not supported in this environment.');
    return;
  }

  const vs = createShader(gl, gl.VERTEX_SHADER, vertexShaderSource);
  const fs = createShader(gl, gl.FRAGMENT_SHADER, fragmentShaderSource);
  if (!vs || !fs) return;

  program = gl.createProgram();
  if (!program) return;

  gl.attachShader(program, vs);
  gl.attachShader(program, fs);
  gl.linkProgram(program);

  if (!gl.getProgramParameter(program, gl.LINK_STATUS)) {
    console.error('Shader program linking error:', gl.getProgramInfoLog(program));
    return;
  }

  const positionAttributeLocation = gl.getAttribLocation(program, 'position');
  const positionBuffer = gl.createBuffer();

  // Cache uniform locations once at init — getUniformLocation is expensive per-frame
  uResolution = gl.getUniformLocation(program, 'u_resolution');
  uTime = gl.getUniformLocation(program, 'u_time');
  uBeat = gl.getUniformLocation(program, 'u_beat');
  uColorLocs.length = 0;
  for (let i = 0; i < 4; i++) {
    uColorLocs.push(gl.getUniformLocation(program, `u_colors[${i}]`)!);
  }

  gl.bindBuffer(gl.ARRAY_BUFFER, positionBuffer);

  const positions = new Float32Array([
    -1, -1,
    1, -1,
    -1, 1,
    -1, 1,
    1, -1,
    1, 1,
  ]);
  gl.bufferData(gl.ARRAY_BUFFER, positions, gl.STATIC_DRAW);
  gl.enableVertexAttribArray(positionAttributeLocation);
  gl.vertexAttribPointer(positionAttributeLocation, 2, gl.FLOAT, false, 0, 0);

  const resizeCanvas = () => {
    if (!canvas || !gl) return;
    const dpr = Math.min(window.devicePixelRatio || 1, 2);
    const width = Math.round(canvas.clientWidth * dpr);
    const height = Math.round(canvas.clientHeight * dpr);
    if (canvas.width !== width || canvas.height !== height) {
      canvas.width = width;
      canvas.height = height;
      gl.viewport(0, 0, width, height);
    }
  };

  const renderLoop = () => {
    if (!gl || !program || !canvas) return;

    resizeCanvas();

    gl.clearColor(0, 0, 0, 0);
    gl.clear(gl.COLOR_BUFFER_BIT);

    gl.useProgram(program);

    // Dynamic color lerp
    for (let i = 0; i < 4; i++) {
      for (let j = 0; j < 3; j++) {
        currentColors[i][j] = (currentColors[i][j] * 0.95) + (targetColors[i][j] * 0.05);
      }
    }

    // Decay beat
    beatValue *= 0.94;

    timeValue += 0.05;

    // Set uniforms using pre-cached locations
    gl.uniform2f(uResolution, canvas.width, canvas.height);
    gl.uniform1f(uTime, timeValue);
    gl.uniform1f(uBeat, beatValue);

    for (let i = 0; i < 4; i++) {
      gl.uniform3f(uColorLocs[i], currentColors[i][0], currentColors[i][1], currentColors[i][2]);
    }

    gl.drawArrays(gl.TRIANGLES, 0, 6);

    animationFrameId = requestAnimationFrame(renderLoop);
  };

  renderLoop();
}

export function updateBackdropColors(imgSrc: string) {
  if (!imgSrc) return;

  // Debounce to prevent rapid successive image decodes when songs change quickly
  if (colorDebounceTimer !== null) {
    clearTimeout(colorDebounceTimer);
  }

  colorDebounceTimer = setTimeout(() => {
    colorDebounceTimer = null;

    const img = new Image();
    img.crossOrigin = 'anonymous';
    img.src = imgSrc;
    img.onload = () => {
      // Reuse a single temp canvas instead of allocating a new one per song
      if (!tempCanvas) {
        tempCanvas = document.createElement('canvas');
        tempCanvas.width = 4;
        tempCanvas.height = 4;
      }
      const ctx = tempCanvas.getContext('2d', { willReadFrequently: true });
    if (!ctx) return;

    ctx.drawImage(img, 0, 0, 4, 4);
    const pixelData = ctx.getImageData(0, 0, 4, 4).data;

    const rgbColors: number[][] = [];
    for (let i = 0; i < pixelData.length; i += 12) {
      const r = pixelData[i] / 255;
      const g = pixelData[i + 1] / 255;
      const b = pixelData[i + 2] / 255;
      rgbColors.push([r, g, b]);
    }

    // Ensure we have 4 colors
    while (rgbColors.length < 4) {
      rgbColors.push([0.1, 0.1, 0.1]);
    }

    targetColors = rgbColors.slice(0, 4);
    };
    img.onerror = () => {
    // default colors if loading fails
    targetColors = [
      [0.1, 0.1, 0.1],
      [0.2, 0.1, 0.2],
      [0.1, 0.2, 0.3],
      [0.2, 0.2, 0.2],
    ];
  };
}, 500);
}

export function triggerBackdropBeat() {
  beatValue = 1.0;
}

export function destroyBackdrop() {
  if (colorDebounceTimer !== null) {
    clearTimeout(colorDebounceTimer);
    colorDebounceTimer = null;
  }

  if (animationFrameId !== null) {
    cancelAnimationFrame(animationFrameId);
    animationFrameId = null;
  }

  // Properly dispose WebGL resources to prevent GPU memory leaks
  if (gl && program) {
    try { gl.deleteProgram(program); } catch { /* ignore */ }
    program = null;
  }
  uResolution = null;
  uTime = null;
  uBeat = null;
  uColorLocs.length = 0;

  // Discard the reusable temp canvas so it can be recreated fresh next time
  tempCanvas = null;
  gl = null;
}
