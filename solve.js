// aica-diff-speed: a fast drop-in for makefun-diff 1.0.0.
//
// Same patch, same tie-breaks, much less work. The reference (jsdiff's Myers
// with a deletion-preferred tie-break) keeps a linked path object per cell
// of the search and compares line strings along every snake. This module
// instead:
//
//   1. cuts each text into lines once and interns every distinct line to a
//      small integer, shared across the cases of one run, so every later
//      comparison is one integer compare;
//   2. trims the common prefix and suffix on those integers;
//   3. runs the same greedy Myers search on typed arrays, keeping one
//      integer per diagonal per edit distance (the furthest old position
//      reached) instead of a path object per cell, and no edge diagonal
//      is pruned, exactly like the reference;
//   4. rebuilds the edit script by walking the stored diagonals backwards,
//      re-applying the same choice rule the forward search used at each
//      step, so the script — and therefore the patch — is the reference's
//      own first path to both ends, deletion first on a tie.
//
// Nothing here is copied from the reference: the search, the backtrack and
// the patch builder are written from the rule as the kit states it.

/** The patch's first word. */
const FORMAT = 'makefun-diff/1';

/** The kept lines a hunk shows before and after each change run. */
const CONTEXT = 3;

/** Run kinds, internal only. */
const KEEP = 0;
const DELETE = 1;
const INSERT = 2;

/** Distinct lines seen so far, line string -> small integer id (>= 1). */
const dict = new Map();

/**
 * Cut a text into lines and intern them. A text is cut after every "\n"
 * (the only separator; "\r" stays part of its line) and a last line with no
 * "\n" is a line too; the empty text has no lines. Returns the split parts
 * (line i is parts[i], with its "\n" for every i below `last` and without
 * one for the last line when it is bare), the index `last` of the final
 * part, and the integer ids. A line's id is its part's base id doubled,
 * plus one when the line is bare: two lines share an id exactly when they
 * are the same code units, newline or its absence included. Keeping the
 * parts as split() made them, with no string built per line, keeps this
 * cheap; the patch builder adds each "\n" back as it writes the line out.
 */
function tokenize(text) {
  const parts = text.split('\n');
  const last = parts.length - 1;
  const count = last + (parts[last] === '' ? 0 : 1);
  const ids = new Int32Array(count);
  for (let i = 0; i < last; i++) {
    let base = dict.get(parts[i]);
    if (base === undefined) {
      base = dict.size + 1;
      dict.set(parts[i], base);
    }
    ids[i] = base * 2;
  }
  if (parts[last] !== '') {
    let base = dict.get(parts[last]);
    if (base === undefined) {
      base = dict.size + 1;
      dict.set(parts[last], base);
    }
    ids[last] = base * 2 + 1;
  }
  return { parts, last, ids };
}

/**
 * The edit runs of the middle slices A into B, as [kind, count] pairs in
 * order: the reference's Myers search, then a backwards walk that rebuilds
 * its exact script. A and B hold integer line ids; N and M are their
 * lengths. The search keeps, for each edit distance d, one Int32Array
 * holding, per diagonal k, how many old lines the furthest d-edit path on
 * that diagonal has consumed (-1 where no path reaches the diagonal).
 */
function myersRuns(A, B) {
  const N = A.length;
  const M = B.length;
  const Vs = [];
  // d = 0: the snake from the first lines, with no edit yet.
  const v0 = new Int32Array(1);
  let x = 0;
  let y = 0;
  while (x < N && y < M && A[x] === B[y]) {
    x++;
    y++;
  }
  v0[0] = x;
  Vs.push(v0);
  let D = 0;
  let kf = 0;
  if (x < N || y < M) {
    let done = false;
    for (let d = 1; d <= N + M && !done; d++) {
      const vd = new Int32Array(2 * d + 1);
      const prev = Vs[d - 1];
      // The two edge diagonals have one candidate each: k = -d can only
      // insert (from k+1), k = d can only delete (from k-1). Every other
      // diagonal reads both neighbours, which are always in range there,
      // so the interior loop needs no bounds checks. A diagonal no path
      // reaches is written -1 in the open, so no fill is needed: a fresh
      // array is only ever read where this loop wrote it. The edges are
      // handled first and last so the first diagonal to reach both ends
      // is still found in ascending k order, as the reference finds it.
      // k = -d: insertion only, from the (d-1)-path on diagonal -(d-1).
      let xp = prev[0];
      if (xp >= 0 && xp + d <= M) {
        let xx = xp;
        let yy = xx + d;
        while (xx < N && A[xx] === B[yy]) {
          xx++;
          yy++;
        }
        vd[0] = xx;
        if (xx >= N && yy >= M) {
          D = d;
          kf = -d;
          done = true;
        }
      } else vd[0] = -1;
      if (!done) {
        for (let k = -d + 2, w = 2; k <= d - 2; k += 2, w += 2) {
          // Deletion: one old line past the furthest (d-1)-path on k-1,
          // no candidate past the old text's end. Insertion: one new line
          // past the furthest (d-1)-path on k+1, no candidate past the new
          // text's end. The candidate further into the old text wins, the
          // deletion on a tie. The snake test needs only xx < N: with xx
          // in range A[xx] is an id, and B[yy] is undefined outside the
          // new text, so an out-of-range yy can never match it.
          const xpD = prev[w - 2];
          const xpI = prev[w];
          let delX = -1;
          if (xpD >= 0 && xpD < N) delX = xpD + 1;
          let insX = -1;
          if (xpI >= 0 && xpI - k <= M) insX = xpI;
          if (delX < 0 && insX < 0) {
            vd[w] = -1;
            continue;
          }
          let xx = delX >= insX ? delX : insX;
          let yy = xx - k;
          while (xx < N && A[xx] === B[yy]) {
            xx++;
            yy++;
          }
          vd[w] = xx;
          if (xx >= N && yy >= M) {
            D = d;
            kf = k;
            done = true;
            break;
          }
        }
      }
      if (!done) {
        // k = d: deletion only, from the (d-1)-path on diagonal d-1.
        const xpLast = prev[prev.length - 1];
        if (xpLast >= 0 && xpLast < N) {
          let xx = xpLast + 1;
          let yy = xx - d;
          while (xx < N && A[xx] === B[yy]) {
            xx++;
            yy++;
          }
          vd[2 * d] = xx;
          if (xx >= N && yy >= M) {
            D = d;
            kf = d;
            done = true;
          }
        } else vd[2 * d] = -1;
      }
      Vs.push(vd);
    }
    if (!done) throw new Error('aica-diff-speed: the search ended without reaching both ends');
  }

  // Walk back from (D, kf): at each step re-apply the forward choice rule
  // to the stored diagonals, so the move and the snake it extends are the
  // reference's own. Segments are collected backwards, snake first, then
  // the edit that precedes it, and reversed at the end.
  const rev = [];
  let k = kf;
  for (let d = D; d >= 1; d--) {
    const vd = Vs[d];
    const xEnd = vd[k + d];
    const prev = Vs[d - 1];
    const prevLen = prev.length;
    let delX = -1;
    const jDel = k + d - 2;
    if (jDel >= 0 && jDel < prevLen) {
      const xp = prev[jDel];
      if (xp >= 0 && xp < N) delX = xp + 1;
    }
    let insX = -1;
    const jIns = k + d;
    if (jIns >= 0 && jIns < prevLen) {
      const xp = prev[jIns];
      if (xp >= 0 && xp - k <= M) insX = xp;
    }
    let moveX;
    let prevK;
    let kind;
    if (delX >= insX) {
      moveX = delX;
      prevK = k - 1;
      kind = DELETE;
    } else {
      moveX = insX;
      prevK = k + 1;
      kind = INSERT;
    }
    const snake = xEnd - moveX;
    if (snake > 0) rev.push([KEEP, snake]);
    rev.push([kind, 1]);
    k = prevK;
  }
  const firstSnake = Vs[0][0];
  if (firstSnake > 0) rev.push([KEEP, firstSnake]);

  // Forward order, merging runs of one kind that touch.
  const runs = [];
  for (let i = rev.length - 1; i >= 0; i--) {
    const seg = rev[i];
    const lastRun = runs.length > 0 ? runs[runs.length - 1] : undefined;
    if (lastRun !== undefined && lastRun[0] === seg[0]) lastRun[1] += seg[1];
    else runs.push([seg[0], seg[1]]);
  }
  return runs;
}

/** make.fun's own patch of input.old into input.new, as one string. */
export function run(input) {
  if (input === null || typeof input !== 'object' || typeof input.old !== 'string' || typeof input.new !== 'string') {
    throw new TypeError('aica-diff-speed: the input is { old, new }, two strings');
  }
  const oldTok = tokenize(input.old);
  const newTok = tokenize(input.new);
  const a = oldTok.parts;
  const b = newTok.parts;
  const aLast = oldTok.last;
  const bLast = newTok.last;
  const aIds = oldTok.ids;
  const bIds = newTok.ids;
  const n = aIds.length;
  const m = bIds.length;

  // The common prefix, then the common suffix of what is left.
  let prefix = 0;
  while (prefix < n && prefix < m && aIds[prefix] === bIds[prefix]) prefix++;
  let suffix = 0;
  while (suffix < n - prefix && suffix < m - prefix && aIds[n - 1 - suffix] === bIds[m - 1 - suffix]) suffix++;

  // The runs: kept prefix, the search over the middle, kept suffix.
  const runs = [];
  const pushRun = (kind, count) => {
    if (count <= 0) return;
    const lastRun = runs.length > 0 ? runs[runs.length - 1] : undefined;
    if (lastRun !== undefined && lastRun[0] === kind) lastRun[1] += count;
    else runs.push([kind, count]);
  };
  pushRun(KEEP, prefix);
  const middle = myersRuns(aIds.subarray(prefix, n - suffix), bIds.subarray(prefix, m - suffix));
  for (const seg of middle) pushRun(seg[0], seg[1]);
  pushRun(KEEP, suffix);

  // The change runs: each a stretch of deletions and insertions between two
  // kept lines, at old line o and new line p.
  const changes = [];
  let o = 0;
  let p = 0;
  let deleted = 0;
  let inserted = 0;
  for (const seg of runs) {
    const kind = seg[0];
    const count = seg[1];
    if (kind === KEEP) {
      o += count;
      p += count;
      continue;
    }
    let c = changes.length > 0 ? changes[changes.length - 1] : undefined;
    if (c === undefined || c.o + c.dels !== o || c.p + c.ins !== p) {
      c = { o, p, dels: 0, ins: 0 };
      changes.push(c);
    }
    if (kind === DELETE) {
      c.dels += count;
      o += count;
      deleted += count;
    } else {
      c.ins += count;
      p += count;
      inserted += count;
    }
  }

  // The hunks: change runs at most 2 * CONTEXT kept lines apart share one.
  const hunks = [];
  for (const c of changes) {
    const h = hunks.length > 0 ? hunks[hunks.length - 1] : undefined;
    const prev = h !== undefined ? h[h.length - 1] : undefined;
    if (prev !== undefined && c.o - (prev.o + prev.dels) <= 2 * CONTEXT) h.push(c);
    else hunks.push([c]);
  }

  // The patch, built as pieces and joined once. A kept or deleted line is
  // its old part with its "\n" (every line but the last of its text), or the
  // bare last part followed by "\n%\n"; an inserted line the same from the
  // new text. Pushing the op, the part and the ending as separate pieces
  // leaves every join to the one final join, with no string built per line.
  const out = [`${FORMAT} old=${n} new=${m} hunks=${hunks.length} deleted=${deleted} inserted=${inserted}\n`];
  for (const h of hunks) {
    const first = h[0];
    const last = h[h.length - 1];
    const oldStart = Math.max(0, first.o - CONTEXT);
    const newStart = first.p - (first.o - oldStart);
    const after = Math.min(CONTEXT, n - (last.o + last.dels));
    const oldEnd = last.o + last.dels + after;
    const newEnd = last.p + last.ins + after;
    out.push(`@ ${oldStart + 1} ${oldEnd - oldStart} ${newStart + 1} ${newEnd - newStart}\n`);
    let at = oldStart;
    for (const c of h) {
      for (; at < c.o; at++) {
        if (at < aLast) out.push('=', a[at], '\n');
        else out.push('=', a[at], '\n%\n');
      }
      for (let i = 0; i < c.dels; i++) {
        const j = c.o + i;
        if (j < aLast) out.push('-', a[j], '\n');
        else out.push('-', a[j], '\n%\n');
      }
      for (let i = 0; i < c.ins; i++) {
        const j = c.p + i;
        if (j < bLast) out.push('+', b[j], '\n');
        else out.push('+', b[j], '\n%\n');
      }
      at = c.o + c.dels;
    }
    for (; at < oldEnd; at++) {
      if (at < aLast) out.push('=', a[at], '\n');
      else out.push('=', a[at], '\n%\n');
    }
  }
  return out.join('');
}
