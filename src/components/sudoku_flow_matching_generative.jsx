import { useState, useEffect, useMemo, useRef, useCallback } from "react";
import { Mi, MATH_ITALIC } from "./mathType.jsx";

// ── Seeded PRNG (mulberry32) ──────────────────────────────────────────
function makePrng(seed) {
  let s = seed >>> 0;
  return () => {
    s = (s + 0x6D2B79F5) >>> 0;
    let t = Math.imul(s ^ (s >>> 15), 1 | s);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

// ── Generate a complete valid Sudoku via seeded backtracking ──────────
function generateSolvedGrid(seed) {
  const rng = makePrng(seed);
  const grid = Array.from({ length: 9 }, () => Array(9).fill(0));

  function isValid(r, c, num) {
    for (let i = 0; i < 9; i++) {
      if (grid[r][i] === num) return false;
      if (grid[i][c] === num) return false;
    }
    const br = Math.floor(r / 3) * 3, bc = Math.floor(c / 3) * 3;
    for (let dr = 0; dr < 3; dr++)
      for (let dc = 0; dc < 3; dc++)
        if (grid[br + dr][bc + dc] === num) return false;
    return true;
  }

  function shuffle(arr) {
    for (let i = arr.length - 1; i > 0; i--) {
      const j = Math.floor(rng() * (i + 1));
      [arr[i], arr[j]] = [arr[j], arr[i]];
    }
    return arr;
  }

  function fill(pos = 0) {
    if (pos === 81) return true;
    const r = Math.floor(pos / 9), c = pos % 9;
    for (const n of shuffle([1, 2, 3, 4, 5, 6, 7, 8, 9])) {
      if (isValid(r, c, n)) {
        grid[r][c] = n;
        if (fill(pos + 1)) return true;
        grid[r][c] = 0;
      }
    }
    return false;
  }

  fill(0);
  return grid;
}

// ── Reveal thresholds ─────────────────────────────────────────────────
// Diffusion unmasks the 81 cells in a random order, autoregressive fills them
// left to right, top to bottom: the same 81 steps, only the order differs.
function buildThresholds(seed, order) {
  const positions = [];
  for (let r = 0; r < 9; r++)
    for (let c = 0; c < 9; c++)
      positions.push({ r, c });
  if (order === "diffusion") {
    const rng = makePrng(seed ^ 0xdeadbeef);
    positions.forEach((p) => { p.key = rng(); });
    positions.sort((a, b) => a.key - b.key);
  }
  const thresholds = new Map();
  positions.forEach(({ r, c }, i) => {
    thresholds.set(`${r}-${c}`, (i + 1) / 81);
  });
  return thresholds;
}

function getGrid(t, solvedBoard, thresholds) {
  return solvedBoard.map((row, r) =>
    row.map((val, c) => {
      const thresh = thresholds.get(`${r}-${c}`);
      if (t >= thresh) return { value: val, state: "revealed" };
      return { value: "m", state: "masked" };
    })
  );
}

const CELL = 42;

// Cell/gap geometry, scaled from the cell size so the side-by-side gif mode
// can shrink both grids and keep the 3x3 boxes readable.
function geometry(cell) {
  const gap = Math.max(1, Math.round((cell * 2) / 42));
  const boxGap = Math.max(3, Math.round((cell * 5) / 42));
  return { cell, gap, boxGap, size: cell * 9 + gap * 6 + boxGap * 2 };
}

function SudokuGrid({ grid, cell = CELL }) {
  const { gap, boxGap, size } = geometry(cell);
  const block = cell * 3 + gap * 2 + boxGap;
  const pos = (r, c) => ({
    x: Math.floor(c / 3) * block + (c % 3) * (cell + gap),
    y: Math.floor(r / 3) * block + (r % 3) * (cell + gap),
  });

  return (
    <div style={{
      position: "relative", width: size, height: size,
      borderRadius: 12, overflow: "hidden",
      boxShadow: "0 0 0 1px rgba(167,139,250,0.1), 0 18px 52px rgba(0,0,0,0.34)",
    }}>
      <svg width={size} height={size} style={{ position: "absolute", top: 0, left: 0 }}>
        {[0, 1, 2].map(br => [0, 1, 2].map(bc => (
          <rect key={`${br}-${bc}`} x={bc * block} y={br * block}
            width={cell * 3 + gap * 2} height={cell * 3 + gap * 2}
            rx={7} fill="none" stroke="rgba(167,139,250,0.07)" strokeWidth={1.5} />
        )))}
      </svg>

      {grid.map((row, r) => row.map((c_, c) => {
        const { x, y } = pos(r, c);
        const isMasked = c_.state === "masked";
        return (
          <div key={`${r}-${c}`} style={{
            position: "absolute", left: x, top: y, width: cell, height: cell,
            borderRadius: Math.max(3, cell / 8),
            background: isMasked ? "rgba(0,0,0,0.6)" : "rgba(125,239,160,0.1)",
            display: "flex", alignItems: "center", justifyContent: "center",
            fontFamily: isMasked ? MATH_ITALIC : "'KaTeX_Main', 'STIX Two Math', serif",
            fontStyle: isMasked ? "italic" : "normal",
            fontSize: (isMasked ? 16 : 18) * (cell / CELL),
            fontWeight: 500,
            color: isMasked ? "rgba(130,180,255,0.55)" : "#7defa0",
            transition: "all 0.5s cubic-bezier(0.22, 1, 0.36, 1)",
            boxShadow: isMasked ? "none" : `inset 0 0 16px rgba(125,239,160,0.08)`,
          }}>
            {isMasked ? "m" : c_.value}
          </div>
        );
      }))}
    </div>
  );
}

function Stats({ grid, compact = false }) {
  const masked = grid.flat().filter(c => c.state === "masked").length;
  const revealed = 81 - masked;
  return (
    <div style={{ display: "flex", gap: compact ? 16 : 26, justifyContent: "center" }}>
      {[
        { label: "Masked", value: masked, color: "#82b4ff" },
        { label: "Generated", value: revealed, color: "#7defa0" },
        ...(compact ? [] : [{ label: "Total", value: 81, color: "rgba(255,255,255,0.4)" }]),
      ].map(s => (
        <div key={s.label} style={{ display: "flex", flexDirection: "column", alignItems: "center", gap: 1 }}>
          <span style={{ fontFamily: "'KaTeX_Main', 'STIX Two Math', serif", fontSize: compact ? 16.5 : 20.7, fontWeight: 600, color: s.color }}>{s.value}</span>
          <span style={{ fontFamily: "'KaTeX_Main', 'STIX Two Math', serif", fontSize: 10.3, color: "rgba(255,255,255,0.3)", textTransform: "uppercase", letterSpacing: "0.1em" }}>{s.label}</span>
        </div>
      ))}
    </div>
  );
}

// gif mode: one full sweep t: 0 -> 1, then a pause on the finished grid, loop.
const GIF_SWEEP_MS = 9000;
const GIF_HOLD_MS = 1800;

export default function App() {
  const [inputSeed, setInputSeed] = useState("42");
  const [solvedBoard, setSolvedBoard] = useState(() => generateSolvedGrid(42));
  const [seed, setSeed] = useState(42);
  const [mode, setMode] = useState("diffusion"); // "diffusion" | "ar"
  const [gif, setGif] = useState(true);
  const [t, setT] = useState(0);
  const [playing, setPlaying] = useState(false);
  const tRef = useRef(t);
  const animRef = useRef(null);

  const thresholds = useMemo(() => ({
    diffusion: buildThresholds(seed, "diffusion"),
    ar: buildThresholds(seed, "ar"),
  }), [seed]);

  useEffect(() => { tRef.current = t; }, [t]);

  // Manual play/pause (single-grid mode)
  useEffect(() => {
    if (gif || !playing) { if (animRef.current) cancelAnimationFrame(animRef.current); return; }
    let last = performance.now();
    const tick = (now) => {
      const next = tRef.current + (now - last) / 1000 * 0.11;
      last = now;
      if (next >= 1) { setT(1); setPlaying(false); return; }
      setT(next);
      animRef.current = requestAnimationFrame(tick);
    };
    animRef.current = requestAnimationFrame(tick);
    return () => { if (animRef.current) cancelAnimationFrame(animRef.current); };
  }, [playing, gif]);

  // gif mode: looping sweep, no controls
  useEffect(() => {
    if (!gif) return undefined;
    setPlaying(false);
    let raf = null;
    let start = null;
    const period = GIF_SWEEP_MS + GIF_HOLD_MS;
    const step = (now) => {
      if (start == null) start = now;
      const e = (now - start) % period;
      setT(e < GIF_SWEEP_MS ? e / GIF_SWEEP_MS : 1);
      raf = requestAnimationFrame(step);
    };
    raf = requestAnimationFrame(step);
    return () => cancelAnimationFrame(raf);
  }, [gif]);

  const applySeed = useCallback((s) => {
    setInputSeed(String(s));
    setSeed(s);
    setSolvedBoard(generateSolvedGrid(s));
    setT(0);
    setPlaying(false);
    if (animRef.current) cancelAnimationFrame(animRef.current);
  }, []);

  const handleGenerate = useCallback(() => {
    applySeed(Math.floor(Math.random() * 1000) + 1);
  }, [applySeed]);

  const handleApplyInputSeed = useCallback(() => {
    const parsed = parseInt(inputSeed, 10);
    applySeed(isNaN(parsed) ? 42 : parsed);
  }, [inputSeed, applySeed]);

  const grid = getGrid(t, solvedBoard, thresholds[mode]);

  const label = t === 0 ? "x₀ : fully masked"
    : t >= 0.995 ? "x₁ : generated grid"
      : `xₜ : t = ${t.toFixed(2)}`;

  const title = gif
    ? "Generating a Sudoku grid"
    : mode === "diffusion"
      ? "Discrete Flow Matching on Sudoku"
      : "Autoregressive generation on Sudoku";

  return (
    <div style={{
      background: "radial-gradient(ellipse at 35% 15%, #0f1729, #080d18 55%, #050810)",
      color: "white",
      fontFamily: "'KaTeX_Main', 'STIX Two Math', serif",
      display: "flex",
      flexDirection: "column",
      alignItems: "center",
      padding: "24px 14px 24px",
      gap: 14,
      borderRadius: 16,
    }}>
      <style>{css}</style>

      <h1 style={{
        fontSize: 23, fontWeight: 700, margin: 0, letterSpacing: "-0.02em", textAlign: "center",
        background: "linear-gradient(135deg, #82b4ff, #a78bfa, #7defa0)",
        WebkitBackgroundClip: "text", WebkitTextFillColor: "transparent",
      }}>{title}</h1>

      {/* Controls: mode, view and seed all on one row, to save vertical space */}
      <div style={{ display: "flex", gap: 12, alignItems: "center", flexWrap: "wrap", justifyContent: "center" }}>
        {!gif && (
          <div className="sfm-toggle-group">
            <button
              className={`sfm-toggle-btn${mode === "diffusion" ? " active" : ""}`}
              onClick={() => setMode("diffusion")}
            >
              Diffusion
            </button>
            <button
              className={`sfm-toggle-btn${mode === "ar" ? " active" : ""}`}
              onClick={() => setMode("ar")}
            >
              Autoregressive
            </button>
          </div>
        )}
        <div className="sfm-toggle-group">
          <button
            className={`sfm-toggle-btn${gif ? " active" : ""}`}
            onClick={() => { setGif(g => !g); setT(0); }}
          >
            GIF mode
          </button>
        </div>
        {!gif && (
          <>
            <span style={{
              fontFamily: "'KaTeX_Main', 'STIX Two Math', serif", fontSize: 11.5,
              color: "rgba(255,255,255,0.3)", textTransform: "uppercase", letterSpacing: "0.1em",
            }}>Seed</span>
            <input
              type="number"
              value={inputSeed}
              onChange={e => setInputSeed(e.target.value)}
              onKeyDown={e => e.key === "Enter" && handleApplyInputSeed()}
              style={{
                width: 64, padding: "5px 8px",
                background: "rgba(255,255,255,0.04)",
                border: "1px solid rgba(167,139,250,0.2)",
                borderRadius: 8,
                color: "#a78bfa",
                fontFamily: "'KaTeX_Main', 'STIX Two Math', serif",
                fontSize: 13.8,
                outline: "none",
              }}
            />
          </>
        )}
        <button className="sfm-btn" onClick={handleGenerate}>Generate new grid</button>
      </div>

      {gif ? (
        <>
          <div style={{
            fontFamily: "'KaTeX_Main', 'STIX Two Math', serif", fontSize: 14.5,
            color: "#a78bfa", letterSpacing: "0.06em",
          }}>
            <Mi>t</Mi> = {t.toFixed(2)}
          </div>
          <div className="sfm-gif-row">
            {[
              { key: "diffusion", name: "Diffusion", sub: "random order" },
              { key: "ar", name: "Autoregressive", sub: "left to right" },
            ].map(({ key, name, sub }) => {
              const g = getGrid(t, solvedBoard, thresholds[key]);
              return (
                <div key={key} className="sfm-gif-panel">
                  <div className="sfm-gif-title">{name}</div>
                  <div className="sfm-gif-sub">{sub}</div>
                  <SudokuGrid grid={g} cell={28} />
                  <Stats grid={g} compact />
                </div>
              );
            })}
          </div>
        </>
      ) : (
        <>
          <div style={{
            fontFamily: "'KaTeX_Main', 'STIX Two Math', serif", fontSize: 14.5,
            color: "rgba(255,255,255,0.5)", letterSpacing: "0.1em",
          }}>{label}</div>

          <SudokuGrid grid={grid} />

          <Stats grid={grid} />

          {/* Slider */}
          <div style={{ display: "flex", alignItems: "center", gap: 12, width: "100%", maxWidth: 440 }}>
            <button onClick={() => {
              if (t >= 0.995) setT(0);
              setPlaying(p => !p);
            }} style={{
              width: 34, height: 34, borderRadius: "50%",
              border: "1.5px solid rgba(167,139,250,0.25)",
              background: playing ? "rgba(167,139,250,0.12)" : "rgba(255,255,255,0.03)",
              color: "#a78bfa", cursor: "pointer",
              display: "flex", alignItems: "center", justifyContent: "center", fontSize: 14.9,
              flexShrink: 0,
            }}>{playing ? "❚❚" : "▶"}</button>

            <div style={{ flex: 1, position: "relative", height: 36, display: "flex", alignItems: "center" }}>
              <div style={{ width: "100%", height: 3, borderRadius: 2, background: "rgba(255,255,255,0.07)", position: "relative" }}>
                <div style={{
                  position: "absolute", left: 0, top: 0, height: "100%",
                  width: `${t * 100}%`, borderRadius: 2,
                  background: "linear-gradient(90deg, #82b4ff, #a78bfa, #7defa0)",
                  transition: playing ? "none" : "width 0.15s ease",
                }} />
              </div>
              <input type="range" min={0} max={1} step={0.005} value={t}
                onChange={e => { setT(parseFloat(e.target.value)); setPlaying(false); }}
                style={{ position: "absolute", width: "100%", height: 36, opacity: 0, cursor: "pointer", margin: 0 }}
              />
              <div style={{
                position: "absolute", left: `calc(${t * 100}% - 8px)`, top: "50%", transform: "translateY(-50%)",
                width: 16, height: 16, borderRadius: "50%", background: "#a78bfa",
                boxShadow: "0 0 14px rgba(167,139,250,0.4)", pointerEvents: "none",
                transition: playing ? "none" : "left 0.15s ease",
              }} />
            </div>

            <span style={{
              fontFamily: "'KaTeX_Main', 'STIX Two Math', serif", fontSize: 13.8, color: "#a78bfa",
              minWidth: 46, textAlign: "right", fontWeight: 500,
            }}><Mi>t</Mi>={t.toFixed(2)}</span>
          </div>
        </>
      )}

      {/* Legend */}
      <div style={{ display: "flex", gap: 16, flexWrap: "wrap", justifyContent: "center" }}>
        {[
          { color: "rgba(130,180,255,0.5)", label: "Masked [M]" },
          { color: "#7defa0", label: "Generated" },
        ].map(it => (
          <div key={it.label} style={{ display: "flex", alignItems: "center", gap: 6 }}>
            <div style={{ width: 10, height: 10, borderRadius: 3, background: it.color }} />
            <span style={{ fontFamily: "'KaTeX_Main', 'STIX Two Math', serif", fontSize: 11.5, color: "rgba(255,255,255,0.3)" }}>{it.label}</span>
          </div>
        ))}
      </div>
    </div>
  );
}

const css = `
.sfm-toggle-group {
  display: inline-flex;
  border-radius: 8px;
  overflow: hidden;
  border: 1px solid rgba(255,255,255,0.12);
}
.sfm-toggle-btn {
  padding: 6px 14px;
  border: none;
  background: rgba(255,255,255,0.04);
  color: rgba(255,255,255,0.4);
  font-family: 'KaTeX_Main', 'STIX Two Math', serif;
  font-size: 14.9px;
  cursor: pointer;
  transition: background 0.2s, color 0.2s;
}
.sfm-toggle-btn:not(:last-child) {
  border-right: 1px solid rgba(255,255,255,0.08);
}
.sfm-toggle-btn.active {
  background: rgba(167,139,250,0.18);
  color: #a78bfa;
  font-weight: 600;
}
.sfm-btn {
  padding: 6px 12px;
  background: rgba(167,139,250,0.12);
  border: 1.5px solid rgba(167,139,250,0.25);
  border-radius: 8px;
  color: #a78bfa;
  font-family: 'KaTeX_Main', 'STIX Two Math', serif;
  font-size: 13.8px;
  font-weight: 500;
  cursor: pointer;
}
.sfm-gif-row {
  display: flex;
  gap: 26px;
  align-items: flex-start;
  justify-content: center;
  flex-wrap: wrap;
}
.sfm-gif-panel {
  display: flex;
  flex-direction: column;
  align-items: center;
  gap: 8px;
}
.sfm-gif-title {
  font-family: 'KaTeX_Main', 'STIX Two Math', serif;
  font-size: 15.5px;
  font-weight: 600;
  color: rgba(255,255,255,0.82);
}
.sfm-gif-sub {
  font-family: 'KaTeX_Main', 'STIX Two Math', serif;
  font-size: 11.5px;
  color: rgba(255,255,255,0.3);
  text-transform: uppercase;
  letter-spacing: 0.1em;
  margin-top: -6px;
}
`;
