import { useState, useEffect, useRef, useCallback } from "react";

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

// ── Build reveal thresholds via seeded shuffle ────────────────────────
function buildThresholds(seed) {
  const rng = makePrng(seed ^ 0xdeadbeef);
  const positions = [];
  for (let r = 0; r < 9; r++)
    for (let c = 0; c < 9; c++)
      positions.push({ r, c, key: rng() });
  positions.sort((a, b) => a.key - b.key);
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
      return { value: "M", state: "masked" };
    })
  );
}

const CELL = 42;
const GAP = 2;
const BOX_GAP = 5;

function getPos(r, c) {
  const x = Math.floor(c / 3) * (CELL * 3 + GAP * 2 + BOX_GAP) + (c % 3) * (CELL + GAP);
  const y = Math.floor(r / 3) * (CELL * 3 + GAP * 2 + BOX_GAP) + (r % 3) * (CELL + GAP);
  return { x, y };
}

const GRID_SIZE = CELL * 9 + GAP * 6 + BOX_GAP * 2;

export default function App() {
  const [activeSeed, setActiveSeed] = useState(42);
  const [inputSeed, setInputSeed] = useState("42");
  const [solvedBoard, setSolvedBoard] = useState(() => generateSolvedGrid(42));
  const [thresholds, setThresholds] = useState(() => buildThresholds(42));
  const [t, setT] = useState(0);
  const [playing, setPlaying] = useState(false);
  const tRef = useRef(t);
  const animRef = useRef(null);

  useEffect(() => { tRef.current = t; }, [t]);

  useEffect(() => {
    if (!playing) { if (animRef.current) cancelAnimationFrame(animRef.current); return; }
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
  }, [playing]);

  // Button: pick a fresh random seed in [1, 1000]
  const handleGenerate = useCallback(() => {
    const s = Math.floor(Math.random() * 1000) + 1;
    setInputSeed(String(s));
    setActiveSeed(s);
    setSolvedBoard(generateSolvedGrid(s));
    setThresholds(buildThresholds(s));
    setT(0);
    setPlaying(false);
    if (animRef.current) cancelAnimationFrame(animRef.current);
  }, []);

  // Enter key on input: apply the typed seed
  const handleApplyInputSeed = useCallback(() => {
    const parsed = parseInt(inputSeed, 10);
    const s = isNaN(parsed) ? 42 : parsed;
    setInputSeed(String(s));
    setActiveSeed(s);
    setSolvedBoard(generateSolvedGrid(s));
    setThresholds(buildThresholds(s));
    setT(0);
    setPlaying(false);
    if (animRef.current) cancelAnimationFrame(animRef.current);
  }, [inputSeed]);

  const grid = getGrid(t, solvedBoard, thresholds);
  const masked = grid.flat().filter(c => c.state === "masked").length;
  const revealed = grid.flat().filter(c => c.state === "revealed").length;
  const total = 81;

  const label = t === 0 ? "x\u2080  \u2014 fully masked"
    : t >= 0.995 ? "x\u2081  \u2014 generated grid"
      : `x\u209C  \u2014 t = ${t.toFixed(2)}`;

  return (
    <div style={{
      background: "radial-gradient(ellipse at 35% 15%, #0f1729, #080d18 55%, #050810)",
      color: "white",
      fontFamily: "'Outfit', sans-serif",
      display: "flex",
      flexDirection: "column",
      alignItems: "center",
      padding: "24px 14px 24px",
      gap: 14,
      borderRadius: 16,
    }}>
      <link href="https://fonts.googleapis.com/css2?family=Outfit:wght@300;400;500;600;700&family=DM+Mono:wght@400;500&display=swap" rel="stylesheet" />

      {/* Title */}
      <div style={{ textAlign: "center", maxWidth: 520 }}>
        <h1 style={{
          fontSize: 20, fontWeight: 700, margin: 0, letterSpacing: "-0.02em",
          background: "linear-gradient(135deg, #82b4ff, #a78bfa, #7defa0)",
          WebkitBackgroundClip: "text", WebkitTextFillColor: "transparent",
        }}>Discrete Flow Matching on Sudoku</h1>
        <p style={{
          fontSize: 10, color: "rgba(255,255,255,0.35)", marginTop: 6, lineHeight: 1.45,
          fontFamily: "'DM Mono', monospace",
        }}>
          Transporting <span style={{ color: "#82b4ff" }}>x{"\u2080"}</span> (fully masked)
          {" \u2192 "}<span style={{ color: "#a78bfa" }}>x{"\u209C"}</span> (intermediate at t)
          {" \u2192 "}<span style={{ color: "#7defa0" }}>x{"\u2081"}</span> (generated grid)
        </p>
      </div>

      {/* Seed controls */}
      <div style={{ display: "flex", gap: 12, alignItems: "center", flexWrap: "wrap", justifyContent: "center" }}>
        <span style={{
          fontFamily: "'DM Mono', monospace", fontSize: 10,
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
            fontFamily: "'DM Mono', monospace",
            fontSize: 12,
            outline: "none",
          }}
        />
        <button
          onClick={handleGenerate}
          style={{
            padding: "6px 12px",
            background: "rgba(167,139,250,0.12)",
            border: "1.5px solid rgba(167,139,250,0.25)",
            borderRadius: 8,
            color: "#a78bfa",
            fontFamily: "'Outfit', sans-serif",
            fontSize: 12,
            fontWeight: 500,
            cursor: "pointer",
          }}
        >
          Generate new grid
        </button>
        <span style={{
          fontFamily: "'DM Mono', monospace", fontSize: 10,
          color: "rgba(255,255,255,0.2)",
        }}>active: {activeSeed}</span>
      </div>

      {/* Grid label */}
      <div style={{
        fontFamily: "'DM Mono', monospace", fontSize: 10,
        color: "rgba(255,255,255,0.5)", letterSpacing: "0.1em", textTransform: "uppercase",
      }}>{label}</div>

      {/* Sudoku Grid */}
      <div style={{
        position: "relative", width: GRID_SIZE, height: GRID_SIZE,
        borderRadius: 12, overflow: "hidden",
        boxShadow: "0 0 0 1px rgba(167,139,250,0.1), 0 18px 52px rgba(0,0,0,0.34)",
      }}>
        <svg width={GRID_SIZE} height={GRID_SIZE} style={{ position: "absolute", top: 0, left: 0 }}>
          {[0, 1, 2].map(br => [0, 1, 2].map(bc => {
            const x = bc * (CELL * 3 + GAP * 2 + BOX_GAP);
            const y = br * (CELL * 3 + GAP * 2 + BOX_GAP);
            return <rect key={`${br}-${bc}`} x={x} y={y}
              width={CELL * 3 + GAP * 2} height={CELL * 3 + GAP * 2}
              rx={7} fill="none" stroke="rgba(167,139,250,0.07)" strokeWidth={1.5} />;
          }))}
        </svg>

        {grid.map((row, r) => row.map((cell, c) => {
          const { x, y } = getPos(r, c);
          const isMasked = cell.state === "masked";
          const isRevealed = cell.state === "revealed";

          return (
            <div key={`${r}-${c}`} style={{
              position: "absolute", left: x, top: y, width: CELL, height: CELL,
              borderRadius: 5,
              background: isMasked ? "rgba(0,0,0,0.6)" : "rgba(125,239,160,0.1)",
              display: "flex", alignItems: "center", justifyContent: "center",
              fontFamily: isMasked ? "'DM Mono', monospace" : "'Outfit', sans-serif",
              fontSize: isMasked ? 11 : 16,
              fontWeight: 500,
              color: isMasked ? "rgba(130,180,255,0.4)" : "#7defa0",
              transition: "all 0.5s cubic-bezier(0.22, 1, 0.36, 1)",
              boxShadow: isRevealed ? "inset 0 0 16px rgba(125,239,160,0.08)" : "none",
            }}>
              {isMasked ? "M" : cell.value}
            </div>
          );
        }))}
      </div>

      {/* Stats */}
      <div style={{ display: "flex", gap: 26, justifyContent: "center" }}>
        {[
          { label: "Masked", value: masked, color: "#82b4ff" },
          { label: "Generated", value: revealed, color: "#7defa0" },
          { label: "Total", value: total, color: "rgba(255,255,255,0.4)" },
        ].map(s => (
          <div key={s.label} style={{ display: "flex", flexDirection: "column", alignItems: "center", gap: 1 }}>
            <span style={{ fontFamily: "'Outfit', sans-serif", fontSize: 18, fontWeight: 600, color: s.color }}>{s.value}</span>
            <span style={{ fontFamily: "'DM Mono', monospace", fontSize: 9, color: "rgba(255,255,255,0.3)", textTransform: "uppercase", letterSpacing: "0.1em" }}>{s.label}</span>
          </div>
        ))}
      </div>

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
          display: "flex", alignItems: "center", justifyContent: "center", fontSize: 13,
          flexShrink: 0,
        }}>{playing ? "\u275A\u275A" : "\u25B6"}</button>

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
          fontFamily: "'DM Mono', monospace", fontSize: 12, color: "#a78bfa",
          minWidth: 46, textAlign: "right", fontWeight: 500,
        }}>t={t.toFixed(2)}</span>
      </div>

      {/* Legend */}
      <div style={{ display: "flex", gap: 16, flexWrap: "wrap", justifyContent: "center" }}>
        {[
          { color: "rgba(130,180,255,0.5)", label: "Masked [M]" },
          { color: "#7defa0", label: "Generated" },
        ].map(it => (
          <div key={it.label} style={{ display: "flex", alignItems: "center", gap: 6 }}>
            <div style={{ width: 10, height: 10, borderRadius: 3, background: it.color }} />
            <span style={{ fontFamily: "'DM Mono', monospace", fontSize: 10, color: "rgba(255,255,255,0.3)" }}>{it.label}</span>
          </div>
        ))}
      </div>
    </div>
  );
}
