import { useState } from "react";

// Static figure: the Euler step analogy between continuous and discrete flow
// matching. Global view: one Euler step of size h on a sample (an image / a
// sequence). Local view: the same step seen on states (a point of R^d moves
// along h u_t / the one-hot e_{x_t} in R^|S| becomes a probability vector
// from which the next state is sampled).
//
// Color convention used throughout: purple = current state, green = next
// state / the velocity, orange = the stochastic sampling.

// ── Toy vocabulary, same color convention as the other dfm figures ───
const VOCAB = ["A", "B"];
const MASK = "m";

function tokenColor(token) {
  if (token === MASK) return "#555";
  const index = VOCAB.indexOf(token);
  return `lch(30% 100 ${(20 + index * 360) / VOCAB.length})`;
}

// ── Seeded RNG (mulberry32) ─────────────────────────────────────────
function makeRng(seed) {
  let s = seed | 0;
  return function () {
    s = (s + 0x6d2b79f5) | 0;
    let t = Math.imul(s ^ (s >>> 15), 1 | s);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

const clamp01 = (v) => Math.min(1, Math.max(0, v));

// ── SVG math labels: segments with optional bold and subscript level ──
// seg = { t: text, b: bold, lvl: baseline offset in px (0 main, ~3 sub,
// ~5 sub-sub), fs: font size }
function MText({ x, y, segs, anchor = "middle", className = "esa-svg-label", fill }) {
  let cur = 0;
  return (
    <text className={className} x={x} y={y} textAnchor={anchor} fill={fill}>
      {segs.map((s, i) => {
        const lvl = s.lvl ?? 0;
        const dy = lvl - cur;
        cur = lvl;
        return (
          <tspan key={i} dy={dy || undefined} fontSize={s.fs} fontWeight={s.b ? 700 : undefined}>
            {s.t}
          </tspan>
        );
      })}
    </text>
  );
}

// x_t, x_{t+h}, e_{x_t}, e_{x_{t+h}}, u_t(x_t) as label segments
const SEG_XT = [{ t: "x", b: 1 }, { t: "t", lvl: 3, fs: 8 }];
const SEG_XTH = [{ t: "x", b: 1 }, { t: "t+h", lvl: 3, fs: 8 }];
const SEG_E_XT = [
  { t: "e", b: 1 },
  { t: "x", b: 1, lvl: 3, fs: 8.5 },
  { t: "t", lvl: 5, fs: 7 },
];
const SEG_E_XTH = [
  { t: "e", b: 1 },
  { t: "x", b: 1, lvl: 3, fs: 8.5 },
  { t: "t+h", lvl: 5, fs: 7 },
];
const SEG_U_XT = [
  { t: "u" },
  { t: "t", lvl: 3, fs: 8 },
  { t: "(", lvl: 0 },
  { t: "x", b: 1 },
  { t: "t", lvl: 3, fs: 8 },
  { t: ")", lvl: 0 },
];

// ── Continuous, global view: pixel images x(t) and x(t+h) ───────────
// Clean image: a pixel-art smiley. Both images share the same noise
// realization, with a smaller amplitude at t+h: one Euler step moved x(t)
// towards the clean image.
const IMG_N = 11;
const PIX = 10;

const rng = makeRng(11);
const NOISE = Array.from({ length: IMG_N }, () =>
  Array.from({ length: IMG_N }, () => rng() * 2 - 1),
);
const CLEAN = Array.from({ length: IMG_N }, (_, i) =>
  Array.from({ length: IMG_N }, (_, j) => {
    const r = Math.hypot(i - 5, j - 5);
    const eyes = i === 3 && (j === 3 || j === 7);
    const mouth = (i === 7 && j >= 4 && j <= 6) || (i === 6 && (j === 3 || j === 7));
    if (eyes || mouth) return 0.05;
    return r <= 4.5 ? 0.85 : 0.08;
  }),
);

function imageValues(sigma) {
  return CLEAN.map((row, i) => row.map((c, j) => clamp01(c + sigma * NOISE[i][j])));
}

const PIX_LOW = [15, 21, 38];
const PIX_HIGH = [164, 199, 255];
function pixelShade(v) {
  const c = PIX_LOW.map((lo, i) => Math.round(lo + (PIX_HIGH[i] - lo) * v));
  return `rgb(${c[0]},${c[1]},${c[2]})`;
}

function PixelImage({ values }) {
  return (
    <svg className="esa-img" viewBox={`0 0 ${IMG_N * PIX} ${IMG_N * PIX}`}>
      {values.map((row, i) =>
        row.map((v, j) => (
          <rect
            key={`${i}-${j}`}
            x={j * PIX}
            y={i * PIX}
            width={PIX + 0.4}
            height={PIX + 0.4}
            fill={pixelShade(v)}
          />
        )),
      )}
    </svg>
  );
}

// ── Discrete, global view: sequences x_t and x_{t+h} ────────────────
const SEQ_T = ["A", MASK, "B", MASK];
const SEQ_TH = ["A", MASK, "B", "B"]; // one mask revealed (position 4)
const REVEALED = 3;

function Block({ token, size = 32, glow = false }) {
  return (
    <span
      className={`esa-block${glow ? " esa-block-glow" : ""}`}
      style={{
        width: size,
        height: size,
        fontSize: size * 0.5,
        background: tokenColor(token),
      }}
    >
      {token}
    </span>
  );
}

// ── Shared arrow between two items of a global row ──────────────────
function StepArrow({ id, formula, nature, natureClass }) {
  return (
    <div className="esa-arrow">
      <span className="esa-arrow-formula">{formula}</span>
      <svg className="esa-arrow-svg" viewBox="0 0 90 10">
        <defs>
          <marker id={id} markerWidth="7" markerHeight="7" refX="5" refY="3.5" orient="auto">
            <path d="M 0 0 L 7 3.5 L 0 7 z" fill="rgba(255,255,255,0.75)" />
          </marker>
        </defs>
        <line
          x1="2"
          y1="5"
          x2="82"
          y2="5"
          stroke="rgba(255,255,255,0.75)"
          strokeWidth="1.4"
          markerEnd={`url(#${id})`}
        />
      </svg>
      <span className={`esa-arrow-nature ${natureClass}`}>{nature}</span>
    </div>
  );
}

// ── Continuous, local view: a point moves along h u_t(x(t)) ─────────
const P0 = [25, 168];
const P1 = [105, 162];
const P2 = [135, 52];
const P3 = [278, 30];

function bez(u) {
  const a = (1 - u) ** 3;
  const b = 3 * u * (1 - u) ** 2;
  const c = 3 * u * u * (1 - u);
  const d = u ** 3;
  return [
    a * P0[0] + b * P1[0] + c * P2[0] + d * P3[0],
    a * P0[1] + b * P1[1] + c * P2[1] + d * P3[1],
  ];
}

function bezTangent(u) {
  const a = 3 * (1 - u) ** 2;
  const b = 6 * u * (1 - u);
  const c = 3 * u * u;
  const dx = a * (P1[0] - P0[0]) + b * (P2[0] - P1[0]) + c * (P3[0] - P2[0]);
  const dy = a * (P1[1] - P0[1]) + b * (P2[1] - P1[1]) + c * (P3[1] - P2[1]);
  const n = Math.hypot(dx, dy);
  return [dx / n, dy / n];
}

function ContinuousLocal() {
  const pt = bez(0.4);
  const dir = bezTangent(0.4);
  const L = 55; // Euler step length: the tip lies slightly off the true trajectory
  const tip = [pt[0] + L * dir[0], pt[1] + L * dir[1]];
  const mid = [pt[0] + 0.5 * L * dir[0], pt[1] + 0.5 * L * dir[1]];
  return (
    <svg className="esa-local-svg" viewBox="0 0 300 195">
      <defs>
        <marker id="esa-m-loc" markerWidth="7" markerHeight="7" refX="5" refY="3.5" orient="auto">
          <path d="M 0 0 L 7 3.5 L 0 7 z" fill="#7defa0" />
        </marker>
      </defs>
      {/* true ODE trajectory */}
      <path
        d={`M ${P0[0]} ${P0[1]} C ${P1[0]} ${P1[1]}, ${P2[0]} ${P2[1]}, ${P3[0]} ${P3[1]}`}
        fill="none"
        stroke="rgba(255,255,255,0.25)"
        strokeWidth="1.5"
        strokeDasharray="4 4"
      />
      <circle cx={P0[0]} cy={P0[1]} r="2.5" fill="rgba(255,255,255,0.35)" />
      <circle cx={P3[0]} cy={P3[1]} r="2.5" fill="rgba(255,255,255,0.35)" />
      <text className="esa-svg-faint" x={P0[0] + 8} y={P0[1] + 4}>
        x(0)
      </text>
      <text className="esa-svg-faint" x={P3[0] - 8} y={P3[1] + 4} textAnchor="end">
        x(1)
      </text>
      {/* one Euler step along the tangent */}
      <line
        x1={pt[0]}
        y1={pt[1]}
        x2={tip[0]}
        y2={tip[1]}
        stroke="#7defa0"
        strokeWidth="2"
        markerEnd="url(#esa-m-loc)"
      />
      <circle cx={pt[0]} cy={pt[1]} r="4" fill="#a78bfa" />
      <circle cx={tip[0]} cy={tip[1]} r="4" fill="#7defa0" />
      <text className="esa-svg-label" x={pt[0] - 2} y={pt[1] + 18} textAnchor="middle" fill="#a78bfa">
        x(t)
      </text>
      <MText
        x={mid[0] - 10}
        y={mid[1] - 12}
        anchor="end"
        fill="#7defa0"
        segs={[{ t: "h u" }, { t: "t", lvl: 3, fs: 8 }, { t: "(x(t))", lvl: 0 }]}
      />
      <text className="esa-svg-label" x={tip[0] + 8} y={tip[1] - 6} fill="#7defa0">
        x(t+h)
      </text>
    </svg>
  );
}

// ── Discrete, local view: vectors of R^|S|, with S = V^4 (81 states) ──
// Visible entries y_1..y_6, an ellipsis, then y_80, y_81. The current state
// is x_t = AmBm = y_3, the sampled next state is x_{t+h} = AmBB = y_6; the
// other states gaining mass differ from AmBm by one revealed token.
const STATES = [
  { name: "AAAA", idx: "1", oneT: 0, p: 0, oneTH: 0 },
  { name: "AAAB", idx: "2", oneT: 0, p: 0, oneTH: 0 },
  { name: "AmBm", idx: "3", oneT: 1, p: 0.91, oneTH: 0, cur: true },
  { name: "AmBA", idx: "4", oneT: 0, p: 0.05, oneTH: 0 },
  { name: "ABBm", idx: "5", oneT: 0, p: 0.01, oneTH: 0 },
  { name: "AmBB", idx: "6", oneT: 0, p: 0.03, oneTH: 1, next: true },
  null, // ellipsis row
  { name: "mmmB", idx: "80", oneT: 0, p: 0, oneTH: 0 },
  { name: "mmmm", idx: "81", oneT: 0, p: 0, oneTH: 0 },
];
const VIS = STATES.length;
const K = 2; // visual row of the current state x_t
const J = 5; // visual row of the sampled next state x_{t+h}

const CW = 30;
const CH = 20;
const STEP = 23;
const TOP = 36;
const COLH = VIS * STEP - (STEP - CH);
const rowCenter = (i) => TOP + i * STEP + CH / 2;

const COL1_X = 100;
const COL2_X = 265;
const COL3_X = 405;

const PURPLE = "167,139,250";
const GREEN = "125,239,160";

function VecCell({ x, y, v, accent }) {
  const on = v > 0;
  return (
    <g>
      <rect
        x={x}
        y={y}
        width={CW}
        height={CH}
        rx="4"
        fill={on ? `rgba(${accent},${(0.18 + 0.74 * v).toFixed(2)})` : "rgba(255,255,255,0.04)"}
        stroke={on ? "rgba(0,0,0,0.4)" : "rgba(255,255,255,0.12)"}
      />
      <text
        className="esa-svg-cell"
        x={x + CW / 2}
        y={y + CH / 2 + 0.5}
        fontSize={v > 0 && v < 1 ? 8 : 9.5}
        fill={on ? "white" : "rgba(255,255,255,0.3)"}
      >
        {v > 0 && v < 1 ? v.toFixed(2) : v}
      </text>
    </g>
  );
}

function VecColumn({ x, field, accent, header, caption }) {
  return (
    <g>
      <path
        d={`M ${x - 4} ${TOP} h -5 v ${COLH} h 5`}
        fill="none"
        stroke="rgba(255,255,255,0.4)"
        strokeWidth="1.2"
      />
      <path
        d={`M ${x + CW + 4} ${TOP} h 5 v ${COLH} h -5`}
        fill="none"
        stroke="rgba(255,255,255,0.4)"
        strokeWidth="1.2"
      />
      <MText x={x + CW / 2} y={TOP - 13} segs={header} className="esa-svg-faint" />
      {STATES.map((st, i) =>
        st === null ? (
          <text
            key={i}
            className="esa-svg-faint"
            x={x + CW / 2}
            y={rowCenter(i) + 4}
            textAnchor="middle"
            fontSize="13"
          >
            ⋮
          </text>
        ) : (
          <VecCell key={i} x={x} y={TOP + i * STEP} v={st[field]} accent={accent} />
        ),
      )}
      <MText x={x + CW / 2} y={TOP + COLH + 19} segs={caption} className="esa-svg-caption" />
    </g>
  );
}

// Fan of arrows from the current state y_3 to the states gaining probability
// mass: the rate towards y_3 itself is 1 + h u_t(x_t)_{y_3}, the rate towards
// any other state y is h u_t(x_t)_y.
function FanArrows() {
  const sx = COL1_X + CW + 12;
  const sy = rowCenter(K);
  const tx = COL2_X - 13;
  const targets = STATES.map((st, i) => (st && st.p > 0 ? i : -1)).filter((i) => i >= 0);
  const last = targets[targets.length - 1];
  const angle = (Math.atan2(rowCenter(last) - sy, tx - sx) * 180) / Math.PI;
  const lx = (sx + tx) / 2 - 0.531 * 18;
  const ly = (sy + rowCenter(last)) / 2 + 0.847 * 18;
  return (
    <g>
      <defs>
        <marker id="esa-m-fan" markerWidth="6" markerHeight="6" refX="4.5" refY="3" orient="auto">
          <path d="M 0 0 L 6 3 L 0 6 z" fill="#7defa0" />
        </marker>
      </defs>
      {targets.map((r) => (
        <line
          key={r}
          x1={sx}
          y1={sy}
          x2={tx}
          y2={rowCenter(r)}
          stroke="#7defa0"
          strokeWidth="1.4"
          opacity={r === K ? 1 : 0.8}
          markerEnd="url(#esa-m-fan)"
        />
      ))}
      <MText
        x={(sx + tx) / 2}
        y={sy - 13}
        fill="#7defa0"
        className="esa-svg-small"
        segs={[
          { t: "1 + h " },
          ...SEG_U_XT,
          { t: "y", b: 1, lvl: 3.5, fs: 8 },
          { t: "3", lvl: 5.5, fs: 6.5 },
        ]}
      />
      <g transform={`translate(${lx.toFixed(1)}, ${ly.toFixed(1)}) rotate(${angle.toFixed(1)})`}>
        <MText
          x={0}
          y={0}
          fill="#7defa0"
          className="esa-svg-small"
          segs={[
            { t: "h " },
            ...SEG_U_XT,
            { t: "y", b: 1, lvl: 3.5, fs: 8 },
            { t: STATES[last].idx, lvl: 5.5, fs: 6.5 },
          ]}
        />
      </g>
    </g>
  );
}

function SampleArrow() {
  const x1 = COL2_X + CW + 14;
  const x2 = COL3_X - 14;
  const y = TOP + COLH / 2;
  return (
    <g>
      <defs>
        <marker id="esa-m-sample" markerWidth="7" markerHeight="7" refX="5" refY="3.5" orient="auto">
          <path d="M 0 0 L 7 3.5 L 0 7 z" fill="#dd8452" />
        </marker>
      </defs>
      <text className="esa-svg-label" x={(x1 + x2) / 2} y={y - 12} textAnchor="middle" fill="#dd8452">
        sample ∼ Cat
      </text>
      <line x1={x1} y1={y} x2={x2 - 5} y2={y} stroke="#dd8452" strokeWidth="1.6" markerEnd="url(#esa-m-sample)" />
    </g>
  );
}

function DiscreteLocal() {
  return (
    <svg className="esa-local-svg esa-local-svg-disc" viewBox="0 0 458 272">
      {/* state labels: sequence = y_i; current and sampled states are colored */}
      {STATES.map((st, i) =>
        st === null ? (
          <text
            key={i}
            className="esa-svg-faint"
            x={68}
            y={rowCenter(i) + 4}
            textAnchor="end"
            fontSize="13"
          >
            ⋮
          </text>
        ) : (
          <MText
            key={i}
            x={78}
            y={rowCenter(i) + 3}
            anchor="end"
            className="esa-svg-faint"
            fill={st.cur ? "#a78bfa" : st.next ? "#7defa0" : undefined}
            segs={[{ t: `${st.name} = ` }, { t: "y", b: 1 }, { t: st.idx, lvl: 3, fs: 8 }]}
          />
        ),
      )}
      <VecColumn
        x={COL1_X}
        field="oneT"
        accent={PURPLE}
        header={[{ t: "current " }, ...SEG_XT]}
        caption={SEG_E_XT}
      />
      <FanArrows />
      <VecColumn
        x={COL2_X}
        field="p"
        accent={PURPLE}
        header={[{ t: "probabilities of next state" }]}
        caption={[...SEG_E_XT, { t: " + h ", lvl: 0 }, ...SEG_U_XT]}
      />
      <SampleArrow />
      <VecColumn
        x={COL3_X}
        field="oneTH"
        accent={GREEN}
        header={[{ t: "next " }, ...SEG_XTH]}
        caption={SEG_E_XTH}
      />
    </svg>
  );
}

// ── Figure ──────────────────────────────────────────────────────────
export default function EulerStepAnalogy({ local = false }) {
  const [showGlobal, setShowGlobal] = useState(true);
  const [showLocal, setShowLocal] = useState(!!local);

  return (
    <div className="esa-card">
      <style>{css}</style>

      <div className="esa-toggle-group">
        <button
          className={`esa-toggle-btn${showGlobal ? " active" : ""}`}
          onClick={() => {
            if (showGlobal && !showLocal) setShowLocal(true);
            setShowGlobal(!showGlobal);
          }}
        >
          Global view
        </button>
        <button
          className={`esa-toggle-btn${showLocal ? " active" : ""}`}
          onClick={() => {
            if (showLocal && !showGlobal) setShowGlobal(true);
            setShowLocal(!showLocal);
          }}
        >
          Local view
        </button>
      </div>

      {showGlobal && (
        <div className="esa-section">
          <div className="esa-panel">
            <div className="esa-panel-label">
              Continuous — an image x(t) &isin; <span className="esa-bb">R</span>
              <sup>d</sup>
            </div>
            <div className="esa-flow">
              <div className="esa-item">
                <PixelImage values={imageValues(0.5)} />
                <span className="esa-itemlabel esa-cur">x(t)</span>
              </div>
              <StepArrow
                id="esa-m-cont"
                formula={
                  <>
                    x(t+h) = x(t) + h u<sub>t</sub>(x(t))
                  </>
                }
                nature="deterministic"
                natureClass="esa-det"
              />
              <div className="esa-item">
                <PixelImage values={imageValues(0.25)} />
                <span className="esa-itemlabel esa-next">x(t+h)</span>
              </div>
            </div>
          </div>

          <div className="esa-panel">
            <div className="esa-panel-label">
              Discrete — a sequence <b>x</b>
              <sub>t</sub> &isin; <span className="esa-cal">S</span> (here{" "}
              <span className="esa-cal">V</span> = {"{A, B, m}"}, S = 4)
            </div>
            <div className="esa-flow">
              <div className="esa-item">
                <div className="esa-seq">
                  {SEQ_T.map((tok, i) => (
                    <Block key={i} token={tok} />
                  ))}
                </div>
                <span className="esa-itemlabel esa-cur">
                  <b>x</b>
                  <sub>t</sub>
                </span>
              </div>
              <StepArrow
                id="esa-m-disc"
                formula={
                  <>
                    <b>x</b>
                    <sub>t+h</sub> ∼ Cat(<b>e</b>
                    <sub>
                      <b>x</b>
                      <sub>t</sub>
                    </sub>{" "}
                    + h u<sub>t</sub>(<b>x</b>
                    <sub>t</sub>))
                  </>
                }
                nature="stochastic"
                natureClass="esa-sto"
              />
              <div className="esa-item">
                <div className="esa-seq">
                  {SEQ_TH.map((tok, i) => (
                    <Block key={i} token={tok} glow={i === REVEALED} />
                  ))}
                </div>
                <span className="esa-itemlabel esa-next">
                  <b>x</b>
                  <sub>t+h</sub>
                </span>
              </div>
            </div>
          </div>
        </div>
      )}

      {showLocal && (
        <div className="esa-section">
          <div className="esa-row">
            <div className="esa-panel">
              <div className="esa-panel-label">
                Continuous — a point of <span className="esa-bb">R</span>
                <sup>d</sup>
              </div>
              <ContinuousLocal />
            </div>
            <div className="esa-panel">
              <div className="esa-panel-label">
                Discrete — vectors of <span className="esa-bb">R</span>
                <sup>
                  |<span className="esa-cal">S</span>|
                </sup>{" "}
                (here |<span className="esa-cal">S</span>| = 3<sup>4</sup> = 81)
              </div>
              <DiscreteLocal />
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

const css = `
.esa-card {
  background: radial-gradient(ellipse at 35% 15%, #0f1729, #080d18 55%, #050810);
  color: white;
  font-family: 'Outfit', sans-serif;
  display: flex;
  flex-direction: column;
  align-items: center;
  padding: 18px 20px 22px;
  gap: 22px;
  border-radius: 16px;
  max-width: 760px;
  margin: 0 auto;
}
.esa-section {
  display: flex;
  flex-direction: column;
  align-items: center;
  gap: 18px;
  width: 100%;
}
.esa-toggle-group {
  display: inline-flex;
  border-radius: 8px;
  overflow: hidden;
  border: 1px solid rgba(255,255,255,0.12);
}
.esa-toggle-btn {
  padding: 6px 14px;
  border: none;
  background: rgba(255,255,255,0.04);
  color: rgba(255,255,255,0.4);
  font-family: 'DM Mono', monospace;
  font-size: 13px;
  cursor: pointer;
  transition: background 0.2s, color 0.2s;
}
.esa-toggle-btn:first-child {
  border-right: 1px solid rgba(255,255,255,0.08);
}
.esa-toggle-btn.active {
  background: rgba(167,139,250,0.18);
  color: #a78bfa;
  font-weight: 600;
}
.esa-row {
  display: flex;
  justify-content: center;
  align-items: flex-start;
  gap: 30px;
  flex-wrap: wrap;
  width: 100%;
}
.esa-panel {
  display: flex;
  flex-direction: column;
  align-items: center;
  gap: 8px;
}
.esa-panel-label {
  font-family: 'DM Mono', monospace;
  font-size: 13px;
  color: rgba(255,255,255,0.85);
}
.esa-panel-label sup {
  font-size: 9px;
}
.esa-panel-label sub {
  font-size: 9px;
}
.esa-cal {
  font-family: 'KaTeX_Caligraphic', 'STIX Two Math', serif;
}
.esa-bb {
  font-family: 'KaTeX_AMS', 'STIX Two Math', serif;
}
.esa-flow {
  display: flex;
  align-items: center;
  justify-content: center;
  gap: 14px;
  flex-wrap: wrap;
}
.esa-item {
  display: flex;
  flex-direction: column;
  align-items: center;
  gap: 6px;
}
.esa-itemlabel {
  font-family: 'DM Mono', monospace;
  font-size: 13px;
  color: rgba(255,255,255,0.7);
}
.esa-itemlabel sub {
  font-size: 9px;
}
.esa-cur { color: #a78bfa; }
.esa-next { color: #7defa0; }
.esa-img {
  width: 104px;
  height: auto;
  display: block;
  border-radius: 8px;
  box-shadow: 0 0 0 1px rgba(255,255,255,0.15), 0 2px 6px rgba(0,0,0,0.4);
}
.esa-seq {
  display: flex;
  gap: 3px;
}
.esa-block {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  border-radius: 6px;
  color: white;
  font-family: 'DM Mono', monospace;
  font-weight: 600;
  box-shadow: inset 0 1px 0 rgba(255,255,255,0.18), 0 2px 5px rgba(0,0,0,0.35);
}
.esa-block-glow {
  outline: 2px solid rgba(125,239,160,0.9);
  outline-offset: 1px;
}
.esa-arrow {
  display: flex;
  flex-direction: column;
  align-items: center;
  gap: 2px;
  padding: 0 4px;
}
.esa-arrow-formula {
  font-family: 'DM Mono', monospace;
  font-size: 12px;
  color: rgba(255,255,255,0.85);
  white-space: nowrap;
}
.esa-arrow-formula sub {
  font-size: 8.5px;
}
.esa-arrow-formula sub sub {
  font-size: 7px;
}
.esa-arrow-svg {
  width: 90px;
  height: 10px;
}
.esa-arrow-nature {
  font-family: 'DM Mono', monospace;
  font-size: 11px;
}
.esa-det { color: #7defa0; }
.esa-sto { color: #dd8452; }
.esa-local-svg {
  width: 100%;
  max-width: 310px;
  height: auto;
  display: block;
}
.esa-local-svg-disc {
  max-width: 410px;
}
.esa-local-svg text {
  font-family: 'DM Mono', monospace;
}
.esa-svg-label {
  font-size: 12px;
  fill: rgba(255,255,255,0.85);
}
.esa-svg-small {
  font-size: 9.5px;
  fill: rgba(255,255,255,0.85);
}
.esa-svg-faint {
  font-size: 10px;
  fill: rgba(255,255,255,0.55);
}
.esa-svg-cell {
  font-weight: 600;
  text-anchor: middle;
  dominant-baseline: central;
}
.esa-svg-caption {
  font-size: 11.5px;
  fill: rgba(255,255,255,0.8);
}
`;
