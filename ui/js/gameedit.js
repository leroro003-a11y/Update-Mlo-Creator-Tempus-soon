// Changing the game's own models in a game interior (gamemlo.js): an opening (door, window, passage) cut through a model, faces or whole parts of it taken
// out, the texture of a part changed; and new rooms and portals. A model's changes: project.game.mods[name] = { cuts: [{ id, type, cx, cy, zb, w, h, d, yaw,
// grp }] in the model's own frame (grp: the openings made together through several models), deletes: [[geometry, triangle]], parts: [geometry], tex: { shader
// index: { id, tile } } }. They act on every object of the project that shows the model; the export writes the model under a name of its own (GameModels.cs).
// New rooms: project.game.rooms entries with new: true ({ name, mn, mx }); new portals: project.game.portals entries with new: true ({ from, to, corners }).
window.MLO = window.MLO || {};
(function (M) {
    'use strict';
    const { el, Model, TEX } = M, S = Model.state, bus = Model.bus, GM = M.GameMlo;
    const toast = (t, k) => bus.emit('toast', { text: t, kind: k });
    const r3 = (v) => Math.round(v * 1000) / 1000, f2 = (v) => (+v).toFixed(2);
    const randId = () => Math.random().toString(36).slice(2, 8);
    function bytes(s) { const bin = atob(s), u = new Uint8Array(bin.length); for (let i = 0; i < bin.length; i++) u[i] = bin.charCodeAt(i); return u; }
    const f32 = (s) => new Float32Array(bytes(s).buffer), u16 = (s) => new Uint16Array(bytes(s).buffer), i32 = (s) => new Int32Array(bytes(s).buffer);
    const G = () => S.project.game;
    // mode: { cut: 'door' | 'window' | 'pass' } (the next click on the selected object cuts there) or { faces: true } (clicks pick faces); faceSel: 'g:t' keys
    // of the selected object's model (geometry number, original triangle); room: drawing a new room
    const GE = M.GameEdit = { mode: null, faceSel: new Set(), faceModel: null, through: true, room: null, roomZ: 0, roomH: 3, busy: new Set(), err: {} };
    const modOf = (n) => (G().mods || {})[n] || null;
    const edited = new Map();               // model -> its geometries after the cuts and deletes (the host's preview), or absent
    let editGeneration = 0;
    GE.reset = function () {
        editGeneration++; edited.clear(); GE.faceSel.clear(); GE.faceModel = null; GE.busy.clear(); GE.err = {}; GE.mode = null; GE.room = null;
    };

    // ---------- the view: a changed model's geometries (the cut ones from the host, the rest as they are) ----------
    GE.modelFor = (n) => edited.get(n) || null;
    GE.refresh = function (n) { clearTimeout(GE['t_' + n]); GE['t_' + n] = setTimeout(() => preview(n), 120); };
    async function preview(n) {
        const project = S.project, generation = editGeneration, sourceKey = JSON.stringify(GM.source());
        const base = GM.model(n), mod = modOf(n); if (!base || base.error) return;
        if (!mod || (!(mod.cuts || []).length && !(mod.deletes || []).length && !(mod.parts || []).length)) { edited.delete(n); GM.dirty = true; M.App.remesh(); return; }
        GE.busy.add(n); M.UI.renderRight();
        try {
            const r = await Model.api('buildings/model-edit', 'POST', Object.assign({ name: n, mod: { cuts: mod.cuts || [], deletes: mod.deletes || [], parts: mod.parts || [] }, gta: '' }, GM.source())); if (r.ok === false) throw new Error(r.error);
            if (generation !== editGeneration || S.project !== project || !GM.active || sourceKey !== JSON.stringify(GM.source())) return;
            const changed = new Map(); (r.geoms || []).forEach(x => changed.set(x.g, { tex: (x.tex || '').toLowerCase(), shader: x.shader || '', bucket: x.bucket || 0, g: x.g, si: x.si, skip: /decal_dirt|decal_shadow|shadow_only/i.test(x.shader || ''), pos: f32(x.pos), nrm: f32(x.nrm), uv: f32(x.uv), idx: u16(x.idx), src: x.src ? i32(x.src) : null }));
            edited.set(n, { bmin: base.bmin, bmax: base.bmax, geoms: base.geoms.map(gm => changed.get(gm.g) || gm) }); delete GE.err[n];
        } catch (e) {
            if (generation !== editGeneration || S.project !== project || !GM.active || sourceKey !== JSON.stringify(GM.source())) return;
            GE.err[n] = e.message; edited.delete(n);
        }
        GE.busy.delete(n); GM.dirty = true; M.App.remesh(); M.UI.renderRight();
    }
    GE.refreshAll = function () { Object.keys(G().mods || {}).forEach(n => GE.refresh(n)); };
    // a part with a texture of the program: that texture, its faces' texture coordinates in metres from their place (like the program's own walls)
    GE.texOf = function (n, gm) { const mod = modOf(n), t = mod && mod.tex && mod.tex[gm.si]; return t ? t : null; };
    GE.retexUv = function (gm, tile) {
        const p = gm.pos, nr = gm.nrm, n = p.length / 3, uv = new Float32Array(n * 2);
        for (let v = 0; v < n; v++) {
            const ax = Math.abs(nr[v * 3]), ay = Math.abs(nr[v * 3 + 1]), az = Math.abs(nr[v * 3 + 2]), x = p[v * 3], y = p[v * 3 + 1], z = p[v * 3 + 2];
            let u, w; if (ax >= ay && ax >= az) { u = y; w = -z; } else if (ay >= ax && ay >= az) { u = x; w = -z; } else { u = x; w = y; }
            uv[v * 2] = u / tile; uv[v * 2 + 1] = w / tile;
        }
        return uv;
    };

    // ---------- changing a model (each one step of undo) ----------
    function editMod(n, fn) { GM.change(P => { const mods = P.game.mods = P.game.mods || {}; const m = mods[n] = mods[n] || { cuts: [], deletes: [], parts: [], tex: {} }; fn(m); }); GE.refresh(n); }
    GE.setTex = (n, si, id) => editMod(n, m => { m.tex = m.tex || {}; if (id) m.tex[si] = { id, tile: TEX.tile(id) }; else delete m.tex[si]; });
    GE.togglePart = (n, g) => editMod(n, m => { const a = m.parts || []; m.parts = a.indexOf(g) >= 0 ? a.filter(x => x !== g) : a.concat([g]); });
    GE.removeCut = (n, id) => { const c = (modOf(n).cuts || []).find(k => k.id === id), grp = c && c.grp; Object.keys(G().mods || {}).forEach(m => { if ((modOf(m).cuts || []).some(k => k.id === id || (grp && k.grp === grp))) editMod(m, q => { q.cuts = q.cuts.filter(k => k.id !== id && !(grp && k.grp === grp)); }); }); };
    // a field of an opening; the openings made together through several models change together (sizes the same, the bottom by the same amount)
    GE.setCut = function (n, id, key, v) {
        const c = (modOf(n).cuts || []).find(k => k.id === id); if (!c) return; const dz = key === 'zb' ? v - c.zb : 0;
        Object.keys(G().mods || {}).forEach(m => { if ((modOf(m).cuts || []).some(k => k.id === id || (c.grp && k.grp === c.grp))) editMod(m, q => { q.cuts.forEach(k => { if (k.id !== id && !(c.grp && k.grp === c.grp)) return; if (key === 'zb') k.zb = r3(k.zb + dz); else k[key] = r3(v); }); }); });
    };
    GE.deleteFaces = function () {
        const n = GE.faceModel; if (!n || !GE.faceSel.size) return; const keys = [...GE.faceSel].map(k => k.split(':').map(Number));
        editMod(n, m => { const have = new Set((m.deletes || []).map(d => d[0] + ':' + d[1])); m.deletes = (m.deletes || []).concat(keys.filter(k => !have.has(k[0] + ':' + k[1]))); });
        GE.faceSel.clear(); toast(keys.length + ' face' + (keys.length === 1 ? '' : 's') + ' taken out of ' + n + '.', 'ok');
    };
    GE.restoreFaces = (n) => editMod(n, m => { m.deletes = []; });

    // ---------- helpers: an object's frame ----------
    function qrot(q, x, y, z) { const qx = q[0], qy = q[1], qz = q[2], qw = q[3], tx = 2 * (qy * z - qz * y), ty = 2 * (qz * x - qx * z), tz = 2 * (qx * y - qy * x); return [x + qw * tx + (qy * tz - qz * ty), y + qw * ty + (qz * tx - qx * tz), z + qw * tz + (qx * ty - qy * tx)]; }
    const qinv = (q) => [-q[0], -q[1], -q[2], q[3]];
    const toLocal = (e, p) => { const s = e.s || [1, 1], v = qrot(qinv(e.q), p[0] - e.p[0], p[1] - e.p[1], p[2] - e.p[2]); return [v[0] / s[0], v[1] / s[0], v[2] / s[1]]; };
    const toInt = (e, v) => { const s = e.s || [1, 1], r = qrot(e.q, v[0] * s[0], v[1] * s[0], v[2] * s[1]); return [r[0] + e.p[0], r[1] + e.p[1], r[2] + e.p[2]]; };
    const dirInt = (e, v) => qrot(e.q, v[0], v[1], v[2]);
    const dirLocal = (e, v) => qrot(qinv(e.q), v[0], v[1], v[2]);
    const headingOf = (q) => { const v = qrot(q, 1, 0, 0); return Math.atan2(v[1], v[0]); };
    // the eight corners of an opening (in its model's frame) where they are in the interior
    function cutCorners(e, k) {
        const cs = Math.cos(k.yaw), sn = Math.sin(k.yaw), U = [cs, sn], N = [-sn, cs], out = [];
        for (const z of [k.zb, k.zb + k.h]) for (const q of [[-1, -1], [1, -1], [1, 1], [-1, 1]]) { const u = q[0] * k.w / 2, n = q[1] * k.d / 2; out.push(toInt(e, [k.cx + U[0] * u + N[0] * n, k.cy + U[1] * u + N[1] * n, z])); }
        return out;
    }
    GE.cutCorners = cutCorners;

    // ---------- cutting an opening where the selected object was clicked ----------
    // the first face of the model behind a point along a direction (in the model's frame), up to `max` (2 m): how thick the wall is there; with parallel, only
    // faces turned the same way as the wall count (a wall's layers, not a bench in front of it)
    function thickness(m, o, d, max, parallel) {
        let best = null; max = max || 2;
        m.geoms.forEach(gm => {
            const p = gm.pos, ix = gm.idx;
            for (let t = 0; t + 2 < ix.length; t += 3) {
                const a = ix[t] * 3, b = ix[t + 1] * 3, c = ix[t + 2] * 3, e1 = [p[b] - p[a], p[b + 1] - p[a + 1], p[b + 2] - p[a + 2]], e2 = [p[c] - p[a], p[c + 1] - p[a + 1], p[c + 2] - p[a + 2]];
                const pv = [d[1] * e2[2] - d[2] * e2[1], d[2] * e2[0] - d[0] * e2[2], d[0] * e2[1] - d[1] * e2[0]], det = e1[0] * pv[0] + e1[1] * pv[1] + e1[2] * pv[2]; if (Math.abs(det) < 1e-12) continue;
                const inv = 1 / det, s = [o[0] - p[a], o[1] - p[a + 1], o[2] - p[a + 2]], u = (s[0] * pv[0] + s[1] * pv[1] + s[2] * pv[2]) * inv; if (u < 0 || u > 1) continue;
                const qv = [s[1] * e1[2] - s[2] * e1[1], s[2] * e1[0] - s[0] * e1[2], s[0] * e1[1] - s[1] * e1[0]], v = (d[0] * qv[0] + d[1] * qv[1] + d[2] * qv[2]) * inv; if (v < 0 || u + v > 1) continue;
                const tt = (e2[0] * qv[0] + e2[1] * qv[1] + e2[2] * qv[2]) * inv; if (!(tt > 0.02 && tt < max && (best === null || tt < best))) continue;
                if (parallel) { const fn = [e1[1] * e2[2] - e1[2] * e2[1], e1[2] * e2[0] - e1[0] * e2[2], e1[0] * e2[1] - e1[1] * e2[0]], fl = Math.hypot(fn[0], fn[1], fn[2]) || 1; if (Math.abs(fn[0] * d[0] + fn[1] * d[1] + fn[2] * d[2]) / fl < 0.85) continue; }
                best = tt;
            }
        });
        return best;
    }
    const SIZES = { door: { w: 1.0, h: 2.15 }, window: { w: 1.2, h: 1.2, sill: 0.9 }, pass: { w: 1.4, h: 2.35 } };
    GE.cutAt = function (i, hit, ray) {
        const g = G(), e = g.entities[i], m = GE.modelFor(e.n) || GM.model(e.n), type = GE.mode.cut; if (!m || m.error || !hit.nrm) return;
        // the face's normal, turned towards whoever looks at it
        let n = hit.nrm; if (n[0] * ray.d[0] + n[1] * ray.d[1] + n[2] * ray.d[2] > 0) n = n.map(v => -v);
        if (Math.abs(n[2]) > 0.6) { toast('Click a wall (an upright face) of the object.', 'warn'); return; }
        const nh = Math.hypot(n[0], n[1]), ni = [n[0] / nh, n[1] / nh, 0];
        // The floor under the spot, on the side the face looks to, looking down past furniture: the first face turned up of a big model (the room's shell, 6 m
        // or more across), else the lowest face turned up within 2.5 m.
        let floor = null, lowest = null, from = [hit.pt[0] + ni[0] * 0.3, hit.pt[1] + ni[1] * 0.3, hit.pt[2] + 0.05];
        for (let k = 0; k < 10; k++) {
            const fl = GM.pickAny({ o: from, d: [0, 0, -1] }); if (!fl || hit.pt[2] - fl.pt[2] > 2.5) break;
            if (!fl.nrm || fl.nrm[2] > 0.7) {
                const fe = fl.i != null ? g.entities[fl.i] : null, fm = fe && GM.model(fe.n);
                if (!fe || (fm && Math.max(fm.bmax[0] - fm.bmin[0], fm.bmax[1] - fm.bmin[1]) >= 6)) { floor = fl.pt[2]; break; }
                lowest = fl.pt[2];
            }
            from = [fl.pt[0], fl.pt[1], fl.pt[2] - 0.01];
        }
        if (floor === null) floor = lowest !== null ? lowest : hit.pt[2] - 1;
        const sz = SIZES[type], zb = type === 'window' ? floor + sz.sill : floor;
        // the opening in each model it goes through: the clicked one and (when asked) every other model whose box it reaches, each in its own frame
        const grp = randId(), cut = (e2, md) => {
            const lp = toLocal(e2, hit.pt), ln = dirLocal(e2, ni), lnh = Math.hypot(ln[0], ln[1]) || 1, N = [ln[0] / lnh, ln[1] / lnh], yaw = Math.atan2(N[1], N[0]) - Math.PI / 2;
            // across the wall: from 10 cm in front of the face to 10 cm behind its back (the first face behind it), or 25 cm each way
            const t = thickness(md, [lp[0] - N[0] * 0.01, lp[1] - N[1] * 0.01, lp[2]], [-N[0], -N[1], 0]), back = t ? t + 0.1 : 0.25, front = 0.1, mid = (front - back) / 2;
            const lz = toLocal(e2, [hit.pt[0], hit.pt[1], zb])[2], sc = (e2.s || [1, 1]);
            return { id: randId(), grp, type, cx: r3(lp[0] + N[0] * mid), cy: r3(lp[1] + N[1] * mid), zb: r3(lz), w: r3(sz.w / sc[0]), h: r3(sz.h / sc[1]), d: r3(front + back), yaw: r3(yaw) };
        };
        // Through every model at the spot: the ones with a face turned like the wall from 10 cm in front of it to 10 cm behind the clicked model's wall (its layers:
        // decals and dirt on it, the building's outside behind it), not the furniture in front of it.
        const targets = [[i, m]], lp0 = toLocal(e, hit.pt), ln0 = dirLocal(e, ni), ln0h = Math.hypot(ln0[0], ln0[1]) || 1, N0 = [ln0[0] / ln0h, ln0[1] / ln0h];
        const t0 = thickness(m, [lp0[0] - N0[0] * 0.01, lp0[1] - N0[1] * 0.01, lp0[2]], [-N0[0], -N0[1], 0]), reach = (t0 ? t0 : 0.25) + 0.2;
        if (GE.through) g.entities.forEach((e2, j) => {
            if (j === i || e2.del || !GM.isShown(j)) return; const m2 = GE.modelFor(e2.n) || GM.model(e2.n); if (!m2 || m2.error || m2.frag) return;
            const lp = toLocal(e2, hit.pt), r = 1.2; if (lp[0] < m2.bmin[0] - r || lp[0] > m2.bmax[0] + r || lp[1] < m2.bmin[1] - r || lp[1] > m2.bmax[1] + r || lp[2] < m2.bmin[2] - 1 || lp[2] > m2.bmax[2] + 1) return;
            if (targets.some(t => g.entities[t[0]].n === e2.n)) return;
            const ln = dirLocal(e2, ni), lh = Math.hypot(ln[0], ln[1]) || 1, N = [ln[0] / lh, ln[1] / lh];
            if (thickness(m2, [lp[0] + N[0] * 0.1, lp[1] + N[1] * 0.1, lp[2]], [-N[0], -N[1], 0], reach + 0.1, true) === null) return;
            targets.push([j, m2]);
        });
        targets.forEach(t => { const e2 = g.entities[t[0]], k = cut(e2, t[1]); editMod(e2.n, q => { (q.cuts = q.cuts || []).push(k); }); });
        GE.mode = null; M.UI.renderRight();
        toast('Opening cut through ' + targets.length + ' model' + (targets.length === 1 ? '' : 's') + ' (' + targets.map(t => g.entities[t[0]].n).join(', ') + '). Its sizes are in the panel.', 'ok');
    };

    // ---------- picking faces: a click takes the flat patch round the face (connected faces turned the same way), Shift adds or takes away ----------
    GE.pickFaces = function (i, hit, add) {
        const e = G().entities[i], mo = GM.model(e.n), ed = GE.modelFor(e.n); if (!mo || hit.gi == null) return;
        const gmE = (ed || mo).geoms[hit.gi], orig = mo.geoms[hit.gi], t0 = gmE.src ? gmE.src[hit.tri] : hit.tri;
        if (GE.faceModel !== e.n) { GE.faceSel.clear(); GE.faceModel = e.n; }
        const p = orig.pos, ix = orig.idx, nt = ix.length / 3, key = (v) => Math.round(p[v * 3] * 200) + ',' + Math.round(p[v * 3 + 1] * 200) + ',' + Math.round(p[v * 3 + 2] * 200);
        const nrm = (t) => { const a = ix[t * 3] * 3, b = ix[t * 3 + 1] * 3, c = ix[t * 3 + 2] * 3, ux = p[b] - p[a], uy = p[b + 1] - p[a + 1], uz = p[b + 2] - p[a + 2], vx = p[c] - p[a], vy = p[c + 1] - p[a + 1], vz = p[c + 2] - p[a + 2]; const n = [uy * vz - uz * vy, uz * vx - ux * vz, ux * vy - uy * vx], l = Math.hypot(n[0], n[1], n[2]) || 1; return n.map(v => v / l); };
        const byPt = new Map(); for (let t = 0; t < nt; t++) for (let k = 0; k < 3; k++) { const kk = key(ix[t * 3 + k]); let l = byPt.get(kk); if (!l) byPt.set(kk, l = []); l.push(t); }
        const n0 = nrm(t0), seen = new Set([t0]), stack = [t0];
        while (stack.length && seen.size < 4000) { const t = stack.pop(); for (let k = 0; k < 3; k++) (byPt.get(key(ix[t * 3 + k])) || []).forEach(u => { if (seen.has(u)) return; const nu = nrm(u); if (nu[0] * n0[0] + nu[1] * n0[1] + nu[2] * n0[2] < 0.985) return; seen.add(u); stack.push(u); }); }
        const keys = [...seen].map(t => orig.g + ':' + t), on = keys.every(k => GE.faceSel.has(k));
        if (!add) GE.faceSel.clear();
        keys.forEach(k => { if (add && on) GE.faceSel.delete(k); else GE.faceSel.add(k); });
        M.UI.renderRight();
    };
    GE.drawFaces = function (R) {
        if (!GE.faceSel.size || !GE.faceModel || GM.sel == null) return; const e = G().entities[GM.sel]; if (!e || e.n !== GE.faceModel) return; const mo = GM.model(e.n); if (!mo) return;
        const byG = new Map(mo.geoms.map(gm => [gm.g, gm])); let n = 0;
        GE.faceSel.forEach(k => {
            if (n++ > 3000) return; const [g, t] = k.split(':').map(Number), gm = byG.get(g); if (!gm) return; const ix = gm.idx, p = gm.pos;
            const v = [0, 1, 2].map(j => toInt(e, [p[ix[t * 3 + j] * 3], p[ix[t * 3 + j] * 3 + 1], p[ix[t * 3 + j] * 3 + 2]]));
            R.ovTopLine(v[0], v[1], [1, 0.35, 0.3, 0.9]); R.ovTopLine(v[1], v[2], [1, 0.35, 0.3, 0.9]); R.ovTopLine(v[2], v[0], [1, 0.35, 0.3, 0.9]);
        });
    };
    GE.drawCuts = function (R) {
        if (GM.sel == null) return; const e = G().entities[GM.sel]; if (!e) return; const mod = modOf(e.n); if (!mod) return;
        (mod.cuts || []).forEach(k => { const c = cutCorners(e, k); [[0, 1], [1, 2], [2, 3], [3, 0], [4, 5], [5, 6], [6, 7], [7, 4], [0, 4], [1, 5], [2, 6], [3, 7]].forEach(ed => R.ovTopLine(c[ed[0]], c[ed[1]], [0.45, 0.85, 1, 0.95])); });
    };

    // ---------- new rooms: drag a rectangle on the floor ----------
    GE.startRoom = function (on) { GE.room = on ? { a: null, b: null, z: GE.roomZ } : null; GE.mode = null; M.UI.renderLeft(); };
    GE.roomTool = {
        down(e) {         const ray = M.Tools.api.pointerRay(e), p = M.Tools.api.planeHit(ray, GE.room.z); if (!p) return; GE.room.a = [Math.round(p.x / 0.05) * 0.05, Math.round(p.y / 0.05) * 0.05]; GE.room.b = null; },
        move(e) { if (!GE.room.a) return; const p = M.Tools.api.planeHit(M.Tools.api.pointerRay(e), GE.room.z); if (p) GE.room.b = [Math.round(p.x / 0.05) * 0.05, Math.round(p.y / 0.05) * 0.05]; },
        up() {
            const r = GE.room; if (!r.a || !r.b || Math.abs(r.b[0] - r.a[0]) < 0.5 || Math.abs(r.b[1] - r.a[1]) < 0.5) { r.a = null; return; }
            const n = G().rooms.filter(q => q.new).length + 1, mn = [r3(Math.min(r.a[0], r.b[0])), r3(Math.min(r.a[1], r.b[1])), r3(r.z)], mx = [r3(Math.max(r.a[0], r.b[0])), r3(Math.max(r.a[1], r.b[1])), r3(r.z + GE.roomH)];
            GM.change(P => { P.game.rooms.push({ name: 'NEW_ROOM_' + n, mn, mx, new: true, flags: 0, count: 0 }); });
            GE.room = null; GM.room = G().rooms.length - 1;
            if (M.GameWalls) { M.GameWalls.room = GM.room; M.GameWalls.floorZ = r.z; M.GameWalls.h = GE.roomH; }
            M.UI.renderLeft(); toast('New room created. Draw walls and add a portal to connect it to the stairwell.', 'ok');
        },
        draw(R, label) {
            const r = GE.room; if (r.a && r.b) { const z = r.z + 0.02, c = [[r.a[0], r.a[1], z], [r.b[0], r.a[1], z], [r.b[0], r.b[1], z], [r.a[0], r.b[1], z]]; for (let k = 0; k < 4; k++) R.ovTopLine(c[k], c[(k + 1) % 4], [0.45, 0.95, 0.6, 1]); label(f2(Math.abs(r.b[0] - r.a[0])) + ' x ' + f2(Math.abs(r.b[1] - r.a[1])) + ' m', [r.b[0], r.b[1], z + 0.3]); }
            else label('Drag a rectangle on the floor for the new room · Esc stops', null);
        }
    };
    GE.setRoom = (i, fn) => GM.change(P => { const r = P.game.rooms[i]; if (r && r.new) fn(r); });
    // a new room can only go when nothing is in it and no portal leads to it (the rooms after it would move down)
    GE.removeRoom = function (i) {
        const g = G(); if (g.entities.some(e => e.room === i) || (g.walls || []).some(w => w.room === i) || g.portals.some(p => p.from === i || p.to === i)) { toast('Move its objects and walls to another room and remove its portals first.', 'warn'); return; }
        if (i !== g.rooms.length - 1) { toast('Remove the newest room first (the rooms are numbered in order).', 'warn'); return; }
        GM.change(P => { P.game.rooms.pop(); }); if (GM.room === i) GM.room = null;
    };

    // ---------- new portals: from an opening (an opening cut in a model, or one in a new wall), between the rooms on its two sides ----------
    GE.addPortal = function (corners, nrm, wall, opening) {
        const mid = corners.reduce((a, c) => [a[0] + c[0] / 4, a[1] + c[1] / 4, a[2] + c[2] / 4], [0, 0, 0]), side = (s) => GM.roomAt([mid[0] + nrm[0] * 0.6 * s, mid[1] + nrm[1] * 0.6 * s, mid[2]], true);
        const a = side(1), b = side(-1);
        GM.change(P => { P.game.portals.push({ from: a, to: b === a ? 0 : b, flags: 0, corners: corners.map(c => c.map(r3)), objects: [], wall: wall || null, opening: opening || null, new: true }); });
        toast('Portal between ' + GM.roomName(a) + ' and ' + GM.roomName(b === a ? 0 : b) + '. Change the rooms in the list if they are wrong.', 'ok');
    };
    GE.portalFromCut = function (i, k) {
        const e = G().entities[i], cs = Math.cos(k.yaw), sn = Math.sin(k.yaw), U = [cs, sn], N = [-sn, cs], hw = k.w / 2, c = [k.cx, k.cy];
        const corners = [[-hw, k.zb], [-hw, k.zb + k.h], [hw, k.zb + k.h], [hw, k.zb]].map(q => toInt(e, [c[0] + U[0] * q[0], c[1] + U[1] * q[0], q[1]]));
        GE.addPortal(corners, dirInt(e, [N[0], N[1], 0]));
    };
    GE.setPortal = (j, fn) => GM.change(P => { const p = P.game.portals[j]; if (p && p.new) fn(p); });
    GE.removePortal = (j) => GM.change(P => { const p = P.game.portals[j]; if (p && p.new) P.game.portals.splice(j, 1); });

    // ---------- the export: what the host needs for the changed models ----------
    GE.exportData = function () {
        const used = new Set(); Object.values(G().mods || {}).forEach(m => Object.values(m.tex || {}).forEach(t => used.add(t.id)));
        return { mods: G().mods || {}, modTextures: [...used].map(id => { const t = TEX.pixels(id); return { name: id, size: t.size, rgba: M.toB64(new Uint8Array(t.data.buffer, t.data.byteOffset, t.data.byteLength)) }; }) };
    };

    // ---------- panels ----------
    const num = (label, value, step, set, unit) => el('div', { class: 'row' }, el('label', null, label), el('input', { type: 'number', class: 'grow', step, value, onchange: (ev) => { const v = parseFloat(ev.target.value); if (!isNaN(v)) set(v); } }), unit ? el('span', { class: 'note' }, unit) : null);
    const texOptions = (cur) => [el('option', { value: '', selected: !cur ? true : null }, 'its own texture')].concat(TEX.list.filter(t => t.cat !== 'Roof').map(t => el('option', { value: t.id, selected: t.id === cur ? true : null }, t.cat + ' · ' + t.name)));
    // the selected object's model: openings, faces, parts, textures
    GE.renderObject = function (root, i) {
        const g = G(), e = g.entities[i], mo = GM.model(e.n); if (!mo || mo.error) return;
        const mod = modOf(e.n) || {}, users = g.entities.filter(x => x.n === e.n && !x.del).length, ed = GE.modelFor(e.n);
        root.append(el('div', { class: 'h' }, 'Its model'));
        root.append(el('div', { class: 'note' }, 'Changes here act on the model ' + e.n + (users > 1 ? ', so on all ' + users + ' objects of the project that show it' : '') + '. The export gives it a name of its own; the same model elsewhere in the world stays as it is.'));
        if (mo.frag) { root.append(el('div', { class: 'note bad' }, 'A model that breaks or moves (.yft): it can be moved, turned and deleted, not changed.')); return; }
        if (GE.err[e.n]) root.append(el('div', { class: 'note bad' }, GE.err[e.n]));
        if (GE.busy.has(e.n)) root.append(el('div', { class: 'note' }, 'Cutting the model...'));
        const md = GE.mode;
        root.append(el('div', { class: 'row wrap' },
            ...[['door', 'Cut a door'], ['window', 'Cut a window'], ['pass', 'Cut a passage']].map(t => el('button', { class: 'btn sm' + (md && md.cut === t[0] ? ' primary' : ''), onclick: () => { GE.mode = md && md.cut === t[0] ? null : { cut: t[0] }; M.UI.renderRight(); } }, t[1])),
            el('button', { class: 'btn sm' + (md && md.faces ? ' primary' : ''), onclick: () => { GE.mode = md && md.faces ? null : { faces: true }; GE.faceSel.clear(); GE.faceModel = e.n; M.UI.renderRight(); } }, 'Pick faces')));
        root.append(el('label', { class: 'chk' }, el('input', { type: 'checkbox', checked: GE.through ? true : null, onchange: (ev) => { GE.through = ev.target.checked; } }), 'Cut through every model at the spot (the wall, its decals, the building\'s outside)'));
        if (md && md.cut) root.append(el('div', { class: 'note' }, 'Click the wall of the object where the ' + ({ door: 'door', window: 'window', pass: 'passage' })[md.cut] + ' goes. Esc stops.'));
        if (md && md.faces) root.append(el('div', { class: 'note' }, 'Click faces of the object: a click takes the flat patch, Shift adds or takes away. ' + GE.faceSel.size + ' selected.'),
            el('div', { class: 'row wrap' }, el('button', { class: 'btn sm danger', disabled: GE.faceSel.size ? null : true, onclick: () => GE.deleteFaces() }, 'Take them out (X)'), (mod.deletes || []).length ? el('button', { class: 'btn sm', onclick: () => GE.restoreFaces(e.n) }, 'Put back all ' + mod.deletes.length + ' taken out') : null));
        else if ((mod.deletes || []).length) root.append(el('div', { class: 'row wrap' }, el('span', { class: 'note' }, mod.deletes.length + ' face(s) taken out'), el('button', { class: 'btn sm', onclick: () => GE.restoreFaces(e.n) }, 'Put them back')));
        (mod.cuts || []).forEach((k, n) => {
            const name = ({ door: 'Door', window: 'Window', pass: 'Passage' })[k.type] || 'Opening';
            root.append(el('div', { class: 'h', style: { margin: '10px 0 4px' } }, name + ' ' + (n + 1)));
            root.append(num('Width', k.w, 0.05, v => GE.setCut(e.n, k.id, 'w', Math.max(0.2, v)), 'm'), num('Height', k.h, 0.05, v => GE.setCut(e.n, k.id, 'h', Math.max(0.2, v)), 'm'), num('Bottom', k.zb, 0.05, v => GE.setCut(e.n, k.id, 'zb', v), 'm'), num('Depth', k.d, 0.05, v => GE.setCut(e.n, k.id, 'd', Math.max(0.05, v)), 'm'));
            root.append(el('div', { class: 'row wrap' }, el('button', { class: 'btn sm', onclick: () => GE.portalFromCut(i, k) }, 'Make a portal here'), el('button', { class: 'btn sm danger', onclick: () => GE.removeCut(e.n, k.id) }, 'Remove')));
        });
        // the parts: one per texture of the model (its most detailed level)
        root.append(el('div', { class: 'h', style: { margin: '10px 0 4px' } }, 'Parts'));
        const pl = el('div', { class: 'plist', style: { maxHeight: '220px' } }), gone = new Set(mod.parts || []);
        (ed || mo).geoms.forEach(gm => {
            const t = mod.tex && mod.tex[gm.si], off = gone.has(gm.g);
            pl.append(el('div', { class: 'pitem', style: { padding: '3px 6px', display: 'block', opacity: off ? 0.5 : 1 } },
                el('div', { class: 'row', style: { margin: 0 } }, el('span', { class: 'grow', style: { overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }, title: gm.tex + ' · ' + gm.shader }, gm.tex || '(no texture)'), el('small', null, (gm.idx.length / 3) + ' faces'),
                    el('button', { class: 'btn sm', onclick: () => GE.togglePart(e.n, gm.g) }, off ? 'Restore' : 'Remove')),
                off ? null : el('select', { class: 'grow', style: { width: '100%' }, onchange: (ev) => GE.setTex(e.n, gm.si, ev.target.value) }, ...texOptions(t && t.id)),
                off ? null : M.UI.imageButton(id => GE.setTex(e.n, gm.si, id))));
        });
        root.append(pl);
    };
    // the new rooms and portals (left panel)
    GE.renderLeft = function (root) {
        const g = G();
        root.append(el('div', { class: 'row wrap' }, num('Floor Z', GE.roomZ, 0.1, v => { GE.roomZ = r3(v); if (GE.room) GE.room.z = GE.roomZ; }, 'm'),
            num('Room height', GE.roomH, 0.1, v => { GE.roomH = Math.max(1, r3(v)); }, 'm'),
            el('button', { class: 'btn sm' + (GE.room ? ' primary' : ''), onclick: () => GE.startRoom(!GE.room) }, GE.room ? 'Stop (Esc)' : '+ Draw new room')));
        g.rooms.forEach((r, i) => {
            if (!r.new) return;
            root.append(el('div', { class: 'row' }, el('input', { type: 'text', class: 'grow', value: r.name, onchange: (ev) => GE.setRoom(i, q => { q.name = ev.target.value.replace(/[^A-Za-z0-9_]/g, '_').slice(0, 40) || q.name; }) }),
                el('input', { type: 'number', step: 0.1, style: { width: '64px' }, title: 'Height', value: r3(r.mx[2] - r.mn[2]), onchange: (ev) => { const v = parseFloat(ev.target.value); if (v > 0.5) GE.setRoom(i, q => { q.mx[2] = r3(q.mn[2] + v); }); } }),
                el('button', { class: 'btn sm danger', onclick: () => GE.removeRoom(i) }, 'X')));
        });
        const np = g.portals.map((p, j) => ({ p, j })).filter(x => x.p.new);
        if (np.length) {
            root.append(el('div', { class: 'note' }, 'New portals'));
            const opts = (cur) => g.rooms.map((r, k) => el('option', { value: k, selected: k === cur ? true : null }, r.name));
            np.forEach(x => root.append(el('div', { class: 'row' }, el('select', { class: 'grow', onchange: (ev) => GE.setPortal(x.j, q => { q.from = parseInt(ev.target.value, 10); }) }, ...opts(x.p.from)), el('span', null, '↔'),
                el('select', { class: 'grow', onchange: (ev) => GE.setPortal(x.j, q => { q.to = parseInt(ev.target.value, 10); }) }, ...opts(x.p.to)), el('button', { class: 'btn sm danger', onclick: () => GE.removePortal(x.j) }, 'X'))));
        }
    };
})(window.MLO);
