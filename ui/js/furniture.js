// Furniture: props of the game (sofas, tables, lamps, beds...) placed in the rooms. The host searches the game's model names (import/furniture-search) and sends a
// prop's model with its textures (import/furniture-models). A placement is stored with the building's rooms: shell.furniture = [{ id, n name, x, y, z, h }] in the
// grid's frame (z above the floor, h the turn in degrees). The export puts each one into the interior's room as an entity of the game's prop: the resource
// carries no model, the game already has it.
window.MLO = window.MLO || {};
(function (M) {
    'use strict';
    const { el, Model } = M, S = Model.state, bus = Model.bus, IM = M.ImportModel;
    const safe = () => encodeURIComponent(Model.safeName(S.project.name));
    const toast = (t, k) => bus.emit('toast', { text: t, kind: k });
    const r3 = (v) => Math.round(v * 1000) / 1000;
    const f2 = (v, d) => (v == null || isNaN(v)) ? '' : (+v).toFixed(d == null ? 2 : d);
    const randId = () => Math.random().toString(36).slice(2, 8);
    const api = () => M.Tools.api;
    function bytes(s) { const bin = atob(s), u = new Uint8Array(bin.length); for (let i = 0; i < bin.length; i++) u[i] = bin.charCodeAt(i); return u; }
    const f32 = (s) => new Float32Array(bytes(s).buffer);
    const u16 = (s) => new Uint16Array(bytes(s).buffer);

    const FU = M.Furniture = { results: null, query: '', busy: false, err: '', chosen: null, sel: null };
    const list = () => (S.project.kind === 'import' && S.project.shell && S.project.shell.furniture) || [];
    const byId = (id) => list().find(f => f.id === id) || null;
    const selItem = () => { const f = FU.sel ? byId(FU.sel) : null; if (!f) FU.sel = null; return f; };

    // ---------- the models: name -> { geoms: [{ pos, nrm, uv, idx, tex }], bmin, bmax } or { error } ----------
    const models = new Map(), loading = new Set(), texs = new Map();         // texs: 'fu:' + name -> { w, h, rgba } (kept here: loading the building's model empties IM.textures)
    FU.model = (n) => models.get(n) || null;
    // every piece of furniture's model read (on every floor of every building): the export needs them for the collision of the ones that carry none
    FU.whenLoaded = async function () {
        const names = []; Model.bldAll(S.project).forEach(b => Model.levelsOf(b.d).forEach(lv => ((lv.shell && lv.shell.furniture) || []).forEach(f => names.push(f.n))));
        await FU.ensure(names); for (let i = 0; i < 300 && names.some(n => !models.has(n)); i++) await new Promise(r => setTimeout(r, 100));
    };
    FU.ensure = async function (names) {
        const now = Date.now();
        const need = [...new Set(names)].filter(n => {
            const old = models.get(n);
            return !loading.has(n) && (!old || (old.error && old.retryAt && old.retryAt <= now));
        });
        if (!need.length) return;
        need.forEach(n => loading.add(n));
        try {
            const r = await Model.api('import/furniture-models?name=' + safe(), 'POST', { names: need, gta: '' }), ms = r.models || {}; if (r.serverBuild) M.UI.serverBuild = r.serverBuild;
            need.forEach(n => {
                const d = ms[n]; if (!d || d.error) { models.set(n, { error: (d && d.error) || 'not found' }); return; }
                (d.textures || []).forEach(t => texs.set('fu:' + t.name, { w: t.w, h: t.h, rgba: bytes(t.rgba) }));
                const mm = { bmin: d.bmin, bmax: d.bmax, dlc: d.dlc || '', build: d.build || 0, lights: d.lights || [], frag: !!d.frag, col: d.col !== false, colBoxes: d.colBoxes || null, geoms: d.geoms.map(g => ({ tex: (g.tex || '').toLowerCase(), pos: f32(g.pos), nrm: f32(g.nrm), uv: f32(g.uv), idx: u16(g.idx) })) }; mm.rest = restOf(mm); models.set(n, mm);
            });
        } catch (e) { need.forEach(n => models.set(n, { error: e.message, retryAt: Date.now() + 5000 })); FU.err = e.message; }
        need.forEach(n => loading.delete(n)); bake.clear(); settleOld();
        if (M.App.renderer) M.App.remesh(); M.UI.renderLeft();
    };

    // ---------- in the view: each placement's model turned and moved, as batches of the renderer (kept until it changes) ----------
    const bake = new Map();
    FU.batches = function () {
        if (S.project.kind !== 'import') return [];
        const out = [], items = list(), miss = items.map(f => f.n).filter(n => !models.has(n)); if (miss.length) FU.ensure(miss);
        texs.forEach((t, k) => { if (!IM.textures[k]) IM.textures[k] = t; });
        items.forEach(f => {
            const m = models.get(f.n); if (!m || m.error) return;
            const key = f.id + '|' + f.n + '|' + f.x + '|' + f.y + '|' + f.z + '|' + f.h; let bs = bake.get(f.id);
            if (!bs || bs.key !== key) {
                const h = (f.h || 0) * Math.PI / 180, c = Math.cos(h), s = Math.sin(h), b = [];
                m.geoms.forEach(g => {
                    const n = g.pos.length / 3, pos = new Float32Array(n * 3), nrm = new Float32Array(n * 3);
                    for (let i = 0; i < n; i++) {
                        const x = g.pos[i * 3], y = g.pos[i * 3 + 1]; pos[i * 3] = f.x + x * c - y * s; pos[i * 3 + 1] = f.y + x * s + y * c; pos[i * 3 + 2] = f.z + g.pos[i * 3 + 2];
                        const nx = g.nrm[i * 3], ny = g.nrm[i * 3 + 1]; nrm[i * 3] = nx * c - ny * s; nrm[i * 3 + 1] = nx * s + ny * c; nrm[i * 3 + 2] = g.nrm[i * 3 + 2];
                    }
                    b.push({ level: 0, kind: 'furn', group: 'furn', tex: '', imgKey: texs.has('fu:' + g.tex) ? 'fu:' + g.tex : null, flat: [0.72, 0.68, 0.62], alpha: 1, noCull: true, pos, nrm, uv: g.uv, idx: g.idx, glass: false, furn: f.id });
                });
                bs = { key, b }; bake.set(f.id, bs);
            }
            bs.b.forEach(x => out.push(x));
        });
        return out;
    };

    // ---------- geometry of a placement ----------
    // the box of a placement in the grid's frame: its corners (turned), for drawing; and the ray test in its own frame
    function corners(f, m, at) {
        const p = at || f, h = (p.h != null ? p.h : f.h || 0) * Math.PI / 180, c = Math.cos(h), s = Math.sin(h), mn = m.bmin, mx = m.bmax, out = [];
        for (const z of [mn[2], mx[2]]) for (const q of [[mn[0], mn[1]], [mx[0], mn[1]], [mx[0], mx[1]], [mn[0], mx[1]]]) out.push([p.x + q[0] * c - q[1] * s, p.y + q[0] * s + q[1] * c, p.z + z]);
        return out;
    }
    function drawBox(R, cs, col) {
        const E = [[0, 1], [1, 2], [2, 3], [3, 0], [4, 5], [5, 6], [6, 7], [7, 4], [0, 4], [1, 5], [2, 6], [3, 7]];
        E.forEach(e => R.ovTopLine(cs[e[0]], cs[e[1]], col));
    }
    function hitItem(ray) {
        let best = null;
        list().forEach(f => {
            const m = models.get(f.n); if (!m || m.error) return;
            const h = -(f.h || 0) * Math.PI / 180, c = Math.cos(h), s = Math.sin(h), ox = ray.o[0] - f.x, oy = ray.o[1] - f.y;
            const lr = { o: [ox * c - oy * s, ox * s + oy * c, ray.o[2] - f.z], d: [ray.d[0] * c - ray.d[1] * s, ray.d[0] * s + ray.d[1] * c, ray.d[2]] };
            const t = api().rayBox(lr, m.bmin, m.bmax); if (t != null && (!best || t < best.t)) best = { t, f };
        });
        return best;
    }
    // What a prop stands on. Most props of the game have their origin where they stand, so a prop that reaches no lower than that stands on its lowest point (a
    // sofa's legs, an open pot). One that reaches well under its origin either stands on feet down there (a chest of drawers or a coffee table modelled around its
    // middle) or has hidden parts under the floor (a toilet's drain, an apartment bed's), and lifting it by those makes it float: it stands on the lowest faces
    // looking down (at least 0.3 dm² of them, 2 cm steps) between its lowest point and its origin; none there, its lowest point.
    function restOf(m) {
        const lo = m.bmin[2]; if (lo >= -0.02) return lo;
        const top = Math.min(lo + 0.35, 0.02), area = new Map(), low = new Map();
        m.geoms.forEach(g => {
            const p = g.pos, ix = g.idx;
            for (let t = 0; t + 2 < ix.length; t += 3) {
                const a = ix[t] * 3, b = ix[t + 1] * 3, c = ix[t + 2] * 3, ux = p[b] - p[a], uy = p[b + 1] - p[a + 1], uz = p[b + 2] - p[a + 2], vx = p[c] - p[a], vy = p[c + 1] - p[a + 1], vz = p[c + 2] - p[a + 2];
                const nz = ux * vy - uy * vx, l = Math.hypot(uy * vz - uz * vy, uz * vx - ux * vz, nz); if (l < 1e-9 || nz / l > -0.7) continue;
                const z = (p[a + 2] + p[b + 2] + p[c + 2]) / 3; if (z > top) continue;
                const k = Math.round(z * 50); area.set(k, (area.get(k) || 0) + l / 2); low.set(k, Math.min(low.has(k) ? low.get(k) : z, z));
            }
        });
        const k = [...area.keys()].sort((x, y) => x - y).find(q => area.get(q) >= 0.003);
        return k === undefined ? lo : Math.max(lo, low.get(k));
    }
    // where a prop's origin goes so that what it stands on is on the floor
    const footZ = (m) => (m && !m.error) ? r3(-(m.rest != null ? m.rest : m.bmin[2])) : 0;
    // placements made with an older rule are put on the floor by this one once their model is known: z 0 with a model that starts above its origin (they
    // floated), or the lowest point on the floor (an apartment set that reaches under the floor floated)
    function settleOld() {
        const fix = list().filter(f => { const m = models.get(f.n); if (!m || m.error) return false; const old = (Math.abs(f.z) < 1e-6 && m.bmin[2] > 0.01) || Math.abs(f.z - r3(-m.bmin[2])) < 0.002; return old && Math.abs(f.z - footZ(m)) > 0.002; }).map(f => f.id);
        if (fix.length) Model.edit(P => { (P.shell.furniture || []).forEach(f => { if (fix.indexOf(f.id) >= 0) f.z = footZ(models.get(f.n)); }); });
    }
    FU.allOnFloor = function () { const n = list().filter(f => { const m = models.get(f.n); return m && !m.error; }).length; Model.edit(P => { (P.shell.furniture || []).forEach(f => { const m = models.get(f.n); if (m && !m.error) f.z = footZ(m); }); }); M.UI.renderLeft(); return n; };
    const snap = (v, fine) => fine ? r3(v) : Math.round(v / 0.05) * 0.05;

    // ---------- the tool ----------
    let hover = null, ground = null, drag = null, lastH = 0;
    FU.dragging = () => !!drag;
    FU.state = () => drag ? 'move' : null;
    FU.cancel = function () { if (drag) { drag = null; return true; } return false; };
    FU.choose = function (n) { FU.chosen = n; FU.ensure([n]); M.UI.renderLeft(); };
    FU.select = function (id) { FU.sel = id; M.UI.renderLeft(); };
    FU.edit = function (id, fn) { Model.edit(P => { const f = (P.shell.furniture || []).find(q => q.id === id); if (f) fn(f); }); M.UI.renderLeft(); };
    FU.remove = function (id) { Model.edit(P => { P.shell.furniture = (P.shell.furniture || []).filter(q => q.id !== id); }); if (FU.sel === id) FU.sel = null; bake.delete(id); M.UI.renderLeft(); };
    FU.turn = function (id, deg) { FU.edit(id, f => { f.h = ((Math.round(((f.h || 0) + deg) * 100) / 100) % 360 + 360) % 360; lastH = f.h; }); };
    FU.duplicate = function (id) {
        const f = byId(id); if (!f) return; const n = Object.assign({}, f, { id: randId(), x: r3(f.x + 0.5), y: r3(f.y + 0.5) });
        Model.edit(P => { P.shell.furniture.push(n); }); FU.sel = n.id; M.UI.renderLeft();
    };
    FU.place = function (n, x, y) {
        const m = models.get(n); if (!m || m.error) { toast(m && m.error ? n + ': ' + m.error : 'The model is still loading.', 'warn'); return; }
        const f = { id: randId(), n, x: r3(x), y: r3(y), z: footZ(m), h: lastH };
        Model.edit(P => { (P.shell.furniture = P.shell.furniture || []).push(f); }); FU.sel = f.id; M.UI.renderLeft();
    };
    FU.tool = {
        scan(e, ray) {
            const g = api().planeHit(ray, 0); ground = g ? { x: g.x, y: g.y, fine: !!e.shiftKey } : null;
            if (!drag) hover = hitItem(ray);
        },
        down(e) {
            if (hover) {
                const f = hover.f; FU.sel = f.id; M.UI.renderLeft();
                if (ground) drag = { id: f.id, dx: f.x - ground.x, dy: f.y - ground.y, x: f.x, y: f.y, moved: false };
                return;
            }
            if (FU.chosen && ground) { FU.place(FU.chosen, snap(ground.x, ground.fine), snap(ground.y, ground.fine)); return; }
            if (FU.sel) { FU.sel = null; M.UI.renderLeft(); }
        },
        move(e) {
            if (!drag || !ground) return;
            const x = snap(ground.x + drag.dx, e.shiftKey), y = snap(ground.y + drag.dy, e.shiftKey);
            if (x !== drag.x || y !== drag.y) { drag.x = x; drag.y = y; drag.moved = true; }
        },
        up(e, commit) {
            const d = drag; drag = null; if (!d || !commit || !d.moved) return;
            FU.edit(d.id, f => { f.x = r3(d.x); f.y = r3(d.y); });
        },
        draw(R) {
            const sel = selItem();
            if (sel) { const m = models.get(sel.n); if (m && !m.error) drawBox(R, corners(sel, m, drag && drag.id === sel.id ? { x: drag.x, y: drag.y, z: sel.z, h: sel.h } : null), [1, 0.93, 0.45, 1]); }
            if (hover && (!sel || hover.f.id !== sel.id)) { const m = models.get(hover.f.n); drawBox(R, corners(hover.f, m), [1, 1, 1, 0.9]); }
            if (drag) return { text: 'Moving ' + (byId(drag.id) || { n: '' }).n + ' · Shift: no snapping', at: null };
            if (hover) { const f = hover.f; return { text: f.n + ' · drag to move · R turns 90° · X deletes', at: [f.x, f.y, f.z + (models.get(f.n).bmax[2] || 1) + 0.25] }; }
            if (FU.chosen && ground) {
                const m = models.get(FU.chosen);
                if (m && !m.error) { const p = { x: snap(ground.x, ground.fine), y: snap(ground.y, ground.fine), z: footZ(m), h: lastH }; drawBox(R, corners(p, m, p), [0.45, 0.95, 0.6, 0.9]); return { text: 'Click: put ' + FU.chosen + ' here', at: [p.x, p.y, p.z + m.bmax[2] + 0.25] }; }
                return { text: m && m.error ? FU.chosen + ': ' + m.error : 'Loading ' + FU.chosen + '...', at: null };
            }
            return { text: list().length ? 'Click a piece of furniture to select it' : 'Search for furniture in the panel, choose one and click the floor', at: null };
        },
        key(k) {
            const sel = selItem();
            if (k === 'r' && sel) { FU.turn(sel.id, 90); return true; }
            if ((k === 'x' || k === 'Delete' || k === 'Backspace') && sel) { FU.remove(sel.id); return true; }
            if (k === 'Escape') { if (drag) { drag = null; return true; } if (sel) { FU.select(null); return true; } if (FU.chosen) { FU.chosen = null; M.UI.renderLeft(); return true; } }
            return false;
        },
        keyEv(e, k) {
            const sel = selItem();
            if (e.shiftKey && !e.ctrlKey && !e.altKey && k === 'd' && sel) { FU.duplicate(sel.id); return true; }
            if (e.shiftKey && !e.ctrlKey && !e.altKey && k === 'r' && sel) { FU.turn(sel.id, 15); return true; }
            return false;
        }
    };

    // ---------- the panel ----------
    const CATS = [['Sofa', 'sofa'], ['Chair', 'chair'], ['Table', 'table'], ['Bed', 'bed'], ['Lamp', 'lamp'], ['TV', 'tv'], ['Cabinet', 'cabinet'], ['Kitchen', 'kitchen'], ['Bathroom', 'bath'], ['Plant', 'plant'], ['Rug', 'rug'], ['Picture', 'picture']];
    FU.search = async function (q) {
        FU.query = q = (q || '').trim(); if (!q) return; FU.busy = true; FU.err = ''; M.UI.renderLeft();
        try { const r = await Model.api('import/furniture-search?name=' + safe(), 'POST', { q, gta: '' }); FU.results = r.names || []; }
        catch (e) { FU.err = e.message; FU.results = null; }
        FU.busy = false; M.UI.renderLeft();
    };
    FU.panel = function (root) {
        const nf = (label, get, set, step, unit) => el('div', { class: 'row' }, el('label', null, label), el('input', { type: 'number', class: 'grow', step, value: get(), onchange: (e) => { const v = parseFloat(e.target.value); if (!isNaN(v)) set(v); } }), unit ? el('span', { class: 'note' }, unit) : null);
        const q = el('input', { type: 'text', class: 'grow', placeholder: 'sofa, table, lamp, bett, tisch...', value: FU.query, onkeydown: (e) => { if (e.key === 'Enter') FU.search(q.value); } });
        root.append(el('div', { class: 'h' }, 'Find furniture in the game'));
        root.append(el('div', { class: 'row' }, q, el('button', { class: 'btn sm primary', disabled: FU.busy ? true : null, onclick: () => FU.search(q.value) }, FU.busy ? 'Searching...' : 'Search')));
        root.append(el('div', { class: 'row wrap' }, ...CATS.map(c => el('button', { class: 'btn sm' + (FU.query === c[1] ? ' on' : ''), onclick: () => FU.search(c[1]) }, c[0]))));
        root.append(M.UI.myPropsRow(n => FU.choose(n)));
        if (FU.busy) root.append(el('div', { class: 'note' }, 'The first search reads the game archives (about 15 seconds).'));
        if (FU.err) root.append(el('div', { class: 'note', style: { color: '#ffb3c2' } }, FU.err));
        if (FU.results) {
            root.append(el('div', { class: 'note' }, FU.results.length ? FU.results.length + (FU.results.length >= 400 ? '+' : '') + ' models. Choose one, then click the floor to put it there.' : 'No model of the game has that in its name.'));
            const box = el('div', { class: 'plist', style: { maxHeight: '220px' } });
            FU.results.forEach(n => box.append(el('div', { class: 'pitem', style: { padding: '3px 8px', background: FU.chosen === n ? 'var(--accent-soft)' : '' }, title: n, onclick: () => FU.choose(n) }, el('span', { style: { overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' } }, n))));
            root.append(box);
        }
        if (FU.chosen) {
            const m = models.get(FU.chosen);
            root.append(el('div', { class: 'note' }, 'Chosen: ', el('b', null, FU.chosen), m ? (m.error ? ' · ' + m.error : ' · ' + f2(m.bmax[0] - m.bmin[0]) + ' x ' + f2(m.bmax[1] - m.bmin[1]) + ' x ' + f2(m.bmax[2] - m.bmin[2]) + ' m') : ' · loading...'));
        }
        // the selected piece
        const sel = selItem();
        if (sel) {
            root.append(el('div', { class: 'h' }, 'Selected: ' + sel.n));
            root.append(nf('X', () => f2(sel.x), v => FU.edit(sel.id, f => { f.x = r3(v); }), '0.05', 'm'), nf('Y', () => f2(sel.y), v => FU.edit(sel.id, f => { f.y = r3(v); }), '0.05', 'm'),
                nf('Height', () => f2(sel.z), v => FU.edit(sel.id, f => { f.z = r3(v); }), '0.01', 'm'), nf('Turn', () => f2(sel.h, 1), v => FU.edit(sel.id, f => { f.h = ((v % 360) + 360) % 360; lastH = f.h; }), '15', '°'));
            root.append(el('div', { class: 'row wrap' }, el('button', { class: 'btn sm', title: 'R', onclick: () => FU.turn(sel.id, 90) }, 'Turn 90°'), el('button', { class: 'btn sm', onclick: () => FU.turn(sel.id, -15) }, '-15°'), el('button', { class: 'btn sm', title: 'Shift+R', onclick: () => FU.turn(sel.id, 15) }, '+15°'),
                el('button', { class: 'btn sm', title: 'What it stands on (its feet, its base) on the floor', onclick: () => FU.edit(sel.id, f => { f.z = footZ(models.get(f.n)); }) }, 'On the floor'),
                el('button', { class: 'btn sm', title: 'Shift+D', onclick: () => FU.duplicate(sel.id) }, 'Duplicate'), el('button', { class: 'btn sm danger', title: 'X', onclick: () => FU.remove(sel.id) }, 'Delete')));
            const bn = M.UI.buildNote(models.get(sel.n)); if (bn) root.append(bn);
            M.PropLights.panel(root, sel.n, models.get(sel.n));                 // (the lights built into it: a lamp's)
        }
        // everything placed in this building
        const items = list();
        root.append(el('div', { class: 'h' }, 'Placed (' + items.length + ')'));
        const pl = el('div', { class: 'plist', style: { maxHeight: '160px' } });
        items.forEach(f => pl.append(el('div', { class: 'pitem', style: { padding: '3px 8px', background: FU.sel === f.id ? 'var(--accent-soft)' : '' }, onclick: () => FU.select(f.id) },
            el('span', { class: 'grow', style: { overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' } }, f.n), el('span', { class: 'note' }, f2(f.x, 1) + ', ' + f2(f.y, 1)),
            el('button', { class: 'btn sm danger', onclick: (e) => { e.stopPropagation(); FU.remove(f.id); } }, 'x'))));
        if (!items.length) pl.append(el('div', { class: 'note' }, 'Nothing yet.'));
        root.append(pl);
        if (items.length) root.append(el('div', { class: 'row wrap' }, el('button', { class: 'btn sm', title: 'Put the lowest point of every piece on this floor on the floor', onclick: () => { const n = FU.allOnFloor(); toast(n + ' piece' + (n === 1 ? '' : 's') + ' put on the floor.', 'ok'); } }, 'All on the floor')));
        root.append(el('div', { class: 'note' }, 'The export places these props in the interior by name: the game already has them, the resource carries no model. Props that only some DLCs have need that DLC on the server.'));
    };
    // the export: every placement of the building being exported
    // (every floor of the building, each piece at its floor's height above the active one)
    FU.exportSpec = (P) => {
        const L = P.import && Model.levelsOf ? Model.levelsOf({ import: P.import, shell: P.shell, settings: P.settings }) : [{ z: 0, shell: P.shell }], out = [];
        L.forEach(l => ((l.shell && l.shell.furniture) || []).forEach(f => out.push({ name: f.n, x: f.x, y: f.y, z: r3(f.z + l.z), heading: f.h || 0 })));
        return out;
    };
})(window.MLO);
