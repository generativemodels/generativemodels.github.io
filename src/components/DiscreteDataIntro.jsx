import { useState, useEffect, useMemo, useRef, useCallback } from "react";
import { Mi, Mb, Mc, svgMath, cal } from "./mathType.jsx";

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
// next to the uniform samples.
function dataSequence(j) {
  return Array.from({ length: S }, (_, i) => (i < j ? "A" : "B"));
}

function sampleData(rand) {
  return dataSequence(Math.floor(rand() * (S + 1)));
}

function sampleUniform(rand) {
  return Array.from({ length: S }, () => VOCAB[Math.floor(rand() * VOCAB.length)]);
}

const ALL_TOKENS = [...VOCAB, MASK];

// ── The state space S = V^S, ordered for plotting ───────────────────
// Sequences are laid out left to right by increasing number of mask tokens,
// so the fully masked sequence m…m (the source Dirac) sits at the far right
// and the clean sequences occupy the left of the axis.
const STATES = (() => {
  const out = [];
  const build = (prefix) => {
    if (prefix.length === S) return void out.push(prefix);
    for (const v of ALL_TOKENS) build([...prefix, v]);
  };
  build([]);
  const rank = (x) => x.map((v) => ALL_TOKENS.indexOf(v)).join("");
  return out
    .map((x) => ({ x, masks: x.filter((v) => v === MASK).length, rank: rank(x) }))
    .sort((a, b) => a.masks - b.masks || a.rank.localeCompare(b.rank))
    .map((o) => o.x);
})();

const DATA_SEQS = Array.from({ length: S + 1 }, (_, j) => dataSequence(j));

// p_t over the whole state space, exact for the conditional path
//   q_t(x^i | x_0, x_1) = t·1(x^i = x_1^i) + (1-t)·1(x^i = x_0^i),
// marginalized over x_1 ~ p_data and x_0 ~ p_0 (both factorize per position).
function stateProbs(t, source) {
  const w = 1 / DATA_SEQS.length;
  const off = source === "mask" ? 0 : (1 - t) / VOCAB.length;
  return STATES.map((x) => {
    let p = 0;
    for (const x1 of DATA_SEQS) {
      let q = 1;
      for (let i = 0; i < S; i++) {
        const isMask = x[i] === MASK;
        // weight of token x[i] at position i under q_t(· | x_0, x_1)
        const f = (x[i] === x1[i] ? t : 0) +
          (source === "mask" ? (isMask ? 1 - t : 0) : (isMask ? 0 : off));
        if (f === 0) {
          q = 0;
          break;
        }
        q *= f;
      }
      p += w * q;
    }
    return p;
  });
}

// ── Token block (1D view) ───────────────────────────────────────────
function Block({ token, size = 34 }) {
  return (
    <span
      className="ddi-block"
      style={{
        width: size,
        height: size,
        fontSize: size * 0.575,
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
        fontSize: size * 0.52,
        background: on ? tokenColor(token) : undefined,
      }}
    >
      {on ? 1 : 0}
    </span>
  );
}



// ── Distribution over the state space S = V^S ───────────────────────
// Each sequence gets one bar; bar heights use a square-root scale so that the
// source Dirac (mass 1) and the spread-out p_t (mass ~1/50 per state) are
// legible on the same axis. The vertical axis is deliberately unlabelled: only
// the shape and the ordering of the masses carry meaning here.
const PANEL_W = 176;
const PANEL_H = 92;
const PANEL_GAP = 36;
const ARC_H = 54; // band above the panels reserved for the p_0 -> p_1 arrow
const VIEW_W = 3 * PANEL_W + 2 * PANEL_GAP;
const BASE_Y = ARC_H + PANEL_H;
const panelX = (i) => i * (PANEL_W + PANEL_GAP);

// SVG label with a subscript, e.g. p_t. The variable p is italic (math);
// number subscripts stay upright, the single-letter t stays italic.
function TableLabel({ x, y, sub, highlight = false, italicSub = false }) {
  return (
    <text
      className={`ddi-svg-label${highlight ? " ddi-svg-label-pt" : ""}`}
      x={x}
      y={y}
    >
      <tspan {...svgMath}>p</tspan>
      <tspan dy="4" fontSize="11.5" {...(italicSub ? svgMath : { fontStyle: "normal" })}>
        {sub}
      </tspan>
    </text>
  );
}

function DistPanel({ i, probs, color, dim = false }) {
  const x0 = panelX(i);
  const slot = PANEL_W / STATES.length;
  const barW = Math.max(1.6, slot * 0.72);
  return (
    <g opacity={dim ? 0.55 : 1}>
      {probs.map((p, k) => {
        if (p <= 1e-9) return null;
        const h = Math.sqrt(p) * PANEL_H;
        return (
          <rect
            key={k}
            x={x0 + k * slot + (slot - barW) / 2}
            y={BASE_Y - h}
            width={barW}
            height={h}
            fill={color}
            rx={0.8}
          />
        );
      })}
      {/* x-axis, arrow-tipped like the continuous-case sketch */}
      <line
        x1={x0}
        y1={BASE_Y}
        x2={x0 + PANEL_W + 8}
        y2={BASE_Y}
        stroke="rgba(255,255,255,0.3)"
        strokeWidth="1"
      />
      <path
        d={`M${x0 + PANEL_W + 8},${BASE_Y} l-5,-2.6 l0,5.2 z`}
        fill="rgba(255,255,255,0.3)"
      />
    </g>
  );
}

function DistView({ t, source }) {
  const p0 = stateProbs(0, source);
  const pt = stateProbs(t, source);
  const p1 = stateProbs(1, source);
  const labelY = BASE_Y + 30;
  // the arrow arcs through the band above the panels, so it clears p_t whatever
  // the value of t
  const ax0 = panelX(0) + PANEL_W / 2;
  const ax1 = panelX(2) + PANEL_W / 2;
  return (
    <svg className="ddi-dist-svg" viewBox={`-6 -6 ${VIEW_W + 24} ${labelY + 16}`}>
      <path
        d={`M${ax0},${ARC_H - 12} Q${(ax0 + ax1) / 2},${-4} ${ax1 - 6},${ARC_H - 14}`}
        fill="none"
        stroke="rgba(255,255,255,0.4)"
        strokeWidth="1.3"
      />
      <path
        d={`M${ax1 - 6},${ARC_H - 14} l-6.4,-4.4 l1.8,7.6 z`}
        fill="rgba(255,255,255,0.4)"
      />
      <DistPanel i={0} probs={p0} color="#82b4ff" dim />
      <DistPanel i={1} probs={pt} color="#a78bfa" />
      <DistPanel i={2} probs={p1} color="#7defa0" dim />
      <TableLabel x={panelX(0) + PANEL_W / 2} y={labelY} sub="0" />
      <TableLabel x={panelX(1) + PANEL_W / 2} y={labelY} sub="t" highlight italicSub />
      <TableLabel x={panelX(2) + PANEL_W / 2} y={labelY} sub="1" />
    </svg>
  );
}

// `row` lays the two sections (notations | transport) side by side instead of
// stacked — used in the slides where horizontal space is the one available.
// `notation` / `transport` toggle each section independently, so the figure can
// be split into two standalone figures (notations panel vs. transport panel).
export default function DiscreteDataIntro({ onehot = false, row = false, notation = true, transport: showTransport = true, onehotToggle = true }) {
  const [seed, setSeed] = useState(26);
  const [source, setSource] = useState("mask"); // "mask" | "unif"
  const [showOneHot, setShowOneHot] = useState(!!onehot);
  const [t, setT] = useState(0.5);
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
    <div className={`ddi-card${row ? " ddi-card--row" : ""}`}>
      <style>{css}</style>
      <div className={`ddi-body${row ? " ddi-body--row" : ""}`}>

      {/* ── 1. Vocabulary and sequence, with aligned one-hot encodings ── */}
      {notation && (
      <div className="ddi-section">
        <div className="ddi-notation">
          <div className="ddi-notation-item">
            <div className="ddi-section-title">
              <span className="ddi-nowrap">
                Sequence <Mb>x</Mb> ={" "}
                <Mi>
                  x<sup>1</sup>x<sup>2</sup>x<sup>3</sup>x<sup>4</sup>
                </Mi>
              </span>{" "}
              <span className="ddi-nowrap">of length {S}</span>
            </div>
            <div className="ddi-oh-grid">
              {showOneHot && (
                <div className="ddi-oh-col">
                  <span className="ddi-pos-label">&nbsp;</span>
                  <span className="ddi-oh-spacer" />
                  <span className="ddi-oh-header">&nbsp;</span>
                  {ALL_TOKENS.map((v) => (
                    <span key={v} className="ddi-oh-rowlabel">
                      <Mi>{v}</Mi>
                    </span>
                  ))}
                </div>
              )}
              {exampleSequence.map((tok, i) => (
                <div key={i} className="ddi-oh-col">
                  <span className="ddi-pos-label">
                    <Mi>
                      x<sup>{i + 1}</sup>
                    </Mi>
                  </span>
                  <Block token={tok} size={30} />
                  {showOneHot && (
                    <>
                      <span className="ddi-oh-header">
                        <Mb>e</Mb>
                        <sub><Mi>x<sup>{i + 1}</sup></Mi></sub>
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
                <Mb>e</Mb>
                <sub>
                  <Mb>x</Mb>
                </sub>{" "}
                = (<Mb>e</Mb>
                <sub><Mi>x<sup>1</sup></Mi></sub> &hellip; <Mb>e</Mb>
                <sub><Mi>x<sup>4</sup></Mi></sub>) &isin; &#8477;
                <sup>3&times;{S}</sup>
              </div>
            )}
          </div>
          <div className="ddi-notation-item">
            <div className="ddi-section-title">
              <span className="ddi-nowrap">
                Vocabulary of {ALL_TOKENS.length} elements
              </span>{" "}
              <span className="ddi-nowrap">
                <Mc>{cal.V}</Mc> = {"{"}
                <Mi>A</Mi>, <Mi>B</Mi>, <Mi>m</Mi>
                {"}"}
              </span>
            </div>
            <div className="ddi-oh-grid">
              {showOneHot && (
                <div className="ddi-oh-col">
                  <span className="ddi-pos-label">&nbsp;</span>
                  <span className="ddi-oh-spacer" />
                  <span className="ddi-oh-header">&nbsp;</span>
                  {ALL_TOKENS.map((v) => (
                    <span key={v} className="ddi-oh-rowlabel">
                      <Mi>{v}</Mi>
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
                        <Mb>e</Mb>
                        <sub><Mi>{tok}</Mi></sub>
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
                <Mb>e</Mb>
                <sub><Mi>A</Mi></sub>, <Mb>e</Mb>
                <sub><Mi>B</Mi></sub>, <Mb>e</Mb>
                <sub><Mi>m</Mi></sub> &isin; &#8477;&sup3;
              </div>
            )}
          </div>
        </div>
        {onehotToggle && (
        <div className="ddi-toggle-group">
          <button
            className={`ddi-toggle-btn${showOneHot ? " active" : ""}`}
            onClick={() => setShowOneHot(!showOneHot)}
          >
            One-hot encoding
          </button>
        </div>
        )}
      </div>
      )}

      {/* ── 3. Transport p_0 → p_data ── */}
      {showTransport && (
      <div className="ddi-section">
        {/* distributions over the state space; the three panels line up with
            the three sample columns below */}
        <div className="ddi-dist-wrap">
          <DistView t={t} source={source} />
        </div>
        <div className="ddi-transport">
          <div className="ddi-endpoint">
            <div className="ddi-endpoint-label">
              <Mb>x</Mb>
              <sub>0</sub> &sim; <Mi>p</Mi>
              <sub>0</sub>
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
              <Mb>x</Mb>
              <sub>
                <Mi>t</Mi>
              </sub>{" "}
              &sim; <Mi>p</Mi>
              <sub>
                <Mi>t</Mi>
              </sub>
            </div>
            <div className="ddi-pt">
              {transportRows.map((row, r) => (
                <SampleRow key={r} tokens={row} />
              ))}
            </div>
          </div>
          <div className="ddi-endpoint">
            <div className="ddi-endpoint-label">
              <Mb>x</Mb>
              <sub>1</sub> &sim; <Mi>p</Mi>
              <sub>1</sub>
            </div>
            {transport.map(({ x1 }, r) => (
              <SampleRow key={r} tokens={x1} />
            ))}
          </div>
        </div>

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
            <span><Mi>t</Mi> = {t.toFixed(2)}</span>
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
      )}
      </div>
    </div>
  );
}

const css = `
.ddi-card {
  background: radial-gradient(ellipse at 35% 15%, #0f1729, #080d18 55%, #050810);
  color: white;
  font-family: 'KaTeX_Main', 'STIX Two Math', serif;
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
.ddi-body {
  display: flex;
  flex-direction: column;
  align-items: center;
  gap: 22px;
  width: 100%;
}
.ddi-card--row {
  max-width: 1200px;
}
.ddi-body--row {
  flex-direction: row;
  align-items: flex-start;
  justify-content: center;
  gap: 36px;
}
.ddi-body--row .ddi-section {
  width: auto;
  flex: 0 1 auto;
}
.ddi-body--row .ddi-dist-svg {
  max-width: 480px;
}
.ddi-section-title {
  font-size: 17.2px;
  font-weight: 700;
  letter-spacing: -0.01em;
  background: linear-gradient(135deg, #82b4ff, #a78bfa, #7defa0);
  -webkit-background-clip: text;
  -webkit-text-fill-color: transparent;
  background-clip: text;
  text-align: center;
}
.ddi-section-title sup,
.ddi-oh-header sup {
  font-size: 0.68em;
  vertical-align: super;
  line-height: 0;
}
.ddi-block {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  border-radius: 6px;
  color: white;
  font-family: 'KaTeX_Math', 'STIX Two Math', serif;
  font-style: italic;
  font-weight: 600;
  box-shadow: inset 0 1px 0 rgba(255,255,255,0.18), 0 2px 5px rgba(0,0,0,0.35);
}
.ddi-notation {
  display: flex;
  flex-direction: row;
  justify-content: center;
  align-items: flex-start;
  gap: 28px;
  flex-wrap: wrap;
  width: 100%;
}
/* the two panels share the row evenly; their titles wrap rather than pushing
   the vocabulary panel onto a second line */
.ddi-notation-item {
  display: flex;
  flex-direction: column;
  align-items: center;
  gap: 10px;
  flex: 1 1 240px;
  min-width: 0;
}
/* reserve two lines so both panels' token rows stay on the same baseline */
.ddi-notation-item .ddi-section-title {
  line-height: 1.3;
  min-height: 2.6em;
}
.ddi-nowrap {
  white-space: nowrap;
}
.ddi-pos-label {
  font-family: 'KaTeX_Main', 'STIX Two Math', serif;
  font-size: 13.8px;
  color: rgba(255,255,255,0.55);
  height: 16px;
  line-height: 16px;
}
.ddi-pos-label sup {
  line-height: 0;
}
.ddi-vocab-note {
  font-family: 'KaTeX_Main', 'STIX Two Math', serif;
  font-size: 13.8px;
  color: rgba(255,255,255,0.5);
}
.ddi-endpoint-label, .ddi-arrow-label {
  font-family: 'KaTeX_Main', 'STIX Two Math', serif;
  font-size: 16.1px;
  color: rgba(255,255,255,0.85);
  margin-bottom: 4px;
}
.ddi-oh-caption {
  font-family: 'KaTeX_Main', 'STIX Two Math', serif;
  font-size: 17.2px;
  color: rgba(255,255,255,0.7);
}
.ddi-oh-caption sup,
.ddi-oh-caption sub {
  font-size: 12.6px;
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
.ddi-oh-header {
  height: 18px;
  line-height: 18px;
  margin-top: 6px;
  text-align: center;
  font-family: 'KaTeX_Main', 'STIX Two Math', serif;
  font-size: 13.8px;
  color: rgba(255,255,255,0.75);
}
.ddi-oh-header sub {
  font-size: 10.3px;
  line-height: 0;
}
.ddi-oh-rowlabel {
  width: 16px;
  height: 30px;
  display: inline-flex;
  align-items: center;
  justify-content: center;
  font-family: 'KaTeX_Main', 'STIX Two Math', serif;
  font-size: 13.8px;
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
  font-family: 'KaTeX_Main', 'STIX Two Math', serif;
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
/* the three sample columns mirror the three SVG panels: same relative widths
   and gap, so each stack sits under its distribution */
.ddi-transport {
  display: flex;
  justify-content: center;
  align-items: flex-start;
  gap: 6.06%;
  width: 100%;
  max-width: 600px;
}
.ddi-endpoint, .ddi-arrow {
  display: flex;
  flex-direction: column;
  align-items: center;
  gap: 4px;
  flex: 1 1 0;
  min-width: 0;
}
.ddi-endpoint {
  opacity: 0.55;
}
.ddi-pt {
  display: flex;
  flex-direction: column;
  gap: 4px;
  filter: drop-shadow(0 0 8px rgba(167,139,250,0.55));
}
.ddi-dist-wrap {
  display: flex;
  flex-direction: column;
  align-items: center;
  gap: 4px;
  width: 100%;
  max-width: 600px;
}
.ddi-dist-svg {
  width: 100%;
  height: auto;
  display: block;
}
.ddi-svg-label {
  font-family: 'KaTeX_Main', 'STIX Two Math', serif;
  font-size: 16.1px;
  fill: rgba(255,255,255,0.7);
  text-anchor: middle;
}
.ddi-svg-label-pt {
  fill: #a78bfa;
  font-weight: 600;
}
.ddi-svg-poslabel {
  font-family: 'KaTeX_Math', 'STIX Two Math', serif;
  font-style: italic;
  font-size: 14.9px;
  fill: rgba(255,255,255,0.85);
  text-anchor: start;
}
.ddi-controls {
  display: flex;
  gap: 12px;
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
  font-family: 'KaTeX_Main', 'STIX Two Math', serif;
  font-size: 14.9px;
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
  font-family: 'KaTeX_Main', 'STIX Two Math', serif;
  font-size: 14.9px;
  color: rgba(255,255,255,0.6);
  display: flex;
  align-items: center;
  gap: 8px;
}
.ddi-slider {
  -webkit-appearance: none;
  appearance: none;
  width: 118px;
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
  font-family: 'KaTeX_Main', 'STIX Two Math', serif;
  font-size: 14.9px;
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
