import { useState, useEffect, useMemo, useRef, useCallback } from "react";

// ── Setup: small vocabulary and short sequences ─────────────────────
const VOCAB = ["A", "B"]; // "real" tokens; the mask token m is added on top
const MASK = "m";
const S = 4; // sequence length
const N_SAMPLES = 4; // sample rows shown per distribution

// Same color convention as the dfm-live-figure: lch(30% 100 h) per token, gray mask.
function tokenColor(token) {
  if (token === MASK) return "#555";
  const index = VOCAB.indexOf(token);
  return `lch(30% 100 ${(20 + index * 360) / VOCAB.length})`;
}

// RGB approximations of the lch colors above, for the 3D cube shading math.
const TOKEN_RGB = {
  A: [142, 14, 47], // ~ lch(30% 100 10)
  B: [0, 78, 76], // ~ lch(30% 100 190)
  [MASK]: [85, 85, 85],
};
const mixWhite = (rgb, p) => rgb.map((c) => Math.round(255 * (1 - p) + c * p));
const lighten = (rgb, a) => rgb.map((c) => Math.round(c * (1 - a) + 255 * a));
const darken = (rgb, a) => rgb.map((c) => Math.round(c * (1 - a)));
const rgbStr = (rgb) => `rgb(${rgb[0]},${rgb[1]},${rgb[2]})`;

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

// Toy structured target distribution p_data: "sorted" sequences A^j B^(S-j),
// j uniform in {0,...,S} — all the A's come before the B's. Visibly structured
// next to the uniform samples, with non-uniform per-position marginals:
// P(x^s = A) = (S + 1 - s) / (S + 1).
const PDATA_A_MARGINAL = Array.from(
  { length: S },
  (_, s) => (S - s) / (S + 1),
);

function dataSequence(j) {
  return Array.from({ length: S }, (_, i) => (i < j ? "A" : "B"));
}

function sampleData(rand) {
  return dataSequence(Math.floor(rand() * (S + 1)));
}

function sampleUniform(rand) {
  return Array.from({ length: S }, () => VOCAB[Math.floor(rand() * VOCAB.length)]);
}

// Per-position marginals over {A, B, m} along the path p_t = (1-t) p_0 + t p_data.
function sourceMarginal(source) {
  return source === "mask" ? { A: 0, B: 0, [MASK]: 1 } : { A: 0.5, B: 0.5, [MASK]: 0 };
}
function dataMarginals() {
  return PDATA_A_MARGINAL.map((pa) => ({ A: pa, B: 1 - pa, [MASK]: 0 }));
}
function ptMarginals(t, source) {
  const p0 = sourceMarginal(source);
  return PDATA_A_MARGINAL.map((pa) => ({
    A: (1 - t) * p0.A + t * pa,
    B: (1 - t) * p0.B + t * (1 - pa),
    [MASK]: (1 - t) * p0[MASK],
  }));
}

const ALL_TOKENS = [...VOCAB, MASK];

// ── Token block (1D view) ───────────────────────────────────────────
function Block({ token, size = 34 }) {
  return (
    <span
      className="ddi-block"
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

function SampleRow({ tokens, size = 26 }) {
  return (
    <div className="ddi-sample-row">
      {tokens.map((tok, i) => (
        <Block key={i} token={tok} size={size} />
      ))}
    </div>
  );
}

// ── One-hot encoding cells/columns ──────────────────────────────────
function OneHotCell({ on, token, size = 24 }) {
  return (
    <span
      className={`ddi-oh-cell${on ? " on" : ""}`}
      style={{
        width: size,
        height: size,
        fontSize: size * 0.45,
        background: on ? tokenColor(token) : undefined,
      }}
    >
      {on ? 1 : 0}
    </span>
  );
}



// ── Isometric cube (3D view), ported from dfm-live-figure SVGCube.vue ──
const CUBE = 30; // front face size
const DEPTH = 15; // depth offset per sequence position

function Cube({ x = 0, y = 0, z = 0, rgb, label, opacity = 1 }) {
  const tx = x * CUBE + z * DEPTH;
  const ty = y * CUBE - z * DEPTH;
  return (
    <g transform={`translate(${tx},${ty})`} opacity={opacity}>
      <polygon
        points={`0,0 ${DEPTH},${-DEPTH} ${CUBE + DEPTH},${-DEPTH} ${CUBE},0`}
        fill={rgbStr(lighten(rgb, 0.18))}
        stroke="rgba(0,0,0,0.5)"
        strokeWidth="0.6"
      />
      <rect
        width={CUBE}
        height={CUBE}
        fill={rgbStr(rgb)}
        stroke="rgba(0,0,0,0.5)"
        strokeWidth="0.6"
      />
      <polygon
        points={`${CUBE},0 ${CUBE + DEPTH},${-DEPTH} ${CUBE + DEPTH},${CUBE - DEPTH} ${CUBE},${CUBE}`}
        fill={rgbStr(darken(rgb, 0.2))}
        stroke="rgba(0,0,0,0.5)"
        strokeWidth="0.6"
      />
      {label && (
        <text
          x={CUBE / 2}
          y={CUBE / 2}
          textAnchor="middle"
          dominantBaseline="central"
          fill="white"
          fontSize={CUBE * 0.5}
          fontFamily="'DM Mono', monospace"
          fontWeight="600"
        >
          {label}
        </text>
      )}
    </g>
  );
}

// One probability table: |V|+1 rows (A on top, then B, then m), S depth slices.
// probs[s][token] is the marginal probability of `token` at position s+1.
const ROW_ORDER = ["A", "B", MASK];

function ProbTable({ probs, x = 0, opacity = 1, highlight = false }) {
  const cubes = [];
  // painter's algorithm: draw back slices (large z) first, and within a slice
  // bottom rows first, so upper cubes' front faces cover lower cubes' top faces
  for (let z = S - 1; z >= 0; z--) {
    for (let row = ROW_ORDER.length - 1; row >= 0; row--) {
      const tok = ROW_ORDER[row];
      const p = probs[z][tok];
      cubes.push(
        <Cube
          key={`${z}-${tok}`}
          x={x}
          y={row}
          z={z}
          rgb={mixWhite(TOKEN_RGB[tok], p)}
        />,
      );
    }
  }
  return (
    <g
      opacity={opacity}
      filter={highlight ? "drop-shadow(0 0 8px rgba(167,139,250,0.7))" : undefined}
    >
      {cubes}
    </g>
  );
}

// SVG label with a subscript, e.g. p_t, p_data.
function TableLabel({ x, y, sub, highlight = false }) {
  return (
    <text
      className={`ddi-svg-label${highlight ? " ddi-svg-label-pt" : ""}`}
      x={x}
      y={y}
    >
      p
      <tspan dy="4" fontSize="10">
        {sub}
      </tspan>
    </text>
  );
}

function CubeView({ t, source }) {
  const HB = 7; // horizontal travel of the p_t table, in cube units
  const tableCenter = CUBE / 2 + (S * DEPTH) / 2; // x-center of one table
  const stackX = HB + (S * DEPTH) / CUBE + 1.4;
  const labelY = ROW_ORDER.length * CUBE + 24;
  const width = (stackX + 1) * CUBE + DEPTH + 20;
  const top = -(S * DEPTH + 48); // room for the moving p_t and x^s labels on top
  return (
    <svg
      className="ddi-cube-svg"
      viewBox={`-10 ${top} ${width} ${labelY - top + 14}`}
    >
      <ProbTable probs={ptMarginals(0, source)} x={0} opacity={0.4} />
      <ProbTable probs={dataMarginals()} x={HB} opacity={0.4} />
      <ProbTable probs={ptMarginals(t, source)} x={t * HB} highlight />
      {/* vocabulary stack, drawn bottom-up so the cubes stack cleanly */}
      <g>
        {[...ROW_ORDER]
          .map((tok, row) => ({ tok, row }))
          .reverse()
          .map(({ tok, row }) => (
            <Cube key={tok} x={stackX} y={row} rgb={TOKEN_RGB[tok]} label={tok} />
          ))}
      </g>
      {/* position labels x^1..x^S above the moving p_t table, one per depth
          slice, slanted along the depth axis so they stay legible */}
      {Array.from({ length: S }, (_, z) => (
        <text
          key={z}
          className="ddi-svg-label ddi-svg-poslabel"
          transform={`translate(${t * HB * CUBE + z * DEPTH + 8}, ${-z * DEPTH - DEPTH - 5}) rotate(-45)`}
        >
          {`x${"¹²³⁴⁵⁶⁷⁸⁹"[z]}`}
        </text>
      ))}
      {/* endpoint labels below, moving p_t label above its table */}
      <TableLabel x={tableCenter} y={labelY} sub="0" />
      <TableLabel
        x={t * HB * CUBE + tableCenter}
        y={-(S * DEPTH) - 30}
        sub="t"
        highlight
      />
      <TableLabel x={HB * CUBE + tableCenter} y={labelY} sub="data" />
      <text className="ddi-svg-label" x={stackX * CUBE + CUBE / 2 + DEPTH / 2} y={labelY}>
        𝒱
      </text>
    </svg>
  );
}

export default function DiscreteDataIntro() {
  const [seed, setSeed] = useState(26);
  const [source, setSource] = useState("mask"); // "mask" | "unif"
  // which transport views are shown (both can be active at once)
  const [showSamples, setShowSamples] = useState(false);
  const [showCube, setShowCube] = useState(true);
  const [showOneHot, setShowOneHot] = useState(false);
  const [t, setT] = useState(0);
  const [playing, setPlaying] = useState(false);

  // Example sequence for the notation panel, plus the transport setup:
  // target sequences x_1 ~ p_data, per-token unmasking thresholds, and
  // per-token source tokens (used in the uniform-source mode).
  const { exampleSequence, transport } = useMemo(() => {
    const rand = makeRng(seed);
    const exampleSequence = sampleData(rand);
    const transport = Array.from({ length: N_SAMPLES }, () => ({
      x1: sampleData(rand),
      thresholds: Array.from({ length: S }, () => 0.04 + 0.92 * rand()),
      srcTokens: sampleUniform(rand),
    }));
    return { exampleSequence, transport };
  }, [seed]);

  // Samples x_t ~ p_t: token i is revealed (equal to x_1^i) once t passes its
  // threshold; before that it equals the source token (m, or a uniform draw).
  const transportRows = useMemo(
    () =>
      transport.map(({ x1, thresholds, srcTokens }) =>
        x1.map((tok, i) =>
          t >= thresholds[i] ? tok : source === "mask" ? MASK : srcTokens[i],
        ),
      ),
    [transport, t, source],
  );

  // Play/pause animation
  const rafRef = useRef(null);
  const lastRef = useRef(null);
  useEffect(() => {
    if (!playing) return undefined;
    const step = (now) => {
      if (lastRef.current == null) lastRef.current = now;
      const delta = (now - lastRef.current) / 1000;
      lastRef.current = now;
      setT((prev) => {
        const next = Math.min(1, prev + 0.25 * delta);
        if (next >= 1) setPlaying(false);
        return next;
      });
      rafRef.current = requestAnimationFrame(step);
    };
    rafRef.current = requestAnimationFrame(step);
    return () => {
      cancelAnimationFrame(rafRef.current);
      lastRef.current = null;
    };
  }, [playing]);

  const togglePlay = useCallback(() => {
    setPlaying((p) => {
      if (!p && t >= 1) setT(0);
      return !p;
    });
  }, [t]);

  return (
    <div className="ddi-card">
      <style>{css}</style>

      {/* ── 1. Vocabulary and sequence, with aligned one-hot encodings ── */}
      <div className="ddi-section">
        <div className="ddi-notation">
          <div className="ddi-notation-item">
            <div className="ddi-section-title">
              Vocabulary &#119985; = {"{A, B, m}"}
            </div>
            <div className="ddi-oh-grid">
              <span className="ddi-oh-tokenslabel">tokens</span>
              {showOneHot && (
                <div className="ddi-oh-col">
                  <span className="ddi-pos-label">&nbsp;</span>
                  <span className="ddi-oh-spacer" />
                  <span className="ddi-oh-header">&nbsp;</span>
                  {ALL_TOKENS.map((v) => (
                    <span key={v} className="ddi-oh-rowlabel">
                      {v}
                    </span>
                  ))}
                </div>
              )}
              {ALL_TOKENS.map((tok) => (
                <div key={tok} className="ddi-oh-col">
                  <span className="ddi-pos-label">&nbsp;</span>
                  <Block token={tok} size={30} />
                  {showOneHot && (
                    <>
                      <span className="ddi-oh-header">
                        <b>e</b>
                        <sub>{tok}</sub>
                      </span>
                      {ALL_TOKENS.map((v) => (
                        <OneHotCell key={v} on={v === tok} token={tok} size={30} />
                      ))}
                    </>
                  )}
                </div>
              ))}
            </div>
            {showOneHot && (
              <div className="ddi-oh-caption">
                <b>e</b>
                <sub>A</sub>, <b>e</b>
                <sub>B</sub>, <b>e</b>
                <sub>m</sub> &isin; &#8477;&sup3;
              </div>
            )}
          </div>
          <div className="ddi-notation-item">
            <div className="ddi-section-title">
              Sequence <b>x</b> = x&sup1;x&sup2;x&sup3;x&#8308; &nbsp;(S = {S})
            </div>
            <div className="ddi-oh-grid">
              {showOneHot && (
                <div className="ddi-oh-col">
                  <span className="ddi-pos-label">&nbsp;</span>
                  <span className="ddi-oh-spacer" />
                  <span className="ddi-oh-header">&nbsp;</span>
                  {ALL_TOKENS.map((v) => (
                    <span key={v} className="ddi-oh-rowlabel">
                      {v}
                    </span>
                  ))}
                </div>
              )}
              {exampleSequence.map((tok, i) => (
                <div key={i} className="ddi-oh-col">
                  <span className="ddi-pos-label">
                    x<sup>{i + 1}</sup>
                  </span>
                  <Block token={tok} size={30} />
                  {showOneHot && (
                    <>
                      <span className="ddi-oh-header">
                        <b>e</b>
                        <sub>x{"¹²³⁴⁵⁶⁷⁸⁹"[i]}</sub>
                      </span>
                      {ALL_TOKENS.map((v) => (
                        <OneHotCell key={v} on={v === tok} token={tok} size={30} />
                      ))}
                    </>
                  )}
                </div>
              ))}
            </div>
            {showOneHot && (
              <div className="ddi-oh-caption">
                <b>e</b>
                <sub>
                  <b>x</b>
                </sub>{" "}
                = (<b>e</b>
                <sub>x&sup1;</sub> &hellip; <b>e</b>
                <sub>x&#8308;</sub>) &isin; &#8477;
                <sup>3&times;{S}</sup>
              </div>
            )}
          </div>
        </div>
        <div className="ddi-toggle-group">
          <button
            className={`ddi-toggle-btn${showOneHot ? " active" : ""}`}
            onClick={() => setShowOneHot(!showOneHot)}
          >
            One-hot encoding
          </button>
        </div>
      </div>

      {/* ── 3. Transport p_0 → p_data ── */}
      <div className="ddi-section">
        <div className="ddi-section-title">
          Transport p&#8320; to p&#8321; via intermediate distributions p<sub>t</sub>
        </div>

        <div className="ddi-toggle-group">
          <button
            className={`ddi-toggle-btn${showSamples ? " active" : ""}`}
            onClick={() => {
              // keep at least one view active
              if (showSamples && !showCube) setShowCube(true);
              setShowSamples(!showSamples);
            }}
          >
            Samples
          </button>
          <button
            className={`ddi-toggle-btn${showCube ? " active" : ""}`}
            onClick={() => {
              if (showCube && !showSamples) setShowSamples(true);
              setShowCube(!showCube);
            }}
          >
            Distributions (3D)
          </button>
        </div>

        {showCube && (
          <div className="ddi-cube-wrap">
            <CubeView t={t} source={source} />
          </div>
        )}

        {showSamples && (
          <div className="ddi-transport">
            <div className="ddi-endpoint">
              <div className="ddi-endpoint-label">
                p&#8320; = p<sub>{source === "mask" ? "mask" : "unif"}</sub>
              </div>
              {transport.map(({ srcTokens }, r) => (
                <SampleRow
                  key={r}
                  tokens={source === "mask" ? Array(S).fill(MASK) : srcTokens}
                />
              ))}
            </div>
            <div className="ddi-arrow">
              <div className="ddi-arrow-label">
                p<sub>t</sub>
              </div>
              <div className="ddi-pt">
                {transportRows.map((row, r) => (
                  <SampleRow key={r} tokens={row} />
                ))}
              </div>
            </div>
            <div className="ddi-endpoint">
              <div className="ddi-endpoint-label">
                p&#8321; = p<sub>data</sub>
              </div>
              {transport.map(({ x1 }, r) => (
                <SampleRow key={r} tokens={x1} />
              ))}
            </div>
          </div>
        )}

        <div className="ddi-controls">
          <div className="ddi-toggle-group">
            <button
              className={`ddi-toggle-btn${source === "mask" ? " active" : ""}`}
              onClick={() => setSource("mask")}
            >
              Masked
            </button>
            <button
              className={`ddi-toggle-btn${source === "unif" ? " active" : ""}`}
              onClick={() => setSource("unif")}
            >
              Uniform
            </button>
          </div>
          <label className="ddi-slider-label">
            <span>t = {t.toFixed(2)}</span>
            <input
              type="range"
              min="0"
              max="1"
              step="0.001"
              value={t}
              className="ddi-slider"
              onChange={(e) => {
                setPlaying(false);
                setT(parseFloat(e.target.value));
              }}
            />
          </label>
          <button
            className={`ddi-btn ddi-play-btn${playing ? " playing" : ""}`}
            onClick={togglePlay}
          >
            {playing ? "⏸ Pause" : "▶ Play"}
          </button>
          <button
            className="ddi-btn ddi-reset-btn"
            onClick={() => {
              setPlaying(false);
              setT(0);
              setSeed((s) => s + 1);
            }}
          >
            Resample
          </button>
        </div>
      </div>
    </div>
  );
}

const css = `
.ddi-card {
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
.ddi-section {
  display: flex;
  flex-direction: column;
  align-items: center;
  gap: 10px;
  width: 100%;
}
.ddi-section-title {
  font-size: 15px;
  font-weight: 700;
  letter-spacing: -0.01em;
  background: linear-gradient(135deg, #82b4ff, #a78bfa, #7defa0);
  -webkit-background-clip: text;
  -webkit-text-fill-color: transparent;
  background-clip: text;
  text-align: center;
}
.ddi-block {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  border-radius: 6px;
  color: white;
  font-family: 'DM Mono', monospace;
  font-weight: 600;
  box-shadow: inset 0 1px 0 rgba(255,255,255,0.18), 0 2px 5px rgba(0,0,0,0.35);
}
.ddi-notation {
  display: flex;
  flex-direction: row;
  justify-content: center;
  align-items: flex-start;
  gap: 48px;
  flex-wrap: wrap;
}
.ddi-notation-item {
  display: flex;
  flex-direction: column;
  align-items: center;
  gap: 10px;
}
.ddi-pos-label {
  font-family: 'DM Mono', monospace;
  font-size: 12px;
  color: rgba(255,255,255,0.55);
  height: 16px;
  line-height: 16px;
}
.ddi-pos-label sup {
  line-height: 0;
}
.ddi-vocab-note {
  font-family: 'DM Mono', monospace;
  font-size: 12px;
  color: rgba(255,255,255,0.5);
}
.ddi-endpoint-label, .ddi-arrow-label {
  font-family: 'DM Mono', monospace;
  font-size: 14px;
  color: rgba(255,255,255,0.85);
  margin-bottom: 4px;
}
.ddi-oh-caption {
  font-family: 'DM Mono', monospace;
  font-size: 15px;
  color: rgba(255,255,255,0.7);
}
.ddi-oh-caption sup,
.ddi-oh-caption sub {
  font-size: 11px;
}
.ddi-oh-grid {
  position: relative;
  display: flex;
  gap: 4px;
  align-items: flex-start;
}
.ddi-oh-col {
  display: flex;
  flex-direction: column;
  align-items: center;
  gap: 4px;
}
.ddi-oh-spacer {
  height: 30px;
}
.ddi-oh-tokenslabel {
  position: absolute;
  right: calc(100% + 10px);
  top: 20px;
  height: 30px;
  display: inline-flex;
  align-items: center;
  font-family: 'DM Mono', monospace;
  font-size: 12px;
  color: rgba(255,255,255,0.55);
}
.ddi-oh-header {
  height: 18px;
  line-height: 18px;
  margin-top: 6px;
  text-align: center;
  font-family: 'DM Mono', monospace;
  font-size: 12px;
  color: rgba(255,255,255,0.75);
}
.ddi-oh-header sub {
  font-size: 9px;
  line-height: 0;
}
.ddi-oh-rowlabel {
  width: 16px;
  height: 30px;
  display: inline-flex;
  align-items: center;
  justify-content: center;
  font-family: 'DM Mono', monospace;
  font-size: 12px;
  color: rgba(255,255,255,0.55);
}
.ddi-oh-cell {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  box-sizing: border-box;
  border-radius: 5px;
  border: 1px solid rgba(255,255,255,0.12);
  background: rgba(255,255,255,0.04);
  color: rgba(255,255,255,0.35);
  font-family: 'DM Mono', monospace;
  font-weight: 600;
}
.ddi-oh-cell.on {
  border-color: rgba(0,0,0,0.4);
  color: white;
  box-shadow: inset 0 1px 0 rgba(255,255,255,0.18), 0 2px 5px rgba(0,0,0,0.35);
}
.ddi-sample-row {
  display: flex;
  gap: 3px;
}
.ddi-transport {
  display: flex;
  justify-content: center;
  align-items: flex-start;
  gap: 28px;
  flex-wrap: wrap;
}
.ddi-endpoint {
  display: flex;
  flex-direction: column;
  align-items: center;
  gap: 4px;
  opacity: 0.55;
}
.ddi-arrow {
  display: flex;
  flex-direction: column;
  align-items: center;
  gap: 4px;
}
.ddi-pt {
  display: flex;
  flex-direction: column;
  gap: 4px;
  filter: drop-shadow(0 0 8px rgba(167,139,250,0.55));
}
.ddi-cube-wrap {
  display: flex;
  flex-direction: column;
  align-items: center;
  gap: 4px;
  width: 100%;
}
.ddi-cube-svg {
  width: 100%;
  max-width: 560px;
  height: auto;
  display: block;
}
.ddi-svg-label {
  font-family: 'DM Mono', monospace;
  font-size: 14px;
  fill: rgba(255,255,255,0.7);
  text-anchor: middle;
}
.ddi-svg-label-pt {
  fill: #a78bfa;
  font-weight: 600;
}
.ddi-svg-poslabel {
  font-size: 13px;
  fill: rgba(255,255,255,0.85);
  text-anchor: start;
}
.ddi-controls {
  display: flex;
  gap: 16px;
  align-items: center;
  justify-content: center;
  flex-wrap: wrap;
  margin-top: 6px;
}
.ddi-toggle-group {
  display: inline-flex;
  border-radius: 8px;
  overflow: hidden;
  border: 1px solid rgba(255,255,255,0.12);
}
.ddi-toggle-btn {
  padding: 6px 14px;
  border: none;
  background: rgba(255,255,255,0.04);
  color: rgba(255,255,255,0.4);
  font-family: 'DM Mono', monospace;
  font-size: 13px;
  cursor: pointer;
  transition: background 0.2s, color 0.2s;
}
.ddi-toggle-btn:first-child {
  border-right: 1px solid rgba(255,255,255,0.08);
}
.ddi-toggle-btn.active {
  background: rgba(167,139,250,0.18);
  color: #a78bfa;
  font-weight: 600;
}
.ddi-slider-label {
  font-family: 'DM Mono', monospace;
  font-size: 13px;
  color: rgba(255,255,255,0.6);
  display: flex;
  align-items: center;
  gap: 8px;
}
.ddi-slider {
  -webkit-appearance: none;
  appearance: none;
  width: 140px;
  height: 4px;
  background: rgba(255,255,255,0.12);
  border-radius: 2px;
  outline: none;
}
.ddi-slider::-webkit-slider-thumb {
  -webkit-appearance: none;
  appearance: none;
  width: 14px;
  height: 14px;
  border-radius: 50%;
  background: #a78bfa;
  cursor: pointer;
}
.ddi-slider::-moz-range-thumb {
  width: 14px;
  height: 14px;
  border-radius: 50%;
  background: #a78bfa;
  cursor: pointer;
  border: none;
}
.ddi-btn {
  padding: 6px 16px;
  border-radius: 8px;
  border: 1px solid rgba(255,255,255,0.12);
  background: rgba(255,255,255,0.04);
  color: #fff;
  cursor: pointer;
  font-family: 'DM Mono', monospace;
  font-size: 13px;
  transition: background 0.2s, border-color 0.2s;
}
.ddi-play-btn {
  border-color: rgba(125,239,160,0.3);
  background: rgba(125,239,160,0.08);
  color: #7defa0;
  font-weight: 600;
  min-width: 90px;
}
.ddi-play-btn.playing {
  border-color: rgba(221,132,82,0.4);
  background: rgba(221,132,82,0.12);
  color: #dd8452;
}
.ddi-reset-btn {
  color: rgba(255,255,255,0.45);
}
.ddi-reset-btn:hover {
  background: rgba(255,255,255,0.08);
}
`;
