// SPDX-License-Identifier: GPL-3.0-or-later
// Copyright (C) 2026 transpason
// このプログラムはフリーソフトウェアです。GNU一般公衆利用許諾書(GPL)バージョン3または
// それ以降のバージョンの条件で再配布・改変できます。無保証です。詳細は LICENSE を参照。
// 実行: node --test tests/
const test = require('node:test');
const assert = require('node:assert/strict');
const O = require('../js/optics.js');

const { WORLD } = O;
const f = WORLD.F_DEFAULT;
const L = WORLD.LENS_U;
const A = WORLD.AXIS_V;

// seg2 上で u = x のときの v
function vAt(seg, x) {
  return seg.v1 + ((seg.v2 - seg.v1) * (x - seg.u1)) / (seg.u2 - seg.u1);
}

test('光軸に平行な光はレンズを通ると後ろの焦点を通る', () => {
  for (const v0 of [200, 350, 600, 700]) {
    const tr = O.traceBeam(100, v0, 0, f);
    assert.ok(tr.passedLens);
    assert.ok(Math.abs(vAt(tr.seg2, L + f) - A) < 1e-6);
  }
});

test('レンズの中心を通る光は直進する', () => {
  const theta = Math.atan2(A - 300, L - 200); // (200,300) からレンズ中心へ
  const tr = O.traceBeam(200, 300, theta, f);
  assert.ok(Math.abs(tr.h) < 1e-6);
  assert.ok(Math.abs(tr.m2 - tr.m) < 1e-9);
});

test('前の焦点を通った光はレンズを通ると光軸に平行に進む', () => {
  const u0 = 200, v0 = 380;
  const theta = Math.atan2(A - v0, L - f - u0); // 前の焦点 (L-f, A) を通る向き
  const tr = O.traceBeam(u0, v0, theta, f);
  assert.ok(tr.passedLens);
  assert.ok(Math.abs(tr.m2) < 1e-9);
  assert.deepEqual(O.detectLaws(u0, v0, theta, f, tr), ['focus']);
});

test('レンズの外側を通る光は曲がらず、的に当たっても無効', () => {
  const tr = O.traceBeam(100, 100, 0, f); // h = -350 (半径300の外)
  assert.equal(tr.passedLens, false);
  const target = { u: 1200, v: 100, r: 28 };
  assert.equal(O.hitTest(tr, target), null);
  assert.equal(O.crossesWithoutLens(tr, target), true);
});

test('得点: 1秒以内1000点、1〜7秒は1秒150点減、7秒超は100点', () => {
  assert.equal(O.baseScore(0.5), 1000);
  assert.equal(O.baseScore(1), 1000);
  assert.equal(O.baseScore(3), 700);
  assert.equal(O.baseScore(7), 100);
  assert.equal(O.baseScore(20), 100);
});

test('的はレンズの右側に出て、前回位置から離れ、必ず当てられる', () => {
  let seed = 1;
  const rng = () => ((seed = (seed * 16807) % 2147483647) / 2147483647);
  let prev = null;
  for (let i = 0; i < 30; i++) {
    const t = O.spawnTarget(f, prev, rng);
    assert.ok(t.u >= L + 0.5 * f);
    if (prev) assert.ok(Math.hypot(t.u - prev.u, t.v - prev.v) >= 300);
    assert.ok(O.isReachable(t, f));
    prev = t;
  }
});

test('発射台はレンズから0.5F以内に近づけない(焦点距離に応じて変わる)', () => {
  assert.equal(O.moveMaxU(320), L - 160);
  assert.equal(O.moveMaxU(480), L - 240);
});

test('比較用の点線は、レンズで曲がらなかった場合の直進の道筋', () => {
  const theta = 10 * Math.PI / 180;
  const tr = O.traceBeam(200, 300, theta, f);
  assert.ok(tr.passedLens && tr.straight);
  assert.equal(tr.straight.u1, L);
  assert.ok(Math.abs((tr.straight.v2 - tr.straight.v1) / (tr.straight.u2 - tr.straight.u1) - Math.tan(theta)) < 1e-9);
  // レンズの外を通って曲がらないときは点線なし
  assert.equal(O.traceBeam(100, 100, 0, f).straight, null);
});

test('avoid で指定した場所(発射ボタンの周りなど)には的を置かない', () => {
  const avoid = (t) => t.u > 1300 && t.v > 600; // 右下を避ける
  for (let i = 0; i < 30; i++) {
    const t = O.spawnTarget(f, null, Math.random, avoid);
    assert.ok(!avoid(t));
  }
});

test('狙いの点線は発射台から向きのまま画面端まで伸びる', () => {
  const a = O.aimLine(200, 450, 0);
  assert.deepEqual([a.u1, a.v1, a.u2, a.v2], [200, 450, WORLD.W, 450]);
  const b = O.aimLine(200, 450, -Math.PI / 4); // 上向き45度 → 上端で切れる
  assert.ok(Math.abs(b.v2) < 1e-9 && Math.abs(b.u2 - 650) < 1e-9);
});
