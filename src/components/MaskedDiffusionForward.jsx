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

// state[i] is true iff the token is still unmasked at step i (t = i/T).
function simulateOne(T, alpha, alphaDot, mode, rand) {
  const state = new Array(T + 1);
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

function singleTrajectory(T, alpha, alphaDot, mode, seed) {
  return simulateOne(T, alpha, alphaDot, mode, makeRng(seed));
}

function aggregateTrajectories(T, alpha, alphaDot, mode, N, baseSeed) {
  const counts = new Array(T + 1).fill(0);
  for (let n = 0; n < N; n++) {
    const seed = (baseSeed + n * 2654435761) | 0;
    const rand = makeRng(seed);
    const traj = simulateOne(T, alpha, alphaDot, mode, rand);
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
  T, alpha, alphaDot, seed, showDiscrete, showContinuous, step,
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
    () => singleTrajectory(T, alpha, alphaDot, "discrete", seed),
    [T, alpha, alphaDot, seed]
  );
  const trajC = useMemo(
    () => singleTrajectory(T, alpha, alphaDot, "continuous", seed + 7919),
    [T, alpha, alphaDot, seed]
  );

  const yOf = (alive) => (alive ? yClean : yMask);
  const clampProb = (p) => Math.max(0, Math.min(1, p));

  function previousCleanProb(traj) {
    if (step <= 0 || traj[step]) return 1;
    const t = step / T;
    const s = (step - 1) / T;
    const aNow = alpha(t);
    return aNow < 1 - 1e-12 ? clampProb((alpha(s) - aNow) / (1 - aNow)) : 0;
  }

  // Arrow path from step (i-1) to step i. L-shape if a vertical jump happens.
  function renderArrow(traj, i, color, dashed, opacity) {
    if (i < 1 || i > T) return null;
    const x0 = xAt(i - 1);
    const x1 = xAt(i);
    const y0 = yOf(traj[i - 1]);
    const y1 = yOf(traj[i]);
    const id = `arrow-${color.replace("#", "")}-${dashed ? "d" : "s"}-${opacity > 0.5 ? "f" : "p"}`;
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

  // Right-hand bars: one-step bridge probability and the unconditional clean probability.
  const barX = padL + plotW + 20;
  const barW = 16;
  const barAreaH = 80;
  const barTop = padT + 20;
  const barGap = 8;
  const activeBarCount = Number(showDiscrete) + Number(showContinuous);
  const conditionalGroupW = activeBarCount * barW + Math.max(0, activeBarCount - 1) * barGap;
  const unconditionalBarX = barX + conditionalGroupW + (activeBarCount > 0 ? 22 : 0);
  const unconditionalCleanProb = clampProb(alpha(step / T));

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

      {/* Past arrows (transitions for k = 1..step). The latest is brighter. */}
      {showDiscrete && Array.from({ length: step }, (_, k) => (
        <g key={`ad${k}`}>
          {renderArrow(trajD, k + 1, COLOR_DISCRETE, false, k === step - 1 ? 1 : 0.35)}
        </g>
      ))}
      {showContinuous && Array.from({ length: step }, (_, k) => (
        <g key={`ac${k}`}>
          {renderArrow(trajC, k + 1, COLOR_CONTINUOUS, true, k === step - 1 ? 1 : 0.35)}
        </g>
      ))}

      {/* Visited dots only (no connecting line). Current dot highlighted. */}
      {showDiscrete && Array.from({ length: step + 1 }, (_, i) => (
        <circle key={`dD${i}`} cx={xAt(i)} cy={yOf(trajD[i])}
          r={i === step ? 5.5 : 3} fill={COLOR_DISCRETE}
          stroke={i === step ? "#fff" : "none"} strokeWidth={i === step ? 1.5 : 0}
          opacity={i === step ? 1 : 0.7} />
      ))}
      {showContinuous && Array.from({ length: step + 1 }, (_, i) => (
        <circle key={`dC${i}`} cx={xAt(i)} cy={yOf(trajC[i])}
          r={i === step ? 5.5 : 3} fill={COLOR_CONTINUOUS}
          stroke={i === step ? "#fff" : "none"} strokeWidth={i === step ? 1.5 : 0}
          opacity={i === step ? 1 : 0.7} />
      ))}

      {showDiscrete && (() => {
        const p = previousCleanProb(trajD);
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
        const p = previousCleanProb(trajC);
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
function AggregateFigure({ T, alpha, alphaDot, N, seed, showDiscrete, showContinuous }) {
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
    () => (showDiscrete ? aggregateTrajectories(T, alpha, alphaDot, "discrete", N, seed) : null),
    [T, alpha, alphaDot, N, seed, showDiscrete]
  );
  const aggC = useMemo(
    () => (showContinuous ? aggregateTrajectories(T, alpha, alphaDot, "continuous", N, seed + 104729) : null),
    [T, alpha, alphaDot, N, seed, showContinuous]
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
}) {
  const [scheduleKey, setScheduleKey] = useState("linear");
  const [T, setT] = useState(10);
  const [seed, setSeed] = useState(0);
  const [showDiscrete, setShowDiscrete] = useState(initialShowDiscrete);
  const [showContinuous, setShowContinuous] = useState(initialShowContinuous);
  const [N, setN] = useState(10000);
  const [aggSeed, setAggSeed] = useState(0);

  // Animation state for top figure
  const [step, setStep] = useState(0);
  const [playing, setPlaying] = useState(false);
  const [speed, setSpeed] = useState(700);
  const timerRef = useRef(null);

  const sched = SCHEDULES[scheduleKey];
  const isFinished = step >= T;

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

  // Reset step when seed, T, or schedule changes
  useEffect(() => {
    setStep(0);
    setPlaying(false);
  }, [seed, T, scheduleKey]);

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
        Masked Diffusion: Forward Process
      </h2>
      <div style={{
        fontSize: 11, color: "rgba(255,255,255,0.4)",
        fontFamily: "'DM Mono', monospace", margin: 0, textAlign: "center", maxWidth: 560,
        lineHeight: 1.5,
      }}>
        {showDiscrete && (
          <div>discrete view: β<sub>i</sub> = 1 − α<sub>i/T</sub> / α<sub>(i−1)/T</sub></div>
        )}
        {showContinuous && (
          <div>continuous view: Euler step on rate −α̇<sub>t</sub>/α<sub>t</sub></div>
        )}
      </div>

      <div style={{ display: "flex", gap: 12, alignItems: "center", flexWrap: "wrap", justifyContent: "center" }}>
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

      <div style={{ display: "flex", gap: 20, alignItems: "center" }}>
        <span style={{ fontFamily: "'DM Mono', monospace", fontSize: 13, color: "#a78bfa", fontWeight: 500 }}>
          {isFinished ? "Done!" : step === 0 ? "Start" : `Step ${step}/${T}`}
        </span>
        <span style={{ fontFamily: "'DM Mono', monospace", fontSize: 13, color: "#82b4ff" }}>
          t = {(step / T).toFixed(2)}
        </span>
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
          step={step}
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

      {/* Bottom: aggregate */}
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
        />
      </div>
    </div>
  );
}
