// Small dense linear algebra helpers for least-squares adjustment.
// Matrices are arrays of rows. Kept dependency-free so students can read it.

export function transpose(A) {
  return A[0].map((_, j) => A.map(row => row[j]));
}

export function matmul(A, B) {
  const n = A.length, m = B[0].length, k = B.length;
  const C = Array.from({ length: n }, () => new Array(m).fill(0));
  for (let i = 0; i < n; i++)
    for (let j = 0; j < m; j++) {
      let s = 0;
      for (let t = 0; t < k; t++) s += A[i][t] * B[t][j];
      C[i][j] = s;
    }
  return C;
}

export function matvec(A, v) {
  return A.map(row => row.reduce((s, a, j) => s + a * v[j], 0));
}

// Solve the square system N x = b by Gauss-Jordan elimination with partial pivoting.
// Also returns the inverse of N (the cofactor matrix Qxx in an adjustment).
export function solve(N, b) {
  const n = N.length;
  const M = N.map((row, i) => [...row, b[i], ...Array.from({ length: n }, (_, j) => (i === j ? 1 : 0))]);
  for (let c = 0; c < n; c++) {
    let p = c;
    for (let r = c + 1; r < n; r++) if (Math.abs(M[r][c]) > Math.abs(M[p][c])) p = r;
    if (Math.abs(M[p][c]) < 1e-14) throw new Error('Singular normal matrix: the measurements do not determine all unknowns.');
    [M[c], M[p]] = [M[p], M[c]];
    const d = M[c][c];
    for (let j = 0; j < M[c].length; j++) M[c][j] /= d;
    for (let r = 0; r < n; r++) {
      if (r === c) continue;
      const f = M[r][c];
      if (f !== 0) for (let j = 0; j < M[r].length; j++) M[r][j] -= f * M[c][j];
    }
  }
  return { x: M.map(row => row[n]), inv: M.map(row => row.slice(n + 1)) };
}

// Linear least squares: minimise |A x - l|^2.
// Returns unknowns, residuals v = A x - l, sigma0 and the cofactor matrix.
export function leastSquares(A, l) {
  const At = transpose(A);
  const N = matmul(At, A);
  const b = matvec(At, l);
  const { x, inv } = solve(N, b);
  const v = matvec(A, x).map((ax, i) => ax - l[i]);
  const dof = A.length - x.length;
  const vtv = v.reduce((s, vi) => s + vi * vi, 0);
  const sigma0 = dof > 0 ? Math.sqrt(vtv / dof) : NaN;
  return { x, v, sigma0, dof, Qxx: inv };
}
