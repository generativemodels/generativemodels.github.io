import { useState, useEffect, useRef } from "react";

// --- USER'S PUZZLE (0 = unknown) ---
const PUZZLE = [
  [0,0,1,7,0,0,0,9,0],
  [0,0,0,0,0,0,2,0,6],
  [0,0,4,0,2,0,0,0,7],
  [0,5,0,0,9,0,3,6,0],
  [0,3,0,8,0,0,0,4,0],
  [0,6,0,2,0,0,0,0,0],
  [0,0,8,9,0,0,0,3,0],
  [0,4,0,0,0,5,0,7,0],
  [0,0,0,0,0,0,0,0,0],
];

// --- SOLVED VERSION (valid solution for the puzzle above) ---
const SOLVED = [
  [6,2,1,7,8,4,5,9,3],
  [8,7,9,3,5,1,2,0,6],
  [3,0,4,6,2,9,8,1,7],
  [4,5,7,1,9,0,3,6,2],
  [2,3,0,8,7,6,9,4,5],
  [1,6,0,2,4,3,7,5,8],
  [7,1,8,9,6,2,4,3,0],
  [0,4,6,0,3,5,1,7,8],
  [5,0,3,4,1,7,6,2,9],
];

// We need a fully valid solved board — let me use a proper backtracking solver
function solveSudoku(board) {
  const grid = board.map(r => [...r]);
  function isValid(grid, row, col, num) {
    for (let i = 0; i < 9; i++) {
      if (grid[row][i] === num) return false;
      if (grid[i][col] === num) return false;
    }
    const br = Math.floor(row / 3) * 3, bc = Math.floor(col / 3) * 3;
    for (let r = br; r < br + 3; r++)
      for (let c = bc; c < bc + 3; c++)
        if (grid[r][c] === num) return false;
    return true;
  }
  function solve(grid) {
    for (let r = 0; r < 9; r++)
      for (let c = 0; c < 9; c++)
        if (grid[r][c] === 0) {
          for (let n = 1; n <= 9; n++) {
            if (isValid(grid, r, c, n)) {
              grid[r][c] = n;
              if (solve(grid)) return true;
              grid[r][c] = 0;
            }
          }
          return false;
        }
    return true;
  }
  solve(grid);
  return grid;
}

const SOLVED_BOARD = solveSudoku(PUZZLE);

const GIVEN_MASK = PUZZLE.map(row => row.map(v => v !== 0 ? 1 : 0));

// Collect unknowns and assign each a reveal threshold
const UNKNOWNS = [];
for (let r = 0; r < 9; r++)
  for (let c = 0; c < 9; c++)
    if (!GIVEN_MASK[r][c]) UNKNOWNS.push([r, c]);

const sorted = [...UNKNOWNS].sort((a, b) => {
  const ha = ((Math.sin(a[0] * 73.17 + a[1] * 137.29) * 43758.5453) % 1 + 1) % 1;
  const hb = ((Math.sin(b[0] * 73.17 + b[1] * 137.29) * 43758.5453) % 1 + 1) % 1;
  return ha - hb;
});

const THRESHOLDS = new Map();
sorted.forEach((pos, i) => {
  THRESHOLDS.set(`${pos[0]}-${pos[1]}`, (i + 1) / sorted.length);
});

function getGrid(t) {
  return SOLVED_BOARD.map((row, r) =>
    row.map((val, c) => {
      if (GIVEN_MASK[r][c]) return { value: PUZZLE[r][c], state: "given" };
      const thresh = THRESHOLDS.get(`${r}-${c}`);
      if (t >= thresh) return { value: val, state: "revealed" };
      return { value: "M", state: "masked" };
    })
  );
}

const CELL = 50;
const GAP = 2;
const BOX_GAP = 6;

function getPos(r, c) {
  const x = Math.floor(c / 3) * (CELL * 3 + GAP * 2 + BOX_GAP) + (c % 3) * (CELL + GAP);
  const y = Math.floor(r / 3) * (CELL * 3 + GAP * 2 + BOX_GAP) + (r % 3) * (CELL + GAP);
  return { x, y };
}

const GRID_SIZE = CELL * 9 + GAP * 6 + BOX_GAP * 2;

export default function App() {
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

  const grid = getGrid(t);
  const masked = grid.flat().filter(c => c.state === "masked").length;
  const revealed = grid.flat().filter(c => c.state === "revealed").length;
  const total = UNKNOWNS.length;

  const label = t === 0 ? "x\u2080  \u2014 initial puzzle"
    : t >= 0.995 ? "x\u2081  \u2014 solved"
    : `x\u209C  \u2014 t = ${t.toFixed(2)}`;

  const phaseText = t === 0 ? "p\u2080 : source distribution"
    : t >= 0.995 ? "p\u2081 : target distribution"
    : `p\u209C : probability path at t=${t.toFixed(2)}`;

  return (
    <div style={{
      minHeight: "100vh",
      background: "radial-gradient(ellipse at 35% 15%, #0f1729, #080d18 55%, #050810)",
      color: "white",
      fontFamily: "'Outfit', sans-serif",
      display: "flex",
      flexDirection: "column",
      alignItems: "center",
      padding: "40px 16px 56px",
      gap: 24,
    }}>
      <link href="https://fonts.googleapis.com/css2?family=Outfit:wght@300;400;500;600;700&family=DM+Mono:wght@400;500&display=swap" rel="stylesheet" />

      {/* Title */}
      <div style={{ textAlign: "center", maxWidth: 520 }}>
        <h1 style={{
          fontSize: 24, fontWeight: 700, margin: 0, letterSpacing: "-0.02em",
          background: "linear-gradient(135deg, #82b4ff, #a78bfa, #7defa0)",
          WebkitBackgroundClip: "text", WebkitTextFillColor: "transparent",
        }}>Discrete Flow Matching on Sudoku</h1>
        <p style={{
          fontSize: 12, color: "rgba(255,255,255,0.35)", marginTop: 8, lineHeight: 1.6,
          fontFamily: "'DM Mono', monospace",
        }}>
          Transporting <span style={{ color: "#82b4ff" }}>p{"\u2080"}</span> (initial puzzles)
          {" \u2192 "}<span style={{ color: "#a78bfa" }}>p{"\u209C"}</span> (intermediate puzzles at t)
          {" \u2192 "}<span style={{ color: "#7defa0" }}>p{"\u2081"}</span> (solved puzzles)
        </p>
      </div>

      {/* Phase label */}
      <div style={{
        fontFamily: "'DM Mono', monospace", fontSize: 12,
        color: t === 0 ? "#82b4ff" : t >= 0.995 ? "#7defa0" : "#a78bfa",
        letterSpacing: "0.06em",
      }}>{phaseText}</div>

      {/* Grid label */}
      <div style={{
        fontFamily: "'DM Mono', monospace", fontSize: 11,
        color: "rgba(255,255,255,0.5)", letterSpacing: "0.1em", textTransform: "uppercase",
      }}>{label}</div>

      {/* Sudoku Grid */}
      <div style={{
        position: "relative", width: GRID_SIZE, height: GRID_SIZE,
        borderRadius: 14, overflow: "hidden",
        boxShadow: "0 0 0 1px rgba(167,139,250,0.1), 0 24px 80px rgba(0,0,0,0.4)",
      }}>
        <svg width={GRID_SIZE} height={GRID_SIZE} style={{ position: "absolute", top: 0, left: 0 }}>
          {[0,1,2].map(br => [0,1,2].map(bc => {
            const x = bc * (CELL * 3 + GAP * 2 + BOX_GAP);
            const y = br * (CELL * 3 + GAP * 2 + BOX_GAP);
            return <rect key={`${br}-${bc}`} x={x} y={y}
              width={CELL * 3 + GAP * 2} height={CELL * 3 + GAP * 2}
              rx={8} fill="none" stroke="rgba(167,139,250,0.07)" strokeWidth={1.5} />;
          }))}
        </svg>

        {grid.map((row, r) => row.map((cell, c) => {
          const { x, y } = getPos(r, c);
          const isGiven = cell.state === "given";
          const isMasked = cell.state === "masked";
          const isRevealed = cell.state === "revealed";

          return (
            <div key={`${r}-${c}`} style={{
              position: "absolute", left: x, top: y, width: CELL, height: CELL,
              borderRadius: 6,
              background: isGiven ? "rgba(255,255,255,0.05)"
                : isMasked ? "rgba(130,180,255,0.06)"
                : "rgba(125,239,160,0.1)",
              display: "flex", alignItems: "center", justifyContent: "center",
              fontFamily: isMasked ? "'DM Mono', monospace" : "'Outfit', sans-serif",
              fontSize: isMasked ? 13 : 19,
              fontWeight: isGiven ? 600 : 500,
              color: isGiven ? "rgba(255,255,255,0.8)"
                : isMasked ? "rgba(130,180,255,0.4)"
                : "#7defa0",
              transition: "all 0.5s cubic-bezier(0.22, 1, 0.36, 1)",
              boxShadow: isRevealed ? "inset 0 0 16px rgba(125,239,160,0.08)" : "none",
            }}>
              {isMasked ? "M" : cell.value}
            </div>
          );
        }))}
      </div>

      {/* Stats */}
      <div style={{ display: "flex", gap: 32, justifyContent: "center" }}>
        {[
          { label: "Masked", value: masked, color: "#82b4ff" },
          { label: "Revealed", value: revealed, color: "#7defa0" },
          { label: "Total unknowns", value: total, color: "rgba(255,255,255,0.4)" },
        ].map(s => (
          <div key={s.label} style={{ display: "flex", flexDirection: "column", alignItems: "center", gap: 2 }}>
            <span style={{ fontFamily: "'Outfit', sans-serif", fontSize: 22, fontWeight: 600, color: s.color }}>{s.value}</span>
            <span style={{ fontFamily: "'DM Mono', monospace", fontSize: 9, color: "rgba(255,255,255,0.3)", textTransform: "uppercase", letterSpacing: "0.1em" }}>{s.label}</span>
          </div>
        ))}
      </div>

      {/* Slider */}
      <div style={{ display: "flex", alignItems: "center", gap: 16, width: "100%", maxWidth: 500 }}>
        <button onClick={() => {
          if (t >= 0.995) setT(0);
          setPlaying(p => !p);
        }} style={{
          width: 42, height: 42, borderRadius: "50%",
          border: "1.5px solid rgba(167,139,250,0.25)",
          background: playing ? "rgba(167,139,250,0.12)" : "rgba(255,255,255,0.03)",
          color: "#a78bfa", cursor: "pointer",
          display: "flex", alignItems: "center", justifyContent: "center", fontSize: 16,
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
          fontFamily: "'DM Mono', monospace", fontSize: 13, color: "#a78bfa",
          minWidth: 50, textAlign: "right", fontWeight: 500,
        }}>t={t.toFixed(2)}</span>
      </div>

      {/* Legend */}
      <div style={{ display: "flex", gap: 20, flexWrap: "wrap", justifyContent: "center" }}>
        {[
          { color: "rgba(255,255,255,0.8)", label: "Given clue" },
          { color: "rgba(130,180,255,0.5)", label: "Masked [M]" },
          { color: "#7defa0", label: "Revealed" },
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
