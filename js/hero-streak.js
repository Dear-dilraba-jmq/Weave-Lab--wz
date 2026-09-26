/**
 * Weave Lab - Hero 交互光线 & 满天星
 * 效果（参考视频）：
 *   - 鼠标移动：粉紫色彗星拖着粉→紫渐变亮丝带跟随鼠标
 *   - 鼠标停下：从鼠标处快速散落出满屏蓝色荧光星，星星闪烁漂移
 *   - 鼠标再动：星星淡出，光线重新跟随
 *   - 用户尚未移动鼠标时：自动驾驶演示（光线自行乱窜，定期爆散）
 * 零依赖 Canvas 2D（additive blending），自动暂停离屏渲染，支持 prefers-reduced-motion。
 */
(function () {
  'use strict';

  var canvas = document.getElementById('hero-streak-canvas');
  if (!canvas) return;
  var ctx = canvas.getContext('2d');
  var section = canvas.closest('.hero-immersive');

  /* ---------- 可调参数 ---------- */
  var IDLE_MS = 420;              // 鼠标静止多久后爆散
  var STAR_MIN = 700, STAR_MAX = 1050; // 每次散落的星星数量
  var AUTO_CYCLE = 7.5;           // 自动驾驶：一轮时长(秒)
  var AUTO_STARS_HOLD = 2.4;      // 自动驾驶：星星停留时长(秒)
  var TRAIL_MAX = 320;            // 拖尾最大点数
  var TRAIL_SPACING = 3.2;        // 拖尾采样点间距(px)，插值加密保证丝带连续
  var PINK = [255, 92, 226];
  var PURPLE = [150, 80, 255];
  var WHITE = [255, 244, 255];
  var STAR_COLORS = [
    [168, 196, 255],  // 冰蓝
    [122, 162, 255],  // 荧光蓝
    [196, 216, 255],  // 淡蓝白
    [140, 220, 255],  // 青蓝
    [110, 130, 255]   // 靛蓝
  ];

  /* ---------- 画布尺寸 ---------- */
  var w = 0, h = 0, dpr = 1;
  function resize() {
    dpr = Math.min(window.devicePixelRatio || 1, 2);
    w = canvas.parentElement.clientWidth;
    h = canvas.parentElement.clientHeight;
    canvas.width = Math.round(w * dpr);
    canvas.height = Math.round(h * dpr);
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
  }

  /* ---------- 工具 ---------- */
  function rand(a, b) { return a + Math.random() * (b - a); }
  function lerp(a, b, t) { return a + (b - a) * t; }
  function lerpC(c1, c2, t) {
    return [lerp(c1[0], c2[0], t) | 0, lerp(c1[1], c2[1], t) | 0, lerp(c1[2], c2[2], t) | 0];
  }
  function rgba(c, a) { return 'rgba(' + c[0] + ',' + c[1] + ',' + c[2] + ',' + a + ')'; }

  /* ---------- 状态 ---------- */
  var head = { x: 0, y: 0 };       // 彗星头（缓动跟随目标）
  var target = { x: 0, y: 0 };     // 目标位置（鼠标 / 自动驾驶虚拟点）
  var trail = [];
  var stars = [];
  var sparks = [];
  var mode = 'follow';             // 'follow' | 'stars'
  var starsFade = 1;               // 星星整体透明度系数（鼠标再动时快速淡出）
  var hasPointer = false;
  var lastMoveAt = 0;
  var autoT0 = performance.now();  // 自动驾驶计时
  var autoPhase = 'fly';           // 自动驾驶阶段: 'fly' | 'hold'
  var autoHoldT0 = 0;

  /* 自动驾驶：层叠正弦的不规则轨迹 */
  function autoTarget(t) {
    var nx = 0.5 + 0.36 * Math.sin(t * 0.9) + 0.14 * Math.sin(t * 2.17 + 1.3);
    var ny = 0.46 + 0.30 * Math.sin(t * 1.27 + 2.1) + 0.12 * Math.sin(t * 2.71 + 0.7);
    target.x = nx * w;
    target.y = ny * h;
  }

  /* ---------- 满天星 ---------- */
  function spawnStars(x, y) {
    var area = w * h;
    var count = Math.round(lerp(STAR_MIN, STAR_MAX, Math.random()) * Math.min(1, area / (1440 * 900) + 0.35));
    var maxDist = Math.sqrt(w * w + h * h);
    stars = [];
    for (var i = 0; i < count; i++) {
      var ang = Math.random() * Math.PI * 2;
      /* 距离均匀分布：先定落点半径（sqrt 按面积均匀），再反推初速度，
         避免大量慢星堆在爆点附近导致远处稀疏 */
      var fr = rand(0.955, 0.978);           // 摩擦：先冲刺后悬停
      var travel = (0.12 + 0.88 * Math.sqrt(Math.random())) * maxDist * 0.62;
      var sp = Math.max(2, travel * (1 - fr));
      var big = Math.random() < 0.12;
      stars.push({
        x: x, y: y,
        vx: Math.cos(ang) * sp,
        vy: Math.sin(ang) * sp,
        fr: fr,
        r: big ? rand(2.0, 3.2) : rand(0.7, 2.0),
        c: STAR_COLORS[(Math.random() * STAR_COLORS.length) | 0],
        baseA: rand(0.55, 1),
        twF: rand(1.2, 4.2),             // 闪烁频率
        twP: rand(0, Math.PI * 2),       // 闪烁相位
        driftA: rand(0, Math.PI * 2),    // 悬停后漂移方向
        driftS: rand(0.04, 0.22),
        halo: big,
        born: performance.now()
      });
    }
  }

  /* ---------- 交互 ---------- */
  function pointerPos(e) {
    var rect = canvas.getBoundingClientRect();
    var cx = (e.touches && e.touches[0]) ? e.touches[0].clientX : e.clientX;
    var cy = (e.touches && e.touches[0]) ? e.touches[0].clientY : e.clientY;
    return { x: cx - rect.left, y: cy - rect.top };
  }

  function onMove(e) {
    var p = pointerPos(e);
    /* 忽略 hero 区域外的指针 */
    if (p.x < -80 || p.y < -80 || p.x > w + 80 || p.y > h + 80) return;
    target.x = p.x; target.y = p.y;
    lastMoveAt = performance.now();
    if (!hasPointer) {
      hasPointer = true;
      head.x = p.x; head.y = p.y;   // 首次接管：瞬移到鼠标，避免长距离飞入
      trail = [];
    }
    if (mode === 'stars') {         // 鼠标再动：星星快速淡出，光线回归
      mode = 'follow';
      starsFade = 1;
    }
  }

  window.addEventListener('mousemove', onMove, { passive: true });
  window.addEventListener('touchstart', onMove, { passive: true });
  window.addEventListener('touchmove', onMove, { passive: true });
  window.addEventListener('touchend', function () {
    lastMoveAt = performance.now() - IDLE_MS;  // 触屏松手即视为静止
  }, { passive: true });

  /* ---------- 更新 ---------- */
  function update(now, dt) {
    var t = now / 1000;

    if (!hasPointer) {
      /* 自动驾驶演示 */
      var autoT = (now - autoT0) / 1000;
      if (autoPhase === 'fly') {
        autoTarget(autoT);
        if (autoT >= AUTO_CYCLE) {
          autoPhase = 'hold';
          autoHoldT0 = now;
          spawnStars(head.x, head.y);
          trail = [];
          mode = 'stars';
          starsFade = 1;
        }
      } else if (now - autoHoldT0 > AUTO_STARS_HOLD * 1000) {
        autoPhase = 'fly';
        autoT0 = now;
        mode = 'follow';
        starsFade = 1;
      }
    } else if (mode === 'follow' && now - lastMoveAt > IDLE_MS) {
      /* 鼠标静止：从鼠标处爆散满天星 */
      spawnStars(head.x, head.y);
      trail = [];
      mode = 'stars';
      starsFade = 1;
    }

    if (mode === 'follow') {
      /* 彗星缓动跟随目标 */
      var ease = hasPointer ? 0.22 : 0.06;
      var px = head.x, py = head.y;
      head.x += (target.x - head.x) * ease;
      head.y += (target.y - head.y) * ease;
      var speed = Math.sqrt((head.x - px) * (head.x - px) + (head.y - py) * (head.y - py));

      /* 拖尾采样：与上一点间距过大时等距插值加密，避免丝带断成串珠 */
      var lastPt = trail[trail.length - 1];
      if (!lastPt) {
        trail.push({ x: head.x, y: head.y });
      } else {
        var tdx = head.x - lastPt.x, tdy = head.y - lastPt.y;
        var tdist = Math.sqrt(tdx * tdx + tdy * tdy);
        if (tdist >= TRAIL_SPACING) {
          var steps = Math.min(60, Math.floor(tdist / TRAIL_SPACING));
          for (var si = 1; si <= steps; si++) {
            trail.push({ x: lastPt.x + tdx * si / steps, y: lastPt.y + tdy * si / steps });
          }
        }
      }
      while (trail.length > TRAIL_MAX) trail.shift();
      /* 高速时迸溅火花 */
      if (speed > 14 && Math.random() < 0.5) {
        sparks.push({
          x: head.x, y: head.y,
          vx: rand(-2.4, 2.4), vy: rand(-2.4, 2.4),
          life: 1, decay: rand(0.05, 0.1),
          r: rand(0.7, 1.7)
        });
      }

      /* 星星快速淡出 */
      if (starsFade > 0) starsFade = Math.max(0, starsFade - dt * 3);
    } else {
      /* 星星模式：整体保持 */
      starsFade = Math.min(1, starsFade + dt * 4);
    }

    /* 星星运动：先冲刺减速，后闪烁漂移 */
    var i, s;
    for (i = 0; i < stars.length; i++) {
      s = stars[i];
      s.vx *= s.fr; s.vy *= s.fr;
      s.x += s.vx + Math.cos(s.driftA) * s.driftS;
      s.y += s.vy + Math.sin(s.driftA) * s.driftS;
      if (Math.abs(s.vx) + Math.abs(s.vy) < 0.4) {
        s.driftA += rand(-0.05, 0.05);
      }
    }

    /* 火花 */
    for (i = sparks.length - 1; i >= 0; i--) {
      var k = sparks[i];
      k.x += k.vx; k.y += k.vy;
      k.vx *= 0.96; k.vy *= 0.96;
      k.life -= k.decay;
      if (k.life <= 0) sparks.splice(i, 1);
    }
  }

  /* ---------- 绘制 ---------- */
  function draw(now) {
    ctx.clearRect(0, 0, w, h);
    ctx.globalCompositeOperation = 'lighter';
    var t = now / 1000;
    var i, p, c, r, a;

    /* --- 拖尾：粉→紫渐变连续丝带（多边形填充，无分段感） --- */
    if (mode === 'follow' && trail.length > 2) {
      var n = trail.length;
      var tail = trail[0];

      /* 沿轨迹构建可变宽度的丝带轮廓 */
      function ribbonPath(widthScale) {
        var left = [], right = [], i, p, pP, pN, dx, dy, len, nx, ny, t, hw;
        for (i = 0; i < n; i++) {
          p = trail[i];
          pP = trail[Math.max(0, i - 1)];
          pN = trail[Math.min(n - 1, i + 1)];
          dx = pN.x - pP.x; dy = pN.y - pP.y;
          len = Math.sqrt(dx * dx + dy * dy) || 1;
          nx = -dy / len; ny = dx / len;
          t = i / (n - 1);
          hw = lerp(0.4, 4.5, t * t) * widthScale;
          left.push(p.x + nx * hw, p.y + ny * hw);
          right.push(p.x - nx * hw, p.y - ny * hw);
        }
        ctx.beginPath();
        ctx.moveTo(left[0], left[1]);
        for (i = 1; i < n; i++) ctx.lineTo(left[i * 2], left[i * 2 + 1]);
        for (i = n - 1; i >= 0; i--) ctx.lineTo(right[i * 2], right[i * 2 + 1]);
        ctx.closePath();
      }

      function ribbonGrad(aMul) {
        var g2 = ctx.createLinearGradient(tail.x, tail.y, head.x, head.y);
        g2.addColorStop(0, rgba(PURPLE, 0));
        g2.addColorStop(0.3, rgba(PURPLE, 0.28 * aMul));
        g2.addColorStop(0.72, rgba(lerpC(PURPLE, PINK, 0.6), 0.55 * aMul));
        g2.addColorStop(1, rgba(PINK, 0.9 * aMul));
        return g2;
      }

      /* 辉光层（宽而淡） */
      ribbonPath(4.2);
      ctx.fillStyle = ribbonGrad(0.16);
      ctx.fill();
      /* 主体丝带（窄而亮） */
      ribbonPath(1);
      ctx.fillStyle = ribbonGrad(1);
      ctx.fill();

      /* 头部光球 */
      var g = ctx.createRadialGradient(head.x, head.y, 0, head.x, head.y, 30);
      g.addColorStop(0, rgba(WHITE, 0.95));
      g.addColorStop(0.25, rgba(PINK, 0.55));
      g.addColorStop(1, rgba(PINK, 0));
      ctx.fillStyle = g;
      ctx.beginPath();
      ctx.arc(head.x, head.y, 30, 0, Math.PI * 2);
      ctx.fill();
      ctx.fillStyle = rgba(WHITE, 1);
      ctx.beginPath();
      ctx.arc(head.x, head.y, 3, 0, Math.PI * 2);
      ctx.fill();
    }

    /* --- 火花 --- */
    for (i = 0; i < sparks.length; i++) {
      var k = sparks[i];
      ctx.fillStyle = rgba(lerpC(PINK, WHITE, k.life * 0.5), k.life * 0.85);
      ctx.beginPath();
      ctx.arc(k.x, k.y, k.r * k.life, 0, Math.PI * 2);
      ctx.fill();
    }

    /* --- 蓝色荧光满天星 --- */
    if (starsFade > 0) {
      for (i = 0; i < stars.length; i++) {
        var s = stars[i];
        var age = (now - s.born) / 1000;
        var fadeIn = Math.min(1, age / 0.4);
        var tw = 0.5 + 0.5 * Math.sin(t * s.twF + s.twP);
        a = s.baseA * (0.45 + 0.55 * tw) * fadeIn * starsFade;
        if (s.halo) {
          var hg = ctx.createRadialGradient(s.x, s.y, 0, s.x, s.y, s.r * 6);
          hg.addColorStop(0, rgba(s.c, a * 0.5));
          hg.addColorStop(1, rgba(s.c, 0));
          ctx.fillStyle = hg;
          ctx.beginPath();
          ctx.arc(s.x, s.y, s.r * 6, 0, Math.PI * 2);
          ctx.fill();
        }
        ctx.fillStyle = rgba(s.c, a);
        ctx.beginPath();
        ctx.arc(s.x, s.y, s.r, 0, Math.PI * 2);
        ctx.fill();
      }
    }

    ctx.globalCompositeOperation = 'source-over';
  }

  /* ---------- 减少动态：静态星野 ---------- */
  var reduced = window.matchMedia && window.matchMedia('(prefers-reduced-motion: reduce)').matches;
  function drawStatic() {
    spawnStars(w * 0.5, h * 0.42);
    for (var i = 0; i < stars.length; i++) {
      var s = stars[i];
      var d = Math.random() * 0.9 + 0.1;
      s.x = lerp(s.x, s.x + s.vx * 40 * d, 1);
      s.y = lerp(s.y, s.y + s.vy * 40 * d, 1);
      s.vx = 0; s.vy = 0;
    }
    starsFade = 1;
    draw(performance.now());
  }

  /* ---------- 主循环 ---------- */
  var running = true;
  var lastT = performance.now();
  function frame(now) {
    if (!running) return;
    var dt = Math.min(0.05, (now - lastT) / 1000);
    lastT = now;
    update(now, dt);
    draw(now);
    requestAnimationFrame(frame);
  }

  if ('IntersectionObserver' in window) {
    new IntersectionObserver(function (entries) {
      entries.forEach(function (en) {
        if (en.isIntersecting && !running) {
          running = true;
          lastT = performance.now();
          requestAnimationFrame(frame);
        } else if (!en.isIntersecting) {
          running = false;
        }
      });
    }, { threshold: 0.02 }).observe(canvas);
  }
  document.addEventListener('visibilitychange', function () {
    if (!document.hidden && running) lastT = performance.now();
  });

  var rzT;
  window.addEventListener('resize', function () {
    clearTimeout(rzT);
    rzT = setTimeout(function () {
      resize();
      if (reduced) drawStatic();
    }, 120);
  });

  /* 初始位置：屏幕中上偏右 */
  resize();
  head.x = target.x = w * 0.62;
  head.y = target.y = h * 0.4;

  /* 生效标记：隐藏旧白色光斑 */
  if (section) section.classList.add('has-streak');
  document.querySelectorAll('.hero-orb').forEach(function (o) { o.style.display = 'none'; });

  if (reduced) {
    drawStatic();
  } else {
    requestAnimationFrame(frame);
  }
})();
