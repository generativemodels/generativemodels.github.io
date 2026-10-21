// Shared LaTeX-style math typography for the JSX figures.
//
// The figures hand-build DOM/SVG and bypass KaTeX, so they don't get the
// nice math fonts for free. These helpers mirror how the same symbols are
// typeset in the prose:
//   - italic scalars            $x$, $u_t$, $S$        -> <Mi>
//   - bold-upright vectors       $\mathbf{x}$, $\mathbf{e}$  -> <Mb>
//   - calligraphic sets          $\mathcal{V}$, $\mathcal{S}$ -> <Mc>
//
// HTML uses inline styles (so no figure needs to inject CSS classes). SVG
// <text>/<tspan> can't be wrapped in a <span>, so spread the `svg*` presets
// onto the element instead.

export const MATH_ITALIC = "'KaTeX_Math', 'STIX Two Math', serif";
export const MATH_UPRIGHT = "'KaTeX_Main', 'STIX Two Math', serif";
// STIX first on purpose: its calligraphic glyphs (the U+1D49C.. block, see
// `cal` below) are always loaded, whereas SVG <text> does not reliably
// repaint when the lazily-fetched KaTeX_Caligraphic webfont arrives.
export const MATH_CAL = "'STIX Two Math', 'KaTeX_Caligraphic', serif";

const ITALIC = { fontFamily: MATH_ITALIC, fontStyle: "italic" };
const BOLD = { fontFamily: MATH_UPRIGHT, fontStyle: "normal", fontWeight: 700 };
const CAL = { fontFamily: MATH_CAL, fontStyle: "normal" };

// ── HTML helpers ────────────────────────────────────────────────────
export const Mi = ({ children, style }) => <span style={{ ...ITALIC, ...style }}>{children}</span>;
export const Mb = ({ children, style }) => <span style={{ ...BOLD, ...style }}>{children}</span>;
export const Mc = ({ children, style }) => <span style={{ ...CAL, ...style }}>{children}</span>;

// Simultaneous sub- and super-script stacked over one base, e.g. u_t^i, so the
// superscript sits above the subscript instead of trailing up-and-right of it.
export const SubSup = ({ sub, sup }) => (
  <span
    style={{
      display: "inline-flex",
      flexDirection: "column",
      alignItems: "flex-start",
      justifyContent: "center",
      verticalAlign: "middle",
      fontSize: "0.72em",
      lineHeight: 1.0,
      textAlign: "left",
    }}
  >
    <span style={{ marginBottom: "0.04em" }}>{sup}</span>
    <span>{sub}</span>
  </span>
);

// ── SVG attribute presets: spread onto <text> or <tspan> ────────────
export const svgMath = { fontFamily: MATH_ITALIC, fontStyle: "italic" };
export const svgBold = { fontFamily: MATH_UPRIGHT, fontWeight: 700 };
export const svgCal = { fontFamily: MATH_CAL };

// Unicode mathematical-script capitals, for $\mathcal{}$ in both HTML and SVG
// (use these glyphs rather than relying on the KaTeX_Caligraphic webfont).
export const cal = {
  A: "𝒜", B: "ℬ", C: "𝒞", D: "𝒟", E: "ℰ", F: "ℱ", G: "𝒢", H: "ℋ", I: "ℐ",
  J: "𝒥", K: "𝒦", L: "ℒ", M: "ℳ", N: "𝒩", O: "𝒪", P: "𝒫", Q: "𝒬", R: "ℛ",
  S: "𝒮", T: "𝒯", U: "𝒰", V: "𝒱", W: "𝒲", X: "𝒳", Y: "𝒴", Z: "𝒵",
};
