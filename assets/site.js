/* TradeSage site v3: charts drawn from window.TS (assets/data.js, built from the MT5 files), the trade replay,
   the bot lab, count-ups, scroll reveals, the pointer light and the mobile menu. */
(() => {
  "use strict";
  const TS = window.TS;
  const doc = document.documentElement;
  doc.classList.add("js");

  const NS = "http://www.w3.org/2000/svg";
  const MINUS = "−";
  const MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
  const motionOK = () => window.matchMedia("(prefers-reduced-motion: no-preference)").matches;
  const css = (name) => getComputedStyle(doc).getPropertyValue(name).trim();

  const svgEl = (tag, attrs, parent) => {
    const e = document.createElementNS(NS, tag);
    for (const k in attrs) e.setAttribute(k, attrs[k]);
    if (parent) parent.appendChild(e);
    return e;
  };
  const text = (parent, x, y, str, cls, anchor = "start") => {
    const t = svgEl("text", { x, y, class: cls, "text-anchor": anchor }, parent);
    t.textContent = str;
    return t;
  };
  // numbers formatted exactly as the page templates do (site/tools/build.py)
  const nf = (v, d = 0) => Math.abs(v).toLocaleString("en-US", { minimumFractionDigits: d, maximumFractionDigits: d });
  const money = (v, d = 0) => (v < 0 ? MINUS : "") + "$" + nf(v, d);
  const smoney = (v, d = 2) => (v > 0 ? "+" : "") + money(v, d);
  const pct = (v, d = 1) => (v < 0 ? MINUS : "") + nf(v, d) + "%";
  const spct = (v, d = 1) => (v > 0 ? "+" : "") + pct(v, d);
  const toDate = (s) => new Date(s.replace(" ", "T").replace(/\./g, "-") + (s.length <= 10 ? "T00:00:00Z" : "Z"));
  const dayLabel = (d) => `${d.getUTCDate()} ${MONTHS[d.getUTCMonth()]} ${d.getUTCFullYear()}`;
  const hhmm = (d) => `${String(d.getUTCHours()).padStart(2, "0")}:${String(d.getUTCMinutes()).padStart(2, "0")}`;
  const monthLabel = (m, withYear) => { const [y, mm] = m.split("-").map(Number); return MONTHS[mm - 1] + (withYear ? ` ${y}` : ""); };
  const botOf = (host) => TS.bots[host.dataset.bot || "balanced"];
  const accOf = (key) => css(`--acc-${key || "balanced"}`) || css("--gold");
  const compact = (v) => (v >= 1000 ? "$" + (v / 1000).toFixed(v % 1000 ? 1 : 0) + "K" : "$" + v);
  let uid = 0;

  function niceStep(span, target) {
    const raw = span / target;
    const mag = Math.pow(10, Math.floor(Math.log10(raw)));
    const f = raw / mag;
    return (f <= 1 ? 1 : f <= 2 ? 2 : f <= 2.5 ? 2.5 : f <= 5 ? 5 : 10) * mag;
  }

  function makeTip(host) {
    const tip = document.createElement("div");
    tip.className = "tip";
    tip.setAttribute("aria-hidden", "true");
    host.appendChild(tip);
    return {
      show(html, x, y) {
        tip.innerHTML = html;
        tip.classList.add("on");
        const w = tip.offsetWidth, h = tip.offsetHeight, W = host.clientWidth;
        let left = x + 14;
        if (left + w > W) left = x - w - 14;
        if (left < 0) left = Math.max(0, Math.min(W - w, x - w / 2));
        tip.style.transform = `translate(${Math.round(left)}px, ${Math.round(Math.max(0, y - h - 12))}px)`;
      },
      hide() { tip.classList.remove("on"); },
    };
  }

  // redraw a chart when its box changes width (also the first time a hidden panel is shown)
  function onWidth(host, draw) {
    let w = -1;
    new ResizeObserver(() => { if (host.clientWidth && host.clientWidth !== w) { w = host.clientWidth; draw(false); } }).observe(host);
  }

  // run fn once, the first time el is well inside the viewport
  function whenSeen(el, fn, threshold = 0.25) {
    if (!("IntersectionObserver" in window)) { fn(); return; }
    const io = new IntersectionObserver((en) => { if (en.some((e) => e.isIntersecting)) { io.disconnect(); fn(); } }, { threshold, rootMargin: "0px 0px -8% 0px" });
    io.observe(el);
  }

  /* ------------------------------------------------------------ count a number up to the value in its text */
  function countUp(el, dur = 1400, fromText) {
    const m = (el.textContent || "").trim().match(/^([^\d−]*?)(−?)([\d,]+(?:\.(\d+))?)(.*)$/);
    if (!m || !motionOK()) return;
    const [, pre, neg, numTxt, dec, post] = m;
    const to = parseFloat(numTxt.replace(/,/g, "")), d = dec ? dec.length : 0;
    let from = 0;
    if (fromText) { const f = fromText.replace(/[^\d.]/g, ""); if (f) from = parseFloat(f); }
    const final = el.textContent;
    const t0 = performance.now();
    cancelAnimationFrame(el._cu || 0);
    const tick = (now) => {
      const p = Math.min(1, (now - t0) / dur), e = 1 - Math.pow(1 - p, 4);
      el.textContent = pre + neg + nf(from + (to - from) * e, d) + post;
      if (p < 1) el._cu = requestAnimationFrame(tick); else el.textContent = final;
    };
    el._cu = requestAnimationFrame(tick);
  }

  /* ------------------------------------------------------------ balance line chart (one bot at a time) */
  function equityChart(host) {
    const series = (host.dataset.series || "balance").split(",");
    const loss = css("--loss"), card = css("--card");
    const gid = `eqg${++uid}`;

    function draw(animate) {
      host.querySelectorAll("svg, .tip").forEach((n) => n.remove());
      const W = host.clientWidth, H = host.clientHeight;
      if (!W || !H) return;
      const bt = botOf(host), acc = accOf(host.dataset.bot);
      const rows = bt.curve.map(([d, b, lo]) => ({ t: toDate(d), d, b, lo }));
      const narrow = W < 560;
      const m = { t: 22, r: narrow ? 80 : 90, b: 30, l: narrow ? 42 : 52 };
      const svg = svgEl("svg", { width: W, height: H, viewBox: `0 0 ${W} ${H}`, role: "img", "aria-label": host.getAttribute("aria-label") || "Balance chart" });
      host.appendChild(svg);
      const defs = svgEl("defs", {}, svg);
      const lg = svgEl("linearGradient", { id: gid, x1: 0, y1: 0, x2: 0, y2: 1 }, defs);
      svgEl("stop", { offset: "0%", "stop-color": acc, "stop-opacity": 0.28 }, lg);
      svgEl("stop", { offset: "100%", "stop-color": acc, "stop-opacity": 0 }, lg);
      const glow = svgEl("filter", { id: `${gid}f`, x: "-10%", y: "-30%", width: "120%", height: "160%" }, defs);
      svgEl("feGaussianBlur", { stdDeviation: 5 }, glow);

      const t0 = rows[0].t.getTime(), t1 = rows[rows.length - 1].t.getTime();
      const vmax = Math.max(...rows.map((r) => r.b));
      const step = niceStep(vmax, narrow ? 3 : 4);
      const top = Math.ceil(vmax / step) * step;
      const x = (t) => m.l + ((t - t0) / (t1 - t0)) * (W - m.l - m.r);
      const y = (v) => m.t + (1 - v / top) * (H - m.t - m.b);

      for (let v = 0; v <= top + 1e-9; v += step) {
        svgEl("line", { x1: m.l, x2: W - m.r, y1: y(v), y2: y(v), class: v === 0 ? "baseline" : "gridline" }, svg);
        text(svg, m.l - 10, y(v) + 4, compact(v), "axis", "end");
      }
      const every = narrow ? 3 : 2;
      let k = 0;
      for (let dt = new Date(Date.UTC(2025, 10, 1)); dt.getTime() <= t1; dt.setUTCMonth(dt.getUTCMonth() + 1), k++) {
        if (k % every) continue;
        const lbl = MONTHS[dt.getUTCMonth()] + (dt.getUTCMonth() === 0 || k === 0 ? ` ${String(dt.getUTCFullYear()).slice(2)}` : "");
        text(svg, x(dt.getTime()), H - 8, lbl, "axis", "middle");
      }

      const path = (key) => rows.map((r, i) => `${i ? "L" : "M"}${x(r.t.getTime()).toFixed(1)},${y(r[key]).toFixed(1)}`).join("");
      const anim = animate && motionOK();
      const area = svgEl("path", { d: path("b") + `L${x(t1)},${y(0)}L${x(t0)},${y(0)}Z`, fill: `url(#${gid})` }, svg);
      let low = null;
      if (series.includes("low")) low = svgEl("path", { d: path("lo"), fill: "none", stroke: loss, "stroke-width": 1.5, "stroke-linejoin": "round", opacity: 0.9 }, svg);
      const halo = svgEl("path", { d: path("b"), fill: "none", stroke: acc, "stroke-width": 6, opacity: 0.45, filter: `url(#${gid}f)` }, svg);
      const line = svgEl("path", { d: path("b"), fill: "none", stroke: acc, "stroke-width": 2.2, "stroke-linejoin": "round", "stroke-linecap": "round" }, svg);
      if (anim) {
        [line, halo, low].forEach((p) => { if (!p) return; p.style.setProperty("--len", Math.ceil(p.getTotalLength())); p.classList.add("line-draw"); });
        area.classList.add("fade-late");
      }

      const first = rows[0], last = rows[rows.length - 1];
      const late = anim ? "fade-late" : "";
      const l1 = text(svg, x(t0) + 2, y(first.b) - 14, money(bt.deposit), "label");
      const endDot = svgEl("circle", { cx: x(t1), cy: y(last.b), r: 5, fill: acc, stroke: card, "stroke-width": 2 }, svg);
      const l2 = text(svg, x(t1) + 12, y(last.b) + 5, money(bt.end_balance), "label-big");
      [l1, endDot, l2].forEach((n) => late && n.classList.add(late));
      const dd = rows.find((r) => r.d === bt.dd_day);
      if (dd) {
        const cx = x(dd.t.getTime()), cy = y(low ? dd.lo : dd.b);
        const g = svgEl("g", { class: late }, svg);
        svgEl("circle", { cx, cy, r: 5, fill: loss, stroke: card, "stroke-width": 2 }, g);
        // the label sits just above the time axis, straight below the dot, joined by a thin drop line:
        // the curve is far above the axis by the time of the worst fall, so that strip is always clear
        const lbl = `Worst fall ${MINUS}${bt.eq_dd_pct.toFixed(1)}%`;
        const ly = H - m.b - 12;
        if (ly - cy > 40) {
          svgEl("line", { x1: cx, x2: cx, y1: cy + 8, y2: ly - 18, stroke: loss, "stroke-width": 1, "stroke-dasharray": "3 3", opacity: 0.8 }, g);
          text(g, Math.max(m.l + 66, Math.min(W - m.r - 30, cx)), ly, lbl, "label", "middle");
        } else text(g, cx - 12, cy - 14, lbl, "label", "end");
      }

      const tip = makeTip(host);
      const cross = svgEl("line", { y1: m.t, y2: H - m.b, stroke: "rgba(255,255,255,.25)", "stroke-width": 1, opacity: 0 }, svg);
      const dotB = svgEl("circle", { r: 5, fill: acc, stroke: card, "stroke-width": 2, opacity: 0 }, svg);
      const dotL = low ? svgEl("circle", { r: 5, fill: loss, stroke: card, "stroke-width": 2, opacity: 0 }, svg) : null;
      const hit = svgEl("rect", { x: m.l, y: 0, width: W - m.l - m.r, height: H, fill: "transparent" }, svg);
      let idx = rows.length - 1;
      const show = (i) => {
        idx = Math.max(0, Math.min(rows.length - 1, i));
        const r = rows[idx], cx = x(r.t.getTime());
        cross.setAttribute("x1", cx); cross.setAttribute("x2", cx); cross.setAttribute("opacity", 1);
        dotB.setAttribute("cx", cx); dotB.setAttribute("cy", y(r.b)); dotB.setAttribute("opacity", 1);
        if (dotL) { dotL.setAttribute("cx", cx); dotL.setAttribute("cy", y(r.lo)); dotL.setAttribute("opacity", 1); }
        let html = `<b>${dayLabel(r.t)}</b><br><span class="k" style="background:${acc}"></span>Balance ${money(r.b, 2)}`;
        if (low) html += `<br><span class="k" style="background:${loss}"></span>Lowest equity ${money(r.lo, 2)}`;
        tip.show(html, cx, y(r.b));
      };
      const hide = () => { [cross, dotB, dotL].forEach((n) => n && n.setAttribute("opacity", 0)); tip.hide(); };
      const nearest = (px) => {
        const t = t0 + ((px - m.l) / (W - m.l - m.r)) * (t1 - t0);
        let lo = 0, hi = rows.length - 1;
        while (hi - lo > 1) { const mid = (lo + hi) >> 1; if (rows[mid].t.getTime() < t) lo = mid; else hi = mid; }
        return Math.abs(rows[lo].t.getTime() - t) < Math.abs(rows[hi].t.getTime() - t) ? lo : hi;
      };
      hit.addEventListener("pointermove", (e) => show(nearest(e.clientX - svg.getBoundingClientRect().left)));
      hit.addEventListener("pointerleave", hide);
      host.onkeydown = (e) => {
        if (e.key === "ArrowLeft" || e.key === "ArrowRight") { e.preventDefault(); show(idx + (e.key === "ArrowRight" ? 1 : -1) * (e.shiftKey ? 20 : 1)); }
        else if (e.key === "Escape") hide();
      };
      host.onfocus = () => show(idx);
      host.onblur = hide;
    }
    host._draw = draw;
    onWidth(host, draw);
    whenSeen(host, () => draw(true));
  }

  /* ------------------------------------------------------------ month-by-month columns */
  function monthsChart(host) {
    const src = host.dataset.src === "live" ? TS.live.months : botOf(host).months;
    const gain = css("--gain"), loss = css("--loss");
    let shown = false;

    function draw() {
      host.querySelectorAll("svg, .tip").forEach((n) => n.remove());
      const W = host.clientWidth, H = host.clientHeight;
      if (!W || !H) return;
      const m = { t: 30, r: 4, b: 28, l: 4 };
      const svg = svgEl("svg", { width: W, height: H, viewBox: `0 0 ${W} ${H}`, role: "img", "aria-label": host.getAttribute("aria-label") || "Monthly results", class: "bars-grow" });
      host.appendChild(svg);
      const vmax = Math.max(0, ...src.map((d) => d.pct)), vmin = Math.min(0, ...src.map((d) => d.pct));
      const pad = (vmax - vmin) * 0.02;
      const y = (v) => m.t + ((vmax + pad - v) / (vmax - vmin + 2 * pad)) * (H - m.t - m.b - (vmin < 0 ? 18 : 0));
      const band = (W - m.l - m.r) / src.length;
      const bw = Math.min(24, band * 0.56);
      const narrow = band < 34;
      const tip = makeTip(host);
      src.forEach((d, i) => {
        const cx = m.l + band * (i + 0.5), up = d.pct >= 0;
        const y0 = y(0), y1 = y(d.pct), h = Math.max(1, Math.abs(y1 - y0)), r = Math.min(4, h, bw / 2), x0 = cx - bw / 2;
        const p = up
          ? `M${x0},${y0}V${y1 + r}Q${x0},${y1} ${x0 + r},${y1}H${x0 + bw - r}Q${x0 + bw},${y1} ${x0 + bw},${y1 + r}V${y0}Z`
          : `M${x0},${y0}V${y1 - r}Q${x0},${y1} ${x0 + r},${y1}H${x0 + bw - r}Q${x0 + bw},${y1} ${x0 + bw},${y1 - r}V${y0}Z`;
        const bar = svgEl("path", { d: p, fill: up ? gain : loss, class: `bar ${up ? "up" : "down"}` }, svg);
        bar.style.transitionDelay = `${i * 45}ms`;
        const lbl = narrow ? spct(d.pct, 0).replace("%", "") : spct(d.pct, Math.abs(d.pct) < 1 ? 1 : 0);
        const v = text(svg, cx, up ? y1 - 9 : y1 + 19, lbl, "label val", "middle");
        v.style.transitionDelay = `${300 + i * 45}ms`;
        text(svg, cx, H - 6, monthLabel(d.m), "axis", "middle");
        const hit = svgEl("rect", { x: cx - band / 2, y: 0, width: band, height: H, fill: "transparent" }, svg);
        hit.addEventListener("pointerenter", () => tip.show(`<b>${monthLabel(d.m, true)}</b><br>${spct(d.pct, 2)}`, cx, Math.min(y0, y1)));
        hit.addEventListener("pointerleave", () => tip.hide());
      });
      svgEl("line", { x1: m.l, x2: W - m.r, y1: y(0), y2: y(0), class: "baseline" }, svg);

      if (shown || !motionOK() || !("IntersectionObserver" in window)) { svg.classList.add("in"); return; }
      const io = new IntersectionObserver((entries) => {
        entries.forEach((en) => { if (en.isIntersecting) { svg.classList.add("in"); shown = true; io.disconnect(); } });
      }, { rootMargin: "0px 0px -12% 0px", threshold: 0.1 });
      io.observe(svg);
    }
    onWidth(host, draw);
  }

  /* ------------------------------------------------------------ the hero terminal: one real grid, replayed */
  function replayChart(host) {
    const R = TS.replay;
    const term = host.closest(".terminal");
    const gold = css("--gold"), gain = css("--gain"), loss = css("--loss"), ink = css("--ink"), card = css("--card"), onGold = css("--on-gold");
    // minutes from the first candle and prices relative to the first buy: the page shows no date, clock or price
    const C = R.candles.map(([mm, o, h, l, c]) => ({ mm, o, h, l, c }));
    const idxOf = (mm) => Math.min(C.length - 1, Math.floor((mm - C[0].mm) / 5));
    const E = R.entries.map((e) => ({ ...e, k: idxOf(e.m) }));
    const X = R.exits[0], kx = idxOf(X.m);
    const since = (mm) => { const v = Math.max(0, mm - E[0].m); return `${Math.floor(v / 60)}h ${String(Math.floor(v % 60)).padStart(2, "0")}m`; };
    const pill = term.querySelector(".pill"), pillText = term.querySelector(".pill-text");
    const out = Object.fromEntries([...term.querySelectorAll("[data-r]")].map((n) => [n.dataset.r, n]));
    let k = C.length - 1, raf = 0, played = false;
    let g = null;

    function draw() {
      host.querySelectorAll("svg").forEach((n) => n.remove());
      const W = host.clientWidth, H = host.clientHeight;
      if (!W || !H) return;
      const narrow = W < 600;
      const m = { t: 18, r: narrow ? 66 : 84, b: 14, l: 12 };
      const lo = Math.min(R.stop, ...C.map((c) => c.l)), hi = Math.max(R.targets[0], ...C.map((c) => c.h));
      const pad = (hi - lo) * 0.06;
      const y = (v) => m.t + ((hi + pad - v) / (hi - lo + 2 * pad)) * (H - m.t - m.b);
      const band = (W - m.l - m.r) / C.length;
      const x = (i) => m.l + band * (i + 0.5);
      const svg = svgEl("svg", { width: W, height: H, viewBox: `0 0 ${W} ${H}`, "aria-hidden": "true" });
      host.appendChild(svg);

      // a plain grid, like a trading terminal (no price or time labels)
      const ps = niceStep(hi - lo, narrow ? 5 : 8);
      for (let v = Math.ceil((lo - pad) / ps) * ps; v <= hi + pad; v += ps) {
        svgEl("line", { x1: m.l, x2: W - m.r, y1: y(v), y2: y(v), class: "gridline" }, svg);
      }

      const gC = svgEl("g", {}, svg);
      const bw = Math.max(1.5, Math.min(9, band * 0.62));
      const candles = C.map((c, i) => {
        const up = c.c >= c.o, col = up ? gain : loss;
        const grp = svgEl("g", {}, gC);
        svgEl("line", { x1: x(i), x2: x(i), y1: y(c.h), y2: y(c.l), stroke: col, "stroke-width": 1 }, grp);
        svgEl("rect", { x: x(i) - bw / 2, width: bw, y: y(Math.max(c.o, c.c)), height: Math.max(1, Math.abs(y(c.o) - y(c.c))), fill: col, rx: 1 }, grp);
        return grp;
      });

      // basket lines: target (moves after each buy), average entry, stop (after the last buy)
      const mkLine = (col, label, dash, noTag) => {
        const grp = svgEl("g", { opacity: 0 }, svg);
        const ln = svgEl("line", { x1: m.l, x2: W - m.r, stroke: col, "stroke-width": 1.5, "stroke-dasharray": dash || "" }, grp);
        if (noTag) return { grp, ln, set(v) { ln.setAttribute("y1", y(v)); ln.setAttribute("y2", y(v)); } };
        const tagW = narrow ? 60 : 76;
        const tag = svgEl("rect", { x: W - m.r + 2, width: tagW, height: 20, rx: 5, fill: col }, grp);
        const tt = text(grp, W - m.r + 2 + tagW / 2, 0, label, "tag", "middle");
        tt.setAttribute("fill", col === ink ? card : onGold);
        return { grp, ln, tag, tt, set(v, t) { ln.setAttribute("y1", y(v)); ln.setAttribute("y2", y(v)); tag.setAttribute("y", y(v) - 10); tt.setAttribute("y", y(v) + 4); if (t) tt.textContent = t; } };
      };
      const avgL = { grp: svgEl("g", { opacity: 0 }, svg), set() {} };   // average entry: not drawn
      const tgtL = mkLine(gain, "Target");
      const stopL = mkLine(loss, "Stop");
      stopL.set(R.stop);

      // entries and the close
      const marks = E.map((e, i) => {
        const grp = svgEl("g", { opacity: 0 }, svg);
        const cx = x(e.k), cy = y(e.px);
        svgEl("circle", { cx, cy, r: 6 + i * 1.5, fill: gold, stroke: card, "stroke-width": 2 }, grp);
        const lbl = `Buy ${i + 1}`;
        const left = cx > W * 0.55;
        const lx = left ? cx - 14 : cx + 14;
        const t = text(grp, lx, cy - 12, lbl, "label", left ? "end" : "start");
        t.setAttribute("paint-order", "stroke"); t.setAttribute("stroke", card); t.setAttribute("stroke-width", 4);
        return grp;
      });
      const close = svgEl("g", { opacity: 0 }, svg);
      const ccx = x(kx), ccy = y(X.px);
      svgEl("circle", { cx: ccx, cy: ccy, r: 9, fill: gain, stroke: card, "stroke-width": 2.5 }, close);
      const ct = text(close, ccx - 16, ccy - 16, `Closed ${smoney(R.pnl)}`, "label-big", "end");
      ct.setAttribute("paint-order", "stroke"); ct.setAttribute("stroke", card); ct.setAttribute("stroke-width", 5);

      g = { candles, avgL, tgtL, stopL, marks, close };
      render(k);
    }


    function render(kk) {
      k = kk;
      if (!g) return;
      const n = E.filter((e) => e.k <= k).length;
      const closed = k >= kx;
      g.candles.forEach((c, i) => c.setAttribute("opacity", i <= k ? 1 : 0));
      g.marks.forEach((mk, i) => mk.setAttribute("opacity", i < n ? 1 : 0));
      if (n > 0) {
        g.tgtL.set(R.targets[n - 1]);
        g.tgtL.grp.setAttribute("opacity", closed ? 0.35 : 1);

        g.stopL.grp.setAttribute("opacity", n === E.length ? (closed ? 0.35 : 1) : 0);
      } else [g.tgtL, g.avgL, g.stopL].forEach((l) => l.grp.setAttribute("opacity", 0));
      g.close.setAttribute("opacity", closed ? 1 : 0);

      // readouts: only the final MT5 result (open P&L candle by candle would give away the position sizes)
      const c = C[Math.min(k, C.length - 1)];
      out.pos.textContent = closed ? "0" : String(n);
      out.pnl.textContent = closed ? smoney(R.pnl) : n ? "Open" : "—";
      out.pnl.className = closed ? (R.pnl >= 0 ? "pos" : "neg") : "";
      out.ret.textContent = closed ? spct(R.pnl / R.balance * 100, 2) : "—";
      out.ret.className = closed ? (R.pnl >= 0 ? "pos" : "neg") : "";
      out.time.textContent = !n ? "0h 00m" : since(closed ? X.m : c.mm + 5);
      const state = closed ? "done" : n ? "grid" : "idle";
      pill.dataset.state = state;
      pillText.textContent = closed ? `Closed at target ${smoney(R.pnl)}` : n ? `In a grid: ${n} of 3 buys` : "Waiting for a signal";
    }

    function play() {
      cancelAnimationFrame(raf);
      if (!motionOK()) { render(C.length - 1); return; }
      const dur = 7200, start = performance.now();
      const tick = (now) => {
        const p = Math.min(1, (now - start) / dur);
        render(Math.round(p * (C.length - 1)));
        if (p < 1) raf = requestAnimationFrame(tick);
      };
      render(0);
      raf = requestAnimationFrame(tick);
    }

    onWidth(host, draw);
    term.querySelector(".replay-btn").addEventListener("click", () => { played = true; play(); });
    if (motionOK() && "IntersectionObserver" in window) {
      render(0);
      const io = new IntersectionObserver((en) => {
        if (en.some((e) => e.isIntersecting) && !played) { played = true; io.disconnect(); setTimeout(play, 350); }
      }, { threshold: 0.35 });
      io.observe(host);
    }
  }


  /* ------------------------------------------------------------ bot lab: tabs that swap one panel between the bots */
  function lab(box) {
    const tabs = [...box.querySelectorAll('[role="tab"]')];
    const panel = box.querySelector(".lab-panel");
    const chart = panel.querySelector('.chart[data-chart="equity"]');
    const f = Object.fromEntries([...panel.querySelectorAll("[data-f]")].map((n) => [n.dataset.f, n]));
    const WA = "https://wa.me/27632762725?text=";
    const share = (s) => (s.match(/\(([^)]+)\)/) || [, s])[1];

    function select(tab, focus) {
      const key = tab.dataset.bot, b = TS.bots[key];
      if (!b || tab.getAttribute("aria-selected") === "true") { if (focus) tab.focus(); return; }
      const prevRet = f.ret.textContent;
      tabs.forEach((t) => { const on = t === tab; t.setAttribute("aria-selected", on); t.tabIndex = on ? 0 : -1; });
      if (focus) tab.focus();
      panel.setAttribute("aria-labelledby", tab.id);
      panel.style.setProperty("--acc", `var(--acc-${key})`);

      const ks = b.inputs.InpMaxDDStopPct;
      f.kick.textContent = `SageGrid ${b.name} · 1 year from ${money(b.deposit)}`;
      f.ret.textContent = spct(b.ret_pct, 0);
      f.sub.textContent = `${money(b.deposit)} became ${money(b.end_balance, 2)} in the MT5 Strategy Tester`;
      f.blurb.textContent = b.blurb;
      f.six.textContent = spct(b.six.ret_pct, 0);
      f.dd.textContent = pct(b.eq_dd_pct, 1);
      f.ddw.style.width = `${b.eq_dd_pct}%`;
      f.ksl.style.left = `${ks}%`;
      f.ks.textContent = `Closed trades only ${pct(b.bal_dd_pct, 1)} · kill switch ${nf(ks)}%, ${b.cap_hit ? "hit" : "never hit"}`;
      f.fl.textContent = pct(-b.float_pct, 1);
      f.flt.textContent = `Of the balance, on one grid (${money(b.float_usd, 2)}). Stop on each grid: ${nf(b.inputs.InpBasketStopPct)}%`;
      f.pf.textContent = nf(b.profit_factor, 2);
      f.trades.textContent = nf(b.trades);
      f.won.textContent = `${share(b.won)} won`;
      f.d500.textContent = b.d500 ? spct(b.d500.ret_pct, 0) : "";
      f.waname.textContent = `Ask about ${b.name}`;
      f.wa.href = WA + encodeURIComponent(`Hi TradeSage, I'd like to ask about SageGrid ${b.name}`);
      f.page.href = b.page;
      f.report.href = b.report;

      chart.dataset.bot = key;
      chart.setAttribute("aria-label", `SageGrid ${b.name}: balance and lowest equity each day of the one-year MT5 test, from ${money(b.deposit)} to ${money(b.end_balance, 2)}. Use the arrow keys to move through the days.`);
      chart._draw && chart._draw(true);

      panel.classList.remove("swap"); void panel.offsetWidth; panel.classList.add("swap");
      countUp(f.ret, 900, prevRet);
    }

    tabs.forEach((t, i) => {
      t.addEventListener("click", () => select(t));
      t.addEventListener("keydown", (e) => {
        const k = e.key;
        let j = null;
        if (k === "ArrowRight") j = (i + 1) % tabs.length;
        else if (k === "ArrowLeft") j = (i + tabs.length - 1) % tabs.length;
        else if (k === "Home") j = 0;
        else if (k === "End") j = tabs.length - 1;
        if (j !== null) { e.preventDefault(); select(tabs[j], true); }
      });
    });
    whenSeen(f.ret, () => countUp(f.ret, 1600), 0.6);
  }

  /* ------------------------------------------------------------ reveals, count-ups, pointer light, menu */
  function reveals() {
    const els = [...document.querySelectorAll(".reveal")];
    if (!motionOK() || !("IntersectionObserver" in window)) { els.forEach((e) => e.classList.add("in")); return; }
    const io = new IntersectionObserver((en) => en.forEach((e) => { if (e.isIntersecting) { e.target.classList.add("in"); io.unobserve(e.target); } }), { threshold: 0.15, rootMargin: "0px 0px -6% 0px" });
    els.forEach((e) => io.observe(e));
  }

  function counters() {
    document.querySelectorAll(".live-big, .gauge-val b, .float b").forEach((el) => {
      if (!/\d/.test(el.textContent)) return;
      whenSeen(el, () => countUp(el, 1600), 0.5);
    });
  }

  function spotlight() {
    if (!window.matchMedia("(hover: hover) and (pointer: fine)").matches) return;
    let el = null;
    document.addEventListener("pointermove", (e) => {
      const s = e.target.closest && e.target.closest(".spot");
      if (s !== el) el = s;
      if (!el) return;
      const r = el.getBoundingClientRect();
      el.style.setProperty("--mx", `${e.clientX - r.left}px`);
      el.style.setProperty("--my", `${e.clientY - r.top}px`);
    }, { passive: true });
  }

  function menu() {
    const btn = document.querySelector(".menu-btn"), bar = document.querySelector(".bar");
    if (!btn || !bar) return;
    const set = (open) => { bar.classList.toggle("open", open); btn.setAttribute("aria-expanded", open); };
    btn.addEventListener("click", () => set(btn.getAttribute("aria-expanded") !== "true"));
    bar.querySelectorAll(".nav a").forEach((a) => a.addEventListener("click", () => set(false)));
    document.addEventListener("keydown", (e) => { if (e.key === "Escape" && bar.classList.contains("open")) { set(false); btn.focus(); } });
    document.addEventListener("click", (e) => { if (!bar.contains(e.target)) set(false); });
  }

  menu();
  reveals();
  spotlight();
  const boot = () => {
    if (!TS) return;
    document.querySelectorAll('.chart[data-chart="equity"]').forEach(equityChart);
    document.querySelectorAll('.chart[data-chart="months"]').forEach(monthsChart);
    if (TS.replay) document.querySelectorAll('.chart[data-chart="replay"]').forEach(replayChart);
    document.querySelectorAll("[data-lab]").forEach(lab);
    counters();
  };
  if (document.fonts && document.fonts.ready) document.fonts.ready.then(boot); else boot();
})();
