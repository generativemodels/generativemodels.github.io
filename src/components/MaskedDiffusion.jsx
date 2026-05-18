import { useState, useEffect, useMemo, useRef, useCallback } from "react";

// ── Schedules ───────────────────────────────────────────────────────
// alpha_t: [0,1] -> [0,1], with alpha_0 = 1 (clean), alpha_1 = 0 (fully masked).
const SCHEDULES = {
  linear: {
    label: "1 - t",
    alpha: (t) => 1 - t,
    alphaDot: (_t) => -1,
  },
  quadratic: {
    label: "1 - t²",
    alpha: (t) => 1 - t * t,
    alphaDot: (t) => -2 * t,
  },
  cosine: {
    label: "cos(tπ/2)",
    alpha: (t) => Math.cos((t * Math.PI) / 2),
    alphaDot: (t) => -(Math.PI / 2) * Math.sin((t * Math.PI) / 2),
  },
};

// ── Theme ───────────────────────────────────────────────────────────
const COLOR_DISCRETE = "#82b4ff";
const COLOR_CONTINUOUS = "#DD8452";
const COLOR_CLEAN = "#5bbf6f";
const COLOR_MASK = "#aaa";
const COLOR_ALPHA = "rgba(255,255,255,0.85)";
const COLOR_UNCONDITIONAL = "#9ca3af";

// ── Seeded RNG (mulberry32) ─────────────────────────────────────────
function makeRng(seed) {
  let s = seed | 0;
  return function () {
    s = (s + 0x6D2B79F5) | 0;
    let t = Math.imul(s ^ (s >>> 15), 1 | s);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

// state[i] is true iff the token is unmasked at grid index i (t = i/T).
// direction = "forward":  start at x_0 (state[0] = true),  step left to right, masking is irreversible.
// direction = "reverse" (conditioned on x_0): start at m (state[T] = false), step right to left, unmasking is irreversible.
function simulateOne(T, alpha, alphaDot, mode, direction, rand) {
  const state = new Array(T + 1);
  if (direction === "forward") {
    state[0] = true;
    let alive = true;
    for (let i = 1; i <= T; i++) {
      if (!alive) { state[i] = false; continue; }
      const tPrev = (i - 1) / T;
      const tCurr = i / T;
      let pMask;
      if (mode === "discrete") {
        const aPrev = alpha(tPrev), aCurr = alpha(tCurr);
        pMask = aPrev > 1e-12 ? 1 - aCurr / aPrev : 1;
      } else {
        const dt = 1 / T;
        const a = alpha(tPrev), ad = alphaDot(tPrev);
        pMask = a > 1e-12 ? -ad / a * dt : 1;
      }
      pMask = Math.max(0, Math.min(1, pMask));
      if (rand() < pMask) alive = false;
      state[i] = alive;
    }
  } else {
    // Reverse process conditioned on x_0 (eq. bridge-mask in dfm.mdx).
    state[T] = false;
    let alive = false;
    for (let i = T - 1; i >= 0; i--) {
      if (alive) { state[i] = true; continue; }
      const tCurr = (i + 1) / T;
      const sNext = i / T;
      let pUnmask;
      if (mode === "discrete") {
        // (alpha_s - alpha_t) / (1 - alpha_t)
        const aT = alpha(tCurr), aS = alpha(sNext);
        const denom = 1 - aT;
        pUnmask = denom > 1e-12 ? (aS - aT) / denom : 0;
      } else {
        // Euler step on the conditional reverse rate -alpha_dot(t) / (1 - alpha(t))
        const dt = 1 / T;
        const aT = alpha(tCurr), adT = alphaDot(tCurr);
        const denom = 1 - aT;
        pUnmask = denom > 1e-12 ? -adT / denom * dt : 0;
      }
      pUnmask = Math.max(0, Math.min(1, pUnmask));
      if (rand() < pUnmask) alive = true;
      state[i] = alive;
    }
  }
  return state;
}

function survivalSchedule(T, alpha, alphaDot, mode) {
  const probs = new Array(T + 1);
  probs[0] = 1;
  if (mode === "discrete") {
    for (let i = 1; i <= T; i++) probs[i] = Math.max(0, alpha(i / T));
    return probs;
  }
  let p = 1;
  const dt = 1 / T;
  for (let i = 1; i <= T; i++) {
    const tPrev = (i - 1) / T;
    const a = alpha(tPrev), ad = alphaDot(tPrev);
    let pMask = a > 1e-12 ? -ad / a * dt : 1;
    pMask = Math.max(0, Math.min(1, pMask));
    p = p * (1 - pMask);
    probs[i] = p;
  }
  return probs;
}

function singleTrajectory(T, alpha, alphaDot, mode, direction, seed) {
  return simulateOne(T, alpha, alphaDot, mode, direction, makeRng(seed));
}

function aggregateTrajectories(T, alpha, alphaDot, mode, direction, N, baseSeed) {
  const counts = new Array(T + 1).fill(0);
  for (let n = 0; n < N; n++) {
    const seed = (baseSeed + n * 2654435761) | 0;
    const rand = makeRng(seed);
    const traj = simulateOne(T, alpha, alphaDot, mode, direction, rand);
    for (let i = 0; i <= T; i++) if (traj[i]) counts[i] += 1;
  }
  return counts.map((c) => c / N);
}

// ── UI bits ─────────────────────────────────────────────────────────
function ToggleButton({ options, value, onChange, color = "#a78bfa" }) {
  return (
    <div style={{ display: "flex", borderRadius: 6, overflow: "hidden", border: "1px solid rgba(255,255,255,0.12)" }}>
      {options.map((opt) => (
        <button
          key={opt.value}
          onClick={() => onChange(opt.value)}
          style={{
            padding: "4px 10px",
            fontSize: 10,
            fontFamily: "'DM Mono', monospace",
            fontWeight: value === opt.value ? 600 : 400,
            background: value === opt.value ? `${color}33` : "rgba(255,255,255,0.03)",
            color: value === opt.value ? color : "rgba(255,255,255,0.4)",
            border: "none",
            cursor: "pointer",
            transition: "all 0.2s ease",
          }}
        >
          {opt.label}
        </button>
      ))}
    </div>
  );
}

function ToggleCheck({ label, checked, onChange, color }) {
  return (
    <button
      onClick={() => onChange(!checked)}
      style={{
        display: "flex", alignItems: "center", gap: 6,
        padding: "4px 10px", borderRadius: 6,
        border: `1px solid ${checked ? color : "rgba(255,255,255,0.12)"}`,
        background: checked ? `${color}1f` : "rgba(255,255,255,0.03)",
        color: checked ? color : "rgba(255,255,255,0.4)",
        cursor: "pointer", fontFamily: "'DM Mono', monospace",
        fontSize: 11, fontWeight: checked ? 600 : 400,
        transition: "all 0.2s ease",
      }}
    >
      <span style={{
        width: 8, height: 8, borderRadius: "50%",
        background: checked ? color : "rgba(255,255,255,0.15)",
      }} />
      {label}
    </button>
  );
}

function NumberInput({ label, value, onApply, color = "#82b4ff", min, max, step = 1, width = 64 }) {
  const [text, setText] = useState(String(value));
  useEffect(() => { setText(String(value)); }, [value]);
  return (
    <div style={{ display: "flex", alignItems: "center", gap: 6 }}>
      <span style={{ fontFamily: "'DM Mono', monospace", fontSize: 11, color: "rgba(255,255,255,0.45)" }}>
        {label}
      </span>
      <input
        type="number"
        min={min}
        max={max}
        step={step}
        value={text}
        onChange={(e) => setText(e.target.value)}
        onBlur={() => onApply(text)}
        onKeyDown={(e) => { if (e.key === "Enter") onApply(text); }}
        style={{
          width, padding: "4px 6px", borderRadius: 6,
          border: "1px solid rgba(255,255,255,0.15)",
          background: "rgba(255,255,255,0.06)",
          color, fontFamily: "'DM Mono', monospace",
          fontSize: 12, fontWeight: 600, textAlign: "center", outline: "none",
        }}
      />
    </div>
  );
}

// ── Top figure: animated step-by-step trajectory ───────────────────
function TrajectoryFigure({
  T, alpha, alphaDot, seed, showDiscrete, showContinuous, step, direction, ghost,
}) {
  const W = 560;
  const H = 200;
  const padL = 50, padR = 150, padT = 30, padB = 28;
  const plotW = W - padL - padR;
  const plotH = H - padT - padB;

  const yClean = padT + plotH * 0.30;
  const yMask = padT + plotH * 0.78;
  const xAt = (i) => padL + (i / T) * plotW;

  const trajD = useMemo(
    () => singleTrajectory(T, alpha, alphaDot, "discrete", direction, seed),
    [T, alpha, alphaDot, direction, seed]
  );
  const trajC = useMemo(
    () => singleTrajectory(T, alpha, alphaDot, "continuous", direction, seed + 7919),
    [T, alpha, alphaDot, direction, seed]
  );

  const yOf = (alive) => (alive ? yClean : yMask);
  const clampProb = (p) => Math.max(0, Math.min(1, p));

  // grid index visited at simulation step k
  const idxAtStep = (k) => (direction === "forward" ? k : T - k);
  const currentIdx = idxAtStep(step);

  // P(x_next = x_0 | x_current). The "next" is the next simulation step
  // (i.e. forward: idx+1 is later in time; reverse: idx-1 is earlier in time).
  // - Once a token leaves x_0 (forward) or m (reverse), it stays absorbed,
  //   so for forward: x_current = m  ->  P = 0.
  //                  reverse: x_current = x_0 -> P = 1 (stays at x_0).
  // - Otherwise we plug into the corresponding kernel from dfm.mdx.
  function nextCleanProb(traj, mode) {
    // No "next" past the last simulation step.
    if (step >= T) return null;
    const alive = traj[currentIdx];
    if (direction === "forward") {
      if (!alive) return 0; // already masked, stays masked
      // P(x_{i+1} = x_0 | x_i = x_0) = alpha_{(i+1)/T}/alpha_{i/T}  (discrete)
      //                              = 1 - (-alpha_dot/alpha) * dt (continuous Euler)
      const tCurr = currentIdx / T;
      const tNext = (currentIdx + 1) / T;
      if (mode === "discrete") {
        const aPrev = alpha(tCurr);
        return aPrev > 1e-12 ? clampProb(alpha(tNext) / aPrev) : 0;
      }
      const dt = 1 / T;
      const a = alpha(tCurr), ad = alphaDot(tCurr);
      const pMask = a > 1e-12 ? -ad / a * dt : 1;
      return clampProb(1 - pMask);
    }
    // reverse: next idx is currentIdx - 1, going backward in time
    if (alive) return 1; // already at x_0, stays at x_0
    // P(x_s = x_0 | x_t = m, x_0) = (alpha_s - alpha_t)/(1 - alpha_t)  (discrete)
    //                             = -alpha_dot(t)/(1 - alpha(t)) * dt   (continuous Euler)
    const tCurr = currentIdx / T;
    const sNext = (currentIdx - 1) / T;
    if (mode === "discrete") {
      const aT = alpha(tCurr);
      const denom = 1 - aT;
      return denom > 1e-12 ? clampProb((alpha(sNext) - aT) / denom) : 0;
    }
    const dt = 1 / T;
    const aT = alpha(tCurr), adT = alphaDot(tCurr);
    const denom = 1 - aT;
    return denom > 1e-12 ? clampProb(-adT / denom * dt) : 0;
  }

  // Arrow path between adjacent grid indices a and b (head at b).
  // L-shape if a vertical jump happens.
  function renderArrow(traj, a, b, color, dashed, opacity) {
    if (a < 0 || b < 0 || a > T || b > T) return null;
    const x0 = xAt(a);
    const x1 = xAt(b);
    const y0 = yOf(traj[a]);
    const y1 = yOf(traj[b]);
    const id = `arrow-${color.replace("#", "")}-${dashed ? "d" : "s"}-${opacity > 0.5 ? "f" : "p"}-${a}-${b}`;
    let d;
    if (y0 === y1) {
      d = `M ${x0} ${y0} L ${x1} ${y1}`;
    } else {
      d = `M ${x0} ${y0} L ${x1} ${y0} L ${x1} ${y1}`;
    }
    return (
      <g opacity={opacity}>
        <defs>
          <marker id={id} viewBox="0 0 8 8" refX={7} refY={4}
            markerWidth={5} markerHeight={5} orient="auto-start-reverse">
            <path d="M 0 0 L 8 4 L 0 8 z" fill={color} />
          </marker>
        </defs>
        <path d={d} fill="none" stroke={color} strokeWidth={1.1}
          strokeLinejoin="round" strokeLinecap="round"
          strokeDasharray={dashed ? "5 3" : undefined}
          markerEnd={`url(#${id})`} />
      </g>
    );
  }

  // Ghost trajectory: render the full previous-run path very faintly so the user
  // can compare reverse against the forward run that produced x_0.
  function renderGhostPath(ghostTraj, ghostDir, color, dashed) {
    if (!ghostTraj) return null;
    const segs = [];
    for (let k = 1; k <= T; k++) {
      const a = ghostDir === "forward" ? k - 1 : T - (k - 1);
      const b = ghostDir === "forward" ? k     : T - k;
      const x0 = xAt(a), x1 = xAt(b);
      const y0 = yOf(ghostTraj[a]), y1 = yOf(ghostTraj[b]);
      if (y0 === y1) {
        segs.push(`M ${x0} ${y0} L ${x1} ${y1}`);
      } else {
        segs.push(`M ${x0} ${y0} L ${x1} ${y0} L ${x1} ${y1}`);
      }
    }
    return (
      <path d={segs.join(" ")} fill="none" stroke={color} strokeWidth={1.0}
        strokeLinejoin="round" strokeLinecap="round" opacity={0.18}
        strokeDasharray={dashed ? "3 3" : undefined} />
    );
  }

  // Right-hand bars: next-step survival prob, and the unconditional clean prob for reference.
  const barX = padL + plotW + 20;
  const barW = 16;
  const barAreaH = 80;
  const barTop = padT + 20;
  const barGap = 8;
  const activeBarCount = Number(showDiscrete) + Number(showContinuous);
  const conditionalGroupW = activeBarCount * barW + Math.max(0, activeBarCount - 1) * barGap;
  const unconditionalBarX = barX + conditionalGroupW + (activeBarCount > 0 ? 22 : 0);
  const unconditionalCleanProb = clampProb(alpha(currentIdx / T));

  // List of visited grid indices (in order of visiting).
  const visitedIdxs = Array.from({ length: step + 1 }, (_, k) => idxAtStep(k));

  return (
    <svg width={W} height={H} style={{ overflow: "visible" }}>
      <line x1={padL} y1={yClean} x2={padL + plotW} y2={yClean}
        stroke="rgba(91,191,111,0.18)" strokeDasharray="3 3" />
      <line x1={padL} y1={yMask} x2={padL + plotW} y2={yMask}
        stroke="rgba(255,255,255,0.12)" strokeDasharray="3 3" />
      <line x1={padL} y1={padT} x2={padL} y2={padT + plotH}
        stroke="rgba(255,255,255,0.18)" />
      <line x1={padL} y1={padT + plotH} x2={padL + plotW} y2={padT + plotH}
        stroke="rgba(255,255,255,0.18)" />

      <text x={padL - 8} y={yClean + 4} textAnchor="end" fontSize={12}
        fill={COLOR_CLEAN} fontFamily="'DM Mono', monospace" fontWeight={600}>x₀</text>
      <text x={padL - 8} y={yMask + 4} textAnchor="end" fontSize={12}
        fill={COLOR_MASK} fontFamily="'DM Mono', monospace" fontWeight={600}>m</text>

      <text x={padL} y={padT + plotH + 16} textAnchor="middle" fontSize={10}
        fill="rgba(255,255,255,0.45)" fontFamily="'DM Mono', monospace">t=0</text>
      <text x={padL + plotW} y={padT + plotH + 16} textAnchor="middle" fontSize={10}
        fill="rgba(255,255,255,0.45)" fontFamily="'DM Mono', monospace">t=1</text>
      {Array.from({ length: T + 1 }, (_, i) => (
        <line key={`tick${i}`} x1={xAt(i)} y1={padT + plotH} x2={xAt(i)} y2={padT + plotH + 3}
          stroke="rgba(255,255,255,0.25)" />
      ))}

      {/* Ghost trajectory of the previous run (drawn underneath everything else). */}
      {ghost && ghost.discrete && showDiscrete && renderGhostPath(ghost.discrete, ghost.direction, COLOR_DISCRETE, false)}
      {ghost && ghost.continuous && showContinuous && renderGhostPath(ghost.continuous, ghost.direction, COLOR_CONTINUOUS, true)}
      {ghost && ghost.discrete && showDiscrete && Array.from({ length: T + 1 }, (_, i) => (
        <circle key={`gD${i}`} cx={xAt(i)} cy={yOf(ghost.discrete[i])}
          r={2} fill={COLOR_DISCRETE} opacity={0.22} />
      ))}
      {ghost && ghost.continuous && showContinuous && Array.from({ length: T + 1 }, (_, i) => (
        <circle key={`gC${i}`} cx={xAt(i)} cy={yOf(ghost.continuous[i])}
          r={2} fill={COLOR_CONTINUOUS} opacity={0.22} />
      ))}

      {/* Past arrows (latest is brighter). */}
      {showDiscrete && Array.from({ length: step }, (_, k) => {
        const a = idxAtStep(k);
        const b = idxAtStep(k + 1);
        return (
          <g key={`ad${k}`}>
            {renderArrow(trajD, a, b, COLOR_DISCRETE, false, k === step - 1 ? 1 : 0.35)}
          </g>
        );
      })}
      {showContinuous && Array.from({ length: step }, (_, k) => {
        const a = idxAtStep(k);
        const b = idxAtStep(k + 1);
        return (
          <g key={`ac${k}`}>
            {renderArrow(trajC, a, b, COLOR_CONTINUOUS, true, k === step - 1 ? 1 : 0.35)}
          </g>
        );
      })}

      {/* Visited dots only. Current dot highlighted with white halo. */}
      {showDiscrete && visitedIdxs.map((gi, k) => (
        <circle key={`dD${k}`} cx={xAt(gi)} cy={yOf(trajD[gi])}
          r={k === step ? 5.5 : 3} fill={COLOR_DISCRETE}
          stroke={k === step ? "#fff" : "none"} strokeWidth={k === step ? 1.5 : 0}
          opacity={k === step ? 1 : 0.7} />
      ))}
      {showContinuous && visitedIdxs.map((gi, k) => (
        <circle key={`dC${k}`} cx={xAt(gi)} cy={yOf(trajC[gi])}
          r={k === step ? 5.5 : 3} fill={COLOR_CONTINUOUS}
          stroke={k === step ? "#fff" : "none"} strokeWidth={k === step ? 1.5 : 0}
          opacity={k === step ? 1 : 0.7} />
      ))}

      {/* Bars: next-step P(x_0). Hidden once we run past the last step. */}
      {showDiscrete && (() => {
        const p = nextCleanProb(trajD, "discrete");
        if (p === null) return null;
        const h = p * barAreaH;
        const x = barX;
        return (
          <g>
            <rect x={x} y={barTop} width={barW} height={barAreaH}
              fill="rgba(255,255,255,0.04)" stroke="rgba(255,255,255,0.1)" />
            {h > 0 && (
              <rect x={x} y={barTop + (barAreaH - h)} width={barW} height={h}
                fill={COLOR_DISCRETE} opacity={0.85} rx={2} />
            )}
            <text x={x + barW / 2} y={barTop + barAreaH + 12} textAnchor="middle" fontSize={9}
              fill={COLOR_DISCRETE} fontFamily="'DM Mono', monospace">{p.toFixed(2)}</text>
          </g>
        );
      })()}
      {showContinuous && (() => {
        const p = nextCleanProb(trajC, "continuous");
        if (p === null) return null;
        const h = p * barAreaH;
        const x = barX + (showDiscrete ? barW + barGap : 0);
        return (
          <g>
            <rect x={x} y={barTop} width={barW} height={barAreaH}
              fill="rgba(255,255,255,0.04)" stroke="rgba(255,255,255,0.1)" />
            {h > 0 && (
              <rect x={x} y={barTop + (barAreaH - h)} width={barW} height={h}
                fill={COLOR_CONTINUOUS} opacity={0.85} rx={2} />
            )}
            <text x={x + barW / 2} y={barTop + barAreaH + 12} textAnchor="middle" fontSize={9}
              fill={COLOR_CONTINUOUS} fontFamily="'DM Mono', monospace">{p.toFixed(2)}</text>
          </g>
        );
      })()}
      {(() => {
        const p = unconditionalCleanProb;
        const h = p * barAreaH;
        return (
          <g>
            <rect x={unconditionalBarX} y={barTop} width={barW} height={barAreaH}
              fill="rgba(255,255,255,0.04)" stroke="rgba(255,255,255,0.1)" />
            {h > 0 && (
              <rect x={unconditionalBarX} y={barTop + (barAreaH - h)} width={barW} height={h}
                fill={COLOR_UNCONDITIONAL} opacity={0.85} rx={2} />
            )}
            <text x={unconditionalBarX + barW / 2} y={barTop + barAreaH + 12} textAnchor="middle" fontSize={9}
              fill={COLOR_UNCONDITIONAL} fontFamily="'DM Mono', monospace">{p.toFixed(2)}</text>
          </g>
        );
      })()}
    </svg>
  );
}

// ── Bottom figure: empirical fraction unmasked vs alpha_t ──────────
function AggregateFigure({ T, alpha, alphaDot, N, seed, showDiscrete, showContinuous, direction }) {
  const W = 520;
  const H = 240;
  const padL = 50, padR = 20, padT = 20, padB = 36;
  const plotW = W - padL - padR;
  const plotH = H - padT - padB;

  const xAt = (t) => padL + t * plotW;
  const yAt = (v) => padT + (1 - v) * plotH;

  const alphaCurve = useMemo(() => {
    const NPTS = 200;
    let d = "";
    for (let i = 0; i <= NPTS; i++) {
      const t = i / NPTS;
      d += `${i === 0 ? "M" : "L"} ${xAt(t).toFixed(2)} ${yAt(alpha(t)).toFixed(2)} `;
    }
    return d;
  }, [alpha]);

  const aggD = useMemo(
    () => (showDiscrete ? aggregateTrajectories(T, alpha, alphaDot, "discrete", direction, N, seed) : null),
    [T, alpha, alphaDot, direction, N, seed, showDiscrete]
  );
  const aggC = useMemo(
    () => (showContinuous ? aggregateTrajectories(T, alpha, alphaDot, "continuous", direction, N, seed + 104729) : null),
    [T, alpha, alphaDot, direction, N, seed, showContinuous]
  );

  return (
    <svg width={W} height={H} style={{ overflow: "visible" }}>
      {[0, 0.25, 0.5, 0.75, 1].map((g) => (
        <g key={`hg${g}`}>
          <line x1={padL} y1={yAt(g)} x2={padL + plotW} y2={yAt(g)}
            stroke="rgba(255,255,255,0.06)" strokeDasharray="2 3" />
          <text x={padL - 6} y={yAt(g) + 3} textAnchor="end" fontSize={9}
            fill="rgba(255,255,255,0.4)" fontFamily="'DM Mono', monospace">{g.toFixed(2)}</text>
        </g>
      ))}
      {[0, 0.25, 0.5, 0.75, 1].map((g) => (
        <text key={`vt${g}`} x={xAt(g)} y={padT + plotH + 14} textAnchor="middle" fontSize={9}
          fill="rgba(255,255,255,0.4)" fontFamily="'DM Mono', monospace">{g.toFixed(2)}</text>
      ))}
      <line x1={padL} y1={padT} x2={padL} y2={padT + plotH} stroke="rgba(255,255,255,0.18)" />
      <line x1={padL} y1={padT + plotH} x2={padL + plotW} y2={padT + plotH} stroke="rgba(255,255,255,0.18)" />

      <text x={padL + plotW / 2} y={H - 6} textAnchor="middle" fontSize={11}
        fill="rgba(255,255,255,0.55)" fontFamily="'DM Mono', monospace">t</text>
      <text x={padL - 38} y={padT + plotH / 2} fontSize={11}
        fill="rgba(255,255,255,0.55)" fontFamily="'DM Mono', monospace"
        textAnchor="middle" dominantBaseline="central"
        transform={`rotate(-90 ${padL - 38} ${padT + plotH / 2})`}>
        fraction unmasked
      </text>

      {aggD && aggD.map((v, i) => (
        <circle key={`dd${i}`} cx={xAt(i / T)} cy={yAt(v)} r={4.2}
          fill={COLOR_DISCRETE} opacity={0.95} />
      ))}
      {aggC && aggC.map((v, i) => (
        <circle key={`cc${i}`} cx={xAt(i / T)} cy={yAt(v)} r={4.2}
          fill={COLOR_CONTINUOUS} opacity={0.95} />
      ))}

      <path d={alphaCurve} fill="none" stroke={COLOR_ALPHA} strokeWidth={2.2} />

      <g transform={`translate(${padL + plotW - 130}, ${padT + 8})`}>
        <line x1={0} y1={6} x2={18} y2={6} stroke={COLOR_ALPHA} strokeWidth={2} />
        <text x={22} y={9} fontSize={10} fill="rgba(255,255,255,0.7)"
          fontFamily="'DM Mono', monospace">αₜ</text>
        {showDiscrete && (
          <g>
            <circle cx={9} cy={20} r={3.2} fill={COLOR_DISCRETE} />
            <text x={22} y={23} fontSize={10} fill={COLOR_DISCRETE}
              fontFamily="'DM Mono', monospace">discrete</text>
          </g>
        )}
        {showContinuous && (
          <g>
            <circle cx={9} cy={showDiscrete ? 32 : 20} r={3.2} fill={COLOR_CONTINUOUS} />
            <text x={22} y={(showDiscrete ? 32 : 20) + 3} fontSize={10} fill={COLOR_CONTINUOUS}
              fontFamily="'DM Mono', monospace">continuous</text>
          </g>
        )}
      </g>
    </svg>
  );
}

// ── Main component ─────────────────────────────────────────────────
export default function MaskedDiffusionForward({
  initialShowDiscrete = true,
  initialShowContinuous = true,
  initialDirection = "forward",
}) {
  const [scheduleKey, setScheduleKey] = useState("linear");
  const [T, setT] = useState(10);
  const [seed, setSeed] = useState(0);
  const [showDiscrete, setShowDiscrete] = useState(initialShowDiscrete);
  const [showContinuous, setShowContinuous] = useState(initialShowContinuous);
  const [N, setN] = useState(10000);
  const [aggSeed, setAggSeed] = useState(0);
  const [direction, setDirection] = useState(initialDirection);
  const [showAggregate, setShowAggregate] = useState(false);

  // Ghost: the other-direction trajectory, displayed faintly behind the current run.
  // We only show it once the user has actually advanced (Next or Play) at least one
  // step in that other direction during this session.
  const [seenForward, setSeenForward] = useState(false);
  const [seenReverse, setSeenReverse] = useState(false);

  // Animation state for top figure
  const [step, setStep] = useState(0);
  const [playing, setPlaying] = useState(false);
  const [speed, setSpeed] = useState(700);
  const timerRef = useRef(null);

  const sched = SCHEDULES[scheduleKey];
  const isFinished = step >= T;
  const isForward = direction === "forward";
  const currentT = isForward ? step / T : (T - step) / T;

  const advance = useCallback(() => {
    setStep((s) => {
      if (s >= T) { setPlaying(false); return s; }
      return s + 1;
    });
  }, [T]);

  useEffect(() => {
    if (playing) {
      timerRef.current = setInterval(advance, speed);
    }
    return () => clearInterval(timerRef.current);
  }, [playing, advance, speed]);

  useEffect(() => { if (isFinished) setPlaying(false); }, [isFinished]);

  // Mark the current direction as "seen" the moment the user advances past step 0.
  useEffect(() => {
    if (step <= 0) return;
    if (isForward) setSeenForward(true);
    else setSeenReverse(true);
  }, [step, isForward]);

  // Reset step when seed, T, or schedule changes (and clear seen flags so the
  // ghost doesn't carry over a stale trajectory drawn from a different setting).
  useEffect(() => {
    setStep(0);
    setPlaying(false);
    setSeenForward(false);
    setSeenReverse(false);
  }, [seed, T, scheduleKey]);

  function changeDirection(nextDir) {
    if (nextDir === direction) return;
    setDirection(nextDir);
    setStep(0);
    setPlaying(false);
  }

  // Compute the ghost on the fly from the seen flags. It shows the *other*
  // direction's deterministic trajectory only once the user has stepped at least
  // once through that direction.
  const ghost = useMemo(() => {
    const otherDir = isForward ? "reverse" : "forward";
    const otherSeen = isForward ? seenReverse : seenForward;
    if (!otherSeen) return null;
    const gD = singleTrajectory(T, sched.alpha, sched.alphaDot, "discrete", otherDir, seed);
    const gC = singleTrajectory(T, sched.alpha, sched.alphaDot, "continuous", otherDir, seed + 7919);
    return { direction: otherDir, discrete: gD, continuous: gC };
  }, [isForward, seenForward, seenReverse, T, sched, seed]);

  const applyT = (val) => {
    const n = Math.max(2, Math.min(200, Number(val) || T));
    if (n !== T) setT(n);
  };
  const applySeed = (val) => {
    const n = parseInt(val, 10);
    if (!isNaN(n) && n !== seed) setSeed(n | 0);
  };
  const applyN = (val) => {
    const n = Math.max(10, Math.min(200000, Number(val) || N));
    if (n !== N) setN(n);
  };
  const applyAggSeed = (val) => {
    const n = parseInt(val, 10);
    if (!isNaN(n) && n !== aggSeed) setAggSeed(n | 0);
  };

  function newSample() {
    const s = (Date.now() ^ 0x5678) | 0;
    setSeed(s);
  }
  function reset() {
    setStep(0);
    setPlaying(false);
    setSeenForward(false);
    setSeenReverse(false);
  }
  function changeAggregateView(nextShowAggregate) {
    setShowAggregate(nextShowAggregate);
    if (nextShowAggregate) setPlaying(false);
  }

  const btnBase = {
    padding: "6px 12px",
    borderRadius: 8,
    border: "1px solid rgba(255,255,255,0.12)",
    background: "rgba(255,255,255,0.04)",
    color: "#fff",
    cursor: "pointer",
    fontFamily: "'DM Mono', monospace",
    fontSize: 12,
  };

  return (
    <div
      style={{
        background: "radial-gradient(ellipse at 35% 15%, #0f1729, #080d18 55%, #050810)",
        color: "white",
        fontFamily: "'Outfit', sans-serif",
        display: "flex",
        flexDirection: "column",
        alignItems: "center",
        padding: "32px 16px 36px",
        gap: 16,
        borderRadius: 16,
        minWidth: 540,
      }}
    >
      <link
        href="https://fonts.googleapis.com/css2?family=Outfit:wght@300;400;500;600;700&family=DM+Mono:wght@400;500&display=swap"
        rel="stylesheet"
      />

      <h2
        style={{
          fontSize: 20, fontWeight: 700, margin: 0, letterSpacing: "-0.02em",
          background: "linear-gradient(135deg, #82b4ff, #a78bfa, #DD8452)",
          WebkitBackgroundClip: "text", WebkitTextFillColor: "transparent",
        }}
      >
        {isForward ? "Masked Diffusion: Forward Process" : "Masked Diffusion: Reverse Process (cond. on x₀)"}
      </h2>
      <div style={{
        fontSize: 11, color: "rgba(255,255,255,0.4)",
        fontFamily: "'DM Mono', monospace", margin: 0, textAlign: "center", maxWidth: 560,
        lineHeight: 1.5,
      }}>
        {isForward ? (
          <>
            {showDiscrete && (
              <div>discrete view: β<sub>i</sub> = 1 − α<sub>i/T</sub> / α<sub>(i−1)/T</sub></div>
            )}
            {showContinuous && (
              <div>continuous view: Euler step on rate −α̇<sub>t</sub>/α<sub>t</sub></div>
            )}
          </>
        ) : (
          <>
            {showDiscrete && (
              <div>discrete view: β<sub>i</sub><sup>rev</sup> = (α<sub>(i−1)/T</sub> − α<sub>i/T</sub>) / (1 − α<sub>i/T</sub>)</div>
            )}
            {showContinuous && (
              <div>continuous view: Euler step on rate −α̇<sub>t</sub>/(1 − α<sub>t</sub>)</div>
            )}
          </>
        )}
      </div>

      <div style={{ display: "flex", gap: 12, alignItems: "center", flexWrap: "wrap", justifyContent: "center" }}>
        <div style={{ display: "flex", borderRadius: 6, overflow: "hidden", border: "1px solid rgba(255,255,255,0.12)" }}>
          {[
            { value: "forward", label: "▶ forward" },
            { value: "reverse", label: "◀ reverse" },
          ].map((opt) => (
            <button
              key={opt.value}
              onClick={() => changeDirection(opt.value)}
              style={{
                padding: "4px 12px",
                fontSize: 11,
                fontFamily: "'DM Mono', monospace",
                fontWeight: direction === opt.value ? 600 : 400,
                background: direction === opt.value
                  ? "rgba(167,139,250,0.20)"
                  : "rgba(255,255,255,0.03)",
                color: direction === opt.value ? "#a78bfa" : "rgba(255,255,255,0.55)",
                border: "none",
                cursor: "pointer",
                transition: "all 0.2s ease",
              }}
            >
              {opt.label}
            </button>
          ))}
        </div>
        <ToggleButton
          options={[
            { value: "linear", label: "1−t" },
            { value: "quadratic", label: "1−t²" },
            { value: "cosine", label: "cos(tπ/2)" },
          ]}
          value={scheduleKey}
          onChange={setScheduleKey}
        />
        <ToggleCheck label="discrete (βᵢ)" checked={showDiscrete}
          onChange={setShowDiscrete} color={COLOR_DISCRETE} />
        <ToggleCheck label="continuous (Euler)" checked={showContinuous}
          onChange={setShowContinuous} color={COLOR_CONTINUOUS} />
      </div>

      {!showAggregate && (
        <>
          <div style={{ display: "flex", gap: 20, alignItems: "center" }}>
            <span style={{ fontFamily: "'DM Mono', monospace", fontSize: 13, color: "#a78bfa", fontWeight: 500 }}>
              {isFinished ? "Done!" : step === 0 ? "Start" : `Step ${step}/${T}`}
            </span>
            <span style={{ fontFamily: "'DM Mono', monospace", fontSize: 13, color: "#82b4ff" }}>
              t = {currentT.toFixed(2)}
            </span>
            {ghost && (
              <span style={{
                fontFamily: "'DM Mono', monospace", fontSize: 11, color: "rgba(255,255,255,0.35)",
                fontStyle: "italic",
              }}>
                {ghost.direction} run shown in background
              </span>
            )}
          </div>

          {/* Top: single trajectory */}
          <div style={{
            display: "flex", flexDirection: "column", alignItems: "center", gap: 6,
            padding: "14px 14px 8px",
            background: "rgba(167,139,250,0.04)",
            border: "1px solid rgba(255,255,255,0.06)",
            borderRadius: 12, width: "100%", maxWidth: 600,
          }}>
            <div style={{
              display: "flex", alignItems: "center", gap: 12, flexWrap: "wrap", justifyContent: "center",
              marginBottom: 4,
            }}>
              <span style={{
                fontFamily: "'DM Mono', monospace", fontSize: 12, color: "#a78bfa", fontWeight: 500,
              }}>
                single trajectory
              </span>
              <NumberInput label="T" value={T} onApply={applyT} min={2} max={200} color="#a78bfa" width={56} />
              <NumberInput label="seed" value={seed} onApply={applySeed} color="#82b4ff" width={72} />
            </div>
            <TrajectoryFigure
              T={T} alpha={sched.alpha} alphaDot={sched.alphaDot}
              seed={seed} showDiscrete={showDiscrete} showContinuous={showContinuous}
              step={step} direction={direction} ghost={ghost}
            />

            {/* Playback controls */}
            <div style={{ display: "flex", gap: 8, marginTop: 6, alignItems: "center", flexWrap: "wrap", justifyContent: "center" }}>
              <button
                onClick={() => setStep((s) => Math.max(0, s - 1))}
                disabled={step === 0}
                style={{
                  ...btnBase,
                  color: step === 0 ? "rgba(255,255,255,0.2)" : "#fff",
                  cursor: step === 0 ? "default" : "pointer",
                }}
              >
                &larr; Prev
              </button>
              <button
                onClick={() => setPlaying((p) => !p)}
                disabled={isFinished}
                style={{
                  ...btnBase,
                  border: playing ? "1px solid rgba(221,132,82,0.4)" : "1px solid rgba(125,239,160,0.3)",
                  background: playing ? "rgba(221,132,82,0.12)" : "rgba(125,239,160,0.08)",
                  color: playing ? "#DD8452" : "#7defa0",
                  fontWeight: 600, minWidth: 72,
                }}
              >
                {playing ? "⏸ Pause" : "▶ Play"}
              </button>
              <button
                onClick={advance}
                disabled={isFinished}
                style={{
                  ...btnBase,
                  border: isFinished ? "1px solid rgba(125,239,160,0.3)" : "1px solid rgba(167,139,250,0.3)",
                  background: isFinished ? "rgba(125,239,160,0.1)" : "rgba(167,139,250,0.1)",
                  color: isFinished ? "#7defa0" : "#a78bfa",
                  fontWeight: 600,
                }}
              >
                {isFinished ? "✓ Done" : "Next →"}
              </button>
              <button onClick={reset} style={{ ...btnBase, color: "rgba(255,255,255,0.5)" }}>Reset</button>
              <button
                onClick={newSample}
                style={{
                  ...btnBase,
                  border: "1px solid rgba(130,180,255,0.3)",
                  background: "rgba(130,180,255,0.08)",
                  color: "#82b4ff", fontWeight: 600,
                }}
              >
                🎲 New seed
              </button>
            </div>

            <div style={{ display: "flex", alignItems: "center", gap: 8, marginTop: 4 }}>
              <span style={{ fontFamily: "'DM Mono', monospace", fontSize: 10, color: "rgba(255,255,255,0.35)" }}>fast</span>
              <input
                type="range"
                min={150} max={1500} step={50}
                value={speed}
                onChange={(e) => setSpeed(Number(e.target.value))}
                style={{ width: 100, accentColor: "#a78bfa" }}
              />
              <span style={{ fontFamily: "'DM Mono', monospace", fontSize: 10, color: "rgba(255,255,255,0.35)" }}>slow</span>
            </div>

            {/* Step progress dots */}
            {(() => {
              const dots = Array.from({ length: T + 1 }, (_, i) => (
                <div
                  key={i}
                  onClick={() => { setPlaying(false); setStep(i); }}
                  style={{
                    width: i === step ? 10 : 6,
                    height: i === step ? 10 : 6,
                    borderRadius: "50%",
                    background: i < step ? "#7defa0" : i === step ? "#a78bfa" : "rgba(255,255,255,0.15)",
                    cursor: "pointer",
                    transition: "all 0.2s ease",
                  }}
                />
              ));
              const perRow = 50;
              if (T + 1 <= perRow) {
                return <div style={{ display: "flex", gap: 6, alignItems: "center", marginTop: 6 }}>{dots}</div>;
              }
              const rows = [];
              for (let r = 0; r < dots.length; r += perRow) {
                rows.push(
                  <div key={r} style={{ display: "flex", gap: 4, alignItems: "center" }}>
                    {dots.slice(r, r + perRow)}
                  </div>
                );
              }
              return <div style={{ display: "flex", flexDirection: "column", gap: 4, alignItems: "center", marginTop: 6 }}>{rows}</div>;
            })()}
          </div>
        </>
      )}

      <ToggleCheck
        label="Show N trajectories: empirical αₜ"
        checked={showAggregate}
        onChange={changeAggregateView}
        color={COLOR_DISCRETE}
      />

      {/* Aggregate trajectories */}
      {showAggregate && (
        <div style={{
          display: "flex", flexDirection: "column", alignItems: "center", gap: 6,
          padding: "14px 14px 8px",
          background: "rgba(130,180,255,0.04)",
          border: "1px solid rgba(255,255,255,0.06)",
          borderRadius: 12, width: "100%", maxWidth: 600,
        }}>
          <div style={{
            display: "flex", alignItems: "center", gap: 12, flexWrap: "wrap", justifyContent: "center",
            marginBottom: 4,
          }}>
            <span style={{
              fontFamily: "'DM Mono', monospace", fontSize: 12, color: "#82b4ff", fontWeight: 500,
            }}>
              N trajectories: empirical αₜ
            </span>
            <NumberInput label="N" value={N} onApply={applyN} min={10} max={200000} color="#82b4ff" width={84} />
            <NumberInput label="seed" value={aggSeed} onApply={applyAggSeed} color="#82b4ff" width={72} />
            <button
              onClick={() => setAggSeed((Date.now() ^ 0x9e3779b9) | 0)}
              style={{
                padding: "5px 12px", borderRadius: 6,
                border: "1px solid rgba(255,255,255,0.15)",
                background: "rgba(255,255,255,0.04)", color: "rgba(255,255,255,0.7)",
                cursor: "pointer", fontFamily: "'DM Mono', monospace", fontSize: 11,
              }}
            >
              ↻ resample
            </button>
          </div>
          <AggregateFigure
            T={T} alpha={sched.alpha} alphaDot={sched.alphaDot}
            N={N} seed={aggSeed}
            showDiscrete={showDiscrete} showContinuous={showContinuous}
            direction={direction}
          />
        </div>
      )}
    </div>
  );
}
