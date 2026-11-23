// レンズ・シューター: 光学計算(描画やDOMに依存しない純粋な関数だけを置く)
// 座標系: u = 光軸方向(左→右 0..1600)、v = 光軸に垂直な方向(上→下 0..900)。
// 縦モード/横モードは表示時の回転だけで、この座標系は共通。
(function (root) {
  'use strict';

  const WORLD = {
    W: 1600,          // 光軸方向の長さ
    H: 900,           // 垂直方向の長さ
    LENS_U: 800,      // レンズの位置(中央)
    AXIS_V: 450,      // 光軸の位置(中央)
    LENS_R: 300,      // レンズの半径(これより外を通る光は曲がらない)
    F_DEFAULT: 320,   // 焦点距離(画面幅の約1/5)
    MAX_ANGLE: (80 * Math.PI) / 180, // 向きの制限 ±80度
    TARGET_R: 28,     // 的の半径
    MOVE_MIN_U: 40,   // 発射台の移動範囲(右端は moveMaxU(f) で焦点距離から決める)
    MOVE_MIN_V: 40,
    MOVE_MAX_V: 860,
  };

  /** 発射台が近づける右端: レンズから焦点距離の0.5倍(0.5F)より近くには行けない */
  function moveMaxU(f) {
    return WORLD.LENS_U - 0.5 * f;
  }

  // 傾き m で点 (u, v) から右へ進む光線を、画面の端で切る
  function clipRight(u, v, m) {
    let uEnd = WORLD.W;
    let vEnd = v + m * (WORLD.W - u);
    if (vEnd < 0) {
      uEnd = u + (0 - v) / m;
      vEnd = 0;
    } else if (vEnd > WORLD.H) {
      uEnd = u + (WORLD.H - v) / m;
      vEnd = WORLD.H;
    }
    return { u1: u, v1: v, u2: uEnd, v2: vEnd };
  }

  /**
   * ビームの道筋を計算する(薄い凸レンズ近似)。
   * レンズの高さ h、入射の傾き m のとき、出ていく傾きは m' = m - h / f。
   * @returns {{seg1, seg2, h, m, m2, passedLens}}
   *   seg1: 発射台 → レンズ(または画面端)
   *   seg2: レンズ → 画面端(レンズに届かなければ null)
   *   straight: レンズで曲がらなかったと仮定した直進の道筋(比較用の点線。曲がらなかったときは null)
   *   passedLens: レンズの内側を通って曲がったか
   */
  function traceBeam(u0, v0, theta, f) {
    const m = Math.tan(theta);
    const L = WORLD.LENS_U;
    const vAtLens = v0 + m * (L - u0);

    if (vAtLens < 0 || vAtLens > WORLD.H) {
      // レンズに届く前に画面の上下から出てしまう
      const seg1 = clipRight(u0, v0, m);
      return { seg1, seg2: null, straight: null, h: null, m, m2: m, passedLens: false };
    }

    const seg1 = { u1: u0, v1: v0, u2: L, v2: vAtLens };
    const h = vAtLens - WORLD.AXIS_V;
    const passedLens = Math.abs(h) <= WORLD.LENS_R;
    const m2 = passedLens ? m - h / f : m;
    const seg2 = clipRight(L, vAtLens, m2);
    const straight = passedLens ? clipRight(L, vAtLens, m) : null;
    return { seg1, seg2, straight, h, m, m2, passedLens };
  }

  /** 発射台の向きのまま、レンズで曲がらずに画面端まで進んだ場合の直線(狙いの点線用) */
  function aimLine(u0, v0, theta) {
    return clipRight(u0, v0, Math.tan(theta));
  }

  function distPointSeg(pu, pv, s) {
    const du = s.u2 - s.u1;
    const dv = s.v2 - s.v1;
    const len2 = du * du + dv * dv;
    let t = len2 === 0 ? 0 : ((pu - s.u1) * du + (pv - s.v1) * dv) / len2;
    t = Math.max(0, Math.min(1, t));
    const qu = s.u1 + t * du;
    const qv = s.v1 + t * dv;
    return Math.hypot(pu - qu, pv - qv);
  }

  /** レンズを通って曲がったビームが的に当たっていれば、的の中心からの距離を返す。外れなら null */
  function hitTest(trace, target) {
    if (!trace.passedLens || !trace.seg2) return null;
    const d = distPointSeg(target.u, target.v, trace.seg2);
    return d <= target.r ? d : null;
  }

  /** レンズを通らずに的を横切ったか(「レンズを通った光だけ有効」のヒント表示用) */
  function crossesWithoutLens(trace, target) {
    if (trace.passedLens || !trace.seg2) return false;
    return distPointSeg(target.u, target.v, trace.seg2) <= target.r;
  }

  const LAW_TOL = 14; // 法則判定の許容幅(座標単位)
  const PARALLEL_TOL = (3 * Math.PI) / 180;

  /** ビームが3つの法則のどれに当てはまるかを返す(['parallel' | 'center' | 'focus']) */
  function detectLaws(u0, v0, theta, f, trace) {
    const laws = [];
    if (!trace.passedLens) return laws;
    if (Math.abs(theta) <= PARALLEL_TOL) laws.push('parallel');
    if (Math.abs(trace.h) <= LAW_TOL) laws.push('center');
    const fu = WORLD.LENS_U - f;
    if (u0 < fu - LAW_TOL && distPointSeg(fu, WORLD.AXIS_V, trace.seg1) <= LAW_TOL) {
      laws.push('focus');
    }
    return laws;
  }

  /** 命中までの時間 t(秒)から基本点を返す */
  function baseScore(t) {
    if (t <= 1) return 1000;
    if (t <= 7) return Math.round(1000 - 150 * (t - 1));
    return 100;
  }

  /** 発射台の移動範囲内のどこかから、レンズを通して的に当てられるか */
  function isReachable(target, f) {
    const probe = { u: target.u, v: target.v, r: target.r * 0.8 };
    const maxU = moveMaxU(f);
    for (let u0 = WORLD.MOVE_MIN_U; u0 <= maxU; u0 += 70) {
      for (let v0 = WORLD.MOVE_MIN_V; v0 <= WORLD.MOVE_MAX_V; v0 += 60) {
        for (let deg = -80; deg <= 80; deg += 2) {
          const tr = traceBeam(u0, v0, (deg * Math.PI) / 180, f);
          if (hitTest(tr, probe) !== null) return true;
        }
      }
    }
    return false;
  }

  /**
   * 新しい的の位置を決める。
   * レンズの右側・レンズから焦点距離の0.5倍以上離す・前回位置から300以上離す・必ず当てられる。
   * avoid(cand) が true を返す位置(発射ボタンの周りなど、画面側の都合で置けない位置)には置かない。
   */
  function spawnTarget(f, prev, rng, avoid) {
    const rand = rng || Math.random;
    const r = WORLD.TARGET_R;
    const minU = WORLD.LENS_U + Math.max(0.5 * f, 60);
    const maxU = WORLD.W - 50;
    const minV = 60;
    const maxV = WORLD.H - 60;
    // 1回目は前回位置から離す条件つき、見つからなければ2回目はその条件を外して探す
    for (const needFar of [true, false]) {
      for (let i = 0; i < 300; i++) {
        const cand = {
          u: minU + rand() * (maxU - minU),
          v: minV + rand() * (maxV - minV),
          r,
        };
        if (needFar && prev && Math.hypot(cand.u - prev.u, cand.v - prev.v) < 300) continue;
        if (avoid && avoid(cand)) continue;
        if (!isReachable(cand, f)) continue;
        return cand;
      }
    }
    // 念のため: 条件を満たす候補が見つからない場合は焦点の少し先に置く
    return { u: WORLD.LENS_U + f * 1.5, v: WORLD.AXIS_V - 120, r };
  }

  const api = {
    WORLD,
    moveMaxU,
    aimLine,
    traceBeam,
    distPointSeg,
    hitTest,
    crossesWithoutLens,
    detectLaws,
    baseScore,
    isReachable,
    spawnTarget,
  };

  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  else root.LensOptics = api;
})(typeof window !== 'undefined' ? window : globalThis);
