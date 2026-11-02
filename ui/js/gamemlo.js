// Buildings of the game, opened in the editor: an interior of GTA V with every object as a part of its own. The project keeps what the game defines
// (project.game: its rooms, portals, objects and entity sets in the interior's own frame, read by Buildings.cs through buildings/interior); the models of
// the objects are read from the game when the project opens (buildings/models) and kept for the session. Objects can be picked, moved, turned, deleted,
// copied and added (props of the game), and the changed interior is exported as a resource that replaces the game's map types file (buildings/export).
// An object: { n model, p position, q turn (x, y, z, w), s [scaleXY, scaleZ], room, set, flags, lod, level, o its index in the game's list (-1: added),
// ch changed, del deleted }. Deleted objects stay in the list (so undo and the export know them) and are left out of the view and the export.
window.MLO = window.MLO || {};
(function (M) {
    'use strict';
    const { el, Model } = M, S = Model.state, bus = Model.bus;
    const toast = (t, k) => bus.emit('toast', { text: t, kind: k });
    const f2 = (v) => (+v).toFixed(2);
    const r3 = (v) => Math.round(v * 1000) / 1000;
    function bytes(s) { const bin = atob(s), u = new Uint8Array(bin.length); for (let i = 0; i < bin.length; i++) u[i] = bin.charCodeAt(i); return u; }
    const f32 = (s) => new Float32Array(bytes(s).buffer);
    const u16 = (s) => new Uint16Array(bytes(s).buffer);

    // textures: 'gm:' + name -> { w, h, rgba } (the renderer reads them from here); sel / hover: index of an object; room: index of the room the lists show;
    // solo: only that room's objects in the view; cut: the height above which nothing is drawn (null: off); hidden: objects hidden from the view only;
    // chosen: the prop that a click puts into the interior; found: the props a search found
    const GM = M.GameMlo = { textures: {}, active: false, dirty: false, tris: 0, sel: null, multi: new Set(), hover: null, room: null, solo: false, portals: true, roomBoxes: false, cut: null, hidden: new Set(), loading: null, failed: [],
        chosen: null, found: null, query: '', searching: false, addH: 0, exporting: false, lastExport: null, showOutside: true, outsideBusy: false };
    const G = () => S.project.game;
    // the MLO resource the project opened (its files come before the game's), or none: sent with every call that reads models or map files
    GM.source = () => { const g = G() || {}; return { src: g.src || '', snap: g.snap || '' }; };
    const models = new Map();           // model name -> { geoms: [{ tex, shader, bucket, pos, nrm, uv, idx }], bmin, bmax } or { error }
    let modelSourceKey = null, modelGeneration = 0;
    GM.syncSource = function () {
        const key = JSON.stringify(GM.source()); if (key === modelSourceKey) return false;
        modelSourceKey = key; modelGeneration++; models.clear(); GM.textures = {}; rboxes = null;
        if (M.App && M.App.renderer) M.App.renderer.resetImgTextures();
        if (M.GameEdit && M.GameEdit.reset) M.GameEdit.reset();
        return true;
    };
    GM.model = (n) => models.get(n) || null;

    // ---------- turning and moving an object's points (its turn is a quaternion x, y, z, w; its size scaleXY, scaleZ) ----------
    function qrot(q, x, y, z) {
        const qx = q[0], qy = q[1], qz = q[2], qw = q[3], tx = 2 * (qy * z - qz * y), ty = 2 * (qz * x - qx * z), tz = 2 * (qx * y - qy * x);
        return [x + qw * tx + (qy * tz - qz * ty), y + qw * ty + (qz * tx - qx * tz), z + qw * tz + (qx * ty - qy * tx)];
    }
    const qinv = (q) => [-q[0], -q[1], -q[2], q[3]];
    const qmul = (a, b) => [a[3] * b[0] + a[0] * b[3] + a[1] * b[2] - a[2] * b[1], a[3] * b[1] - a[0] * b[2] + a[1] * b[3] + a[2] * b[0], a[3] * b[2] + a[0] * b[1] - a[1] * b[0] + a[2] * b[3], a[3] * b[3] - a[0] * b[0] - a[1] * b[1] - a[2] * b[2]];
    const qz = (deg) => { const h = deg * Math.PI / 360; return [0, 0, Math.sin(h), Math.cos(h)]; };
    const qround = (q) => { const l = Math.hypot(q[0], q[1], q[2], q[3]) || 1; return q.map(v => Math.round(v / l * 1e6) / 1e6); };
    function toInterior(e, x, y, z) { const s = e.s || [1, 1], r = qrot(e.q, x * s[0], y * s[0], z * s[1]); return [r[0] + e.p[0], r[1] + e.p[1], r[2] + e.p[2]]; }
    // a point of the interior in the world (where the game puts the interior, turned by its heading)
    function toWorld(p) { const w = G().world, h = (w.heading || 0) * Math.PI / 180, c = Math.cos(h), s = Math.sin(h); return [w.x + p[0] * c - p[1] * s, w.y + p[0] * s + p[1] * c, w.z + p[2]]; }
    const headingOf = (q) => { const v = qrot(q, 1, 0, 0); return Math.round(Math.atan2(v[1], v[0]) * 1800 / Math.PI) / 10; };
    const tilted = (q) => { const v = qrot(q, 0, 0, 1); return v[2] < 0.9995; };
    function corners(e, m) {
        const out = [], a = m.bmin, b = m.bmax;
        for (const z of [a[2], b[2]]) for (const xy of [[a[0], a[1]], [b[0], a[1]], [b[0], b[1]], [a[0], b[1]]]) out.push(toInterior(e, xy[0], xy[1], z));
        return out;
    }
    const EDGES = [[0, 1], [1, 2], [2, 3], [3, 0], [4, 5], [5, 6], [6, 7], [7, 4], [0, 4], [1, 5], [2, 6], [3, 7]];

    // an object that is not the game's: added, or a copy (an object of the building outside also has no place in the interior's list, o -1, but is the game's)
    const isNew = (e) => (e.o < 0 && !e.ext) || !!e.dup;

    // ---------- which objects are in the view ----------
    function shown(i) {
        const g = G(), e = g && Array.isArray(g.entities) ? g.entities[i] : null; if (!e || e.del || GM.hidden.has(i) || (e.ext && !GM.showOutside)) return false;
        if (e.set >= 0) { const st = g.sets[e.set]; if (!st || g.setsOn.indexOf(st.name) < 0) return false; }
        if (GM.solo && GM.room != null && e.room !== GM.room) return false;
        return true;
    }
    GM.visible = (b) => b.wall != null ? M.GameWalls.visible(b) : shown(b.ent);
    GM.isShown = (i) => shown(i);
    // an object's model as it is shown: changed by gameedit.js (cut, faces taken out), or the game's
    const shownModel = (n) => (M.GameEdit && M.GameEdit.modelFor(n)) || models.get(n);
    GM.clip = () => GM.cut != null ? { cx: 0, cy: 0, r: 100000, zmax: GM.cut } : null;
    // The box of each room, from the boxes of its objects (the rooms' own boxes in the game's files often do not match where their objects stand), and of the
    // whole interior without limbo (the room for what stands outside). Before the models are read, the objects' origins.
    let rboxes = null;
    function roomBoxes() {
        if (rboxes) return rboxes; const g = G(), out = g.rooms.map(() => null), add = (i, p) => { if (i < 0 || i >= out.length) return; const b = out[i] || (out[i] = { mn: [1e9, 1e9, 1e9], mx: [-1e9, -1e9, -1e9] }); for (let a = 0; a < 3; a++) { b.mn[a] = Math.min(b.mn[a], p[a]); b.mx[a] = Math.max(b.mx[a], p[a]); } };
        g.entities.forEach(e => { if (e.del) return; const m = models.get(e.n); if (m && !m.error) corners(e, m).forEach(p => add(e.room, p)); else add(e.room, e.p); });
        g.rooms.forEach((r, i) => { if (r.new) out[i] = { mn: r.mn.slice(), mx: r.mx.slice() }; });          // (a new room is the box it was drawn as)
        return (rboxes = out);
    }
    GM.roomBox = (i) => roomBoxes()[i] || null;
    GM.bounds = function () {
        if (!GM.active) return null; const g = G(); if (!g || !Array.isArray(g.rooms) || !Array.isArray(g.entities)) return null; const mn = [1e9, 1e9, 1e9], mx = [-1e9, -1e9, -1e9];
        roomBoxes().forEach((b, i) => { if (!b || !g.rooms[i] || /limbo/i.test(g.rooms[i].name || '')) return; for (let a = 0; a < 3; a++) { mn[a] = Math.min(mn[a], b.mn[a]); mx[a] = Math.max(mx[a], b.mx[a]); } });
        if (mn[0] > mx[0]) g.entities.forEach(e => { for (let a = 0; a < 3; a++) { mn[a] = Math.min(mn[a], e.p[a]); mx[a] = Math.max(mx[a], e.p[a]); } });
        return mn[0] > mx[0] ? null : { mn, mx };
    };
    // the room a point is in: the smallest room box (not limbo) that holds it, else the room the lists show, else the first room
    GM.roomAt = (p) => roomAt(p);
    function roomAt(p) {
        const g = G(); let best = -1, vol = 1e18;
        roomBoxes().forEach((b, i) => { if (!b || /limbo/i.test(g.rooms[i].name)) return; for (let a = 0; a < 3; a++) if (p[a] < b.mn[a] - 0.05 || p[a] > b.mx[a] + 0.05) return; const v = (b.mx[0] - b.mn[0]) * (b.mx[1] - b.mn[1]) * (b.mx[2] - b.mn[2]); if (v < vol) { vol = v; best = i; } });
        if (best >= 0) return best; if (GM.room != null) return GM.room;
        const first = g.rooms.findIndex(r => !/limbo/i.test(r.name)); return first >= 0 ? first : 0;
    }
    GM.changes = function () {
        const c = { moved: 0, deleted: 0, added: 0, walls: G() ? (G().walls || []).length : 0 }; (G() ? G().entities : []).forEach(e => { if (isNew(e)) { if (!e.del) c.added++; } else if (e.del) c.deleted++; else if (e.ch) c.moved++; }); return c;
    };
    GM.statusText = () => GM.loading ? 'loading models ' + GM.loading.done + ' / ' + GM.loading.total : (GM.failed.length ? GM.failed.length + ' model' + (GM.failed.length === 1 ? '' : 's') + ' not shown' : '');

    // ---------- the objects in the view: each model turned and moved to where its object stands ----------
    // one object's model turned and moved to where it stands (ent: its index, for the view's filter)
    GM.bake = function (e, ent) {
        const out = [], m = shownModel(e.n); if (!m || m.error) return out;
        m.geoms.forEach(gm => {
            if (gm.skip) return; const nt = M.GameEdit ? M.GameEdit.texOf(e.n, gm) : null;
            const n = gm.pos.length / 3, pos = new Float32Array(n * 3), nrm = new Float32Array(n * 3);
            for (let v = 0; v < n; v++) {
                const p = toInterior(e, gm.pos[v * 3], gm.pos[v * 3 + 1], gm.pos[v * 3 + 2]), q = qrot(e.q, gm.nrm[v * 3], gm.nrm[v * 3 + 1], gm.nrm[v * 3 + 2]);
                pos[v * 3] = p[0]; pos[v * 3 + 1] = p[1]; pos[v * 3 + 2] = p[2]; nrm[v * 3] = q[0]; nrm[v * 3 + 1] = q[1]; nrm[v * 3 + 2] = q[2];
            }
            // The game's render buckets: 0 solid, 1 see-through, 2 decal (dirt, signs and overlays on walls), 3 cut-out (grilles, leaves). The see-through ones and
            // decals use their texture's alpha and are drawn after the solid ones (so decals do not flicker on their wall); glass is see-through as a whole.
            const glass = /glass/i.test(gm.shader), blend = gm.bucket === 1 || gm.bucket === 2 || /decal|alpha/i.test(gm.shader), cutout = blend || gm.bucket === 3 || /cutout/i.test(gm.shader);
            if (nt) { out.push({ level: 0, kind: 'gm', group: 'gm', tex: nt.id, imgKey: null, flat: null, alpha: 1, alphaCut: 0, noCull: true, clip: true, pos, nrm, uv: M.GameEdit.retexUv(gm, nt.tile || 1), idx: gm.idx, glass: false, ent }); return; }          // (a texture of the program)
            out.push({ level: 0, kind: 'gm', group: 'gm', tex: '', imgKey: GM.textures['gm:' + gm.tex] ? 'gm:' + gm.tex : null, flat: [0.72, 0.69, 0.64], alpha: glass ? 0.35 : (blend ? 0.999 : 1), alphaCut: cutout ? 0.3 : 0, noCull: true, clip: true, pos, nrm, uv: gm.uv, idx: gm.idx, glass: false, ent });
        });
        return out;
    };
    // the objects, then the new walls and the doors in them (gamewalls.js)
    GM.batches = function () {
        const out = []; rboxes = null;
        G().entities.forEach((e, i) => { if (!e.del) GM.bake(e, i).forEach(b => out.push(b)); });
        M.GameWalls.batches().forEach(b => out.push(b));
        GM.tris = out.reduce((a, b) => a + b.idx.length / 3, 0); return out;
    };

    // ---------- opening a project: the models of its objects are read from the game, a few at a time ----------
    GM.open = function () {
        GM.syncSource();
        if (M.GameEdit && M.GameEdit.reset) M.GameEdit.reset();
        GM.active = true; GM.sel = null; GM.hover = null; GM.room = null; GM.solo = false; GM.cut = null; GM.hidden = new Set(); GM.dirty = true; rboxes = null;
        GM.chosen = null; GM.lastExport = null; M.GameWalls.sel = null; M.GameWalls.drawing = false;
        G().entities.forEach((e, i) => { if (e.o == null) e.o = i; });            // (projects made before objects could change: each one is still the game's)
        if (!G().walls) G().walls = [];
        load(G());
    };
    GM.close = function () { GM.active = false; modelGeneration++; GM.sel = null; GM.hover = null; GM.loading = null; GM.chosen = null; if (M.App.renderer) M.App.renderer.setModelBatches([]); };
    GM.fetchModels = (names) => fetchModels(names).then(() => { GM.dirty = true; M.App.remesh(); });
    async function fetchModels(names) {
        GM.syncSource();
        const generation = modelGeneration, sourceKey = JSON.stringify(GM.source()), projectName = S.project.name, source = GM.source();
        const have = Object.keys(GM.textures).map(k => k.slice(3));
        const r = await Model.api('buildings/models', 'POST', Object.assign({ names, have, gta: '' }, source));
        if (generation !== modelGeneration || projectName !== S.project.name || !GM.active || sourceKey !== JSON.stringify(GM.source())) return false;
        if (r.ok === false) throw new Error(r.error); if (r.serverBuild) M.UI.serverBuild = r.serverBuild;
        names.forEach(n => {
            const d = (r.models || {})[n]; if (!d || d.error) { models.set(n, { error: (d && d.error) || 'not found' }); return; }
            (d.textures || []).forEach(t => { GM.textures['gm:' + t.name] = { w: t.w, h: t.h, rgba: bytes(t.rgba) }; });
            // (dirt and shadow decals are masks, not pictures: drawn as colour they are white smears, so they are left out of the view)
            models.set(n, { bmin: d.bmin, bmax: d.bmax, dlc: d.dlc || '', build: d.build || 0, lights: d.lights || [], frag: !!d.frag, geoms: d.geoms.map(x => ({ tex: (x.tex || '').toLowerCase(), shader: x.shader || '', bucket: x.bucket || 0, g: x.g, si: x.si, skip: /decal_dirt|decal_shadow|shadow_only/i.test(x.shader || ''), pos: f32(x.pos), nrm: f32(x.nrm), uv: f32(x.uv), idx: u16(x.idx) })) });
        });
        return true;
    }
    // One reading at a time: a call while one runs (the building loaded while the interior's models are still coming) is done after it, with what is missing then.
    let reading = false, again = false;
    async function load() {
        if (reading) { again = true; return; }
        reading = true;
        try { do { again = false; await loadOnce(G()); } while (again && S.project.kind === 'game'); }
        finally { reading = false; }
    }
    async function loadOnce(g) {
        const generation = modelGeneration, sourceKey = JSON.stringify(GM.source());
        const doorNames = (g.walls || []).reduce((a, w) => a.concat((w.ops || []).filter(o => o.door).map(o => o.door)), []);
        const names = [...new Set(g.entities.map(e => e.n).concat(doorNames))], need = names.filter(n => !models.has(n));
        GM.failed = names.filter(n => models.has(n) && models.get(n).error);
        if (!need.length) { GM.loading = null; GM.dirty = true; return; }
        GM.loading = { done: 0, total: need.length }; M.UI.renderLeft(); const pname = S.project.name;
        for (let i = 0; i < need.length; i += 12) {
            const part = need.slice(i, i + 12);
            try { await fetchModels(part); } catch (e) {
                if (generation !== modelGeneration || sourceKey !== JSON.stringify(GM.source()) || S.project.kind !== 'game' || S.project.name !== pname) return;
                part.forEach(n => models.set(n, { error: e.message }));
            }
            if (generation !== modelGeneration || sourceKey !== JSON.stringify(GM.source()) || S.project.kind !== 'game' || S.project.name !== pname) return; // stale project/source response
            GM.loading.done = Math.min(need.length, i + part.length); GM.dirty = true;
            GM.failed = names.filter(n => models.has(n) && models.get(n).error);
            M.App.remesh(); M.UI.renderLeft();
        }
        GM.loading = null; M.GameEdit.refreshAll(); M.App.remesh();
        // the ceilings hide everything from above: the view starts cut 2.3 m over the floor of the room with the most objects
        if (GM.cut == null) { let best = -1, n = -1; g.rooms.forEach((r, i) => { const c = g.entities.filter(e => e.room === i).length; if (c > n && !/limbo/i.test(r.name) && GM.roomBox(i)) { n = c; best = i; } }); if (best >= 0) GM.cut = Math.round((GM.roomBox(best).mn[2] + 2.3) * 20) / 20; }
        M.UI.renderLeft(); M.UI.renderRight();
        if (GM.failed.length) toast(GM.failed.length + ' of ' + names.length + ' models could not be shown (see the list on the right).', 'warn');
    }

    // ---------- picking: the nearest face under the pointer (an object's box first, then its triangles) ----------
    function rayTris(r, m, tmax, ok) {
        let best = null; const o = r.o, d = r.d; r.hit = null;
        m.geoms.forEach((g, gi) => {
            if (g.skip) return; const p = g.pos, ix = g.idx;
            for (let t = 0; t + 2 < ix.length; t += 3) {
                const a = ix[t] * 3, b = ix[t + 1] * 3, c = ix[t + 2] * 3;
                const e1x = p[b] - p[a], e1y = p[b + 1] - p[a + 1], e1z = p[b + 2] - p[a + 2], e2x = p[c] - p[a], e2y = p[c + 1] - p[a + 1], e2z = p[c + 2] - p[a + 2];
                const px = d[1] * e2z - d[2] * e2y, py = d[2] * e2x - d[0] * e2z, pz = d[0] * e2y - d[1] * e2x, det = e1x * px + e1y * py + e1z * pz;
                if (Math.abs(det) < 1e-12) continue; const inv = 1 / det;
                const sx = o[0] - p[a], sy = o[1] - p[a + 1], sz = o[2] - p[a + 2], u = (sx * px + sy * py + sz * pz) * inv; if (u < 0 || u > 1) continue;
                const qx = sy * e1z - sz * e1y, qy = sz * e1x - sx * e1z, qz2 = sx * e1y - sy * e1x, v = (d[0] * qx + d[1] * qy + d[2] * qz2) * inv; if (v < 0 || u + v > 1) continue;
                const tt = (e2x * qx + e2y * qy + e2z * qz2) * inv; if (tt <= 1e-4 || tt >= tmax || (best != null && tt >= best) || !ok(tt)) continue;
                best = tt; r.hit = { gi, tri: t / 3, n: [e1y * e2z - e1z * e2y, e1z * e2x - e1x * e2z, e1x * e2y - e1y * e2x] };
            }
        });
        return best;
    }
    // { i: the object, pt: where the ray meets it } or null
    function pick(ray) {
        const g = G(), rayBox = M.Tools.api.rayBox, ok = (t) => GM.cut == null || ray.o[2] + ray.d[2] * t <= GM.cut; let best = null;
        g.entities.forEach((e, i) => {
            if (!shown(i)) return; const m = shownModel(e.n); if (!m || m.error) return;
            const s = e.s || [1, 1], qi = qinv(e.q), o = qrot(qi, ray.o[0] - e.p[0], ray.o[1] - e.p[1], ray.o[2] - e.p[2]), d = qrot(qi, ray.d[0], ray.d[1], ray.d[2]);
            const lr = { o: [o[0] / s[0], o[1] / s[0], o[2] / s[1]], d: [d[0] / s[0], d[1] / s[0], d[2] / s[1]] };      // (the same t along the ray in both frames)
            const tb = rayBox(lr, m.bmin, m.bmax); if (tb == null || (best && tb >= best.t)) return;
            const t = rayTris(lr, m, best ? best.t : Infinity, ok); if (t != null) { const nl = qrot(e.q, lr.hit.n[0] / s[0], lr.hit.n[1] / s[0], lr.hit.n[2] / s[1]), l = Math.hypot(nl[0], nl[1], nl[2]) || 1; best = { t, i, gi: lr.hit.gi, tri: lr.hit.tri, nrm: nl.map(v => v / l) }; }
        });
        const w = M.GameWalls.pick(ray, ok);
        if (w && (!best || w.t < best.t)) return { wall: w.wall, pt: w.pt };
        return best ? { i: best.i, gi: best.gi, tri: best.tri, nrm: best.nrm, pt: [ray.o[0] + ray.d[0] * best.t, ray.o[1] + ray.d[1] * best.t, ray.o[2] + ray.d[2] * best.t] } : null;
    }
    GM.pickAny = (ray) => pick(ray);

    // ---------- selecting and looking ----------
    GM.selected = function () { return GM.multi.size ? [...GM.multi] : (GM.sel == null ? [] : [GM.sel]); };
    GM.select = function (i, additive) {
        if (additive && i != null) {
            if (GM.multi.size === 0 && GM.sel != null) GM.multi.add(GM.sel);
            if (GM.multi.has(i)) GM.multi.delete(i); else GM.multi.add(i);
            GM.sel = GM.multi.size ? i : null;
        } else { GM.multi.clear(); GM.sel = i; }
        if (i != null && M.GameWalls) M.GameWalls.sel = null;
        if (i != null && G().entities[i]) { const r = G().entities[i].room; if (r >= 0 && GM.room != null && GM.room !== r) GM.room = r; }
        M.UI.renderLeft(); M.UI.renderRight();
    };
    GM.look = function (i) {
        const e = G().entities[i], m = e && models.get(e.n), c = M.App.renderer.camera; if (!e) return;
        let mid = e.p, size = 1; if (m && !m.error) { const cs = corners(e, m), mn = [1e9, 1e9, 1e9], mx = [-1e9, -1e9, -1e9]; cs.forEach(p => { for (let a = 0; a < 3; a++) { mn[a] = Math.min(mn[a], p[a]); mx[a] = Math.max(mx[a], p[a]); } }); mid = [(mn[0] + mx[0]) / 2, (mn[1] + mx[1]) / 2, (mn[2] + mx[2]) / 2]; size = Math.max(mx[0] - mn[0], mx[1] - mn[1], mx[2] - mn[2]); }
        c.target = mid.slice(); c.dist = Math.max(2.5, size * 2.2); M.App.refreshGrid();
    };
    GM.hide = function (i) { if (i == null) return; GM.hidden.add(i); if (GM.sel === i) GM.sel = null; M.UI.renderLeft(); M.UI.renderRight(); };
    GM.showAll = function () { GM.hidden.clear(); M.UI.renderLeft(); M.UI.renderRight(); };

    // ---------- changing objects (each one step of undo) ----------
    function change(fn) { if (Model.edit(fn)) GM.dirty = true; M.UI.renderLeft(); M.UI.renderRight(); }
    GM.change = change;
    GM.edit = function (i, fn) { change(P => { const e = P.game.entities[i]; if (!e) return; fn(e); e.ch = true; }); };
    GM.move = (i, p) => GM.edit(i, e => { e.p = p.map(r3); });
    GM.turn = (i, deg) => GM.edit(i, e => { e.q = qround(qmul(qz(deg), e.q)); });
    GM.setHeading = (i, deg) => { const e = G().entities[i]; if (e) GM.turn(i, deg - headingOf(e.q)); };
    GM.setRoom = (i, room) => GM.edit(i, e => { e.room = room; });
    GM.remove = function (i) {
        const ids = i == null ? GM.selected() : [i]; if (!ids.length) return;
        change(P => ids.forEach(k => { const e = P.game.entities[k]; if (e) { e.del = true; e.ch = true; } }));
        ids.forEach(k => GM.multi.delete(k)); if (ids.indexOf(GM.sel) >= 0) GM.sel = null;
        M.UI.renderLeft(); M.UI.renderRight();
    };
    GM.restore = (i) => GM.edit(i, e => { delete e.del; });
    // a copy half a metre aside: it keeps the game's entry of the object it copies (lights and the like), as a new one
    GM.duplicate = function (i) {
        const e0 = G().entities[i]; if (!e0) return; let ni = -1;
        change(P => { const c = JSON.parse(JSON.stringify(P.game.entities[i])); c.p = [r3(c.p[0] + 0.5), r3(c.p[1] + 0.5), c.p[2]]; c.ch = true; c.dup = true; delete c.del; P.game.entities.push(c); ni = P.game.entities.length - 1; });
        if (ni >= 0) GM.select(ni);
    };
    GM.duplicateSelected = function (dz, aside) {
        const ids = GM.selected(), made = []; if (!ids.length) return;
        change(P => ids.forEach(i => {
            const e = P.game.entities[i]; if (!e || e.del) return;
            const c = JSON.parse(JSON.stringify(e)); c.p = [r3(c.p[0] + (aside ? 0.5 : 0)), r3(c.p[1] + (aside ? 0.5 : 0)), r3(c.p[2] + dz)]; c.ch = true; c.dup = true; delete c.del;
            P.game.entities.push(c); made.push(P.game.entities.length - 1);
        }));
        GM.multi = new Set(made); GM.sel = made.length ? made[made.length - 1] : null;
        M.UI.renderLeft(); M.UI.renderRight();
    };
    // a prop of the game put into the interior: standing on the point, turned by addH, in the room the point is in
    GM.place = function (n, pt) {
        const m = models.get(n); if (!m || m.error) { toast(m && m.error ? n + ': ' + m.error : 'The model is still loading.', 'warn'); return; }
        const room = roomAt(pt); let ni = -1;
        change(P => { P.game.entities.push({ n, p: [r3(pt[0]), r3(pt[1]), r3(pt[2] - m.bmin[2])], q: qround(qz(GM.addH)), s: [1, 1], room, set: -1, flags: 1572864, lod: -1, level: 'ORPHANHD', o: -1, ch: true }); ni = P.game.entities.length - 1; });
        if (ni >= 0) GM.select(ni);
    };
    GM.choose = async function (n) {
        GM.chosen = n; GM.sel = null; M.UI.renderLeft(); M.UI.renderRight();
        if (!models.has(n)) { try { await fetchModels([n]); } catch (e) { models.set(n, { error: e.message }); } M.UI.renderLeft(); }
    };
    // ---------- the building round the interior: the objects the game's map files place there, edited like the interior's and written back into those files ----------
    GM.loadOutside = async function () {
        const g = G(), b = GM.bounds(); if (!g || !b || GM.outsideBusy) return;
        GM.outsideBusy = true; M.UI.renderLeft();
        try {
            const r = await Model.api('buildings/outside', 'POST', Object.assign({ world: g.world, mn: b.mn, mx: b.mx, margin: 6, gta: '' }, GM.source())); if (r.ok === false) throw new Error(r.error);
            const have = new Set(g.entities.filter(e => e.ext).map(e => e.ext[0].y + ':' + e.ext[0].i)), add = (r.entities || []).filter(e => !have.has(e.ext[0].y + ':' + e.ext[0].i));
            change(P => { add.forEach(e => P.game.entities.push(e)); });
            GM.showOutside = true; toast(add.length ? 'The building: ' + add.length + ' objects of the map round the interior. Their models are read now.' : 'No more objects of the map round the interior.', 'ok');
            load(G());
        } catch (e) { toast('Could not read the building: ' + e.message, 'err'); }
        GM.outsideBusy = false; M.UI.renderLeft();
    };
    // the building's objects out of the project again (the changed ones stay, unless all)
    GM.removeOutside = function (all) {
        change(P => { P.game.entities = P.game.entities.filter((e, i) => !e.ext || (!all && (e.ch || e.del || e.dup))); });
        GM.sel = null; GM.hidden.clear(); if (GM.room === -2) GM.room = null; M.UI.renderLeft(); M.UI.renderRight();
    };
    GM.search = async function (q) {
        GM.query = q = (q || '').trim(); if (!q) return; GM.searching = true; M.UI.renderLeft();
        try { const r = await Model.api('import/furniture-search?name=' + encodeURIComponent(Model.safeName(S.project.name) || 'game'), 'POST', Object.assign({ q, gta: '' }, GM.source())); GM.found = r.names || []; }
        catch (e) { GM.found = []; toast(e.message, 'err'); }
        GM.searching = false; M.UI.renderLeft();
    };

    // ---------- the tool: click selects, dragging the selected object moves it on the level where it was grabbed, a click with a chosen prop puts it there ----------
    let downAt = null, lastPick = 0, drag = null, ghost = null;
    const snapD = (v, fine) => fine ? r3(v) : Math.round(v / 0.05) * 0.05;
    const GW = () => M.GameWalls, GE = () => M.GameEdit;
    GM.tool = {
        down(e) {
            downAt = [e.clientX, e.clientY]; drag = null; if (GW().drawing) { GW().tool.down(e); return; }
            if (GE().room) { GE().roomTool.down(e); return; }
            if (GM.chosen || GM.loading || GE().mode || (GM.sel == null && !GW().sel)) return;
            const ray = M.Tools.api.pointerRay(e), h = pick(ray); if (!h) return;
            if (h.wall && h.wall === GW().sel) { drag = { wall: h.wall, z: h.pt[2], from: h.pt, dx: 0, dy: 0, moved: false }; return; }
            if (h.i == null || h.i !== GM.sel) return;
            const ob = G().entities[GM.sel]; drag = { i: GM.sel, z: h.pt[2], from: h.pt, p0: ob.p.slice(), p: ob.p.slice(), moved: false };
        },
        move(e) {
            const ray = M.Tools.api.pointerRay(e);
            if (GW().drawing) { GW().tool.move(e); return; }
            if (GE().room) { GE().roomTool.move(e); return; }
            if (drag) {
                const g = M.Tools.api.planeHit(ray, drag.z); if (!g) return;
                const dx = snapD(g.x - drag.from[0], e.shiftKey), dy = snapD(g.y - drag.from[1], e.shiftKey);
                if (drag.wall) { if (dx !== drag.dx || dy !== drag.dy) { drag.dx = dx; drag.dy = dy; drag.moved = true; } return; }
                const p = [r3(drag.p0[0] + dx), r3(drag.p0[1] + dy), drag.p0[2]]; if (p[0] !== drag.p[0] || p[1] !== drag.p[1]) { drag.p = p; drag.moved = true; }
                return;
            }
            const now = performance.now(); if (now - lastPick < 40 || GM.loading) return; lastPick = now;
            const h = pick(ray); GM.hover = h && h.i != null ? h.i : null; GM.hoverWall = h && h.wall ? h.wall : null;
            ghost = GM.chosen && h ? h.pt : (GM.chosen ? (() => { const p = M.Tools.api.planeHit(ray, GM.bounds() ? GM.bounds().mn[2] : 0); return p ? [p.x, p.y, GM.bounds() ? GM.bounds().mn[2] : 0] : null; })() : null);
        },
        up(e, commit) {
            if (GW().drawing) { GW().tool.up(e); return; }
            if (GE().room) { GE().roomTool.up(e); return; }
            const d = drag; drag = null; const click = downAt && Math.hypot(e.clientX - downAt[0], e.clientY - downAt[1]) <= 4; downAt = null;
            if (d && d.moved) { if (d.wall) GW().move(d.wall, d.dx, d.dy); else GM.move(d.i, d.p); return; }
            if (!click) return;
            const ray = M.Tools.api.pointerRay(e), h = pick(ray);
            // the model tools (gameedit.js): a click on the selected object cuts an opening there or picks its faces
            const md = GE().mode; if (md && GM.sel != null) { if (h && h.i === GM.sel) { if (md.cut) GE().cutAt(GM.sel, h, ray); else GE().pickFaces(GM.sel, h, e.shiftKey); } return; }
            if (GM.chosen) { const pt = h ? h.pt : ghost; if (pt) GM.place(GM.chosen, pt); return; }
            if (h && h.wall) { GW().select(h.wall); return; }
            GW().sel = null; GM.select(h ? h.i : null, !!e.shiftKey);
        },
        draw(R, label) {
            const g = G(); if (!GM.active || !g) { label(null); return; }
            const W = GW(), wallOf = (id) => (g.walls || []).find(w => w.id === id);
            if (W.drawing) { W.tool.draw(R, label); return; }
            if (GE().room) { GE().roomTool.draw(R, label); return; }
            GE().drawCuts(R); GE().drawFaces(R);
            if (drag && drag.wall) { const w = wallOf(drag.wall); if (w) { const at = W.outline(R, Object.assign({}, w, { a: [w.a[0] + drag.dx, w.a[1] + drag.dy], b: [w.b[0] + drag.dx, w.b[1] + drag.dy] }), [0.45, 0.95, 0.6, 1], true); label('Moving the wall · ' + f2(drag.dx) + ', ' + f2(drag.dy) + ' m · Shift: no snapping', at); } return; }
            if (W.sel) { const w = wallOf(W.sel); if (w) W.outline(R, w, [1, 0.93, 0.45, 1], true); }
            if (GM.portals) g.portals.forEach(p => {
                const c = p.corners; if (!c || c.length < 4) return;
                R.ovQuad(c[0], c[1], c[2], c[3], [0.35, 0.75, 1, 0.12]); for (let k = 0; k < 4; k++) R.ovLine(c[k], c[(k + 1) % 4], [0.45, 0.8, 1, 0.8]);
            });
            g.rooms.forEach((r, i) => {
                const rb = GM.roomBox(i); if (!rb || !(GM.roomBoxes || GM.room === i) || /limbo/i.test(r.name)) return; const a = rb.mn, b = rb.mx, col = GM.room === i ? [1, 0.75, 0.3, 0.95] : [0.6, 0.9, 0.6, 0.6];
                const cs = []; for (const z of [a[2], b[2]]) for (const xy of [[a[0], a[1]], [b[0], a[1]], [b[0], b[1]], [a[0], b[1]]]) cs.push([xy[0], xy[1], z]);
                EDGES.forEach(ed => (GM.room === i ? R.ovTopLine : R.ovLine).call(R, cs[ed[0]], cs[ed[1]], col));
            });
            const boxOf = (e, col, top) => { const m = e && models.get(e.n); if (!m || m.error) return null; const cs = corners(e, m); EDGES.forEach(ed => (top ? R.ovTopLine : R.ovLine).call(R, cs[ed[0]], cs[ed[1]], col)); return cs; };
            const topOf = (cs) => { const t = cs.reduce((a, p) => p[2] > a[2] ? p : a, cs[0]); return [t[0], t[1], t[2] + 0.2]; };
            if (drag) {
                const e = g.entities[drag.i], cs = boxOf(Object.assign({}, e, { p: drag.p }), [0.45, 0.95, 0.6, 1], true);
                label(cs ? 'Moving ' + e.n + ' · ' + f2(drag.p[0] - drag.p0[0]) + ', ' + f2(drag.p[1] - drag.p0[1]) + ' m · Shift: no snapping' : null, cs ? topOf(cs) : null); return;
            }
            if (GM.chosen) {
                const m = models.get(GM.chosen);
                if (ghost && m && !m.error) { const cs = boxOf({ n: GM.chosen, p: [ghost[0], ghost[1], ghost[2] - m.bmin[2]], q: qz(GM.addH), s: [1, 1] }, [0.45, 0.95, 0.6, 0.9], true); label('Click: put ' + GM.chosen + ' here · R turns it · Esc stops', topOf(cs)); return; }
                label(m && m.error ? GM.chosen + ': ' + m.error : (m ? null : 'Loading ' + GM.chosen + '...'), null); return;
            }
            GM.selected().forEach(i => boxOf(g.entities[i], [1, 0.93, 0.45, 1], true));
            if (GM.hover != null && GM.hover !== GM.sel) {
                const e = g.entities[GM.hover], cs = boxOf(e, [1, 1, 1, 0.9], false);
                if (cs) { label(e.n + (e.room >= 0 && g.rooms[e.room] ? ' · ' + g.rooms[e.room].name : '') + (GM.hover === GM.sel ? '' : ''), topOf(cs)); return; }
            }
            if (GM.sel != null && GM.hover === GM.sel) { const e = g.entities[GM.sel], m = models.get(e.n); if (m && !m.error) { label(e.n + ' · drag to move · R turns · X deletes', topOf(corners(e, m))); return; } }
            if (GM.hoverWall) { const w = wallOf(GM.hoverWall); if (w) { const at = GM.hoverWall === W.sel ? W.outline(R, w, [1, 0.93, 0.45, 1], true) : W.outline(R, w, [1, 1, 1, 0.9], false); label(GM.hoverWall === W.sel ? 'Drag to move the wall · X deletes it' : 'New wall · ' + ((g.rooms[w.room] || {}).name || ''), at); return; } }
            label(null);
        },
        key(k) {
            const W = GW();
            if (k === 'Escape') {
                if (GE().room) { GE().startRoom(false); return true; }
                if (GE().mode) { GE().mode = null; M.UI.renderRight(); return true; }
                if (W.drawing) { if (!W.tool.cancel()) W.startDrawing(false); return true; }
                if (drag) { drag = null; return true; } if (GM.chosen) { GM.chosen = null; ghost = null; M.UI.renderLeft(); return true; }
                if (W.sel) { W.select(null); return true; } if (GM.sel != null) { GM.select(null); return true; } return false;
            }
            if (W.sel && (k === 'x' || k === 'Delete' || k === 'Backspace')) { W.remove(W.sel); return true; }
            if (GE().mode && GE().mode.faces && (k === 'x' || k === 'Delete' || k === 'Backspace')) { GE().deleteFaces(); return true; }
            if (k === 'r' && GM.chosen) { GM.addH = (GM.addH + 90) % 360; return true; }
            if (GM.sel != null) {
                if (k === 'h') { GM.selected().forEach(i => GM.hide(i)); return true; }
                if (k === 'f') { GM.look(GM.sel); return true; }
                if (k === 'r') { GM.turn(GM.sel, 90); return true; }
                if (k === 'x' || k === 'Delete' || k === 'Backspace') { GM.remove(); return true; }
            }
            return /^[0-9xp]$/.test(k);                                     // (the build tools' keys do nothing here)
        },
        keyEv(e, k) {
            if (e.altKey && !e.ctrlKey && k === 'h') { GM.showAll(); return true; }
            if (GM.sel == null || e.ctrlKey || e.altKey) return false;
            if (e.shiftKey && k === 'r') { GM.turn(GM.sel, 15); return true; }
            if (e.shiftKey && k === 'd') { GM.duplicateSelected(0, true); return true; }
            if (k === 'PageUp' || k === 'PageDown') { const ob = G().entities[GM.sel], dz = (k === 'PageUp' ? 1 : -1) * (e.shiftKey ? 0.01 : 0.05); GM.move(GM.sel, [ob.p[0], ob.p[1], ob.p[2] + dz]); return true; }
            return false;
        },
        cancelTransform() { if (GW().drawing && GW().tool.cancel()) return true; if (drag) { drag = null; return true; } return false; },
        state: () => drag ? (drag.wall ? 'wall' : 'move') : (GW().drawing ? (GW().tool.busy() ? 'drawing' : 'draw') : null)
    };

    // ---------- export: a resource with the game's map types file, changed ----------
    GM.export = async function () {
        const P = S.project; if (GM.exporting) return; GM.exporting = true; GM.lastExport = null; M.UI.renderRight();
        try {
            await Model.save();
            // the new walls (a model per room, its textures) and the doors in their openings (objects of the game, like the added ones)
            const wd = M.GameWalls.exportData(), ed = M.GameEdit.exportData(), game = Object.assign({}, P.game, { ambient: P.export.ambient || 'normal', entities: P.game.entities.concat(wd.doors), wallGroups: wd.wallGroups, wallTextures: wd.wallTextures, mods: ed.mods, modTextures: ed.modTextures });
            const r = await Model.api('buildings/export', 'POST', { game, resource: P.export.resource || defaultResource(), outDir: P.export.outDir || '', gta: '' });
            if (r.ok === false) throw new Error(r.error);
            GM.lastExport = r; toast((r.own ? 'Saved into ' : 'Exported ') + r.resource + ' (' + r.objects + ' objects).', 'ok');
        } catch (e) { GM.lastExport = { error: e.message }; toast('Export failed: ' + e.message, 'err'); }
        GM.exporting = false; M.UI.renderRight();
    };
    const defaultResource = () => ('mlo_' + (G().name || 'interior') + '_edit').toLowerCase().replace(/[^a-z0-9_]+/g, '_');

    // ---------- the live editor in FiveM (fivem/mlo_creator_live, LiveBridge.cs): send the project to the server, take the changes made in the game ----------
    GM.liveBusy = false; GM.liveNote = null;
    const liveName = () => (S.project.name || 'project').toLowerCase().replace(/[^a-z0-9]+/g, '_').replace(/^_+|_+$/g, '').slice(0, 40) || 'project';
    async function liveCall(what, body) {
        if (GM.liveBusy) return null; GM.liveBusy = true; GM.liveNote = null; M.UI.renderRight();
        try { const r = await Model.api('live/' + what, 'POST', Object.assign({ outDir: S.project.export.outDir || '', gta: '' }, body || {})); return r; }
        catch (e) { return { ok: false, error: e.message }; }
        finally { GM.liveBusy = false; }
    }
    GM.liveInstall = async function () { const r = await liveCall('install'); GM.liveNote = r && r.ok ? { ok: 'The live editor is in ' + r.dir + '. In server.cfg: ensure mlo_creator_live and add_ace group.admin mlocreator.live allow' } : { bad: r ? r.error : '' }; M.UI.renderRight(); };
    GM.liveSend = async function (force) {
        // every object gets an id of its own first (the game's changes come back by it)
        Model.edit(P => { P.game.entities.forEach(e => { if (!e.lid) e.lid = 'e' + Math.random().toString(36).slice(2, 10); }); });
        await Model.save();
        const r = await liveCall('send', { game: S.project.game, project: S.project.name, force: !!force });
        if (r && r.ok) GM.liveNote = { ok: 'Sent: ' + r.objects + ' objects. In the game: /mlolive ' + r.name + ' (or /mlolive ' + r.name + ' reload when it is open).' };
        else if (r && r.dirty) GM.liveNote = { bad: r.error, dirty: true };
        else GM.liveNote = { bad: r ? r.error : '' };
        M.UI.renderRight();
    };
    // the game's changes into the project: moved and turned objects, deleted ones (and back), the copies and props added in the game
    GM.liveTake = async function () {
        const r = await liveCall('take', { project: S.project.name }); if (!r || !r.ok) { GM.liveNote = { bad: r ? r.error : '' }; M.UI.renderRight(); return; }
        const w = G().world, h = (w.heading || 0) * Math.PI / 180, c = Math.cos(h), sn = Math.sin(h), qh = qz(-(w.heading || 0));
        const local = (le) => { const dx = le.x - w.x, dy = le.y - w.y; return { p: [r3(dx * c + dy * sn), r3(-dx * sn + dy * c), r3(le.z - w.z)], q: qround(qmul(qh, [le.qx, le.qy, le.qz, le.qw])) }; };
        let moved = 0, deleted = 0, added = 0, back = 0;
        change(P => {
            const byLid = new Map(P.game.entities.map(e => [e.lid, e]));
            (r.entities || []).forEach(le => {
                const e = byLid.get(le.id), L = local(le);
                if (!e) {
                    if (le.game || le.del) return;
                    P.game.entities.push({ n: le.n, p: L.p, q: L.q, s: [1, 1], room: roomAt(L.p), set: -1, flags: 1572864, lod: -1, level: 'ORPHANHD', o: -1, ch: true, lid: le.id }); added++; return;
                }
                if (le.del && !e.del) { e.del = true; deleted++; return; }
                if (!le.del && e.del) { delete e.del; back++; }
                const d = Math.abs(L.p[0] - e.p[0]) + Math.abs(L.p[1] - e.p[1]) + Math.abs(L.p[2] - e.p[2]), dq = Math.abs(Math.abs(L.q[0] * e.q[0] + L.q[1] * e.q[1] + L.q[2] * e.q[2] + L.q[3] * e.q[3]) - 1);
                if (d > 0.004 || dq > 0.00002) { e.p = L.p; e.q = L.q; e.ch = true; moved++; }
            });
        });
        GM.liveNote = { ok: 'From the game: ' + moved + ' moved or turned, ' + deleted + ' deleted, ' + back + ' brought back, ' + added + ' added.' }; M.UI.renderLeft(); M.UI.renderRight();
    };

    // ---------- panels ----------
    const roomName = (i) => { if (i === -2) return 'The building (outside)'; const r = G().rooms[i]; return r ? r.name : (i < 0 ? 'no room' : 'room ' + i); };
    GM.roomName = (i) => roomName(i);
    // ---- the tool rail of a game interior: a button per job, the panel next to it shows that job
    const GROUPS = [
        { id: 'select', name: 'Select and move', short: 'Select', icon: 'select', sub: 'Pick objects of the interior and change them in the inspector.' },
        '|',
        { id: 'add', name: 'Add an object', short: 'Add', icon: 'plus', sub: 'A model of the game or a prop of your own: choose it, then click where it goes.' },
        { id: 'walls', name: 'New walls', short: 'Walls', icon: 'wall', sub: 'Draw walls of your own, with doors, windows and passages in them.' },
        { id: 'rooms', name: 'Rooms and portals', short: 'Rooms', icon: 'rooms', sub: 'New rooms of the interior and the portals between them.' },
        { id: 'outside', name: 'The building', short: 'Outside', icon: 'outside', sub: 'The walls, roof and props of the map round the interior.' }
    ];
    GM.panel = 'select';
    GM.railGroups = () => GROUPS.map(gr => gr === '|' ? gr : Object.assign({}, gr, { on: GM.panel === gr.id, pick: () => {
        if (GM.panel === 'walls' && gr.id !== 'walls' && M.GameWalls.drawing) M.GameWalls.startDrawing(false);
        if (GM.panel === 'rooms' && gr.id !== 'rooms' && M.GameEdit.room) M.GameEdit.startRoom(false);
        GM.panel = gr.id; M.UI.renderLeft();
    } }));
    GM.renderLeft = function (root) {
        const g = G(); if (!g) return;
        const gr = GROUPS.find(x => x !== '|' && x.id === GM.panel) || GROUPS[0];
        M.Layout.toolHead(root, gr, null);
        if (gr.sub) root.append(el('div', { class: 'note what' }, gr.sub));
        if (GM.loading) root.append(el('div', { class: 'note' }, 'Reading the models of the objects from the game: ' + GM.loading.done + ' / ' + GM.loading.total + '...'));
        if (gr.id === 'add') addPanel(root);
        else if (gr.id === 'walls') M.GameWalls.renderLeft(root);
        else if (gr.id === 'rooms') M.GameEdit.renderLeft(root);
        else if (gr.id === 'outside') outsidePanel(root);
        else selectPanel(root);
    };
    function selectPanel(root) {
        const g = G(), ch = GM.changes();
        root.append(el('div', { class: 'h' }, 'Interior'));
        root.append(el('div', { class: 'note' }, el('b', null, g.name), g.place ? ' · ' + g.place : ''));
        root.append(el('div', { class: 'kv' }, 'Rooms', el('b', null, String(g.rooms.filter(r => !/limbo/i.test(r.name)).length)), 'Portals', el('b', null, String(g.portals.length)), 'Objects', el('b', null, String(g.entities.filter(e => !e.del).length)), 'Entity sets', el('b', null, String(g.sets.length)),
            'Changes', el('b', null, ch.moved + ' moved · ' + ch.deleted + ' deleted · ' + ch.added + ' added' + (ch.walls ? ' · ' + ch.walls + ' new wall' + (ch.walls === 1 ? '' : 's') : ''))));
        root.append(el('ul', { class: 'how' }, el('li', null, 'Click an object in the view (or in Scene) to select it, Shift+click adds more.'), el('li', null, 'Drag it to move it (Shift: no snapping), PageUp / PageDown raise and lower it.'), el('li', null, 'R turns it 90° (Shift+R 15°), Shift+D duplicates, X deletes, H hides, F looks at it.')));
    }
    function addPanel(root) {
        root.append(M.UI.myPropsRow(n => GM.choose(n)));
        const q = el('input', { type: 'text', class: 'grow', placeholder: 'chair, desk, locker, stuhl, tisch...', value: GM.query, onkeydown: (ev) => { if (ev.key === 'Enter') GM.search(q.value); } });
        root.append(el('div', { class: 'row' }, q, el('button', { class: 'btn sm primary', disabled: GM.searching ? true : null, onclick: () => GM.search(q.value) }, GM.searching ? 'Searching...' : 'Search')));
        if (GM.found) {
            if (!GM.found.length) root.append(el('div', { class: 'note' }, 'No model of the game has that in its name.'));
            else {
                const fl = el('div', { class: 'plist', style: { maxHeight: '150px' } });
                GM.found.forEach(n => fl.append(el('div', { class: 'pitem', style: { padding: '3px 8px', background: GM.chosen === n ? 'var(--accent-soft)' : '' }, title: n, onclick: () => GM.choose(GM.chosen === n ? null : n) }, el('span', { style: { overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' } }, n))));
                root.append(fl);
            }
        }
        if (GM.chosen) { const m = models.get(GM.chosen); root.append(el('div', { class: 'note' }, 'Chosen: ', el('b', null, GM.chosen), m ? (m.error ? ' · ' + m.error : ' · click where it goes (R turns it, Esc stops)') : ' · loading...')); }
    }
    function outsidePanel(root) {
        const g = G();
        const nOut = g.entities.filter(e => e.ext && !e.del).length;
        if (!nOut) root.append(el('div', { class: 'note' }, 'The building round the interior (its walls, roof, ground, the props the map places there) is not in the project yet. Load it to see it and change it with the interior: the export writes the map files of what you change.'));
        root.append(el('div', { class: 'row wrap' },
            el('button', { class: 'btn sm' + (nOut ? '' : ' primary'), disabled: GM.outsideBusy || GM.loading ? true : null, onclick: () => GM.loadOutside() }, GM.outsideBusy ? 'Reading the map...' : (nOut ? 'Look for more' : 'Load the building')),
            nOut ? el('span', { class: 'note' }, nOut + ' object' + (nOut === 1 ? '' : 's')) : null,
            nOut ? el('button', { class: 'btn sm', title: 'Take the building\'s objects you did not change out of the project', onclick: () => GM.removeOutside(false) }, 'Remove unchanged') : null));
        if (nOut) root.append(el('label', { class: 'chk' }, el('input', { type: 'checkbox', checked: GM.showOutside ? true : null, onchange: (e) => { GM.showOutside = e.target.checked; GM.hover = null; M.UI.renderLeft(); } }), 'Show the building'));
    }
    // the scene: the rooms, their objects, what was deleted, the entity sets
    function renderScene(root) {
        const g = G();
        const nOut = g.entities.filter(e => e.ext && !e.del).length;
        root.append(el('div', { class: 'h' }, 'Rooms'));
        const rl = el('div', { class: 'plist', style: { maxHeight: '170px' } });
        const roomRow = (i, name) => {
            const n = g.entities.filter(e => e.room === i && !e.del).length;
            rl.append(el('div', { class: 'pitem', style: { padding: '4px 8px', background: GM.room === i ? 'var(--accent-soft)' : '' }, title: 'Show the objects of this room', onclick: () => { GM.room = GM.room === i ? null : i; M.UI.renderLeft(); } },
                el('span', null, name), el('small', null, n + ' object' + (n === 1 ? '' : 's'))));
        };
        g.rooms.forEach((r, i) => roomRow(i, r.name));
        if (nOut) roomRow(-2, roomName(-2));
        root.append(rl);
        root.append(el('label', { class: 'chk' }, el('input', { type: 'checkbox', checked: GM.solo ? true : null, onchange: (e) => { GM.solo = e.target.checked; GM.hover = null; } }), 'Show only the chosen room\'s objects'));

        const list = g.entities.map((e, i) => ({ e, i })).filter(x => !x.e.del && (GM.room == null || x.e.room === GM.room));
        root.append(el('div', { class: 'h' }, GM.room != null ? 'Objects in ' + roomName(GM.room) : 'All objects'));
        const ol = el('div', { class: 'plist', style: { maxHeight: '260px' } });
        list.slice(0, 800).forEach(x => {
            const m = models.get(x.e.n), off = !shown(x.i), set = x.e.set >= 0 ? (g.sets[x.e.set] || {}).name : '', tag = isNew(x.e) ? 'added' : (x.e.ch ? 'changed' : '');
            ol.append(el('div', { class: 'pitem', style: { padding: '3px 8px', background: GM.sel === x.i || GM.multi.has(x.i) ? 'var(--accent-soft)' : '', opacity: off ? 0.5 : 1 }, title: x.e.n + (off ? ' (not in the view)' : ''), onclick: (ev) => { GM.select(x.i, ev.shiftKey); }, ondblclick: () => GM.look(x.i) },
                el('span', { style: { overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' } }, x.e.n),
                el('small', null, [m && m.error ? 'no model' : (set ? 'set ' + set : (GM.room == null ? roomName(x.e.room) : '')), tag].filter(Boolean).join(' · '))));
        });
        root.append(ol);

        const dels = g.entities.map((e, i) => ({ e, i })).filter(x => x.e.del && !isNew(x.e));
        if (dels.length) {
            root.append(el('div', { class: 'h' }, 'Deleted (' + dels.length + ')'));
            const dl = el('div', { class: 'plist', style: { maxHeight: '120px' } });
            dels.forEach(x => dl.append(el('div', { class: 'pitem', style: { padding: '3px 8px' } }, el('span', { style: { overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', textDecoration: 'line-through' } }, x.e.n),
                el('button', { class: 'btn sm', style: { marginLeft: 'auto' }, onclick: () => GM.restore(x.i) }, 'Restore'))));
            root.append(dl);
        }

        if (g.sets.length) {
            root.append(el('div', { class: 'h' }, 'Entity sets'), el('div', { class: 'note' }, 'Groups of objects the game switches on with a script (the doors open or shut, a room furnished or empty).'));
            g.sets.forEach(st => root.append(el('label', { class: 'chk' }, el('input', { type: 'checkbox', checked: g.setsOn.indexOf(st.name) >= 0 ? true : null, onchange: (e) => {
                const on = e.target.checked; Model.edit(P => { const a = P.game.setsOn.filter(x => x !== st.name); if (on) a.push(st.name); P.game.setsOn = a; }); M.UI.renderLeft();
            } }), st.name + ' (' + st.entities.length + ')')));
        }
    }

    async function copy(text, what) { try { await navigator.clipboard.writeText(text); toast('Copied ' + what + ': ' + text, 'ok'); } catch (e) { toast('Could not copy to the clipboard. Check browser permission.', 'warn'); } }
    const num = (label, value, step, set, unit) => el('div', { class: 'row' }, el('label', null, label), el('input', { type: 'number', class: 'grow', step, value, onchange: (ev) => { const v = parseFloat(ev.target.value); if (!isNaN(v)) set(v); } }), unit ? el('span', { class: 'note' }, unit) : null);
    GM.renderRight = function (root) {
        const g = G(); if (!g) return;
        const n = GM.selected().length + (M.GameWalls.sel ? 1 : 0), key = M.GameWalls.sel ? 'w' + M.GameWalls.sel : (GM.multi.size > 1 ? 'm' + GM.selected().join(',') : (GM.sel != null ? 'e' + GM.sel : null));
        M.Layout.watch(key);
        M.Layout.inspector(root, [
            { id: 'sel', label: 'Selected', badge: n ? String(n) : null, render: renderSelected },
            { id: 'scene', label: 'Scene', render: renderScene },
            { id: 'project', label: 'Project', render: renderProject }
        ]);
    };
    function renderSelected(root) {
        const g = G();
        const wallShown = M.GameWalls.renderRight(root);                       // (a selected new wall has its own panel)
        const i = GM.sel, e = i != null ? g.entities[i] : null;
        if (wallShown) { /* the wall's panel is above */ }
        else if (GM.multi.size > 1) {
        const names = GM.selected().map(k => (g.entities[k] || {}).n).filter(Boolean);
        root.append(el('div', { class: 'note' }, GM.multi.size + ' objects selected', names.some(n => /shell/i.test(n)) ? ' · shell group' : ''));
        root.append(el('div', { class: 'row wrap' },
            el('button', { class: 'btn sm danger', onclick: () => GM.remove() }, 'Delete selected')));
                } else if (e && !e.del) {
            const m = models.get(e.n), w = toWorld(e.p);
            root.append(el('div', { class: 'note' }, el('b', null, e.n), isNew(e) ? ' · added' : (e.ch ? ' · changed' : ''), e.ext ? ' · of the building outside' : ''));
            root.append(num('X', e.p[0], 0.05, v => GM.move(i, [v, e.p[1], e.p[2]]), 'm'), num('Y', e.p[1], 0.05, v => GM.move(i, [e.p[0], v, e.p[2]]), 'm'), num('Z', e.p[2], 0.05, v => GM.move(i, [e.p[0], e.p[1], v]), 'm'),
                num('Heading', headingOf(e.q), 1, v => GM.setHeading(i, v), tilted(e.q) ? '° (tilted)' : '°'));
            const rs = el('select', { class: 'grow', onchange: (ev) => GM.setRoom(i, parseInt(ev.target.value, 10)) }, ...g.rooms.map((r, k) => el('option', { value: k, selected: k === e.room ? true : null }, r.name)));
            if (e.set < 0 && !e.ext) root.append(el('div', { class: 'row' }, el('label', null, 'Room'), rs));
            if (e.ext) root.append(el('div', { class: 'note' }, 'Placed by the map file' + (e.ext.length === 1 ? ' ' : 's ') + e.ext.map(f => f.y).join(', ') + ': the export writes ' + (e.ext.length === 1 ? 'it' : 'them') + ' again with the change.'));
            root.append(el('div', { class: 'row wrap' }, el('button', { class: 'btn sm', onclick: () => GM.turn(i, 90) }, 'Turn 90° (R)'), el('button', { class: 'btn sm', onclick: () => GM.turn(i, 15) }, '15° (Shift+R)'),
                el('button', { class: 'btn sm', onclick: () => GM.duplicate(i) }, 'Duplicate (Shift+D)'), el('button', { class: 'btn sm danger', onclick: () => GM.remove(i) }, 'Delete (X)')));
            root.append(el('div', { class: 'kv' }, 'Entity set', el('b', null, e.set >= 0 ? (g.sets[e.set] || {}).name || '?' : 'none'), 'In the world', el('b', null, f2(w[0]) + ', ' + f2(w[1]) + ', ' + f2(w[2])),
                'Model size', el('b', null, m && !m.error ? f2(m.bmax[0] - m.bmin[0]) + ' x ' + f2(m.bmax[1] - m.bmin[1]) + ' x ' + f2(m.bmax[2] - m.bmin[2]) + ' m' : (m ? 'not shown' : 'loading...')),
                'LOD distance', el('b', null, String(e.lod)), 'Flags', el('b', null, String(e.flags))));
            if (m && m.error) root.append(el('div', { class: 'note bad' }, m.error));
            root.append(el('div', { class: 'row wrap' }, el('button', { class: 'btn sm', onclick: () => GM.look(i) }, 'Look at it (F)'), el('button', { class: 'btn sm', onclick: () => GM.hide(i) }, 'Hide (H)'),
                el('button', { class: 'btn sm', onclick: () => copy(e.n, 'the name') }, 'Copy name'), el('button', { class: 'btn sm', onclick: () => copy('vector3(' + w.map(f2).join(', ') + ')', 'the position') }, 'Copy position')));
            root.append(el('div', { class: 'note' }, 'Drag it in the view to move it (Shift: no snapping), PageUp / PageDown raise and lower it.'));
            M.GameEdit.renderObject(root, i);                                  // (openings, faces, parts and textures of its model)
            const bn = M.UI.buildNote(m); if (bn) root.append(bn);
            M.PropLights.panel(root, e.n, m);                                  // (the lights built into it: a lamp's)
        } else M.Layout.empty(root, 'Nothing selected. Click an object in the view or in Scene. Double-click a row to look at it.');
    }
    // the bar over the 3D view
    GM.viewItems = function () {
        const PL = M.PropLights, R = M.App.renderer, b = GM.bounds();
        const items = [{ icon: 'moon', label: 'Night', title: 'Night preview: lit by the lamps', on: PL.night, act: () => PL.setNight(!PL.night) }, '|',
            { icon: 'portal', label: 'Portals', on: GM.portals, act: () => { GM.portals = !GM.portals; } },
            { icon: 'box', label: 'Room boxes', on: GM.roomBoxes, act: () => { GM.roomBoxes = !GM.roomBoxes; } },
            { icon: 'grid', label: 'Grid', on: S.view.grid, act: () => { S.view.grid = !S.view.grid; R.showGrid = S.view.grid; } }];
        if (b) {
            const lo = Math.floor(b.mn[2] * 10) / 10, hi = Math.ceil(b.mx[2] * 10) / 10;
            items.push('|', { icon: 'cut', label: 'Cutaway', title: 'Hide what is above', on: GM.cut != null, act: () => { GM.cut = GM.cut != null ? null : Math.min(hi, lo + 2.6); } });
            if (GM.cut != null) { const val = el('span', { class: 'vl' }, f2(GM.cut) + ' m'); items.push(el('input', { type: 'range', class: 'vrange', min: lo, max: hi, step: 0.05, value: GM.cut, title: 'Cut height', oninput: (ev) => { GM.cut = parseFloat(ev.target.value); val.textContent = f2(GM.cut) + ' m'; } }), val); }
        }
        items.push('|', { icon: 'frame', label: 'Frame', title: 'Frame all (Home)', act: () => M.App.frameAll() });
        if (GM.hidden.size) items.push({ icon: 'eye', label: 'Show ' + GM.hidden.size + ' hidden', title: 'Alt+H', act: () => GM.showAll() });
        return items;
    };
    // the status bar: what is in the interior and what changed
    GM.statusItems = function () {
        const g = G(); if (!g) return null; const ch = GM.changes();
        return [el('span', { class: 'sc' }, el('b', null, g.name), ' · ' + g.rooms.filter(r => !/limbo/i.test(r.name)).length + ' rooms · ' + g.entities.filter(e => !e.del).length + ' objects'),
            el('span', { class: 'sc' }, ch.moved + ' moved · ' + ch.deleted + ' deleted · ' + ch.added + ' added')];
    };
    // the project: export, the live editor and where it is in the game
    function renderProject(root) {
        const g = G();
        // export
        const P = S.project, X = P.export, ch = GM.changes();
        root.append(el('div', { class: 'h' }, 'Export'));
        const outFiles = [...new Set(g.entities.filter(e => e.ext && (e.ch || e.del || e.dup)).reduce((a, e) => a.concat(e.ext.map(f => f.y)), []))];
        if (outFiles.length) root.append(el('div', { class: 'note' }, 'The building: ' + outFiles.length + ' map file' + (outFiles.length === 1 ? '' : 's') + ' of the game written again with your changes (' + outFiles.join(', ') + ').'));
        const counts = ch.moved + ' moved, ' + ch.deleted + ' deleted, ' + ch.added + ' added' + (ch.walls ? ', ' + ch.walls + ' new wall' + (ch.walls === 1 ? '' : 's') : '');
        if (g.src) {
            // an MLO resource opened from its folder: the changes go back into it
            root.append(el('div', { class: 'note' }, 'Saves your changes (' + counts + ') back into the resource ', el('b', null, g.src), '. Before it writes anything, the whole folder is zipped next to it (' + (g.src.split(/[\\/]/).pop()) + '_backup_<date>.zip): unzip it to go back.'));
        } else {
            root.append(el('div', { class: 'note' }, 'A resource that replaces the game\'s ' + g.ytyp + ' with your changes: ' + counts + '.'));
            root.append(el('div', { class: 'row' }, el('label', null, 'Resource'), el('input', { type: 'text', class: 'grow', value: X.resource || '', placeholder: defaultResource(), onchange: (ev) => { X.resource = ev.target.value.trim(); Model.touch(); } })));
            root.append(el('div', { class: 'row' }, el('label', null, 'Folder'), el('input', { type: 'text', class: 'grow', value: X.outDir || '', placeholder: 'the output folder of the settings', onchange: (ev) => { X.outDir = ev.target.value.trim(); Model.touch(); } })));
        }
        if (ch.walls) root.append(M.UI.ambientRow(X));
        if (g.twin) root.append(el('div', { class: 'note' }, 'The game places a second interior at the same spot (', el('b', null, g.twin), '). Only one of the two shows in the game, usually the DLC one: make your changes in that one if they do not show.'));
        root.append(el('button', { class: 'btn primary', disabled: GM.exporting || GM.loading ? true : null, onclick: () => GM.export() }, GM.exporting ? (g.src ? 'Saving...' : 'Exporting...') : (g.src ? 'Save into the resource' : 'Export resource')));
        const r = GM.lastExport;
        if (r && r.error) root.append(el('div', { class: 'note bad' }, r.error));
        else if (r) {
            root.append(el('div', { class: 'note ok' }, 'Written to ', el('b', null, r.dir)));
            if (r.backup) root.append(el('div', { class: 'note' }, 'Backup of the resource as it was: ', el('b', null, r.backup)));
            (r.log || []).forEach(l => root.append(el('div', { class: 'note' }, l)));
            (r.warnings || []).forEach(l => root.append(el('div', { class: 'note bad' }, l)));
            root.append(el('div', { class: 'row wrap' }, el('button', { class: 'btn sm', onclick: () => copy('ensure ' + r.resource, 'the line for server.cfg') }, 'Copy "ensure ' + r.resource + '"'),
                el('button', { class: 'btn sm', onclick: () => Model.api('reveal?name=' + encodeURIComponent(r.dir), 'POST').catch(() => { }) }, 'Open the folder')));
        }

        // the live editor in FiveM
        root.append(el('div', { class: 'h' }, 'Live in FiveM'));
        root.append(el('div', { class: 'note' }, 'Change the objects in the game on your server, together with this project: send it, edit it with /mlolive ' + liveName() + ' in the game, take the changes back here. (Its files go into the folder above, the server\'s resources.)'));
        root.append(el('div', { class: 'row wrap' }, el('button', { class: 'btn sm', disabled: GM.liveBusy ? true : null, onclick: () => GM.liveInstall() }, 'Install the live editor'),
            el('button', { class: 'btn sm primary', disabled: GM.liveBusy || GM.loading ? true : null, onclick: () => GM.liveSend(false) }, 'Send to FiveM'),
            el('button', { class: 'btn sm', disabled: GM.liveBusy ? true : null, onclick: () => GM.liveTake() }, 'Take the changes from FiveM')));
        if (GM.liveNote) {
            const n = GM.liveNote; root.append(el('div', { class: 'note ' + (n.ok ? 'ok' : 'bad') }, n.ok || n.bad || 'Failed.'));
            if (n.dirty) root.append(el('div', { class: 'row wrap' }, el('button', { class: 'btn sm', onclick: () => GM.liveTake() }, 'Take them'), el('button', { class: 'btn sm danger', onclick: () => GM.liveSend(true) }, 'Send anyway')));
        }

        root.append(el('div', { class: 'h' }, 'In the game'));
        const w = g.world;
        root.append(el('div', { class: 'kv' }, 'Interior', el('b', null, g.name), 'Defined in', el('b', null, g.ytyp + (g.src ? ' (in the resource)' : '')), 'Placed by', el('b', null, (g.ymaps || []).join(', ') || '?'),
            'Position', el('b', null, f2(w.x) + ', ' + f2(w.y) + ', ' + f2(w.z)), 'Heading', el('b', null, Math.round(w.heading || 0) + '°')));
        if (GM.failed.length) root.append(el('div', { class: 'note' }, GM.failed.length + ' model' + (GM.failed.length === 1 ? ' is' : 's are') + ' not shown: ', el('span', { title: GM.failed.map(n => n + ': ' + (models.get(n) || {}).error).join('\n') }, GM.failed.join(', '))));
    };
})(window.MLO);
