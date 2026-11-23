// SPDX-License-Identifier: GPL-3.0-or-later
// Copyright (C) 2026 transpason
// このプログラムはフリーソフトウェアです。GNU一般公衆利用許諾書(GPL)バージョン3または
// それ以降のバージョンの条件で再配布・改変できます。無保証です。詳細は LICENSE を参照。
// レンズ・シューター: ゲーム本体(入力・状態更新・描画)
(function () {
  'use strict';

  const O = window.LensOptics;
  const W = O.WORLD;
  const DEG = Math.PI / 180;

  const ROUND_TIME = 60;          // 1回の制限時間(秒)
  const RADAR_DELAY = 0.3;        // 本番: 発射ボタンをこれ以上押し続けるとレーダーが出る(短く押せばすぐ撃つ)
  const SHOT_COOLDOWN = 0.5;      // 本番: 1発撃ったあと次を撃てるまでの時間(旋回しながらの連打を防ぐ)
  const SHOT_FLASH = 0.6;         // 本番: 撃ったビームが明るく光る時間(その後は次の1発まで薄く残る)
  const RADAR_RAYS = 7;           // レーダーで描く光線の本数(両端を含む)
  const GHOST_TIME = 1.0;         // 練習モード: ボタンを離した後に道筋が残る時間
  const ROTATE_PAUSE = 0.5;       // 縦横切り替え中はタイマーを止める
  const MSG_TIME = 1.6;
  const BODY_GRAB_PX = 34;        // 発射台本体をつかめる半径(画面上の最低値。これより外のドラッグは旋回)
  const BODY_MIN_W_PX = 44;       // スマホでも指で押さえやすい発射台の大きさ(画面上の最低値)
  const BODY_MIN_H_PX = 24;
  const DRAG_TURN_PER_PX = 0.25 * DEG; // 空き場所ドラッグ: 指を1px動かすと回る角度(100pxで25度)
  const TURN_BTN_START = 6 * DEG;  // 旋回ボタン: 押し始めの速さ(細かく合わせられる)
  const TURN_BTN_ACCEL = 40 * DEG; // 押し続けると1秒あたりこれだけ速くなる(最大 TURN_SPEED)
  const TURN_BTN_NUDGE = 0.5 * DEG; // 軽く1回押したときに回る量
  const RESERVE_RIGHT = 132;      // 横モード: 右側の操作ボタン列の幅(px)
  const RESERVE_BOTTOM = 104;     // 縦モード: 下側の操作ボタン行の高さ(px)
  const MOVE_SPEED = 500;         // キー操作の移動速度(座標/秒)
  const TURN_SPEED = 80 * DEG;    // キー操作の回転速度(ラジアン/秒)

  const LAW_TEXT = {
    parallel: '光軸に平行な光は、レンズを通ると焦点を通る!',
    center: 'レンズの中心を通る光は、そのまま直進する!',
    focus: '焦点を通った光は、レンズを通ると光軸に平行に進む!',
  };

  // ---------- DOM ----------
  const $ = (id) => document.getElementById(id);
  const canvas = $('game');
  const ctx = canvas.getContext('2d');
  const el = {
    stage: $('stage'),
    time: $('hud-time'), timeBox: $('hud-time-box'),
    score: $('hud-score'), scoreBox: $('hud-score-box'),
    aim: $('hud-aim'),
    fBox: $('hud-f-box'), fSlider: $('f-slider'),
    quit: $('btn-quit'), sound: $('btn-sound'), rotate: $('btn-rotate'), radar: $('btn-radar'),
    fire: $('btn-fire'),
    turnL: $('btn-turn-l'), turnR: $('btn-turn-r'),
    level: $('btn-level'),
    title: $('overlay-title'), result: $('overlay-result'),
    titleHigh: $('title-high'),
    resScore: $('res-score'), resNew: $('res-new'), resHits: $('res-hits'), resBest: $('res-best'),
    resParallel: $('res-parallel'), resCenter: $('res-center'), resFocus: $('res-focus'),
    resFocusShot: $('res-focus-shot'), resInside: $('res-inside'), resFirst: $('res-first'),
    fade: $('rotate-fade'),
  };

  // ---------- 保存(端末内のみ) ----------
  const store = {
    get(key, def) {
      try { const v = localStorage.getItem('lensShooter.' + key); return v === null ? def : JSON.parse(v); }
      catch (e) { return def; }
    },
    set(key, val) {
      try { localStorage.setItem('lensShooter.' + key, JSON.stringify(val)); } catch (e) { /* 保存できなくても遊べる */ }
    },
  };

  // ---------- 状態 ----------
  const S = {
    screen: 'title',           // title | play | practice | result
    lockedMode: null,          // null = 端末の向きに自動で合わせる
    mode: 'landscape',
    launcher: { u: 300, v: 300, theta: 0 },
    f: W.F_DEFAULT,
    target: null,
    fireInputs: new Set(),
    turnInputs: new Map(),     // pointerId → { dir: -1 | 1, t: 押している時間 }
    firing: false,             // 練習モード: 押している間ビームを出し続ける
    trace: null,
    holdTime: 0,               // 本番: 発射ボタンを押し続けている時間
    shotQueued: false,         // 本番: 発射ボタンが離された(次のフレームで1発撃つ)
    cooldown: 0,
    shot: null,                // 本番: 最後に撃った1発 { trace, from, t }
    shotsThisTarget: 0,
    radarOn: true,             // 練習モード: レーダーの常時表示のオン/オフ
    radarVisible: false,
    keyMoving: false,
    focusNoticePrev: false,
    focusNoticeShown: false,
    insideNoticeShown: false,
    stats: { focusShot: 0, inside: 0, first: 0 },
    timeLeft: ROUND_TIME,
    aimTime: 0,
    score: 0,
    hits: 0,
    best: Infinity,
    laws: { parallel: 0, center: 0, focus: 0 },
    hitPaths: [],
    ghost: null,
    popups: [],
    bursts: [],
    message: null,
    pause: 0,
    lensHintCooldown: 0,
    sound: store.get('sound', true),
    high: store.get('high', 0),
  };

  // ---------- 効果音(Web Audio) ----------
  const Sound = {
    ctx: null,
    hum: null,
    ensure() {
      if (!this.ctx) {
        const AC = window.AudioContext || window.webkitAudioContext;
        if (AC) this.ctx = new AC();
      }
      if (this.ctx && this.ctx.state === 'suspended') this.ctx.resume();
    },
    beep(freq, dur, type, vol, slideTo) {
      if (!S.sound || !this.ctx) return;
      const t = this.ctx.currentTime;
      const o = this.ctx.createOscillator();
      const g = this.ctx.createGain();
      o.type = type || 'sine';
      o.frequency.setValueAtTime(freq, t);
      if (slideTo) o.frequency.exponentialRampToValueAtTime(slideTo, t + dur);
      g.gain.setValueAtTime(vol || 0.15, t);
      g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
      o.connect(g).connect(this.ctx.destination);
      o.start(t);
      o.stop(t + dur + 0.02);
    },
    hit() { this.beep(660, 0.12, 'triangle', 0.2); setTimeout(() => this.beep(990, 0.18, 'triangle', 0.2), 90); },
    bonus() { this.beep(1320, 0.25, 'sine', 0.12); },
    empty() { this.beep(160, 0.25, 'square', 0.08, 90); },
    shot() { this.beep(900, 0.12, 'sawtooth', 0.06, 300); },
    snap() { this.beep(1800, 0.04, 'square', 0.07); },
    focus() { this.beep(784, 0.15, 'sine', 0.13); setTimeout(() => this.beep(1175, 0.3, 'sine', 0.13), 120); },
    end() { this.beep(523, 0.2, 'triangle', 0.18); setTimeout(() => this.beep(392, 0.4, 'triangle', 0.18), 180); },
    setHum(on) {
      if (!this.ctx) return;
      if (on && S.sound && !this.hum) {
        const o = this.ctx.createOscillator();
        const g = this.ctx.createGain();
        o.type = 'sawtooth';
        o.frequency.value = 110;
        g.gain.value = 0.025;
        o.connect(g).connect(this.ctx.destination);
        o.start();
        this.hum = { o, g };
      } else if ((!on || !S.sound) && this.hum) {
        const { o, g } = this.hum;
        g.gain.setTargetAtTime(0, this.ctx.currentTime, 0.03);
        o.stop(this.ctx.currentTime + 0.1);
        this.hum = null;
      }
    },
  };

  // ---------- 画面の向きと座標変換 ----------
  let view = { s: 1, ox: 0, oy: 0, cw: 0, ch: 0, dpr: 1 };

  function autoMode() {
    return window.innerWidth >= window.innerHeight ? 'landscape' : 'portrait';
  }

  function applyMode(withPause) {
    const next = S.lockedMode || autoMode();
    if (next === S.mode) return;
    S.mode = next;
    if (withPause && (S.screen === 'play' || S.screen === 'practice')) {
      S.pause = ROTATE_PAUSE;
      el.fade.classList.add('on');
      setTimeout(() => el.fade.classList.remove('on'), 250);
    }
    resize();
  }

  function resize() {
    const r = el.stage.getBoundingClientRect();
    const dpr = window.devicePixelRatio || 1;
    canvas.width = Math.round(r.width * dpr);
    canvas.height = Math.round(r.height * dpr);
    const sw = S.mode === 'landscape' ? W.W : W.H;
    const sh = S.mode === 'landscape' ? W.H : W.W;
    const pad = 8;
    // 操作ボタンの場所(横モードは右の列、縦モードは下の行)を空けて、遊ぶ範囲を置く
    const rw = S.mode === 'landscape' ? RESERVE_RIGHT : 0;
    const rb = S.mode === 'portrait' ? RESERVE_BOTTOM : 0;
    const aw = r.width - rw - pad * 2;
    const ah = r.height - rb - pad * 2;
    const s = Math.min(aw / sw, ah / sh);
    view = { s, ox: pad + (aw - sw * s) / 2, oy: pad + (ah - sh * s) / 2, cw: r.width, ch: r.height, dpr };
    el.stage.classList.toggle('landscape', S.mode === 'landscape');
    el.stage.classList.toggle('portrait', S.mode === 'portrait');
    keepTargetClear();
  }

  // 世界座標 (u, v) → 画面座標 (x, y)。縦モードは横モードの絵を左に90度回したもの
  function toScreen(u, v) {
    if (S.mode === 'landscape') return [view.ox + u * view.s, view.oy + v * view.s];
    return [view.ox + v * view.s, view.oy + (W.W - u) * view.s];
  }
  function toWorld(x, y) {
    if (S.mode === 'landscape') return [(x - view.ox) / view.s, (y - view.oy) / view.s];
    return [W.W - (y - view.oy) / view.s, (x - view.ox) / view.s];
  }
  // 画面上の向き(dx, dy) → 世界座標での向き(du, dv)
  function screenVecToWorld(dx, dy) {
    return S.mode === 'landscape' ? [dx, dy] : [-dy, dx];
  }
  function worldVecToScreen(du, dv) {
    return S.mode === 'landscape' ? [du, dv] : [dv, -du];
  }

  // 発射台をつかめる範囲(画面上で小さくなりすぎないよう px の最低値を持つ)
  function bodyGrab() { return Math.max(64, BODY_GRAB_PX / view.s); }

  // ---------- ゲーム進行 ----------
  function clampLauncher() {
    const L = S.launcher;
    L.u = Math.max(W.MOVE_MIN_U, Math.min(O.moveMaxU(S.f), L.u));
    L.v = Math.max(W.MOVE_MIN_V, Math.min(W.MOVE_MAX_V, L.v));
    L.theta = Math.max(-W.MAX_ANGLE, Math.min(W.MAX_ANGLE, L.theta));
  }

  // 向きを光軸と平行(初期の向き)に戻す
  function levelLauncher() {
    S.launcher.theta = 0;
  }

  // 的が発射ボタン・平行に戻すボタンの近くにあるか(画面上で判定する)
  function nearButtons(t) {
    const cr = canvas.getBoundingClientRect();
    const [x, y] = toScreen(t.u, t.v);
    const clear = t.r * view.s + 16; // 的の半径 + 余白(px)
    for (const b of [el.fire, el.level, el.turnL, el.turnR]) {
      const r = b.getBoundingClientRect();
      if (r.width === 0) continue;
      const bx = r.left - cr.left, by = r.top - cr.top;
      const dx = Math.max(bx - x, 0, x - (bx + r.width));
      const dy = Math.max(by - y, 0, y - (by + r.height));
      if (Math.hypot(dx, dy) < clear) return true;
    }
    return false;
  }

  function newTarget() {
    S.target = O.spawnTarget(S.f, S.target, null, nearButtons);
    S.aimTime = 0;
    S.shotsThisTarget = 0;
  }

  // 光軸上の焦点Fの近くで手を離したら、発射台をFにぴったり吸い付ける(「カチッ」と鳴る)
  function trySnap() {
    const L = S.launcher;
    const fu = W.LENS_U - S.f;
    if (!O.isAtFocus(L.u, L.v, S.f) || (L.u === fu && L.v === W.AXIS_V)) return;
    L.u = fu;
    L.v = W.AXIS_V;
    Sound.snap();
  }

  // 画面サイズや縦横が変わって的がボタンに重なったら、狙い時間はそのままで的だけ置き直す
  function keepTargetClear() {
    if ((S.screen === 'play' || S.screen === 'practice') && S.target && nearButtons(S.target)) {
      S.target = O.spawnTarget(S.f, S.target, null, nearButtons);
    }
  }

  function startRound(practice) {
    Sound.ensure();
    S.screen = practice ? 'practice' : 'play';
    S.f = practice ? Number(el.fSlider.value) : W.F_DEFAULT;
    S.launcher = { u: 250, v: 300, theta: 0 };
    S.target = null;
    S.firing = false;
    S.holdTime = 0;
    S.shotQueued = false;
    S.cooldown = 0;
    S.shot = null;
    S.radarOn = true;
    S.radarVisible = false;
    S.focusNoticePrev = false;
    S.focusNoticeShown = false;
    S.insideNoticeShown = false;
    S.stats = { focusShot: 0, inside: 0, first: 0 };
    S.timeLeft = ROUND_TIME;
    S.score = 0;
    S.hits = 0;
    S.best = Infinity;
    S.laws = { parallel: 0, center: 0, focus: 0 };
    S.hitPaths = [];
    S.ghost = null;
    S.popups = [];
    S.bursts = [];
    S.message = practice
      ? { text: '練習モード:レーダーと焦点距離で、光の進み方を観察しよう', t: 3 }
      : null;
    newTarget();
    el.title.hidden = true;
    el.result.hidden = true;
    updateHudVisibility();
  }

  function endRound() {
    S.screen = 'result';
    S.fireInputs.clear();
    S.turnInputs.clear();
    S.firing = false;
    S.shotQueued = false;
    S.radarVisible = false;
    Sound.setHum(false);
    Sound.end();
    const isNew = S.score > S.high;
    if (isNew) { S.high = S.score; store.set('high', S.high); }
    el.resScore.textContent = S.score.toLocaleString();
    el.resNew.hidden = !isNew;
    el.resHits.textContent = S.hits;
    el.resBest.textContent = S.best === Infinity ? '-' : S.best.toFixed(1) + ' 秒';
    el.resParallel.textContent = S.laws.parallel;
    el.resCenter.textContent = S.laws.center;
    el.resFocus.textContent = S.laws.focus;
    el.resFocusShot.textContent = S.stats.focusShot;
    el.resInside.textContent = S.stats.inside;
    el.resFirst.textContent = S.stats.first;
    el.result.hidden = false;
    updateHudVisibility();
  }

  function toTitle() {
    S.screen = 'title';
    S.fireInputs.clear();
    S.turnInputs.clear();
    S.firing = false;
    S.shotQueued = false;
    S.radarVisible = false;
    Sound.setHum(false);
    el.result.hidden = true;
    el.title.hidden = false;
    el.titleHigh.textContent = S.high.toLocaleString();
    updateHudVisibility();
  }

  function updateHudVisibility() {
    const practice = S.screen === 'practice';
    el.timeBox.hidden = practice;
    el.fBox.hidden = !practice;
    el.radar.hidden = !practice;
    el.fire.innerHTML = practice ? '発射' : '発射<small>長押しで<br>レーダー</small>';
    el.quit.hidden = !(S.screen === 'play' || practice);
    el.scoreBox.querySelector('.hud-label').textContent = practice ? '命中数' : '得点';
  }

  function onHit(trace, dist) {
    const L = S.launcher;
    const t = S.aimTime;
    const laws = O.detectLaws(L.u, L.v, L.theta, S.f, trace);
    const atFocus = O.isAtFocus(L.u, L.v, S.f);
    const inside = !atFocus && L.u > W.LENS_U - S.f + 15; // Fより内側(レンズ寄り)から
    let msg = null;

    S.hits += 1;
    if (S.screen === 'play') {
      const sc = O.shotScore({ t, dist, r: S.target.r, laws, atFocus, firstShot: S.shotsThisTarget === 1 });
      S.score += sc.total;
      S.best = Math.min(S.best, t);
      for (const k of laws) S.laws[k] += 1;
      if (atFocus) S.stats.focusShot += 1;
      if (inside) S.stats.inside += 1;
      if (sc.first) S.stats.first += 1;
      S.hitPaths.push({ seg1: { ...trace.seg1 }, seg2: { ...trace.seg2 } });
      let label = `+${sc.total}`;
      if (sc.first) label += '  一発命中!';
      if (sc.center) label += '  ど真ん中!';
      S.popups.push({ u: S.target.u, v: S.target.v, text: label, t: 1.2 });
      if (atFocus) msg = `焦点から発射!光が光軸に平行に進んだ(+${O.BONUS.focusShot})`;
      else if (laws.length) msg = LAW_TEXT[laws[0]] + `(法則ボーナス +${O.BONUS.law})`;
    } else {
      if (atFocus) msg = '焦点から出た光は、レンズを通ると光軸に平行に進む!';
      else if (laws.length) msg = LAW_TEXT[laws[0]];
    }
    if (inside && !S.insideNoticeShown) {
      msg = 'Fより内側から命中!レンズを通った光が広がって届いたよ';
      S.insideNoticeShown = true;
    }
    S.bursts.push({ u: S.target.u, v: S.target.v, t: 0.6 });
    S.message = msg ? { text: msg, t: MSG_TIME } : { text: `命中!(${t.toFixed(1)} 秒)`, t: 1.0 };
    Sound.hit();
    if (atFocus || laws.length) Sound.bonus();
    newTarget();
  }

  // 本番: 発射ボタンを離した瞬間に1発撃つ
  function fireShot() {
    if (S.cooldown > 0) { Sound.empty(); return; }
    const L = S.launcher;
    const trace = O.traceBeam(L.u, L.v, L.theta, S.f);
    S.cooldown = SHOT_COOLDOWN;
    S.shot = { trace, from: { u: L.u, v: L.v, theta: L.theta }, t: SHOT_FLASH };
    S.shotsThisTarget += 1;
    Sound.shot();
    const d = O.hitTest(trace, S.target);
    if (d !== null) onHit(trace, d);
    else if (O.crossesWithoutLens(trace, S.target)) {
      S.message = { text: 'レンズの外を通った光は無効。レンズを通して当てよう', t: 1.6 };
    }
  }

  // ---------- 更新 ----------
  const keys = new Set();

  function update(dt) {
    const active = S.screen === 'play' || S.screen === 'practice';

    // エフェクトは常に進める
    S.popups = S.popups.filter((p) => (p.t -= dt) > 0);
    S.bursts = S.bursts.filter((b) => (b.t -= dt) > 0);
    if (S.message && (S.message.t -= dt) <= 0) S.message = null;
    if (S.ghost && (S.ghost.t -= dt) <= 0) S.ghost = null;
    if (S.shot) S.shot.t = Math.max(0, S.shot.t - dt);
    S.lensHintCooldown = Math.max(0, S.lensHintCooldown - dt);

    if (!active) return;
    if (S.pause > 0) { S.pause -= dt; return; }

    // キー操作(画面上の見た目の方向に動く)
    let kx = 0, ky = 0;
    if (keys.has('KeyA')) kx -= 1;
    if (keys.has('KeyD')) kx += 1;
    if (keys.has('KeyW')) ky -= 1;
    if (keys.has('KeyS')) ky += 1;
    if (kx || ky) {
      const [du, dv] = screenVecToWorld(kx, ky);
      const n = Math.hypot(du, dv);
      S.launcher.u += (du / n) * MOVE_SPEED * dt;
      S.launcher.v += (dv / n) * MOVE_SPEED * dt;
    }
    const keyMoving = !!(kx || ky);
    // 矢印キー: 光軸を横切る向きのキーで旋回、光軸に沿う向きのキーで平行に戻す。
    // 横モード(光軸が左右)は ↑/↓ で旋回・←/→ で平行、縦モード(光軸が上下)は ←/→ で旋回・↑/↓ で平行。
    // 旋回はキーの矢印の向きにビームが振れる(横の ↑ と縦の ← はどちらも θ を減らす)
    const land = S.mode === 'landscape';
    const turnMinus = land ? 'ArrowUp' : 'ArrowLeft';
    const turnPlus = land ? 'ArrowDown' : 'ArrowRight';
    const lv = land ? ['ArrowLeft', 'ArrowRight'] : ['ArrowUp', 'ArrowDown'];
    if (keys.has(turnMinus)) S.launcher.theta -= TURN_SPEED * dt;
    if (keys.has(turnPlus)) S.launcher.theta += TURN_SPEED * dt;
    if (keys.has(lv[0]) || keys.has(lv[1])) levelLauncher();
    // 旋回ボタン: 押し始めはゆっくり、押し続けるほど速く回る
    for (const ti of S.turnInputs.values()) {
      ti.t += dt;
      const speed = Math.min(TURN_SPEED, TURN_BTN_START + TURN_BTN_ACCEL * ti.t);
      S.launcher.theta += ti.dir * speed * dt;
    }
    clampLauncher();
    if (S.keyMoving && !keyMoving) trySnap(); // キー移動をやめたときも焦点に吸い付く
    S.keyMoving = keyMoving;

    // 発射
    const held = S.fireInputs.size > 0;
    const wasFiring = S.firing;
    if (S.screen === 'play') {
      // 単発: 短く押して離すとすぐ撃つ。長押し中はレーダーが出て、離すと撃つ
      S.cooldown = Math.max(0, S.cooldown - dt);
      if (held) S.holdTime += dt;
      S.radarVisible = held && S.holdTime >= RADAR_DELAY;
      S.firing = false;
      if (S.shotQueued) {
        S.shotQueued = false;
        S.holdTime = 0;
        S.radarVisible = false;
        fireShot();
      }
    } else {
      // 練習モード: 押している間ビームを出し続ける。レーダーは常時表示(ボタンで切り替え)
      S.firing = held;
      S.shotQueued = false;
      S.radarVisible = S.radarOn;
    }

    S.trace = S.firing ? O.traceBeam(S.launcher.u, S.launcher.v, S.launcher.theta, S.f) : null;
    if (wasFiring && !S.firing) {
      const last = O.traceBeam(S.launcher.u, S.launcher.v, S.launcher.theta, S.f);
      S.ghost = { trace: last, t: GHOST_TIME };
    }
    Sound.setHum(S.firing);

    // レーダー表示中に光軸上のFへ入ったら知らせる(文は1ラウンド1回、音は毎回)
    const atF = S.radarVisible && O.isAtFocus(S.launcher.u, S.launcher.v, S.f);
    if (atF && !S.focusNoticePrev) {
      Sound.focus();
      if (!S.focusNoticeShown) {
        S.message = { text: '光が平行になった!ここが焦点F', t: 2.2 };
        S.focusNoticeShown = true;
      }
    }
    S.focusNoticePrev = atF;

    // タイマー
    S.aimTime += dt;
    if (S.screen === 'play') {
      S.timeLeft -= dt;
      if (S.timeLeft <= 0) { S.timeLeft = 0; endRound(); return; }
    }

    // 命中判定
    if (S.trace) {
      const d = O.hitTest(S.trace, S.target);
      if (d !== null) onHit(S.trace, d);
      else if (O.crossesWithoutLens(S.trace, S.target) && S.lensHintCooldown === 0) {
        S.message = { text: 'レンズの外を通った光は無効。レンズを通して当てよう', t: 1.6 };
        S.lensHintCooldown = 3;
      }
    }
  }

  // ---------- 描画 ----------
  const C = {
    bg: '#0f1724',
    field: '#131f35',
    moveArea: 'rgba(79, 163, 255, 0.07)',
    moveEdge: 'rgba(79, 163, 255, 0.35)',
    axis: '#5a6f96',
    text: '#e8eef7',
    quiet: '#9fb0cc',
    lens: 'rgba(160, 220, 255, 0.28)',
    lensEdge: '#a8dcff',
    focus: '#ffd36b',
    beam: '#ff4d6d',
    beamGlow: 'rgba(255, 77, 109, 0.28)',
    ghost: 'rgba(255, 77, 109, 0.35)',
    target: '#7ee081',
    launcher: '#4fa3ff',
    glow: '#fff59d',
    path: 'rgba(255, 211, 107, 0.55)',
    straight: 'rgba(232, 238, 247, 0.6)',
    radarFill: 'rgba(56, 189, 248, 0.16)',
    radarRay: 'rgba(125, 211, 252, 0.55)',
    radarIn: 'rgba(125, 211, 252, 0.25)',
    image: '#fde68a',
  };

  function line(u1, v1, u2, v2) {
    const [x1, y1] = toScreen(u1, v1);
    const [x2, y2] = toScreen(u2, v2);
    ctx.beginPath();
    ctx.moveTo(x1, y1);
    ctx.lineTo(x2, y2);
    ctx.stroke();
  }

  function circle(u, v, rPx, fill, stroke, lw) {
    const [x, y] = toScreen(u, v);
    ctx.beginPath();
    ctx.arc(x, y, rPx, 0, Math.PI * 2);
    if (fill) { ctx.fillStyle = fill; ctx.fill(); }
    if (stroke) { ctx.strokeStyle = stroke; ctx.lineWidth = lw || 1; ctx.stroke(); }
  }

  function text(str, u, v, opt) {
    const o = opt || {};
    const [x, y] = toScreen(u, v);
    ctx.font = `${o.weight || 400} ${Math.max(11, (o.size || 26) * view.s)}px sans-serif`;
    ctx.fillStyle = o.color || C.text;
    ctx.textAlign = o.align || 'center';
    ctx.textBaseline = 'middle';
    ctx.fillText(str, x + (o.dx || 0), y + (o.dy || 0));
  }

  // 光軸上の点に付けるラベル: 横モードは点の下、縦モードは点の右
  function axisLabel(str, u, opt) {
    const off = 26 * view.s + 6;
    const o = Object.assign({}, opt);
    if (S.mode === 'landscape') o.dy = off;
    else { o.dx = off; o.align = 'left'; }
    text(str, u, W.AXIS_V, o);
  }

  function drawBeam(trace, color, glow, width) {
    ctx.lineCap = 'round';
    const segs = [trace.seg1, trace.seg2].filter(Boolean);
    if (glow) {
      ctx.strokeStyle = glow;
      ctx.lineWidth = (width + 8) * Math.max(0.6, view.s * 1.6);
      for (const s of segs) line(s.u1, s.v1, s.u2, s.v2);
    }
    ctx.strokeStyle = color;
    ctx.lineWidth = width * Math.max(0.6, view.s * 1.6);
    for (const s of segs) line(s.u1, s.v1, s.u2, s.v2);
  }

  // 世界座標の点列で多角形の道を作る
  function polyPath(pts) {
    ctx.beginPath();
    pts.forEach(([u, v], i) => {
      const [x, y] = toScreen(u, v);
      if (i) ctx.lineTo(x, y); else ctx.moveTo(x, y);
    });
    ctx.closePath();
  }

  // 世界座標の長方形で描画範囲を切り取る
  function clipWorldRect(u0, v0, u1, v1) {
    const [ax, ay] = toScreen(u0, v0);
    const [bx, by] = toScreen(u1, v1);
    ctx.beginPath();
    ctx.rect(Math.min(ax, bx), Math.min(ay, by), Math.abs(bx - ax), Math.abs(by - ay));
    ctx.clip();
  }

  // レーダー: 今の位置から旋回だけでレンズを通して狙える範囲。今の向きのビームそのものは描かない
  function drawRadar() {
    const { s } = view;
    const L = S.launcher;
    const reg = O.reachRegion(L.u, L.v, S.f, RADAR_RAYS);
    const lensV = (tr) => tr.seg1.v2;
    // レンズより右の光線を画面の外まで延ばした点(描画は遊ぶ範囲で切り取る)
    const far = (tr) => [W.W + 400, lensV(tr) + tr.m2 * (W.W + 400 - W.LENS_U)];
    const [top, bot] = reg.edges;

    // 発射台からレンズの上端・下端まで(入ってくる光の範囲)
    ctx.strokeStyle = C.radarIn;
    ctx.lineWidth = Math.max(1, 1.5 * s);
    for (const tr of [top, bot]) line(L.u, L.v, W.LENS_U, lensV(tr));

    ctx.save();
    clipWorldRect(W.LENS_U, 0, W.W, W.H);
    polyPath([[W.LENS_U, lensV(top)], far(top), far(bot), [W.LENS_U, lensV(bot)]]);
    ctx.fillStyle = C.radarFill;
    ctx.fill();
    ctx.strokeStyle = C.radarRay;
    ctx.lineWidth = Math.max(1, 1.6 * s);
    for (const tr of reg.rays) {
      const [fu, fv] = far(tr);
      line(W.LENS_U, lensV(tr), fu, fv);
    }
    ctx.restore();

    // 像の位置: 実像は輪、虚像は光線を逆にたどった点線と点線の輪
    const im = reg.image;
    if (!im) return;
    const inField = im.u >= 0 && im.u <= W.W && im.v >= 0 && im.v <= W.H;
    ctx.save();
    clipWorldRect(0, 0, W.W, W.H);
    if (!im.real) {
      ctx.strokeStyle = C.image;
      ctx.globalAlpha = 0.6;
      ctx.lineWidth = Math.max(1, 1.4 * s);
      ctx.setLineDash([4, 6]);
      for (const tr of [top, bot]) line(W.LENS_U, lensV(tr), im.u, im.v);
      ctx.globalAlpha = 1;
    }
    if (inField) {
      ctx.setLineDash(im.real ? [] : [4, 4]);
      circle(im.u, im.v, 10 * s + 4, null, C.image, 2.5);
      ctx.setLineDash([]);
      text(im.real ? '実像' : '虚像', im.u, im.v, { color: C.image, size: 22, weight: 700, dy: -(22 * s + 10) });
    }
    ctx.setLineDash([]);
    ctx.restore();
  }

  function render() {
    const { dpr, s } = view;
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    ctx.fillStyle = C.bg;
    ctx.fillRect(0, 0, view.cw, view.ch);

    // 遊ぶ範囲
    const [fx0, fy0] = toScreen(0, 0);
    const [fx1, fy1] = toScreen(W.W, W.H);
    ctx.fillStyle = C.field;
    ctx.fillRect(Math.min(fx0, fx1), Math.min(fy0, fy1), Math.abs(fx1 - fx0), Math.abs(fy1 - fy0));

    // 発射台の移動範囲
    {
      const [ax, ay] = toScreen(W.MOVE_MIN_U - 20, W.MOVE_MIN_V - 20);
      const [bx, by] = toScreen(O.moveMaxU(S.f), W.MOVE_MAX_V + 20);
      ctx.fillStyle = C.moveArea;
      ctx.strokeStyle = C.moveEdge;
      ctx.lineWidth = 1;
      ctx.setLineDash([6, 5]);
      const x = Math.min(ax, bx), y = Math.min(ay, by), w = Math.abs(bx - ax), h = Math.abs(by - ay);
      ctx.fillRect(x, y, w, h);
      ctx.strokeRect(x, y, w, h);
      ctx.setLineDash([]);
    }

    // 光軸
    ctx.strokeStyle = C.axis;
    ctx.lineWidth = 1.2;
    ctx.setLineDash([10, 7]);
    line(0, W.AXIS_V, W.W, W.AXIS_V);
    ctx.setLineDash([]);
    text('光軸', W.W - 20, W.AXIS_V, S.mode === 'landscape'
      ? { color: C.quiet, size: 22, align: 'right', dy: -18 * s - 6 }
      : { color: C.quiet, size: 22, align: 'left', dx: 18 * s + 6 });

    // ビームが通った特別な点(光らせて気づかせる)。本番は撃った1発が光っている間だけ
    const L = S.launcher;
    const flash = S.shot && S.shot.t > 0 ? S.shot : null;
    const tr = S.trace || (flash && flash.trace);
    const from = S.trace ? L : flash ? flash.from : L;
    const laws = tr ? O.detectLaws(from.u, from.v, from.theta, S.f, tr) : [];
    const atFocus = (S.screen === 'play' || S.screen === 'practice') && O.isAtFocus(L.u, L.v, S.f);
    const backFocusLit = tr && tr.passedLens && O.distPointSeg(W.LENS_U + S.f, W.AXIS_V, tr.seg2) <= 14;

    // 焦点 F と 2F
    const pts = [
      { u: W.LENS_U - 2 * S.f, label: '2F', main: false, lit: false },
      { u: W.LENS_U - S.f, label: 'F', main: true, lit: laws.includes('focus') || atFocus },
      { u: W.LENS_U + S.f, label: 'F', main: true, lit: backFocusLit },
      { u: W.LENS_U + 2 * S.f, label: '2F', main: false, lit: false },
    ];
    for (const p of pts) {
      if (p.u < 0 || p.u > W.W) continue;
      if (p.lit) circle(p.u, W.AXIS_V, 18 * s + 6, 'rgba(255, 245, 157, 0.35)');
      circle(p.u, W.AXIS_V, p.main ? 9 * s + 2 : 6 * s + 2, p.lit ? C.glow : p.main ? C.focus : C.quiet);
      axisLabel(p.label, p.u, { color: p.main ? C.focus : C.quiet, size: p.main ? 30 : 24, weight: p.main ? 700 : 400 });
    }

    // 凸レンズ
    {
      const [cx, cy] = toScreen(W.LENS_U, W.AXIS_V);
      const thin = 16 * s, tall = W.LENS_R * s;
      const rx = S.mode === 'landscape' ? thin : tall;
      const ry = S.mode === 'landscape' ? tall : thin;
      ctx.beginPath();
      ctx.ellipse(cx, cy, rx, ry, 0, 0, Math.PI * 2);
      ctx.fillStyle = C.lens;
      ctx.fill();
      ctx.strokeStyle = C.lensEdge;
      ctx.lineWidth = 1.5;
      ctx.stroke();
      if (tr && laws.includes('center')) circle(W.LENS_U, W.AXIS_V, 18 * s + 6, 'rgba(255, 245, 157, 0.45)');
      circle(W.LENS_U, W.AXIS_V, 4 * s + 1.5, C.lensEdge);
      if (S.mode === 'landscape') {
        text('凸レンズ', W.LENS_U, W.AXIS_V - W.LENS_R, { color: C.quiet, size: 22, dy: -14 * s - 8 });
      } else {
        text('凸レンズ', W.LENS_U, W.AXIS_V + W.LENS_R, { color: C.quiet, size: 22, align: 'right', dy: -16 * s - 10 });
      }
    }

    // 結果画面: 命中したビームの道筋を重ねて表示
    if (S.screen === 'result') {
      ctx.strokeStyle = C.path;
      ctx.lineWidth = Math.max(1, 2.5 * s);
      for (const p of S.hitPaths) {
        line(p.seg1.u1, p.seg1.v1, p.seg1.u2, p.seg1.v2);
        line(p.seg2.u1, p.seg2.v1, p.seg2.u2, p.seg2.v2);
      }
    }

    const active = S.screen === 'play' || S.screen === 'practice';
    if (active && S.target) {
      // 的
      const t = S.target;
      const r = t.r * s;
      circle(t.u, t.v, r, 'rgba(126, 224, 129, 0.12)', C.target, 2);
      circle(t.u, t.v, r * 0.62, null, C.target, 1.5);
      circle(t.u, t.v, r * 0.3, C.target);
    }

    // 爆発エフェクト
    for (const b of S.bursts) {
      const k = 1 - b.t / 0.6;
      ctx.globalAlpha = 1 - k;
      circle(b.u, b.v, (30 + 90 * k) * s, null, C.glow, 3);
      ctx.globalAlpha = 1;
    }

    if (active) {
      if (S.radarVisible) drawRadar();
      // 本番: 撃った1発。撃った直後は明るく、その後は次の1発まで薄く残る
      if (S.shot) {
        const k = S.shot.t / SHOT_FLASH;
        ctx.globalAlpha = 0.3 + 0.7 * k;
        drawBeam(S.shot.trace, C.beam, k > 0 ? C.beamGlow : null, k > 0 ? 3 : 2.5);
        ctx.globalAlpha = 1;
      }
      // 練習モード: 直前の道筋(薄く残る)
      if (S.ghost && !S.firing) {
        ctx.globalAlpha = Math.max(0, S.ghost.t / GHOST_TIME);
        drawBeam(S.ghost.trace, C.ghost, null, 2.5);
        ctx.globalAlpha = 1;
      }
      // 発射台の向き(点線): 撃つ前も撃っている間も、レンズで曲がらなかった場合の直線を画面端まで表示する。
      // 撃っている間はビームが手前に重なり、レンズより先で曲がった軌道との違いが見える
      {
        const aim = O.aimLine(L.u, L.v, L.theta);
        ctx.strokeStyle = C.straight;
        ctx.lineWidth = Math.max(1.5, 2.2 * s);
        ctx.setLineDash([8, 8]);
        line(aim.u1, aim.v1, aim.u2, aim.v2);
        ctx.setLineDash([]);
      }
      if (tr) drawBeam(tr, C.beam, C.beamGlow, 3);

      // 発射台
      const [lx, ly] = toScreen(L.u, L.v);
      const [dx, dy] = worldVecToScreen(Math.cos(L.theta), Math.sin(L.theta));
      const ang = Math.atan2(dy, dx);
      ctx.save();
      ctx.translate(lx, ly);
      ctx.rotate(ang);
      const dragKinds = [...drags.values()].map((d) => d.kind);
      const moving = dragKinds.includes('move');
      const turning = dragKinds.includes('turn') || S.turnInputs.size > 0;
      const bw = Math.max(64 * s, BODY_MIN_W_PX), bh = Math.max(34 * s, BODY_MIN_H_PX);
      ctx.fillStyle = moving ? 'rgba(79, 163, 255, 0.55)' : 'rgba(79, 163, 255, 0.25)';
      ctx.strokeStyle = C.launcher;
      ctx.lineWidth = moving ? 3.5 : 2.5;
      ctx.beginPath();
      ctx.roundRect(-bw / 2, -bh / 2, bw, bh, 6);
      ctx.fill();
      ctx.stroke();
      ctx.fillStyle = C.launcher;
      ctx.fillRect(bw / 2 - 4, -bh * 0.18, bh * 0.45, bh * 0.36);
      ctx.restore();
      if (turning) {
        // 旋回中: 発射台の周りに回転の輪を表示
        const rr = Math.max(bw, bh) * 0.5 + 14;
        ctx.strokeStyle = 'rgba(255, 245, 157, 0.75)';
        ctx.lineWidth = 2.5;
        ctx.setLineDash([5, 5]);
        ctx.beginPath();
        ctx.arc(lx, ly, rr, 0, Math.PI * 2);
        ctx.stroke();
        ctx.setLineDash([]);
      }

      // 「平行」マーク
      if (Math.abs(L.theta) <= 3 * DEG) {
        text('平行', L.u, L.v, S.mode === 'landscape'
          ? { color: C.glow, size: 24, weight: 700, dy: -40 * s - 8 }
          : { color: C.glow, size: 24, weight: 700, dx: -46 * s - 12, align: 'right' });
      }
    }

    // 得点の表示(画面の端で切れないように位置を調整)
    for (const p of S.popups) {
      const k = 1 - p.t / 1.2;
      const [px, py] = toScreen(p.u, p.v);
      ctx.font = `800 ${Math.max(14, 34 * s)}px sans-serif`;
      const half = ctx.measureText(p.text).width / 2 + 6;
      const x = Math.max(half, Math.min(view.cw - half, px));
      ctx.globalAlpha = Math.min(1, p.t * 2);
      ctx.fillStyle = C.focus;
      ctx.textAlign = 'center';
      ctx.textBaseline = 'middle';
      ctx.fillText(p.text, x, py - 40 * s - 30 * k);
      ctx.globalAlpha = 1;
    }

    // ひとこと解説(画面下部の帯)
    if (S.message && active) {
      const msg = S.message.text;
      ctx.font = `700 ${Math.max(14, Math.min(22, view.cw / 36))}px sans-serif`;
      const w = Math.min(view.cw - 24, ctx.measureText(msg).width + 32);
      const h = 40;
      const x = (view.cw - w) / 2;
      // 的が出る範囲を隠さない位置: 横モードは画面下端、縦モードはレンズのすぐ下(発射台側)
      const y = S.mode === 'landscape'
        ? view.oy + W.H * s - h - 14
        : view.oy + (W.W - W.LENS_U) * s + 30 * s + 10;
      ctx.globalAlpha = Math.min(1, S.message.t * 3);
      ctx.fillStyle = 'rgba(10, 16, 28, 0.78)';
      ctx.strokeStyle = C.focus;
      ctx.lineWidth = 1.5;
      ctx.beginPath();
      ctx.roundRect(x, y, w, h, 10);
      ctx.fill();
      ctx.stroke();
      ctx.fillStyle = C.text;
      ctx.textAlign = 'center';
      ctx.textBaseline = 'middle';
      ctx.fillText(msg, view.cw / 2, y + h / 2, w - 20);
      ctx.globalAlpha = 1;
    }
  }

  function renderHud() {
    el.time.textContent = S.timeLeft.toFixed(1);
    el.score.textContent = S.screen === 'practice' ? String(S.hits) : S.score.toLocaleString();
    el.aim.textContent = S.aimTime.toFixed(1);
    el.fire.classList.toggle('pressed', S.fireInputs.size > 0);
    el.fire.classList.toggle('disabled', S.screen === 'play' && S.cooldown > 0);
    el.fire.classList.toggle('radar', S.screen === 'play' && S.radarVisible);
    el.radar.textContent = S.radarOn ? 'レーダー:オン' : 'レーダー:オフ';
    el.sound.textContent = S.sound ? '音:オン' : '音:オフ';
    el.rotate.textContent = S.lockedMode ? `↻ 縦/横(${S.mode === 'landscape' ? '横' : '縦'}で固定)` : '↻ 縦/横';
  }

  // ---------- 入力 ----------
  // pointerId → { kind: 'move', offU, offV } | { kind: 'turn', x, y }
  // 発射台の上をドラッグ = 移動、それ以外の場所をドラッグ = 旋回(指を動かした量だけ回る)
  const drags = new Map();

  function pointerWorld(ev) {
    const r = canvas.getBoundingClientRect();
    return toWorld(ev.clientX - r.left, ev.clientY - r.top);
  }

  canvas.addEventListener('pointerdown', (ev) => {
    Sound.ensure();
    if (!(S.screen === 'play' || S.screen === 'practice')) return;
    const [u, v] = pointerWorld(ev);
    const L = S.launcher;
    if (Math.hypot(u - L.u, v - L.v) <= bodyGrab()) {
      drags.set(ev.pointerId, { kind: 'move', offU: L.u - u, offV: L.v - v });
    } else {
      drags.set(ev.pointerId, { kind: 'turn', x: ev.clientX, y: ev.clientY });
    }
    canvas.setPointerCapture(ev.pointerId);
    ev.preventDefault();
  });

  canvas.addEventListener('pointermove', (ev) => {
    const d = drags.get(ev.pointerId);
    if (!d) return;
    const L = S.launcher;
    if (d.kind === 'move') {
      const [u, v] = pointerWorld(ev);
      L.u = u + d.offU;
      L.v = v + d.offV;
    } else {
      // 光軸を横切る向きの指の動きで回る(横モードは上下、縦モードは左右)。
      // 矢印キーと同じく、指を動かした向きにビームが振れる
      const dx = ev.clientX - d.x, dy = ev.clientY - d.y;
      d.x = ev.clientX; d.y = ev.clientY;
      const amount = S.mode === 'landscape' ? dy : dx;
      L.theta += amount * DRAG_TURN_PER_PX;
    }
    clampLauncher();
  });

  const endDrag = (ev) => {
    const d = drags.get(ev.pointerId);
    drags.delete(ev.pointerId);
    if (d && d.kind === 'move') trySnap();
  };
  canvas.addEventListener('pointerup', endDrag);
  canvas.addEventListener('pointercancel', endDrag);

  // 発射の入力(ボタン・スペースキー共通)。本番は全部離した瞬間に1発撃つ
  function pressFire(id) {
    Sound.ensure();
    if (S.fireInputs.size === 0) S.holdTime = 0;
    S.fireInputs.add(id);
  }
  function releaseFireInput(id) {
    if (!S.fireInputs.delete(id)) return;
    if (S.fireInputs.size === 0 && S.screen === 'play') S.shotQueued = true;
  }

  // 発射ボタン(マルチタッチ: 片手で発射台、もう片方で発射)
  el.fire.addEventListener('pointerdown', (ev) => {
    pressFire('p' + ev.pointerId);
    el.fire.setPointerCapture(ev.pointerId);
    ev.preventDefault();
  });
  const releaseFire = (ev) => releaseFireInput('p' + ev.pointerId);
  el.fire.addEventListener('pointerup', releaseFire);
  el.fire.addEventListener('pointercancel', releaseFire);
  el.fire.addEventListener('contextmenu', (ev) => ev.preventDefault());

  // 旋回ボタン(↺ = 左回り = θを減らす、↻ = 右回り = θを増やす。縦横どちらでも見た目の回転方向は同じ)
  for (const [btn, dir] of [[el.turnL, -1], [el.turnR, 1]]) {
    btn.addEventListener('pointerdown', (ev) => {
      if (!(S.screen === 'play' || S.screen === 'practice')) return;
      S.turnInputs.set(ev.pointerId, { dir, t: 0 });
      S.launcher.theta += dir * TURN_BTN_NUDGE;
      clampLauncher();
      btn.setPointerCapture(ev.pointerId);
      btn.classList.add('pressed');
      ev.preventDefault();
    });
    const release = (ev) => {
      S.turnInputs.delete(ev.pointerId);
      if (![...S.turnInputs.values()].some((t) => t.dir === dir)) btn.classList.remove('pressed');
    };
    btn.addEventListener('pointerup', release);
    btn.addEventListener('pointercancel', release);
    btn.addEventListener('contextmenu', (ev) => ev.preventDefault());
  }

  // 平行に戻すボタン(タブレット用。キーボードでは ↑/↓)
  el.level.addEventListener('pointerdown', (ev) => {
    if (S.screen === 'play' || S.screen === 'practice') levelLauncher();
    ev.preventDefault();
  });

  window.addEventListener('keydown', (ev) => {
    if (ev.code === 'Space') {
      pressFire('key');
      ev.preventDefault();
      return;
    }
    if (ev.code === 'KeyR' && !ev.repeat) { toggleRotate(); return; }
    if (ev.code === 'Escape' && (S.screen === 'play' || S.screen === 'practice')) { toTitle(); return; }
    if (ev.code.startsWith('Arrow')) ev.preventDefault();
    keys.add(ev.code);
  });
  window.addEventListener('keyup', (ev) => {
    if (ev.code === 'Space') releaseFireInput('key');
    keys.delete(ev.code);
  });
  window.addEventListener('blur', () => {
    // 画面から離れたら撃たずに入力を取り消す
    keys.clear(); S.fireInputs.clear(); S.turnInputs.clear(); drags.clear();
    S.shotQueued = false; S.holdTime = 0;
    el.turnL.classList.remove('pressed'); el.turnR.classList.remove('pressed');
  });

  function toggleRotate() {
    S.lockedMode = S.mode === 'landscape' ? 'portrait' : 'landscape';
    applyMode(true);
  }

  el.rotate.addEventListener('click', (ev) => { toggleRotate(); ev.currentTarget.blur(); });
  el.sound.addEventListener('click', (ev) => {
    S.sound = !S.sound;
    store.set('sound', S.sound);
    if (!S.sound) Sound.setHum(false);
    ev.currentTarget.blur();
  });
  el.quit.addEventListener('click', (ev) => { toTitle(); ev.currentTarget.blur(); });
  el.radar.addEventListener('click', (ev) => { S.radarOn = !S.radarOn; ev.currentTarget.blur(); });
  el.fSlider.addEventListener('input', () => {
    S.f = Number(el.fSlider.value);
    clampLauncher(); // 焦点距離が長くなると近づける範囲が狭まる
    // 焦点距離が変わると届かない位置になることがあるので、的を置き直す
    if (S.screen === 'practice' && !O.isReachable(S.target, S.f)) newTarget();
  });
  $('btn-start').addEventListener('click', () => startRound(false));
  $('btn-practice').addEventListener('click', () => startRound(true));
  $('btn-retry').addEventListener('click', () => startRound(false));
  $('btn-title').addEventListener('click', toTitle);

  window.addEventListener('resize', () => { applyMode(true); resize(); });
  // 上部の情報表示が折り返して高さが変わったとき(スマホで「やめる」ボタンが出たときなど)も測り直す
  if (window.ResizeObserver) new ResizeObserver(() => resize()).observe(el.stage);

  // ---------- ループ ----------
  let last = performance.now();
  function frame(now) {
    const dt = Math.min(0.05, (now - last) / 1000);
    last = now;
    update(dt);
    render();
    renderHud();
    requestAnimationFrame(frame);
  }

  S.mode = autoMode();
  resize();
  toTitle();
  // タイトル画面の背景用に的を1つ置く
  S.target = O.spawnTarget(S.f, null);
  requestAnimationFrame(frame);

  // 動作確認用(ブラウザのコンソールから状態を見られる)
  window.__lensShooter = { S, toScreen, toWorld, startRound, newTarget, view: () => view };
})();
