/* ============================================
   Weave Lab - Hero Aurora Silk (WebGL)
   首屏流光丝绸背景：域扭曲噪声 + 品红光弧
   参考 "Where Imagination Becomes Motion" 视觉效果
   ============================================ */
(function () {
  var canvas = document.getElementById('hero-aurora-canvas');
  if (!canvas) return;

  var gl = canvas.getContext('webgl', { antialias: false, alpha: false, powerPreference: 'high-performance' })
        || canvas.getContext('experimental-webgl');
  if (!gl) { canvas.style.display = 'none'; return; }

  var VERT = [
    'attribute vec2 aPos;',
    'void main() { gl_Position = vec4(aPos, 0.0, 1.0); }'
  ].join('\n');

  var FRAG = [
    'precision highp float;',
    'uniform vec2 uRes;',
    'uniform float uTime;',
    'uniform vec2 uMouse;',
    '',
    'float hash(vec2 p) {',
    '  p = fract(p * vec2(123.34, 456.21));',
    '  p += dot(p, p + 45.32);',
    '  return fract(p.x * p.y);',
    '}',
    '',
    'float noise(vec2 p) {',
    '  vec2 i = floor(p);',
    '  vec2 f = fract(p);',
    '  vec2 u = f * f * (3.0 - 2.0 * f);',
    '  float a = hash(i);',
    '  float b = hash(i + vec2(1.0, 0.0));',
    '  float c = hash(i + vec2(0.0, 1.0));',
    '  float d = hash(i + vec2(1.0, 1.0));',
    '  return mix(mix(a, b, u.x), mix(c, d, u.x), u.y);',
    '}',
    '',
    'float fbm(vec2 p) {',
    '  float v = 0.0;',
    '  float amp = 0.5;',
    '  mat2 rot = mat2(0.8, 0.6, -0.6, 0.8);',
    '  for (int i = 0; i < 5; i++) {',
    '    v += amp * noise(p);',
    '    p = rot * p * 2.02;',
    '    amp *= 0.5;',
    '  }',
    '  return v;',
    '}',
    '',
    'void main() {',
    '  vec2 uv = gl_FragCoord.xy / uRes;',
    '  float aspect = uRes.x / uRes.y;',
    '  vec2 p = (gl_FragCoord.xy - 0.5 * uRes) / uRes.y;',
    '  float t = uTime * 0.14;',
    '',
    '  /* 鼠标视差 */',
    '  vec2 m = (uMouse - 0.5) * 0.22;',
    '  vec2 q0 = p + m * 0.6;',
    '',
    '  /* 域扭曲：丝绸流动 */',
    '  vec2 q = vec2(fbm(q0 * 1.5 + vec2(0.0, t)),',
    '                fbm(q0 * 1.5 + vec2(5.2, 1.3) - t * 0.7));',
    '  vec2 r = vec2(fbm(q0 * 1.5 + 3.2 * q + vec2(1.7, 9.2) + t * 0.9),',
    '                fbm(q0 * 1.5 + 3.2 * q + vec2(8.3, 2.8) - t * 0.6));',
    '  float v = fbm(q0 * 1.5 + 3.5 * r);',
    '',
    '  /* 丝绸色带：靛蓝 → 紫罗兰 → 品红高光 */',
    '  vec3 colDeep = vec3(0.03, 0.02, 0.10);',
    '  vec3 colIndigo = vec3(0.14, 0.10, 0.42);',
    '  vec3 colViolet = vec3(0.44, 0.20, 0.78);',
    '  vec3 colMagenta = vec3(1.00, 0.34, 0.72);',
    '',
    '  float vv = clamp(v * 1.25 - 0.12, 0.0, 1.0);',
    '  vec3 silk = mix(colDeep, colIndigo, smoothstep(0.05, 0.45, vv));',
    '  silk = mix(silk, colViolet, smoothstep(0.42, 0.72, vv));',
    '  silk = mix(silk, colMagenta, smoothstep(0.74, 0.97, vv) * 0.9);',
    '',
    '  /* 对角流带遮罩（右上 ↔ 左下）+ 中部文字区压暗 */',
    '  float diag = uv.y - (0.66 - uv.x * 0.38) + (v - 0.5) * 0.55;',
    '  float band = exp(-diag * diag * 5.0);',
    '  float centerCalm = smoothstep(0.05, 0.34, abs(uv.y - 0.5)) * 0.75 + 0.25;',
    '  float rightBias = 0.35 + 0.65 * smoothstep(-0.6, 0.9, p.x);',
    '  float silkMask = band * centerCalm * rightBias;',
    '',
    '  vec3 col = vec3(0.0);',
    '  col += silk * silkMask * 1.15;',
    '',
    '  /* 品红光弧（右侧，缓慢旋转呼吸） */',
    '  vec2 rc = vec2(0.66 * aspect * 0.5, 0.10);',
    '  vec2 rp = p - rc - m * 0.35;',
    '  float ang = atan(rp.y, rp.x);',
    '  float rad = length(rp);',
    '  float sweep = uTime * 0.10;',
    '  float arcWin = smoothstep(0.4, 1.6, ang + sweep) * smoothstep(3.4, 1.9, ang + sweep);',
    '  float ringR = 0.42 + 0.03 * sin(uTime * 0.5);',
    '  float glow = exp(-abs(rad - ringR) * 26.0);',
    '  float halo = exp(-abs(rad - ringR) * 7.0) * 0.35;',
    '  col += colMagenta * (glow * 1.4 + halo) * arcWin * (0.55 + 0.25 * sin(uTime * 0.8));',
    '',
    '  /* 微弱环境紫雾，避免死黑 */',
    '  col += colIndigo * 0.10 * fbm(q0 * 0.8 + t * 0.3);',
    '',
    '  /* 四角压暗 */',
    '  vec2 vc = uv - 0.5;',
    '  col *= 1.0 - dot(vc, vc) * 0.9;',
    '',
    '  /* 抖动去色带 */',
    '  col += (hash(gl_FragCoord.xy + uTime) - 0.5) / 128.0;',
    '',
    '  gl_FragColor = vec4(max(col, 0.0), 1.0);',
    '}'
  ].join('\n');

  function compile(type, src) {
    var s = gl.createShader(type);
    gl.shaderSource(s, src);
    gl.compileShader(s);
    if (!gl.getShaderParameter(s, gl.COMPILE_STATUS)) {
      console.error('aurora shader error:', gl.getShaderInfoLog(s));
      return null;
    }
    return s;
  }

  var vs = compile(gl.VERTEX_SHADER, VERT);
  var fs = compile(gl.FRAGMENT_SHADER, FRAG);
  if (!vs || !fs) { canvas.style.display = 'none'; return; }

  var prog = gl.createProgram();
  gl.attachShader(prog, vs);
  gl.attachShader(prog, fs);
  gl.linkProgram(prog);
  if (!gl.getProgramParameter(prog, gl.LINK_STATUS)) {
    console.error('aurora link error:', gl.getProgramInfoLog(prog));
    canvas.style.display = 'none';
    return;
  }
  gl.useProgram(prog);

  var buf = gl.createBuffer();
  gl.bindBuffer(gl.ARRAY_BUFFER, buf);
  gl.bufferData(gl.ARRAY_BUFFER, new Float32Array([-1, -1, 3, -1, -1, 3]), gl.STATIC_DRAW);
  var loc = gl.getAttribLocation(prog, 'aPos');
  gl.enableVertexAttribArray(loc);
  gl.vertexAttribPointer(loc, 2, gl.FLOAT, false, 0, 0);

  var uRes = gl.getUniformLocation(prog, 'uRes');
  var uTime = gl.getUniformLocation(prog, 'uTime');
  var uMouse = gl.getUniformLocation(prog, 'uMouse');

  var mouse = { x: 0.5, y: 0.5, tx: 0.5, ty: 0.5 };
  window.addEventListener('pointermove', function (e) {
    mouse.tx = e.clientX / window.innerWidth;
    mouse.ty = 1.0 - e.clientY / window.innerHeight;
  }, { passive: true });

  var dpr = Math.min(window.devicePixelRatio || 1, 1.25);
  function resize() {
    var w = canvas.clientWidth, h = canvas.clientHeight;
    if (!w || !h) return;
    var W = Math.round(w * dpr), H = Math.round(h * dpr);
    if (canvas.width !== W || canvas.height !== H) {
      canvas.width = W;
      canvas.height = H;
      gl.viewport(0, 0, W, H);
    }
  }
  window.addEventListener('resize', resize);

  var visible = true;
  if ('IntersectionObserver' in window) {
    new IntersectionObserver(function (entries) {
      visible = entries[0].isIntersecting;
    }, { threshold: 0 }).observe(canvas);
  }

  var reduced = window.matchMedia && window.matchMedia('(prefers-reduced-motion: reduce)').matches;
  var start = performance.now();

  function frame(now) {
    requestAnimationFrame(frame);
    if (!visible || document.hidden) return;
    resize();
    mouse.x += (mouse.tx - mouse.x) * 0.04;
    mouse.y += (mouse.ty - mouse.y) * 0.04;
    var t = reduced ? 10.0 : (now - start) / 1000;
    gl.uniform2f(uRes, canvas.width, canvas.height);
    gl.uniform1f(uTime, t);
    gl.uniform2f(uMouse, mouse.x, mouse.y);
    gl.drawArrays(gl.TRIANGLES, 0, 3);
    if (reduced) visible = false; /* 减少动态偏好：只渲一帧 */
  }
  resize();
  requestAnimationFrame(frame);

  /* 极光生效后隐藏旧的白色光斑，避免冲淡色彩 */
  var heroSection = canvas.closest('.hero-immersive');
  if (heroSection) heroSection.classList.add('has-aurora');
})();
