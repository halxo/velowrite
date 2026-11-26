import { escapeHtml } from '../model/sanitize';

const LATEX_SYMBOLS: Record<string, string> = {
  alpha: 'α',
  beta: 'β',
  gamma: 'γ',
  delta: 'δ',
  epsilon: 'ε',
  zeta: 'ζ',
  eta: 'η',
  theta: 'θ',
  lambda: 'λ',
  mu: 'μ',
  pi: 'π',
  rho: 'ρ',
  sigma: 'σ',
  tau: 'τ',
  phi: 'φ',
  chi: 'χ',
  psi: 'ψ',
  omega: 'ω',
  Gamma: 'Γ',
  Delta: 'Δ',
  Theta: 'Θ',
  Lambda: 'Λ',
  Pi: 'Π',
  Sigma: 'Σ',
  Omega: 'Ω',
  sum: '∑',
  prod: '∏',
  int: '∫',
  oint: '∮',
  infty: '∞',
  partial: '∂',
  nabla: '∇',
  pm: '±',
  mp: '∓',
  times: '×',
  div: '÷',
  cdot: '·',
  leq: '≤',
  le: '≤',
  geq: '≥',
  ge: '≥',
  neq: '≠',
  ne: '≠',
  approx: '≈',
  equiv: '≡',
  propto: '∝',
  in: '∈',
  notin: '∉',
  subset: '⊂',
  subseteq: '⊆',
  cup: '∪',
  cap: '∩',
  forall: '∀',
  exists: '∃',
  rightarrow: '→',
  to: '→',
  leftarrow: '←',
  Rightarrow: '⇒',
  Leftarrow: '⇐',
  leftrightarrow: '↔',
  iff: '⇔',
};

/**
 * Lightweight zero-dependency typographic math formatter for display equations.
 * Converts common LaTeX constructs (\frac, \sqrt, superscripts, subscripts,
 * Greek symbols, and operators) into clean semantic math HTML in <0.2ms.
 */
export function renderLatexEquationHtml(rawLatex: string): string {
  const trimmed = rawLatex.trim();
  if (!trimmed) {
    return '<span class="vw-math-placeholder">Click to enter a LaTeX equation (e.g. E = mc^2 or \\frac{-b \\pm \\sqrt{b^2 - 4ac}}{2a})</span>';
  }

  let s = escapeHtml(trimmed);

  // Inner braced superscripts, subscripts, and square roots first so \frac handles nested expressions
  for (let pass = 0; pass < 2; pass++) {
    s = s.replace(
      /\\sqrt\{([^{}]+)\}/g,
      '<span class="vw-math-sqrt">√<span class="vw-math-radicand">$1</span></span>'
    );
    s = s.replace(/\^\{([^{}]+)\}/g, '<sup>$1</sup>');
    s = s.replace(/_\{([^{}]+)\}/g, '<sub>$1</sub>');
  }

  // Fractions: \frac{num}{den}
  for (let pass = 0; pass < 3; pass++) {
    s = s.replace(
      /\\frac\{([^{}]+)\}\{([^{}]+)\}/g,
      '<span class="vw-math-frac"><span class="vw-math-num">$1</span><span class="vw-math-den">$2</span></span>'
    );
  }

  // Single-character superscripts & subscripts
  s = s.replace(/\^([A-Za-z0-9+\-])/g, '<sup>$1</sup>');
  s = s.replace(/_([A-Za-z0-9+\-])/g, '<sub>$1</sub>');

  // Named LaTeX symbols
  s = s.replace(/\\([A-Za-z]+)/g, (full, cmd: string) => LATEX_SYMBOLS[cmd] ?? full);

  return s;
}
