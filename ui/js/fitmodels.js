// Window and door models from .glb files, placed by hand with a gizmo (Models tool, key I).
// The library: every .glb of the project, split by the host into models (one per window system, or the one door). A placement ("fit") is stored in
// import.fits = [{ id, f (file), m (model id), kind, cx, cy, zb, yaw, w, d, h, hinge, open }] in the grid's coordinates: (cx, cy) is the middle of the model's
// footprint, zb its bottom, yaw the turn of its width axis u = (cos, sin), n = (-sin, cos) is the way its front faces. w, d, h are the size the user gave it.
// Nothing is cut from the building: the user deletes the wall faces himself with the Delete faces tool. A placement only opens the interior's own wall (and makes the portal).
window.MLO = window.MLO || {};
(function (M) {
    'use strict';
    const { el, Model } = M, S = Model.state, bus = Model.bus, IM = M.ImportModel;
    const imp = () => S.project.import;
    const safe = () => encodeURIComponent(Model.safeName(S.project.name));
    const toast = (t, k) => bus.emit('toast', { text: t, kind: k });
    const r3 = (v) => Math.round(v * 1000) / 1000;
    const randId = () => Math.random().toString(36).slice(2, 6);
    let idSeq = 0;
    const freshId = (items) => {
        const used = items instanceof Set ? new Set(items) : new Set((items || []).map(x => x && x.id));
        for (let i = 0; i < 8; i++) { const id = randId() + randId(); if (!used.has(id)) return id; }
        let id; do { id = 'mlo' + Date.now().toString(36) + (idSeq++).toString(36); } while (used.has(id)); return id;
    };
    const api = () => M.Tools.api;
    const IT = () => M.ImportTools;
    const f2 = (v, d) => (v == null || isNaN(v)) ? '' : (+v).toFixed(d == null ? 2 : d);
    function bytes(s) { const bin = atob(s), u = new Uint8Array(bin.length); for (let i = 0; i < bin.length; i++) u[i] = bin.charCodeAt(i); return u; }
    const f32 = (s) => new Float32Array(bytes(s).buffer);
    const u16 = (s) => new Uint16Array(bytes(s).buffer);

    const FM = M.FitModels = { lib: { files: [], byId: new Map(), busy: false, error: '', ver: 0, loaded: false }, sel: null };
    const fits = () => (S.project.kind === 'import' && imp()) ? (imp().fits || []) : [];
    const byId = (id) => fits().find(f => f.id === id) || null;
    const selFit = () => { const f = FM.sel ? byId(FM.sel) : null; if (!f) FM.sel = null; return f; };
    let thumbs = new Map(), bakeCache = new Map(), hover = { fit: null, h: null, surf: null, ray: null }, drag = null;

    // ---------- the library ----------
    FM.reset = function () { FM.lib = { files: [], byId: new Map(), busy: false, error: '', ver: (FM.lib.ver || 0) + 1, loaded: false }; thumbs = new Map(); bakeCache.clear(); FM.sel = null; FM.chosen = null; drag = null; };
    FM.kindOf = function (file) { if (file && file.startsWith('gta:')) return file.slice(4); const rec = FM.lib.files.find(x => x.file === file); return ((imp().glbKinds || {})[file]) || (rec ? rec.guess : 'window'); };
    FM.setKind = function (file, kind) { Model.edit(P => { P.import.glbKinds = P.import.glbKinds || {}; P.import.glbKinds[file] = kind; }); FM.loadLib(file); };
    FM.model = function (id) { return id && id.startsWith('gta:') ? gameModel(id.slice(4)) : (FM.lib.byId.get(id) || null); };
    // A model of the game (a door, a gate, a garage door, a window from the game's browser below) as the tool sees its .glb models: its parts with the
    // game's textures (the furniture's), in its own size (the game does not scale a door). Its placement: f "gta:door" or "gta:window", m "gta:<name>", g <name>.
    const gameAdapt = new Map();
    function gameModel(n) {
        const fm = M.Furniture.model(n); if (!fm) { M.Furniture.ensure([n]); return null; } if (fm.error || !fm.geoms) return null;
        let a = gameAdapt.get(n); if (a && a.src === fm) return a;
        const mats = [], mi = new Map(), geoms = fm.geoms.map(g => {
            const key = g.tex || ''; if (!mi.has(key)) { mi.set(key, mats.length); mats.push({ name: key, key, color: [0.72, 0.70, 0.66, 1], tex: key ? 'fu:' + key : '', glass: /glass/.test(key) }); }
            return { mat: mi.get(key), pos: g.pos, nrm: g.nrm, uv: g.uv, idx: g.idx };
        });
        const kind = (GG.kinds[n] || 'door') === 'window' ? 'window' : 'door';
        a = { src: fm, gta: true, id: 'gta:' + n, f: 'gta:' + kind, name: n, min: fm.bmin, max: fm.bmax, size: [fm.bmax[0] - fm.bmin[0], fm.bmax[1] - fm.bmin[1], fm.bmax[2] - fm.bmin[2]],
            tris: geoms.reduce((t, g) => t + g.idx.length / 3, 0), core: null, latch: 0, rot: SETUP.ident, auto: false, inner: null, mats, geoms };
        gameAdapt.set(n, a); return a;
    }
    // the game's doors, gates, garage doors and windows placed in openings, for the export: the model's origin where its box stands (in the grid's frame)
    FM.gameDoors = function (project) {
        return ((project.import && project.import.fits) || []).filter(f => f.g).map(f => {
            const m = FM.model(f.m), cs = Math.cos(f.yaw), sn = Math.sin(f.yaw); if (!m) return null;
            const uc = (m.min[0] + m.max[0]) / 2, nc = (m.min[1] + m.max[1]) / 2;
            // (sized: the export scales a copy of the model by sx, sy, sz about its origin)
            const sx = f.w / m.size[0], sy = f.d / m.size[1], sz = f.h / m.size[2], u = uc * sx, n = nc * sy;
            return { name: f.g, x: r3(f.cx - u * cs + n * sn), y: r3(f.cy - u * sn - n * cs), z: r3(f.zb - m.min[2] * sz), heading: r3(f.yaw * 180 / Math.PI), mode: f.kind === 'door' ? (f.mode || 'swing') : 'swing', h: r3(f.h), sx: +sx.toFixed(4), sy: +sy.toFixed(4), sz: +sz.toFixed(4) };
        }).filter(Boolean);
    };
    FM.models = function () { const out = []; FM.lib.files.forEach(f => f.models.forEach(m => out.push(m))); return out; };
    // `only`: the name of one file to read again (its kind, or the turn of one of its models, changed); the others stay as they are
    FM.loadLib = async function (only) {
        if (S.project.kind !== 'import') return;
        const lib = FM.lib; lib.busy = true; lib.error = '';
        try {
            const r = await Model.api('import/glb?name=' + safe(), 'POST', { kinds: imp().glbKinds || {}, setups: imp().glbSetup || {}, only: only || '' });
            (r.textures || []).forEach(t => { IM.textures[t.name] = { w: t.w, h: t.h, rgba: bytes(t.rgba) }; });
            const files = only ? lib.files.filter(f => f.file !== only) : [], map = new Map(only ? [...lib.byId].filter(e => e[1].f !== only) : []);
            (r.files || []).forEach(f => {
                const rec = { file: f.file, builtin: !!f.builtin, guess: f.kind || 'window', title: f.title || '', author: f.author || '', license: f.license || '', source: f.source || '', error: f.error || '', models: [] };
                const mats = (f.mats || []).map(m => ({ name: m.name, key: m.key, color: m.color || [0.7, 0.7, 0.7, 1], tex: m.tex || '', glass: !!m.glass }));
                (f.models || []).forEach(m => {
                    const size = [m.max[0] - m.min[0], m.max[1] - m.min[1], m.max[2] - m.min[2]];
                    const mm = { id: m.id, f: f.file, name: m.name, min: m.min, max: m.max, size, tris: m.tris, core: m.core || null, latch: m.latch || 0, rot: m.rot || SETUP.ident, auto: !!m.auto, inner: m.inner || null, mats, geoms: m.geoms.map(g => ({ mat: g.mat, pos: f32(g.pos), nrm: f32(g.nrm), uv: f32(g.uv), idx: u16(g.idx) })) };
                    rec.models.push(mm); map.set(mm.id, mm);
                });
                files.push(rec);
            });
            files.sort((a, b) => a.file.localeCompare(b.file));
            lib.files = files; lib.byId = map; lib.loaded = true;
            if (M.App.renderer) M.App.renderer.resetImgTextures();
        } catch (e) { lib.error = e.message; M.Errors.report('glb', e, { quiet: true }); }
        lib.busy = false; lib.ver++; bakeCache.clear(); thumbs = new Map();
        M.UI.renderLeft(); if (M.App.remesh) M.App.remesh();
    };
    // Setting a model up: a model can lie down or face the wrong way as it comes out of its file. Quarter turns (3x3, row major, on (u = width, n = depth, z = up)) are kept for each model in
    // import.glbSetup; none stored = the host stands a door or a frame up by itself. The turn is applied by the host (the library comes back turned), and by the export.
    const mul3 = (A, B) => { const C = [0, 0, 0, 0, 0, 0, 0, 0, 0]; for (let i = 0; i < 3; i++) for (let j = 0; j < 3; j++) for (let k = 0; k < 3; k++) C[i * 3 + j] += A[i * 3 + k] * B[k * 3 + j]; return C.map(v => v + 0); };
    const SETUP = { ident: [1, 0, 0, 0, 1, 0, 0, 0, 1], tilt: [1, 0, 0, 0, 0, -1, 0, 1, 0], roll: [0, 0, 1, 0, 1, 0, -1, 0, 0], spin: [0, -1, 0, 1, 0, 0, 0, 0, 1], flip: [-1, 0, 0, 0, -1, 0, 0, 0, 1], over: [1, 0, 0, 0, -1, 0, 0, 0, -1] };
    FM.setup = function (m, how) {
        Model.edit(P => {
            P.import.glbSetup = P.import.glbSetup || {};
            if (how === 'auto') delete P.import.glbSetup[m.id]; else P.import.glbSetup[m.id] = how === 'reset' ? SETUP.ident.slice() : mul3(SETUP[how], m.rot || SETUP.ident);
        });
        return FM.loadLib(m.f);
    };

    // a small picture of a model seen from the front (a flat-shaded drawing of its triangles, far ones first)
    FM.thumb = function (m, px) {
        px = px || 72; let url = thumbs.get(m.id);
        if (!url) {
            const W = px * 2, cv = document.createElement('canvas'); cv.width = W; cv.height = W; const ctx = cv.getContext('2d');
            const sc = Math.min((W - 12) / m.size[0], (W - 12) / m.size[2]), uc = (m.min[0] + m.max[0]) / 2, zc = (m.min[2] + m.max[2]) / 2, X = (u) => W / 2 - (u - uc) * sc, Y = (z) => W / 2 - (z - zc) * sc;     // the viewer's right is -u
            const tris = [];
            m.geoms.forEach(g => {
                const mat = m.mats[g.mat] || m.mats[0], c = mat.color;
                for (let t = 0; t + 2 < g.idx.length; t += 3) {
                    const a = g.idx[t] * 3, b = g.idx[t + 1] * 3, d = g.idx[t + 2] * 3, nn = (g.nrm[a + 1] + g.nrm[b + 1] + g.nrm[d + 1]) / 3, sh = 0.62 + 0.38 * Math.max(0, nn);
                    tris.push([(g.pos[a + 1] + g.pos[b + 1] + g.pos[d + 1]) / 3, X(g.pos[a]), Y(g.pos[a + 2]), X(g.pos[b]), Y(g.pos[b + 2]), X(g.pos[d]), Y(g.pos[d + 2]), mat.glass ? 'rgba(150,200,235,0.40)' : 'rgb(' + Math.round(Math.min(1, c[0] * sh) * 255) + ',' + Math.round(Math.min(1, c[1] * sh) * 255) + ',' + Math.round(Math.min(1, c[2] * sh) * 255) + ')']);
                }
            });
            tris.sort((p, q) => p[0] - q[0]);
            tris.forEach(t => { ctx.fillStyle = t[7]; ctx.strokeStyle = t[7]; ctx.lineWidth = 0.6; ctx.beginPath(); ctx.moveTo(t[1], t[2]); ctx.lineTo(t[3], t[4]); ctx.lineTo(t[5], t[6]); ctx.closePath(); ctx.fill(); ctx.stroke(); });
            url = cv.toDataURL('image/png'); thumbs.set(m.id, url);
        }
        const im = new Image(); im.src = url; im.style.width = px + 'px'; im.style.height = px + 'px'; im.style.display = 'block'; im.draggable = false; return im;
    };

    // ---------- placements in the view ----------
    // the model baked to a placement (scaled to its size, turned, moved), as batches of the renderer; kept until the placement changes
    // A double door: two leaves side by side, each half of the placement's width, hinged on the two outer edges and meeting in the middle. A door model has its knob on one side; the
    // leaf whose knob would come out on its hinge side is the model turned inside out left-to-right (a mirror), so both knobs are where the leaves meet.
    // side +1 is the half on +u (the viewer's left, hinge left), side -1 the other. Returns [{ side, hinge, du (the leaf's middle from the placement's, along the wall), w, mirror }].
    FM.leaves = function (it) {
        if (!(it.double && it.kind === 'door')) return [{ side: 0, hinge: it.hinge || 'l', du: 0, w: it.w, mirror: false }];
        const m = FM.model(it.m), nat = m && m.latch > 0 ? 'r' : 'l';              // the hinge side the model is made for (opposite its knob)
        return [{ side: 1, hinge: 'l', du: it.w / 4, w: it.w / 2, mirror: nat !== 'l' }, { side: -1, hinge: 'r', du: -it.w / 4, w: it.w / 2, mirror: nat !== 'r' }];
    };
    function bake(it) {
        const m = FM.model(it.m); if (!m) return [];
        const key = [FM.lib.ver, it.m, it.cx, it.cy, it.zb, it.yaw, it.w, it.d, it.h, it.double ? 'D' : 's'].join('|'), c = bakeCache.get(it.id); if (c && c.key === key) return c.batches;
        const sd = it.d / m.size[1], sh = it.h / m.size[2], uc = (m.min[0] + m.max[0]) / 2, nc = (m.min[1] + m.max[1]) / 2, z0 = m.min[2], cs = Math.cos(it.yaw), sn = Math.sin(it.yaw), out = [];
        FM.leaves(it).forEach(lf => {
            const sw = lf.w / m.size[0], mir = lf.mirror ? -1 : 1;
            m.geoms.forEach(g => {
                const nv = g.pos.length / 3, pos = new Float32Array(nv * 3), nrm = new Float32Array(nv * 3), mat = m.mats[g.mat] || m.mats[0];
                for (let i = 0; i < nv; i++) {
                    const lu = (g.pos[i * 3] - uc) * sw * mir + lf.du, ln = (g.pos[i * 3 + 1] - nc) * sd, lz = (g.pos[i * 3 + 2] - z0) * sh;
                    pos[i * 3] = it.cx + lu * cs - ln * sn; pos[i * 3 + 1] = it.cy + lu * sn + ln * cs; pos[i * 3 + 2] = it.zb + lz;
                    let nu = g.nrm[i * 3] / sw * mir, nn = g.nrm[i * 3 + 1] / sd, nz = g.nrm[i * 3 + 2] / sh; const l = Math.hypot(nu, nn, nz) || 1; nu /= l; nn /= l; nz /= l;
                    nrm[i * 3] = nu * cs - nn * sn; nrm[i * 3 + 1] = nu * sn + nn * cs; nrm[i * 3 + 2] = nz;
                }
                let idx = g.idx; if (lf.mirror) { idx = new g.idx.constructor(g.idx.length); for (let t = 0; t + 2 < idx.length; t += 3) { idx[t] = g.idx[t]; idx[t + 1] = g.idx[t + 2]; idx[t + 2] = g.idx[t + 1]; } }       // (a mirror turns the faces inside out: the order of the corners goes back)
                out.push({ level: 0, kind: 'fit', group: 'fit', tex: '', imgKey: mat.tex && IM.textures[mat.tex] ? mat.tex : null, flat: [mat.color[0], mat.color[1], mat.color[2]], alpha: 1, noCull: true, pos, nrm, uv: g.uv, idx, glass: mat.glass, fit: it.id });
            });
        });
        bakeCache.set(it.id, { key, batches: out }); return out;
    }
    FM.batches = function () {
        const list = fits(), out = []; if (!FM.lib.loaded) return out;
        list.forEach(it => { bake(it).forEach(b => out.push(b)); });
        if (bakeCache.size > list.length + 4) { const ids = new Set(list.map(f => f.id)); [...bakeCache.keys()].forEach(k => { if (!ids.has(k)) bakeCache.delete(k); }); }
        return out;
    };
    // The placements open the interior's own walls (and make the portals and the glass collision) like cutters do; they cut nothing from the building.
    // A door's room: the same gap each side of the leaf, so that the cut is centred on the door: half the leaf's thickness (the leaf turns about its hinge, so its corner sweeps that far into the jamb;\n    // the knob does not count) and 1.5 cm to spare.
    function doorRoom(it) {
        const m = FM.model(it.m), t = m && m.core ? (m.core[1] - m.core[0]) * it.d / m.size[1] : Math.min(it.d, 0.08);
        return { gap: t / 2 + 0.015 };
    }
    // The wall cut of a door: the size of the door-shaped opening it was fitted to (it.cut = { w, h, du, dz }: the hole's size, and where its middle is from the door's middle along the
    // wall and in height), else the door plus its room, 2 cm higher, moved towards the hinge side. Returns the hole: middle (cx, cy), bottom, width, height.
    FM.doorCut = function (it) {
        const rm = doorRoom(it); let w = it.w + 2 * rm.gap, z0 = it.zb, h = it.h + 0.02;
        if (it.cut) { w = it.cut.w; h = it.cut.h; z0 = it.zb + (it.cut.dz || 0); }
        const hz = z0 <= 0.02 ? 0 : r3(z0);          // (a door on the floor keeps the floor: no sill piece)
        return { cx: it.cx, cy: it.cy, zb: hz, w: r3(w), h: r3(z0 + h - hz) };
    };
    FM.cutters = function (project) {
        const list = (project && project.import && project.import.fits) || [];
        // (a door that stands in a frame has no hole of its own: the frame's hole is the wall's cut; a window frame with a window in it has none: the window's
        // hole, with its glass, is the cut, and the frame covers the wall round it)
        const filled = (fr) => FM.isWinFrame(fr) && list.some(w => w.kind === 'window' && w.open !== false && findFrame(w, list) === fr);
        return list.filter(f => f.open !== false && f.w > 0.1 && f.h > 0.1 && !(f.kind === 'door' && findFrame(f, list)) && !filled(f)).map(f => {
            if (f.kind === 'door') { const c = FM.doorCut(f); return { id: 'fit' + f.id, type: 'door', face: true, fit: true, cx: c.cx, cy: c.cy, zb: c.zb, w: c.w, h: c.h, d: 0.8, yaw: f.yaw, dd: 0 }; }
            // a window or a frame: the hole is 1 cm smaller than the model all round, so its frame overlaps the wall; a frame on the floor is a doorway (no sill piece, no glass)
            const frame = f.kind === 'frame', floor = frame && f.zb <= 0.02, zb = floor ? 0 : r3(f.zb + 0.01);
            return { id: 'fit' + f.id, type: frame && floor ? 'door' : 'window', face: true, fit: true, noglass: frame, cx: f.cx, cy: f.cy, zb, w: r3(f.w - 0.02), h: r3(f.zb + f.h - 0.01 - zb), d: 0.8, yaw: f.yaw, dd: 0 };
        });
    };
    // ---- frames: a door frame is placed in the opening of the wall; the door goes inside the frame ----
    // The clear opening of a frame as placed: width, height, where its middle is from the frame's middle along the wall (cu) and its bottom. Without a measured opening: the whole frame.
    function frameInner(fr) {
        const m = FM.model(fr.m); if (!m) return null; const su = fr.w / m.size[0], sz = fr.h / m.size[2], uc = (m.min[0] + m.max[0]) / 2, inn = m.inner || [m.min[0], m.max[0], m.min[2], m.max[2]];
        return { w: (inn[1] - inn[0]) * su, h: (inn[3] - inn[2]) * sz, cu: ((inn[0] + inn[1]) / 2 - uc) * su, zb: fr.zb + (inn[2] - m.min[2]) * sz };
    }
    // A window frame: a frame whose opening is shut at the bottom (a sill), so it goes round a window, above the floor; a door frame is open at the bottom
    const winFrameModel = (m) => !!(m && m.inner && m.inner[2] > m.min[2] + 0.02);
    FM.isWinFrame = (it) => !!it && it.kind === 'frame' && winFrameModel(FM.model(it.m));
    // the frame a door (or a window) stands in: the one whose box holds its middle (about the same way round, and in the same wall); a door goes in a door
    // frame, a window in a window frame
    function findFrame(it, list) {
        let best = null; (list || fits()).forEach(fr => {
            if (fr.kind !== 'frame' || fr.id === it.id || fr.open === false || FM.isWinFrame(fr) !== (it.kind === 'window')) return;
            let dy = Math.abs((((fr.yaw - it.yaw) % Math.PI) + Math.PI * 1.5) % Math.PI - Math.PI / 2); dy = Math.min(dy, Math.PI - dy); if (dy > 0.15) return;
            const FU = [Math.cos(fr.yaw), Math.sin(fr.yaw)], FN = [-Math.sin(fr.yaw), Math.cos(fr.yaw)], dx = it.cx - fr.cx, dz = it.cy - fr.cy, du = dx * FU[0] + dz * FU[1], dn = dx * FN[0] + dz * FN[1], mid = it.zb + it.h / 2;
            if (Math.abs(du) > fr.w / 2 + 0.05 || Math.abs(dn) > 0.6 || mid < fr.zb - 0.05 || mid > fr.zb + fr.h + 0.05) return;
            const s = Math.abs(du) + Math.abs(dn); if (!best || s < best.s) best = { fr, s };
        });
        return best ? best.fr : null;
    }
    // the door sized and put to the frame's opening: the opening less its room (and 2 cm at the head), in the middle of the frame across the wall as well
    function doorInFrame(it, fr) {
        const fi = frameInner(fr); if (!fi) return null; const { U, N } = axes(it), rm = doorRoom(it), FU = [Math.cos(fr.yaw), Math.sin(fr.yaw)];
        const ox = fr.cx + FU[0] * fi.cu, oy = fr.cy + FU[1] * fi.cu, along = (ox - it.cx) * U[0] + (oy - it.cy) * U[1], across = (fr.cx - it.cx) * N[0] + (fr.cy - it.cy) * N[1];
        return { cx: r3(it.cx + U[0] * along + N[0] * across), cy: r3(it.cy + U[1] * along + N[1] * across), zb: fi.zb < 0.02 ? 0 : r3(fi.zb), w: r3(Math.max(0.5, fi.w - 2 * rm.gap)), h: r3(Math.max(1.5, fi.h - 0.02)), cut: { w: r3(fi.w), h: r3(fi.h), du: 0, dz: 0 } };
    }
    // a window sized and put to the opening of the window frame it stands in (in the middle of the frame across the wall)
    function windowInFrame(it, fr) {
        const fi = frameInner(fr); if (!fi) return null; const { U, N } = axes(it), FU = [Math.cos(fr.yaw), Math.sin(fr.yaw)];
        const ox = fr.cx + FU[0] * fi.cu, oy = fr.cy + FU[1] * fi.cu, along = (ox - it.cx) * U[0] + (oy - it.cy) * U[1], across = (fr.cx - it.cx) * N[0] + (fr.cy - it.cy) * N[1];
        return { cx: r3(it.cx + U[0] * along + N[0] * across), cy: r3(it.cy + U[1] * along + N[1] * across), zb: r3(fi.zb), w: r3(Math.max(0.2, fi.w)), h: r3(Math.max(0.2, fi.h)) };
    }
    // a frame put to the building's door opening: its outside is the opening (its depth and its place across the wall stay)
    function frameFit(it, r) {
        const { U } = axes(it), along = (r.cx - it.cx) * U[0] + (r.cy - it.cy) * U[1];
        return { cx: r3(it.cx + U[0] * along), cy: r3(it.cy + U[1] * along), zb: r.zb < 0.02 ? 0 : r3(r.zb), w: r3(r.w), h: r3(r.h) };
    }
    // The door-shaped opening of the building behind a door (the faces the building has where its own door is: the "door cut" the wall is measured from): the flat patch of faces that
    // is about as tall as a door and starts near the floor, found by looking along the wall's normal through the door's area, from outside and from inside. Null when there is none (the
    // faces may be deleted already). Returns the rectangle of the faces (IM.faceRect: middle, bottom, width, height, in the grid's frame).
    function findOpening(it) {
        const { U, N } = axes(it), seen = new Set(), found = [], tfile = (IM.targetModel() || {}).file, yawq = it.yaw;
        // a rectangle that is a door-shaped opening near this placement: about as tall as a door, starting near the floor, parallel to it, close to it along and across the wall
        const accept = (r) => {
            let dy = Math.abs((((r.yaw - yawq) % Math.PI) + Math.PI * 1.5) % Math.PI - Math.PI / 2); dy = Math.min(dy, Math.PI - dy);
            const du = (r.cx - it.cx) * U[0] + (r.cy - it.cy) * U[1], dn = (r.cx - it.cx) * N[0] + (r.cy - it.cy) * N[1];
            if (r.w < 0.6 || r.w > 2.6 || r.h < 1.7 || r.h > 2.7 || r.zb > 0.45 || r.zb < -0.3 || dy > 0.15 || Math.abs(du) > Math.max(0.7, it.w) || Math.abs(dn) > 0.8) return;
            found.push({ r, score: Math.abs(du) + Math.abs(dn) * 0.3 });
        };
        [-0.3, 0, 0.3].forEach(fu => [0.3, 0.5, 0.8].forEach(fz => {
            const u = it.w * fu, p = [it.cx + U[0] * u, it.cy + U[1] * u, it.zb + Math.min(it.h * fz, it.h - 0.1)];
            [1, -1].forEach(sd => {
                const o = IM.pickOriginal({ o: [p[0] + N[0] * sd * 2.5, p[1] + N[1] * sd * 2.5, p[2]], d: [-N[0] * sd, -N[1] * sd, 0] }); if (!o || (o.file && o.file !== tfile)) return;
                const key = o.g + ':' + o.tri; if (seen.has(key)) return; seen.add(key);
                const r = IM.faceRect({ g: o.g, tris: IM.flatPatch(o.g, o.tri) }); if (r) accept(r);
            });
        }));
        // the faces may be gone already (a door cut out with the Door tool): that cut remembers the opening
        if (!found.length) (imp().cutters || []).forEach(k => { if (k.face && k.type === 'door') accept({ cx: k.cx, cy: k.cy, zb: k.zb, w: k.w, h: k.h, yaw: k.yaw }); });
        if (!found.length) return null; found.sort((a, b) => a.score - b.score); return found[0].r;
    }
    // the door sized and put to the opening: its wall cut is the opening, the door is the opening less its room (and 2 cm at the head), moved along the wall so that it sits in it
    // with its room on the hinge side; the depth and the position across the wall stay as they are
    function openingFit(it, r) {
        const { U } = axes(it), rm = doorRoom(it), along = (r.cx - it.cx) * U[0] + (r.cy - it.cy) * U[1];
        return { cx: r3(it.cx + U[0] * along), cy: r3(it.cy + U[1] * along), zb: r.zb < 0.02 ? 0 : r3(r.zb), w: r3(Math.max(0.5, r.w - 2 * rm.gap)), h: r3(Math.max(1.5, r.h - 0.02)), cut: { w: r3(r.w), h: r3(r.h), du: 0, dz: 0 } };
    }
    // The opening cut out with the Door, Window or Archway tool behind a placement: the cutter in the same wall (parallel, within its depth across the wall), that
    // the placement's middle lies in along the wall and in height (a door: one that starts near the floor). It is what you cut, so it wins over the building's
    // own door faces. Returns its rectangle (middle, bottom, width, height, in the grid's frame) or null.
    function findCut(it) {
        const { U, N } = axes(it), mid = it.zb + it.h / 2, door = it.kind === 'door' || (it.kind === 'frame' && !FM.isWinFrame(it)); let best = null;
        (imp().cutters || []).forEach(k => {
            if (door ? (k.type !== 'door' && k.type !== 'arch') : (k.type !== 'window' && k.type !== 'arch')) return;
            let dy = Math.abs((((k.yaw - it.yaw) % Math.PI) + Math.PI * 1.5) % Math.PI - Math.PI / 2); dy = Math.min(dy, Math.PI - dy); if (dy > 0.15) return;
            const du = (k.cx - it.cx) * U[0] + (k.cy - it.cy) * U[1], dn = (k.cx - it.cx) * N[0] + (k.cy - it.cy) * N[1];
            if (Math.abs(du) > k.w / 2 + 0.25 || Math.abs(dn) > (k.d || 0.8) / 2 + 0.6) return;
            if (door ? (k.zb > 0.45 || k.h < 1.5) : (mid < k.zb - 0.3 || mid > k.zb + k.h + 0.3)) return;
            const sc = Math.abs(du) + Math.abs(dn) * 0.3; if (!best || sc < best.sc) best = { sc, r: { cx: k.cx, cy: k.cy, zb: k.zb, w: k.w, h: k.h, yaw: k.yaw } };
        });
        return best ? best.r : null;
    }
    // a window put to an opening: the opening's size and height, in its middle along the wall (its depth and its place across the wall stay)
    function windowFit(it, r) {
        const { U } = axes(it), along = (r.cx - it.cx) * U[0] + (r.cy - it.cy) * U[1];
        return { cx: r3(it.cx + U[0] * along), cy: r3(it.cy + U[1] * along), zb: r3(r.zb), w: r3(r.w), h: r3(r.h) };
    }
    // A new placement put to what is there: a door into the frame it stands in, else into the cut opening, else over the building's door faces; a frame to the
    // cut opening or the door faces; a window to the cut opening. Changes `nf`; returns { framed, fitted, wide }.
    function fitNew(nf) {
        let framed = null, fitted = null, wide = false;
        if (nf.kind === 'door') {
            framed = findFrame(nf); const fp = framed ? doorInFrame(nf, framed) : null, leaf0 = nf.w;                                      // put in a frame: it is sized to the frame's opening
            if (fp) Object.assign(nf, fp); else { framed = null; fitted = findCut(nf) || findOpening(nf); if (fitted) Object.assign(nf, openingFit(nf, fitted)); }          // the wall cut is the opening's size
            wide = (fp ? fp.w : (fitted ? fitted.w : 0)) > leaf0 * 1.7;                                                                          // wide enough for two leaves
        } else if (nf.kind === 'frame') { fitted = findCut(nf) || (FM.isWinFrame(nf) ? null : findOpening(nf)); if (fitted) Object.assign(nf, frameFit(nf, fitted)); }
        else {
            framed = findFrame(nf); const fp = framed ? windowInFrame(nf, framed) : null;                                                  // in a window frame: the frame's opening
            if (fp) Object.assign(nf, fp); else { framed = null; fitted = findCut(nf); if (fitted) Object.assign(nf, windowFit(nf, fitted)); }
        }
        return { framed, fitted, wide };
    }
    FM.findOpening = findOpening; FM.openingFit = openingFit; FM.findCut = findCut;
    FM.matchOpening = function () {
        const it = selFit(); if (!it) { toast('Select a placed model first.', 'warn'); return false; }
        const winLike = it.kind === 'window' || FM.isWinFrame(it), r = findCut(it) || (winLike ? null : findOpening(it));
        if (!r) { toast('No opening is behind this ' + (FM.isWinFrame(it) ? 'window frame' : it.kind) + ': cut one with the ' + (winLike ? 'Window' : 'Door') + ' or Archway tool' + (winLike ? '' : ' (or put it over the building\'s door faces)') + ', or set the size by hand.', 'warn'); return false; }
        FM.set(it.kind === 'frame' ? frameFit(it, r) : (it.kind === 'window' ? windowFit(it, r) : openingFit(it, r)));
        if (it.kind === 'window') { toast('The window now has the size of the opening (' + r.w.toFixed(2) + ' x ' + r.h.toFixed(2) + ' m).', 'ok'); return true; }
        toast(it.kind === 'frame' ? 'The frame\'s outside now matches the ' + (winLike ? 'window' : 'building\'s door') + ' opening (' + r.w.toFixed(2) + ' x ' + r.h.toFixed(2) + ' m).' : 'The wall cut now matches the building\'s door opening (' + r.w.toFixed(2) + ' x ' + r.h.toFixed(2) + ' m) and the door was sized to sit in it.', 'ok'); return true;
    };
    // every door (or window, in a window frame) that stands in the selected frame, sized to its opening
    FM.fitDoorsInFrame = function () {
        const fr = selFit(); if (!fr || fr.kind !== 'frame') { toast('Select a placed frame first.', 'warn'); return false; }
        const wf = FM.isWinFrame(fr), what = wf ? 'window' : 'door';
        const patches = fits().filter(d => d.kind === what && findFrame(d) === fr).map(d => [d.id, wf ? windowInFrame(d, fr) : doorInFrame(d, fr)]).filter(p => p[1]);
        if (!patches.length) { toast('No ' + what + ' stands in this frame: put a ' + what + ' into it first.', 'warn'); return false; }
        Model.edit(P => { patches.forEach(p => { const q = (P.import.fits || []).find(f => f.id === p[0]); if (q) Object.assign(q, p[1]); }); }); M.UI.renderLeft();
        toast(patches.length + ' ' + what + (patches.length === 1 ? '' : 's') + ' sized to the frame\'s opening.', 'ok'); return true;
    };
    // the door sized to the opening of the frame it stands in
    FM.fitToFrame = function () {
        const it = selFit(); if (!it || it.kind !== 'door') { toast('Select a placed door first.', 'warn'); return false; }
        const fr = findFrame(it); if (!fr) { toast('This door does not stand in a frame: move it into one.', 'warn'); return false; }
        const p = doorInFrame(it, fr); if (!p) { toast('The frame\'s model is missing.', 'warn'); return false; }
        FM.set(p); toast('The door was sized to the frame\'s opening (' + p.cut.w.toFixed(2) + ' x ' + p.cut.h.toFixed(2) + ' m) with room to swing.', 'ok'); return true;
    };

    // A door that is "solid": a box the size of its leaf in the interior's own collision (the same place the walls' collision is), so it blocks the doorway whatever the door prop does. It is fixed:
    // it stays when a door script swings the prop open.
    FM.solidBoxes = function (project) {
        const list = (project && project.import && project.import.fits) || [];
        const out = [];
        list.filter(f => f.kind === 'door' && f.solid).forEach(f => {
            const m = FM.model(f.m), t = m && m.core ? (m.core[1] - m.core[0]) * f.d / m.size[1] : Math.min(f.d, 0.08);
            if (f.double) { const U = [Math.cos(f.yaw), Math.sin(f.yaw)]; FM.leaves(f).forEach(lf => out.push({ id: 'fs' + f.id + (lf.side > 0 ? 'a' : 'b'), cx: r3(f.cx + U[0] * lf.du), cy: r3(f.cy + U[1] * lf.du), zb: f.zb, h: f.h, hu: lf.w / 2, hn: Math.max(0.03, t / 2 + 0.005), yaw: f.yaw })); }
            else out.push({ id: 'fs' + f.id, cx: f.cx, cy: f.cy, zb: f.zb, h: f.h, hu: f.w / 2, hn: Math.max(0.03, t / 2 + 0.005), yaw: f.yaw });
        });
        return out;
    };
    // what the export gets: every placement; a double door as its two leaves (each a door of its own: its middle, half the width, its hinge side, mirrored or not)
    FM.exportSpec = function (project) {
        const list = (project.import && project.import.fits) || []; if (!list.length) return undefined;
        const items = []; list.forEach(f => {
            if (f.g) return;
            const base = { f: f.f, m: f.m, kind: f.kind, zb: f.zb, yaw: f.yaw, d: f.d, h: f.h, rot: (FM.model(f.m) || {}).rot || null }, U = [Math.cos(f.yaw), Math.sin(f.yaw)];
            // A door gets the clear opening it swings in (where the cut you made in the building and the hole in the interior's own wall overlap): [from, to] along the
            // wall from the leaf's middle and [from, to] in height from its bottom. The export keeps the leaf's collision inside it: a leaf that reaches into the wall is
            // stuck in the game and cannot be pushed open.
            const holes = []; if (f.kind === 'door') { const k = findCut(f); if (k) holes.push(k); const fr = findFrame(f, list); const fc = fr ? FM.cutters({ import: { fits: [fr] } })[0] : FM.doorCut(f); if (fc) holes.push(fc); }
            const holeOf = (cx, cy) => {
                if (!holes.length) return undefined; let lo = -1e9, hi = 1e9, z0 = -1e9, z1 = 1e9;
                holes.forEach(r => { const du = (r.cx - cx) * U[0] + (r.cy - cy) * U[1]; lo = Math.max(lo, du - r.w / 2); hi = Math.min(hi, du + r.w / 2); z0 = Math.max(z0, r.zb - f.zb); z1 = Math.min(z1, r.zb + r.h - f.zb); });
                return [r3(lo), r3(hi), r3(z0), r3(z1)];
            };
            if (f.kind === 'door') base.mode = f.mode || 'swing';          // (how it opens: the game's swing, or moved by the export's door script: both ways by itself, sliding, or up like a garage door)
            if (f.kind === 'door') base.inward = inwardOf(project, f);
            if (f.double && f.kind === 'door') FM.leaves(f).forEach(lf => { const cx = r3(f.cx + U[0] * lf.du), cy = r3(f.cy + U[1] * lf.du); items.push(Object.assign({}, base, { id: f.id + (lf.side > 0 ? 'a' : 'b'), cx, cy, w: r3(lf.w), hinge: lf.hinge, mirror: lf.mirror, hole: holeOf(cx, cy) })); });
            else items.push(Object.assign({}, base, { id: f.id, cx: f.cx, cy: f.cy, w: f.w, hinge: f.hinge || 'l', hole: holeOf(f.cx, f.cy) }));
        });
        return { project: project.name, items };
    };

    // ---------- geometry of a placement ----------
    const axes = (it) => { const cs = Math.cos(it.yaw), sn = Math.sin(it.yaw); return { U: [cs, sn, 0], N: [-sn, cs, 0], Z: [0, 0, 1], c: [it.cx, it.cy, it.zb + it.h / 2] }; };
    const add = (p, a, k) => [p[0] + a[0] * k, p[1] + a[1] * k, p[2] + a[2] * k];
    const dot = (a, b) => a[0] * b[0] + a[1] * b[1] + a[2] * b[2];
    function hitBox(ray, it, pad) {
        const cs = Math.cos(it.yaw), sn = Math.sin(it.yaw), c = [it.cx, it.cy, it.zb + it.h / 2], o = [ray.o[0] - c[0], ray.o[1] - c[1], ray.o[2] - c[2]];
        const lo = [o[0] * cs + o[1] * sn, -o[0] * sn + o[1] * cs, o[2]], ld = [ray.d[0] * cs + ray.d[1] * sn, -ray.d[0] * sn + ray.d[1] * cs, ray.d[2]], p = pad || 0;
        return api().rayBox({ o: lo, d: ld }, [-it.w / 2 - p, -Math.max(it.d, 0.12) / 2 - p, -it.h / 2 - p], [it.w / 2 + p, Math.max(it.d, 0.12) / 2 + p, it.h / 2 + p]);
    }
    // the placement under the pointer; the opening of a frame is not part of it (a door is put into a frame by clicking in its opening)
    function pickFit(ray) {
        let best = null; const cm = FM.chosen ? FM.model(FM.chosen) : null, frameChosen = !!cm && FM.kindOf(cm.f) === 'frame';          // (with a frame chosen the doors are not in the way: a frame goes round a door)
        fits().forEach(f => {
            if (frameChosen && (f.kind === 'door' || f.kind === 'window')) return;
            const t = hitBox(ray, f, 0.02); if (t == null || (best && t >= best.t)) return;
            if (f.kind === 'frame') {
                const fi = frameInner(f); if (fi) { const hp = add(ray.o, ray.d, t), U = [Math.cos(f.yaw), Math.sin(f.yaw)], du = (hp[0] - f.cx) * U[0] + (hp[1] - f.cy) * U[1] - fi.cu; if (Math.abs(du) < fi.w / 2 - 0.02 && hp[2] > fi.zb + 0.02 && hp[2] < fi.zb + fi.h - 0.02) return; }
            }
            best = { t, id: f.id };
        });
        return best ? byId(best.id) : null;
    }

    // the point on the line P + t A that is nearest to the ray (t), null when they run parallel
    function lineParam(ray, P, A) {
        const w = [P[0] - ray.o[0], P[1] - ray.o[1], P[2] - ray.o[2]], a = dot(A, A), b = dot(A, ray.d), c = dot(ray.d, ray.d), d = dot(A, w), e = dot(ray.d, w), den = a * c - b * b;
        if (Math.abs(den) < 1e-6) return null; return (b * e - c * d) / den;
    }
    function planeHitN(ray, P, N) { const dn = dot(ray.d, N); if (Math.abs(dn) < 1e-5) return null; const t = dot([P[0] - ray.o[0], P[1] - ray.o[1], P[2] - ray.o[2]], N) / dn; if (t < 0) return null; return add(ray.o, ray.d, t); }

    // ---------- the gizmo ----------
    const COL = { u: [0.95, 0.38, 0.32, 1], n: [0.42, 0.9, 0.48, 1], z: [0.42, 0.64, 1, 1], hot: [1, 0.93, 0.5, 1], ring: [1, 0.82, 0.35, 0.95] };
    function sizes() { const cam = M.App.renderer.camera; return { hs: Math.max(0.028, cam.dist * 0.0052), L: Math.max(0.32, Math.min(1.8, cam.dist * 0.07)) }; }
    function ringPts(it) {
        const R = Math.max(0.35, Math.hypot(it.w, it.d) / 2 + 0.22), pts = []; for (let i = 0; i <= 48; i++) { const a = i / 48 * Math.PI * 2; pts.push([it.cx + Math.cos(a) * R, it.cy + Math.sin(a) * R, it.zb]); } return pts;
    }
    function gizmo(it) {
        const { U, N, Z, c } = axes(it), { hs, L } = sizes(), g = [];
        g.push({ id: 'su+', type: 'face', axis: 'u', s: 1, p: add(c, U, it.w / 2), col: COL.u }, { id: 'su-', type: 'face', axis: 'u', s: -1, p: add(c, U, -it.w / 2), col: COL.u });
        g.push({ id: 'sz+', type: 'face', axis: 'z', s: 1, p: add(c, Z, it.h / 2), col: COL.z }, { id: 'sz-', type: 'face', axis: 'z', s: -1, p: add(c, Z, -it.h / 2), col: COL.z });
        g.push({ id: 'sn+', type: 'face', axis: 'n', s: 1, p: add(add(add(c, N, it.d / 2), U, -it.w / 2), Z, -it.h / 2), col: COL.n });          // (a corner, so it does not sit where you grab the model to slide it)
        g.push({ id: 'uni', type: 'uni', p: add(add(add(c, U, it.w / 2), N, it.d / 2), Z, it.h / 2), col: [1, 1, 1, 1] });
        const tipU = add(c, U, it.w / 2 + L), tipN = add(c, N, it.d / 2 + L), tipZ = add(c, Z, it.h / 2 + L);
        g.push({ id: 'au', type: 'arrow', axis: 'u', p: add(c, U, it.w / 2 + 2.6 * hs), p2: tipU, dir: U, col: COL.u });
        g.push({ id: 'an', type: 'arrow', axis: 'n', p: add(c, N, it.d / 2 + 2.6 * hs), p2: tipN, dir: N, col: COL.n });
        g.push({ id: 'az', type: 'arrow', axis: 'z', p: add(c, Z, it.h / 2 + 2.6 * hs), p2: tipZ, dir: Z, col: COL.z });
        g.push({ id: 'ring', type: 'ring', col: COL.ring });
        return g;
    }
    FM.gizmo = gizmo;
    function toScreen(p) { const cam = M.App.renderer.camera, r = M.App.canvas.getBoundingClientRect(); cam.update(r.width / r.height); return cam.project(p, r.width, r.height); }
    function segDist(px, py, a, b) { const vx = b[0] - a[0], vy = b[1] - a[1], l2 = vx * vx + vy * vy, t = l2 < 1e-9 ? 0 : Math.max(0, Math.min(1, ((px - a[0]) * vx + (py - a[1]) * vy) / l2)); return Math.hypot(px - (a[0] + vx * t), py - (a[1] + vy * t)); }
    function handleAt(it, e) {
        const r = M.App.canvas.getBoundingClientRect(), mx = e.clientX - r.left, my = e.clientY - r.top; let best = null, bd = 1e9;
        gizmo(it).forEach(h => {
            let d = 1e9, tol = 11, bias = 0;
            if (h.type === 'face' || h.type === 'uni') { const s = toScreen(h.p); if (s) d = Math.hypot(s[0] - mx, s[1] - my); bias = -4; }
            else if (h.type === 'arrow') { const a = toScreen(h.p), b = toScreen(h.p2); if (a && b) d = segDist(mx, my, a, b); tol = 9; }
            else if (h.type === 'ring') { const pts = ringPts(it).map(toScreen); for (let i = 0; i + 1 < pts.length; i++) if (pts[i] && pts[i + 1]) d = Math.min(d, segDist(mx, my, pts[i], pts[i + 1])); tol = 7; bias = 3; }
            if (d <= tol && d + bias < bd) { bd = d + bias; best = h; }
        });
        return best;
    }
    function cube(R, p, hs, col) {
        const q = (a, b, c, d) => R.ovTopQuad(a, b, c, d, col), x0 = p[0] - hs, x1 = p[0] + hs, y0 = p[1] - hs, y1 = p[1] + hs, z0 = p[2] - hs, z1 = p[2] + hs;
        q([x1, y0, z0], [x1, y1, z0], [x1, y1, z1], [x1, y0, z1]); q([x0, y1, z0], [x0, y0, z0], [x0, y0, z1], [x0, y1, z1]); q([x1, y1, z0], [x0, y1, z0], [x0, y1, z1], [x1, y1, z1]);
        q([x0, y0, z0], [x1, y0, z0], [x1, y0, z1], [x0, y0, z1]); q([x0, y0, z1], [x1, y0, z1], [x1, y1, z1], [x0, y1, z1]); q([x0, y1, z0], [x1, y1, z0], [x1, y0, z0], [x0, y0, z0]);
    }
    function cone(R, tip, base, dir, rad, col) {
        // a cone from the base centre to the tip; two vectors across the axis
        let a = Math.abs(dir[2]) > 0.9 ? [1, 0, 0] : [0, 0, 1]; const k = [dir[1] * a[2] - dir[2] * a[1], dir[2] * a[0] - dir[0] * a[2], dir[0] * a[1] - dir[1] * a[0]], kl = Math.hypot(k[0], k[1], k[2]) || 1, v1 = [k[0] / kl, k[1] / kl, k[2] / kl], v2 = [dir[1] * v1[2] - dir[2] * v1[1], dir[2] * v1[0] - dir[0] * v1[2], dir[0] * v1[1] - dir[1] * v1[0]];
        const ring = []; for (let i = 0; i < 6; i++) { const t = i / 6 * Math.PI * 2; ring.push([base[0] + (v1[0] * Math.cos(t) + v2[0] * Math.sin(t)) * rad, base[1] + (v1[1] * Math.cos(t) + v2[1] * Math.sin(t)) * rad, base[2] + (v1[2] * Math.cos(t) + v2[2] * Math.sin(t)) * rad]); }
        for (let i = 0; i < 6; i++) R.ovTopQuad(ring[i], ring[(i + 1) % 6], tip, tip, col);
    }
    function obox(R, it, col) {
        const { U, N } = axes(it), hu = it.w / 2, hn = Math.max(it.d, 0.04) / 2, P = (a, b, z) => [it.cx + U[0] * a * hu + N[0] * b * hn, it.cy + U[1] * a * hu + N[1] * b * hn, it.zb + z * it.h];
        const v = [P(-1, -1, 0), P(1, -1, 0), P(1, 1, 0), P(-1, 1, 0), P(-1, -1, 1), P(1, -1, 1), P(1, 1, 1), P(-1, 1, 1)];
        [[0, 1], [1, 2], [2, 3], [3, 0], [4, 5], [5, 6], [6, 7], [7, 4], [0, 4], [1, 5], [2, 6], [3, 7]].forEach(e => R.ovTopLine(v[e[0]], v[e[1]], col));
    }
    FM.draw = function (R) {
        const cam = R.camera, hs = sizes().hs; let text = null, at = null;
        fits().forEach(f => { const sel = f.id === FM.sel, hov = hover.fit && hover.fit.id === f.id && !drag; obox(R, f, sel ? [1, 1, 1, 0.95] : (hov ? [1, 0.93, 0.55, 1] : [0.62, 0.8, 1, 0.4])); });
        const it = selFit();
        if (it) {
            const act = drag ? drag.h : hover.h, { c, N } = axes(it), hinges = FM.hinges(it);
            gizmo(it).forEach(h => {
                const hot = act && act.id === h.id, col = hot ? COL.hot : h.col;
                if (h.type === 'face' || h.type === 'uni') cube(R, h.p, hot ? hs * 1.5 : hs, col);
                else if (h.type === 'arrow') { R.ovTopLine(add(h.p, h.dir, -2.6 * hs), h.p2, col); cone(R, add(h.p2, h.dir, hs * 3.4), h.p2, h.dir, hs * 1.3, col); }
                else if (h.type === 'ring') { const pts = ringPts(it); for (let i = 0; i + 1 < pts.length; i++) R.ovTopLine(pts[i], pts[i + 1], hot ? COL.hot : (i % 4 < 2 ? h.col : [h.col[0], h.col[1], h.col[2], 0.45])); }
            });
            // the front of the model (the way its green arrow points) and, for a door, the hinge
            hinges.forEach(side => R.ovTopLine(side, add(side, [0, 0, 1], it.h), [1, 0.55, 0.2, 1]));
            if (it.double && it.kind === 'door') R.ovTopLine(add(c, [0, 0, 1], -it.h / 2), add(c, [0, 0, 1], it.h / 2), [0.95, 0.95, 0.95, 0.55]);          // where the two leaves meet
            if (drag && drag.moved) { text = it.w.toFixed(2) + ' x ' + it.h.toFixed(2) + ' x ' + it.d.toFixed(2) + ' m, ' + Math.round(((it.yaw * 180 / Math.PI) % 360 + 360) % 360) + '°, bottom ' + it.zb.toFixed(2) + ' m'; at = [c[0], c[1], it.zb + it.h + 0.3]; }
            else if (hover.h && !drag) { const lab = { face: 'Drag to change the size', uni: 'Drag to scale it all together', arrow: 'Drag to move it along this axis', ring: 'Drag to turn it' }; text = lab[hover.h.type]; at = [c[0], c[1], it.zb + it.h + 0.3]; }
        }
        // where a click would put the chosen model
        if (!drag && !hover.h && !hover.fit && hover.surf && FM.chosen) {
            const m = FM.model(FM.chosen), nf = m ? newFit(m, hover.surf) : null, ft = nf ? fitNew(nf) : null;
            if (nf) { obox(R, nf, [0.45, 0.95, 0.6, 0.95]); text = 'Click to put the ' + m.name.toLowerCase() + ' here (' + nf.w.toFixed(2) + ' x ' + nf.h.toFixed(2) + ' m' + (ft.framed ? ', in the frame' : (ft.fitted ? ', fits the opening' : '')) + ')'; at = [nf.cx, nf.cy, nf.zb + nf.h + 0.3]; }
        } else if (!drag && !hover.h && hover.fit && !text) { text = 'Click to select (drag to move it)'; at = [hover.fit.cx, hover.fit.cy, hover.fit.zb + hover.fit.h + 0.3]; }
        else if (!drag && !hover.h && !hover.fit && !FM.chosen && !it) { text = 'Choose a model in the list first'; at = null; }
        M.App.canvas.style.cursor = drag ? (drag.type === 'ring' ? 'grabbing' : 'move') : ((hover.h || hover.fit) ? 'move' : '');
        return { text, at };
    };
    // where the hinge of a door is (the bottom of its hinge edge)
    // where the hinge of a door is (the bottom of its hinge edge); a double door has two, on its outer edges
    FM.hinges = function (it) { if (it.kind !== 'door') return []; const { U, c } = axes(it); return FM.leaves(it).map(lf => { const k = lf.du + (lf.hinge === 'r' ? -lf.w / 2 : lf.w / 2); return [c[0] + U[0] * k, c[1] + U[1] * k, it.zb]; }); };
    FM.hingeOf = function (it) { const h = FM.hinges(it); return h.length ? h[0] : null; };

    // ---------- placing ----------
    function snapYaw(yaw) { const deg = yaw * 180 / Math.PI, q = ((deg % 90) + 90) % 90; return Math.min(q, 90 - q) < 1.5 ? Math.round(yaw / (Math.PI / 2)) * (Math.PI / 2) : yaw; }
    // how a new door opens, from its name: a sliding door slides (not the patio door, a whole unit of its own), a swing door swings both ways by itself
    const modeOf = (m) => { const n = (m.name + ' ' + m.f).toLowerCase(); return /roll|shutter|roller|rolltor|rollladen/.test(n) ? 'roll' : (/garage|sectional/.test(n) ? 'lift' : (/slid/.test(n) && !/patio/.test(n) ? 'slide' : (/swing/.test(n) ? 'auto' : 'swing'))); };
    // which side of a door the rooms are on: +1 when they are on its front (+n), -1 behind it (a garage door folds up into the room); behind when it cannot tell
    function inwardOf(project, f) {
        const sh = project && project.shell; if (!sh || !sh.ops || !sh.ops.length) return -1;
        const g = M.Shell.regionGrid(sh), inReg = (x, y) => { for (let i = 0; i < g.nx; i++) if (x >= g.X[i] && x < g.X[i + 1]) { for (let j = 0; j < g.ny; j++) if (y >= g.Y[j] && y < g.Y[j + 1]) return !!g.mask[i][j]; } return false; };
        const nx = -Math.sin(f.yaw), ny = Math.cos(f.yaw), front = inReg(f.cx + nx * 0.6, f.cy + ny * 0.6), back = inReg(f.cx - nx * 0.6, f.cy - ny * 0.6);
        return front && !back ? 1 : -1;
    }
    // a new placement for the model on the surface under the pointer: its front looks the way the surface faces, it sits just behind the surface
    function newFit(m, s) {
        if (!s || !s.p || !s.n) return null; const nh = Math.hypot(s.n[0], s.n[1]); let nx, ny;
        if (nh < 0.5) { const cy = M.App.renderer.camera.yaw; nx = Math.cos(cy); ny = Math.sin(cy); const q = Math.round(Math.atan2(ny, nx) / (Math.PI / 2)) * (Math.PI / 2); nx = Math.cos(q); ny = Math.sin(q); }       // a floor: the front looks at the camera
        else {
            nx = s.n[0] / nh; ny = s.n[1] / nh;
            // the front looks at the side the viewer is on (a surface of the model or of the room's wall can face either way)
            const eye = M.App.renderer.camera.eye(); if ((eye[0] - s.p[0]) * nx + (eye[1] - s.p[1]) * ny < 0) { nx = -nx; ny = -ny; }
        }
        const yaw = r3(snapYaw(Math.atan2(-nx, ny))), kind = FM.kindOf(m.f), floorKind = kind === 'door' || (kind === 'frame' && !winFrameModel(m));          // (a window frame hangs where you click)
        // a model made in some other unit (a frame 99 units high) gets the height of a door; the proportions stay
        const sc = (floorKind && (m.size[2] > 4.5 || m.size[2] < 0.3)) ? 2.2 / m.size[2] : 1, w = r3(m.size[0] * sc), d = r3(Math.max(0.03, m.size[1] * sc)), h = r3(m.size[2] * sc), back = d / 2 + 0.03;
        const cs = Math.cos(yaw), sn = Math.sin(yaw), cx0 = s.p[0] - nx * (nh < 0.5 ? 0 : back), cy0 = s.p[1] - ny * (nh < 0.5 ? 0 : back), al = cx0 * cs + cy0 * sn, alS = Math.round(al / 0.01) * 0.01;
        return { id: 'new', f: m.f, m: m.id, kind, cx: r3(cx0 + (alS - al) * cs), cy: r3(cy0 + (alS - al) * sn), zb: floorKind ? 0 : Math.max(0.05, r3(Math.round((s.p[2] - h / 2) * 100) / 100)), yaw, w, d, h, hinge: m.latch > 0 ? 'r' : 'l', open: true, mode: kind === 'door' ? modeOf(m) : undefined };          // (a door hangs on the side opposite its knob: the knob is on +u, so the hinge is on the right as seen from the front)
    }
    FM.newFit = newFit; FM.fitNew = fitNew;
    // Auto-place the chosen model in detected door/window openings. Several building entities can
    // describe the same pane; keep the largest overlapping opening for placement, but cut all detected faces.
    function openingsOverlap(a, b, ratio) {
        if (!a || !b || Math.abs(Math.cos((a.yaw || 0) - (b.yaw || 0))) < 0.985) return false;
        const cs = Math.cos(a.yaw || 0), sn = Math.sin(a.yaw || 0), dx = b.cx - a.cx, dy = b.cy - a.cy;
        const du = Math.abs(dx * cs + dy * sn), dn = Math.abs(-dx * sn + dy * cs);
        if (dn > 0.35) return false;
        const ou = Math.max(0, Math.min(a.w / 2, du + b.w / 2) - Math.max(-a.w / 2, du - b.w / 2));
        const oz = Math.max(0, Math.min(a.zb + a.h, b.zb + b.h) - Math.max(a.zb, b.zb));
        const small = Math.min(a.w * a.h, b.w * b.h);
        return small > 0 && ou * oz / small >= (ratio == null ? 0.68 : ratio);
    }
    FM.autoPlaceOpenings = async function () {
        if (!IM.loaded || !IM.targetModel()) { toast('Charge d’abord le modèle du bâtiment.', 'warn'); return false; }
        const selected = FM.chosen || (selFit() && selFit().m);
        if (!selected) { toast('Choisis d’abord un modèle de porte ou de fenêtre dans l’outil Modèles.', 'warn'); return false; }
        const model = FM.model(selected), kind = model && FM.kindOf(model.f);
        if (!model || (kind !== 'door' && kind !== 'window')) { toast('Choisis un modèle de porte ou de fenêtre, pas un cadre.', 'warn'); return false; }
        let review = { candidates: [], cancelled: false, empty: true };
        if (IT() && IT().reviewAutoOpenings) review = await IT().reviewAutoOpenings({ typeFilter: kind });
        if (review.cancelled && !review.empty) return false;
        const detected = (review.candidates || []).filter(k => k.type === kind);
        const current = (imp().cutters || []).filter(k => k.type === kind && k.cx != null && k.w > 0 && k.h > 0);
        const raw = current.concat(detected);
        if (!raw.length) { toast('Aucune ouverture correspondante. Vérifie les textures ou lance d’abord la découpe automatique.', 'warn'); return false; }
        // All newly detected faces become cutters, even when overlapping entity geometry means one model is enough.
        const usedIds = new Set((imp().cutters || []).map(k => k.id));
        const added = detected.map(c => {
            const id = freshId(usedIds); usedIds.add(id);
            const copy = Object.assign({ id, mesh: false }, c);
            return IT() && IT().copyOpeningReview ? IT().copyOpeningReview(c, copy) : copy;
        });
        const all = current.concat(added), candidates = all.filter(k => k.type === kind);
        // Prefer the largest opening when two faces/entities substantially overlap.
        candidates.sort((a, b) => b.w * b.h - a.w * a.h);
        const unique = [];
        candidates.forEach(k => { if (!unique.some(q => openingsOverlap(q, k))) unique.push(k); });
        const existingFits = (imp().fits || []).filter(f => f.kind === kind && f.open !== false);
        const todo = unique.filter(k => !existingFits.some(f => openingsOverlap(f, k, 0.45)));
        if (!todo.length && !added.length) {
            toast('Chaque ouverture correspondante a déjà un modèle.', 'warn');
            return false;
        }
        const ok = await M.UI.confirm('Ajouter les modèles aux ouvertures détectées ?',
            todo.length + ' placement(s) avec le modèle « ' + (model.name || selected) + ' »; ' + added.length + ' ouverture(s) choisie(s) à découper, dont ' + added.filter(k => k.autoDetection && k.autoDetection.source === 'geometry').length + ' candidate(s) géométriques. Les ouvertures qui se chevauchent ne reçoivent qu’un modèle. Ctrl+Z annule les changements.',
            'Ajouter les modèles');
        if (!ok) return false;
        if (added.length && IT() && IT().openingReviewIsCurrent && !IT().openingReviewIsCurrent(added)) {
            toast('Le bâtiment, le quadrillage ou les faces ont changé depuis l’aperçu. Relance la détection avant de placer les modèles.', 'warn');
            return false;
        }
        // frameDepth is a full-model scan. Defer it until after the user confirms and only do it
        // for openings of the selected model type.
        const needsDepth = added.filter(k => k.dd == null && k.face);
        if (needsDepth.length && IM.frameDepthMany) {
            const depths = IM.frameDepthMany(needsDepth, needsDepth.map(k => new Set(k.face.tris.map(tr => k.face.g + ':' + tr))));
            needsDepth.forEach((k, i) => { k.dd = depths[i]; });
        }
        if (added.length) Model.edit(P => {
            added.forEach(k => {
                if (IT() && IT().clearOpeningReview) IT().clearOpeningReview(k);
                if (k.face) {
                    k.face.added = [];
                    k.face.owner = 'cutter:' + k.id;
                    k.face.claimed = k.face.tris.slice();
                    k.face.added = M.FaceDeletions.claimMany(P, (IM.targetModel() || {}).file || P.import.target, k.face.g, k.face.tris, k.face.owner);
                }
                P.import.cutters.push(k);
            });
        });
        const placements = [];
        todo.forEach(k => {
            const nf = newFit(model, { p: [k.cx, k.cy, k.zb + k.h / 2], n: [-Math.sin(k.yaw || 0), Math.cos(k.yaw || 0), 0] });
            if (!nf) return;
            nf.id = freshId(imp().fits || []); nf.cx = r3(k.cx); nf.cy = r3(k.cy); nf.zb = r3(k.zb); nf.yaw = r3(k.yaw || 0);
            nf.d = Math.max(0.03, nf.d || model.size[1] || 0.08);
            if (model.gta) { nf.w = r3(k.w); nf.h = r3(k.h); nf.g = model.name; }
            else if (kind === 'door') Object.assign(nf, openingFit(nf, k));
            else Object.assign(nf, windowFit(nf, k));
            // Use the exact reviewed candidate, not a second nearest-opening search. That prevents
            // a nearby arch/window/door cutter from stealing the model's fit during auto-placement.
            placements.push(nf);
        });
        if (placements.length) {
            Model.edit(P => { P.import.fits = P.import.fits || []; P.import.fits.push(...placements); });
            FM.sel = placements[placements.length - 1].id;
        }
        M.UI.renderLeft();
        toast((placements.length ? placements.length + ' modèle' + (placements.length === 1 ? '' : 's') + ' de ' + (kind === 'window' ? 'fenêtre' : 'porte') + ' ajouté' + (placements.length === 1 ? '' : 's') : 'Aucun nouveau modèle à ajouter') + (added.length ? '; ' + added.length + ' ouverture(s) découpée(s)' : '') + '. Une seule pièce a été placée par ouverture qui se chevauche.', 'ok');
        return true;
    };
    function place() {
        const m = FM.chosen ? FM.model(FM.chosen) : null;
        if (!m) { toast('Choose a model in the list first, then click a wall.', 'warn'); return; }
        const nf = newFit(m, hover.surf); if (!nf) { toast('Click a wall of the model or of your rooms.', 'warn'); return; }
        nf.id = freshId(imp().fits || []); if (m.gta) { nf.g = m.name; delete nf.double; }
        const { fitted, framed, wide } = m.gta ? {} : fitNew(nf);
        Model.edit(P => { (P.import.fits = P.import.fits || []).push(nf); }); FM.sel = nf.id; M.UI.renderLeft();
        const what = FM.isWinFrame(nf) ? 'window' : 'door', inside = nf.kind === 'frame' ? fits().filter(d => d.kind === what && findFrame(d, [nf])).length : 0;
        if (inside) { toast('Frame placed. ' + inside + ' ' + what + (inside === 1 ? ' stands' : 's stand') + ' in it: "Fit the ' + what + 's in it" in the panel sizes ' + (inside === 1 ? 'it' : 'them') + ' to the frame\'s opening.', 'ok'); return; }
        toast(m.name + ' placed (' + nf.w.toFixed(2) + ' x ' + nf.h.toFixed(2) + ' m)' + (framed ? ', sized to the frame\'s opening' : (fitted ? ', fitted to the opening (' + fitted.w.toFixed(2) + ' x ' + fitted.h.toFixed(2) + ' m)' : '')) + (wide ? '. The doorway is wide enough for two leaves: tick "Double door" in the panel' : '') + '. You can still drag the gizmo to move, size or turn it; the wall behind it is yours to delete with the Delete faces tool.', 'ok');
    }

    // ---------- pointer ----------
    FM.dragging = () => !!drag;
    FM.state = () => drag ? drag.type : null;
    FM.scan = function (e, ray) {
        hover.ray = ray; if (drag) return;
        const it = selFit(); hover.h = it ? handleAt(it, e) : null;
        hover.fit = hover.h ? null : pickFit(ray);
        hover.surf = (!hover.h && !hover.fit && FM.chosen) ? IT().surfaceAt(ray) : null;
    };
    const copyGeo = (it) => ({ cx: it.cx, cy: it.cy, zb: it.zb, yaw: it.yaw, w: it.w, d: it.d, h: it.h });
    FM.down = function (e) {
        const it = selFit(), ray = api().pointerRay(e);
        if (it && hover.h) { startHandle(it, hover.h, e, ray); return; }
        if (hover.fit) { FM.sel = hover.fit.id; startMove(hover.fit, e, ray); M.UI.renderLeft(); return; }
        if (!FM.chosen) { if (it) { FM.sel = null; M.UI.renderLeft(); } else toast('Choose a model in the list first, then click a wall.', 'warn'); return; }
        place();
    };
    function startMove(it, e, ray) {
        const { N, c } = axes(it), wall = Math.abs(dot(ray.d, N)) > 0.12, normal = wall ? N : [0, 0, 1], p0 = planeHitN(ray, c, normal); if (!p0) return;
        drag = { type: 'move', mode: wall ? 'wall' : 'floor', id: it.id, g0: copyGeo(it), p0, px: [e.clientX, e.clientY], moved: false, h: null };
    }
    function startHandle(it, h, e, ray) {

        const { U, N, Z, c } = axes(it); drag = { type: h.type, h, id: it.id, g0: copyGeo(it), px: [e.clientX, e.clientY], moved: false };
        if (h.type === 'arrow') { drag.A = h.dir; drag.P0 = c; drag.t0 = lineParam(ray, c, h.dir); if (drag.t0 == null) { drag = null; return; } }
        else if (h.type === 'face') { drag.A = h.axis === 'u' ? U : (h.axis === 'n' ? N : Z); drag.P0 = h.p; drag.t0 = lineParam(ray, h.p, drag.A); if (drag.t0 == null) { drag = null; return; } }
        else if (h.type === 'uni') { const sc = toScreen(c), r = M.App.canvas.getBoundingClientRect(); drag.sc = sc; drag.r0 = Math.max(12, Math.hypot(e.clientX - r.left - sc[0], e.clientY - r.top - sc[1])); }
        else if (h.type === 'ring') { const p = planeHitN(ray, [it.cx, it.cy, it.zb], [0, 0, 1]); if (!p) { drag = null; return; } drag.a0 = Math.atan2(p[1] - it.cy, p[0] - it.cx); }
    }
    FM.move = function (e) {
        const d = drag; if (!d) return; if (!d.moved && Math.hypot(e.clientX - d.px[0], e.clientY - d.px[1]) < 4) return; d.moved = true;
        const it = byId(d.id); if (!it) return; const ray = api().pointerRay(e), free = e.shiftKey, step = free ? 0.001 : 0.01, sn = (v) => Math.round(v / step) * step, g0 = d.g0;
        const cs = Math.cos(g0.yaw), si = Math.sin(g0.yaw), U = [cs, si, 0], N = [-si, cs, 0];
        let patch = null;
        if (d.type === 'move') {
            const p = d.mode === 'wall' ? planeHitN(ray, [g0.cx, g0.cy, g0.zb + g0.h / 2], N) : planeHitN(ray, [g0.cx, g0.cy, g0.zb + g0.h / 2], [0, 0, 1]); if (!p) return;
            const v = [p[0] - d.p0[0], p[1] - d.p0[1], p[2] - d.p0[2]], du = sn(dot(v, U)), dn = d.mode === 'wall' ? 0 : sn(dot(v, N)), dz = d.mode === 'wall' ? sn(v[2]) : 0;
            patch = { cx: g0.cx + U[0] * du + N[0] * dn, cy: g0.cy + U[1] * du + N[1] * dn, zb: g0.zb + dz };
        } else if (d.type === 'arrow') {
            const t = lineParam(ray, d.P0, d.A); if (t == null) return; const k = sn(t - d.t0);
            patch = d.h.axis === 'z' ? { zb: g0.zb + k } : { cx: g0.cx + d.A[0] * k, cy: g0.cy + d.A[1] * k };
        } else if (d.type === 'face') {
            const t = lineParam(ray, d.P0, d.A); if (t == null) return; const s = d.h.s, delta = t - d.t0, ax = d.h.axis, size0 = ax === 'u' ? g0.w : (ax === 'n' ? g0.d : g0.h), sym = e.altKey;
            let size = Math.max(0.05, sn(size0 + (sym ? 2 : 1) * s * delta)); const shift = sym ? 0 : s * (size - size0) / 2;
            if (ax === 'u') patch = { w: r3(size), cx: g0.cx + U[0] * shift, cy: g0.cy + U[1] * shift };
            else if (ax === 'n') patch = { d: r3(size), cx: g0.cx + N[0] * shift, cy: g0.cy + N[1] * shift };
            else patch = { h: r3(size), zb: sym ? g0.zb - (size - size0) / 2 : (s > 0 ? g0.zb : g0.zb - (size - size0)) };
        } else if (d.type === 'uni') {
            const r = M.App.canvas.getBoundingClientRect(); let f = Math.hypot(e.clientX - r.left - d.sc[0], e.clientY - r.top - d.sc[1]) / d.r0; f = free ? f : Math.round(f * 100) / 100; f = Math.max(0.1, Math.min(8, f));
            patch = { w: r3(g0.w * f), d: r3(g0.d * f), h: r3(g0.h * f) };
        } else if (d.type === 'ring') {
            const p = planeHitN(ray, [g0.cx, g0.cy, g0.zb], [0, 0, 1]); if (!p) return; let yaw = g0.yaw + (Math.atan2(p[1] - g0.cy, p[0] - g0.cx) - d.a0);
            if (!free) { const q = Math.round(yaw / (Math.PI / 12)) * (Math.PI / 12); yaw = q; }            // 15 degree steps (Shift: free)
            patch = { yaw: r3(yaw) };
        }
        if (!patch) return;
        if (patch.zb != null && !free && Math.abs(patch.zb) < 0.03) patch.zb = 0;
        for (const k in patch) patch[k] = r3(patch[k]);
        Object.assign(it, patch); bus.emit('change');
    };
    FM.up = function (e, commit) {
        const d = drag; drag = null; if (!d) return; const it = byId(d.id); if (!it) return;
        const fin = copyGeo(it); Object.assign(it, d.g0);
        if (commit && d.moved) Model.edit(P => { const q = (P.import.fits || []).find(f => f.id === d.id); if (q) Object.assign(q, fin); }); else bus.emit('change');
        M.UI.renderLeft();
    };
    FM.cancel = function () { if (!drag) return false; FM.up(null, false); return true; };

    // ---------- editing ----------
    FM.set = function (patch, id) {
        id = id || FM.sel; if (!id) return; const q0 = fits().find(f => f.id === id);
        if (q0 && q0.g) delete patch.double;          // (a model of the game is one leaf)
        Model.edit(P => { const q = (P.import.fits || []).find(f => f.id === id); if (q) Object.assign(q, patch); }); M.UI.renderLeft(); };
    // a door becomes a double door (its width is the whole doorway: the leaves keep the size the door had) or a single one again (one leaf of half the width)
    FM.setDouble = function (on) {
        const it = selFit(); if (!it || it.kind !== 'door' || !!it.double === !!on) return;
        // a door already as wide as two leaves (it was stretched over a double doorway) keeps its width, so the doorway stays as it is; a one-leaf door doubles
        const m = FM.model(it.m), nat = m ? m.size[0] * ((m.size[2] > 4.5 || m.size[2] < 0.3) ? 2.2 / m.size[2] : 1) : it.w, already = on && it.w >= nat * 1.6, nw = on ? (already ? it.w : it.w * 2) : it.w / 2, leaf = nw / (on ? 2 : 1);
        FM.set({ double: on ? true : undefined, w: r3(nw), cut: already ? it.cut : undefined });
        toast(on ? 'Double door: two leaves, ' + leaf.toFixed(2) + ' m each. Press "Match the building\'s door opening" to fit the doorway, or size and move it with the gizmo.' : 'Single door again.', 'ok');
    };
    FM.turn = function (rad) { const it = selFit(); if (!it) return false; FM.set({ yaw: r3(snapYaw(it.yaw + rad)) }); return true; };
    FM.remove = function () {
        const it = selFit(); if (!it) { toast('Select a placed model first (click it).', 'warn'); return false; }
        Model.edit(P => { P.import.fits = (P.import.fits || []).filter(f => f.id !== it.id); }); FM.sel = null; M.UI.renderLeft(); toast('Removed. Ctrl+Z brings it back.', 'ok'); return true;
    };
    FM.duplicate = function () {
        const it = selFit(); if (!it) { toast('Select a placed model first.', 'warn'); return false; }
        const { U } = axes(it), cp = Object.assign({}, it, { id: freshId(fits()), cx: r3(it.cx + U[0] * (it.w + 0.1)), cy: r3(it.cy + U[1] * (it.w + 0.1)) });
        Model.edit(P => { P.import.fits.push(cp); }); FM.sel = cp.id; M.UI.renderLeft(); toast('Copied next to it.', 'ok'); return true;
    };
    FM.select = function (id) {
        FM.sel = id;
        const it = byId(id), m = it && FM.model(it.m);
        if (it && m && it.kind === 'door' && !it.mode) FM.set({ mode: modeOf(m) }, id);
        else M.UI.renderLeft();
    };
    FM.choose = function (id) { FM.chosen = FM.chosen === id ? null : id; M.UI.renderLeft(); };
    FM.key = function (k) {
        if (k === 'Escape') { if (drag) { FM.cancel(); return true; } if (FM.sel) { FM.sel = null; M.UI.renderLeft(); return true; } if (FM.chosen) { FM.chosen = null; M.UI.renderLeft(); return true; } return false; }
        if (k === 'x' || k === 'Delete' || k === 'Backspace') { FM.remove(); return true; }
        if (k === 'r') { if (!FM.turn(Math.PI / 2)) toast('Select a placed model first: R turns it 90 degrees.', 'warn'); return true; }
        return false;
    };
    FM.keyEv = function (e, k) {
        if (e.shiftKey && !e.ctrlKey && !e.altKey && k === 'd') { FM.duplicate(); return true; }
        if (e.shiftKey && !e.ctrlKey && !e.altKey && k === 'r') { if (!FM.turn(Math.PI)) toast('Select a placed model first: Shift+R turns it around.', 'warn'); return true; }
        return false;
    };

    // ---------- helpers for the wall behind a placement ----------
    FM.boxOf = function (it) { return { cx: it.cx, cy: it.cy, zb: it.zb, w: it.w, d: it.d, h: it.h, yaw: it.yaw }; };

    // ---------- the panel ----------
    const num = (label, get, set, step, unit) => el('div', { class: 'row' }, el('label', null, label), el('input', { type: 'number', class: 'grow', step: step || '0.01', value: get(), onchange: (e) => { const v = parseFloat(e.target.value); if (!isNaN(v)) set(v); } }), unit ? el('span', { class: 'note' }, unit) : null);
    const chk = (label, get, set) => el('label', { class: 'chk' }, el('input', { type: 'checkbox', checked: get() ? true : null, onchange: (e) => set(e.target.checked) }), label);
    // ---------- the game's own doors, windows, garage doors and gates (buildings/doors by kind): a picture of each from its shape, placed as an object of the
    // interior with the furniture tool (a door of the game swings when pushed, like in the game's own interiors) ----------
    const GG = FM.game = { cat: 'door', q: '', names: null, busy: false, shown: 30, models: new Map(), loading: false, kinds: {} };
    const GCATS = [['door', 'Doors'], ['window', 'Windows'], ['garage', 'Garage'], ['gate', 'Gates']];
    async function gameList() {
        GG.busy = true; M.UI.renderLeft();
        try { const r = await Model.api('buildings/doors', 'POST', { q: GG.q, kind: GG.cat, gta: '' }); if (r.ok === false) throw new Error(r.error); GG.names = r.names || []; GG.shown = 30; }
        catch (e) { GG.names = []; toast(e.message, 'err'); }
        GG.busy = false; M.UI.renderLeft(); gamePictures();
    }
    const asThumb = (n, d) => ({ id: 'gta:' + n, name: n, min: d.bmin, max: d.bmax, size: [d.bmax[0] - d.bmin[0], d.bmax[1] - d.bmin[1], d.bmax[2] - d.bmin[2]],
        mats: [{ color: [0.74, 0.71, 0.66] }, { color: [0.6, 0.75, 0.9], glass: true }],
        geoms: (d.geoms || []).map(x => ({ mat: /glass/i.test(x.shader || '') ? 1 : 0, pos: f32(x.pos), nrm: f32(x.nrm), idx: u16(x.idx) })) });
    // the shapes of the shown models, ten at a time (without their textures)
    async function gamePictures() {
        if (GG.loading || !GG.names) return; GG.loading = true;
        try {
            for (;;) {
                const part = GG.names.slice(0, GG.shown).filter(n => !GG.models.has(n)).slice(0, 10); if (!part.length) break;
                const r = await Model.api('buildings/models', 'POST', { names: part, have: [], notex: true, gta: '' });
                part.forEach(n => { const m = (r.models || {})[n]; GG.models.set(n, m && !m.error && m.bmin ? asThumb(n, m) : { error: (m && m.error) || 'not found' }); });
                M.UI.renderLeft();
            }
        } catch (e) { toast(e.message, 'err'); }
        GG.loading = false;
    }
    FM.placeGame = function (n) {
        GG.kinds[n] = GG.cat; gameAdapt.delete(n); M.Furniture.ensure([n]); FM.chosen = 'gta:' + n; M.App.setTool('fit');
        toast(n + ': click a wall to put it there. The opening is cut to it' + (GG.cat === 'window' ? '.' : (GG.cat === 'garage' ? '; the export moves it up when someone comes near.' : '; the game swings it when pushed.')), 'ok');
    };
    function gameSection(root, so) {
        const open = !!so.fitGame;
        root.append(el('button', { class: 'sec' + (open ? ' open' : ''), onclick: () => { so.fitGame = !open; M.UI.renderLeft(); if (!open && !GG.names) gameList(); } },
            el('span', { class: 'arr' }, open ? '▾' : '▸'), el('span', { class: 'st' }, 'From the game: doors, windows, garage doors, gates')));
        if (!open) return;
        const body = el('div', { class: 'secbody' }), k = M.UI.kit;
        body.append(el('div', { class: 'row wrap' }, k.seg(GCATS, GG.cat, v => { GG.cat = v; gameList(); })));
        const q = el('input', { type: 'text', class: 'grow', placeholder: 'Filter: ph, glass, wood, metal...', value: GG.q, onkeydown: (e) => { if (e.key === 'Enter') { GG.q = q.value.trim().toLowerCase(); gameList(); } } });
        body.append(el('div', { class: 'row' }, q, el('button', { class: 'btn sm', onclick: () => { GG.q = q.value.trim().toLowerCase(); gameList(); } }, 'Find')));
        if (GG.busy) body.append(el('div', { class: 'note' }, 'Looking through the game\'s models...'));
        else if (GG.names) {
            const grid = el('div', { style: { display: 'grid', gridTemplateColumns: 'repeat(3, 1fr)', gap: '5px', maxHeight: '320px', overflowY: 'auto', paddingRight: '2px' } });
            GG.names.slice(0, GG.shown).forEach(n => {
                const m = GG.models.get(n);
                grid.append(el('div', { class: 'pitem', title: n + (m && m.size ? ': ' + f2(m.size[0]) + ' x ' + f2(m.size[2]) + ' m, ' + f2(m.size[1]) + ' m deep' : '') + ' · click to place it', style: { flexDirection: 'column', alignItems: 'center', padding: '4px', gap: '2px', opacity: m && m.error ? 0.5 : 1 }, onclick: () => FM.placeGame(n) },
                    m && m.geoms ? FM.thumb(m, 52) : el('div', { style: { width: '52px', height: '52px', display: 'flex', alignItems: 'center', justifyContent: 'center' }, class: 'note' }, m ? 'no picture' : '...'),
                    el('b', { style: { fontSize: '10px', textAlign: 'center', lineHeight: '1.1', wordBreak: 'break-all' } }, n),
                    m && m.size ? el('span', { class: 'note', style: { margin: 0, fontSize: '10px' } }, f2(m.size[0]) + ' x ' + f2(m.size[2]) + ' m') : null));
            });
            if (!GG.names.length) grid.append(el('div', { class: 'note', style: { gridColumn: '1 / -1' } }, 'Nothing of that kind' + (GG.q ? ' with "' + GG.q + '"' : '') + '.'));
            body.append(grid);
            if (GG.names.length > GG.shown) body.append(el('button', { class: 'btn sm', onclick: () => { GG.shown += 30; M.UI.renderLeft(); gamePictures(); } }, 'Show more (' + (GG.names.length - GG.shown) + ' left)'));
            body.append(el('div', { class: 'note' }, GG.names.length + ' model' + (GG.names.length === 1 ? '' : 's') + ': only ' + (GG.cat === 'window' ? 'windows' : 'the ones the game moves (it knows them as doors)') + '. Click one, then click a wall: it stands in the wall and the opening is cut to it.'));
        }
        root.append(body);
    }

    FM.panel = function (root) {
        const lib = FM.lib, k = M.UI.kit;
        if (!FM.chosen && lib.loaded && !FM.sel) { /* nothing chosen yet */ }
        // the models by kind: one tab each for windows, doors and frames, all the files' models of that kind in one grid; the files themselves (their kind,
        // their licence) are in a closed section below
        const KINDS = [['window', 'Windows'], ['door', 'Doors'], ['garage', 'Garage'], ['frame', 'Frames']], all = [];
        lib.files.forEach(f => { if (!f.error) { const kd = FM.kindOf(f.file), cat = kd === 'door' && /garage/i.test(f.file + ' ' + (f.title || '')) ? 'garage' : kd; f.models.forEach(m => all.push({ m, f, kind: cat })); } });          // (garage doors are doors with their own tab)
        const chosenRec = FM.chosen ? all.find(a => a.m.id === FM.chosen) : null;
        if (!S.fitCat) S.fitCat = chosenRec ? chosenRec.kind : 'window';
        const cat = S.fitCat, q = (S.fitFilter || '').trim().toLowerCase();
        root.append(el('div', { class: 'h' }, 'Models'));
        if (lib.busy) root.append(el('div', { class: 'note' }, 'Reading the models...'));
        if (lib.error) root.append(el('div', { class: 'note', style: { color: '#ffb3c2' } }, lib.error));
        if (!lib.files.length && !lib.busy) root.append(el('div', { class: 'note' }, 'No window or door models yet. Add a .glb with a door, or a file with several windows: each window in it becomes a model of its own.'));
        if (all.length) {
            root.append(el('div', { class: 'row' }, k.seg(KINDS.map(c => [c[0], c[1] + ' (' + all.filter(a => a.kind === c[0]).length + ')']), cat, v => { S.fitCat = v; M.UI.renderLeft(); })));
            const shown = all.filter(a => a.kind === cat && (!q || (a.m.name + ' ' + a.f.file + ' ' + (a.f.title || '')).toLowerCase().indexOf(q) >= 0));
            // own files first, then the ones that come with the program
            shown.sort((a, b) => (a.f.builtin ? 1 : 0) - (b.f.builtin ? 1 : 0));
            const filter = el('input', { type: 'text', class: 'grow', placeholder: 'Filter: oak, glass, modern...', value: S.fitFilter || '', oninput: (e) => { S.fitFilter = e.target.value; clearTimeout(FM._ft); FM._ft = setTimeout(() => { M.UI.renderLeft(); const n = document.querySelector('input[data-fitfilter]'); if (n) { n.focus(); n.setSelectionRange(n.value.length, n.value.length); } }, 250); } });
            filter.setAttribute('data-fitfilter', '1');
            root.append(el('div', { class: 'row' }, filter));
            const grid = el('div', { style: { display: 'grid', gridTemplateColumns: 'repeat(3, 1fr)', gap: '5px', maxHeight: '300px', overflowY: 'auto', paddingRight: '2px' } });
            shown.forEach(a => {
                const m = a.m, on = FM.chosen === m.id;
                grid.append(el('div', { class: 'pitem', title: m.name + ': ' + f2(m.size[0]) + ' x ' + f2(m.size[2]) + ' m, ' + f2(m.size[1]) + ' m deep, ' + m.tris.toLocaleString() + ' triangles · ' + a.f.file + (a.f.builtin ? ' (comes with the program)' : ' (your file)'), style: { flexDirection: 'column', alignItems: 'center', gap: '1px', padding: '4px 3px', borderColor: on ? 'var(--accent)' : '', background: on ? 'var(--accent-soft)' : '' }, onclick: () => FM.choose(m.id) },
                    FM.thumb(m, 52), el('b', { style: { fontSize: '10.5px', textAlign: 'center', lineHeight: '1.1' } }, m.name), el('span', { class: 'note', style: { margin: 0, fontSize: '10px' } }, f2(m.size[0]) + ' x ' + f2(m.size[2]) + (a.f.builtin ? '' : ' · own'))));
            });
            if (!shown.length) grid.append(el('div', { class: 'note', style: { gridColumn: '1 / -1' } }, q ? 'No ' + cat + ' model has "' + q + '" in its name.' : 'No ' + cat + ' models yet.'));
            root.append(grid);
        }
        root.append(el('div', { class: 'row wrap' }, el('button', { class: 'btn sm', onclick: () => M.ImportUI.addFiles('files') }, 'Add .glb models...'), el('span', { class: 'note grow' }, 'or drag a .glb onto the window')));
        // the files: what kind each one is (a file that was guessed wrong can be switched), its author and licence
        const so = S.secOpen = S.secOpen || {}, filesOpen = !!so.fitFiles, bad = lib.files.filter(f => f.error).length;
        root.append(el('button', { class: 'sec' + (filesOpen ? ' open' : ''), onclick: () => { so.fitFiles = !filesOpen; M.UI.renderLeft(); } }, el('span', { class: 'arr' }, filesOpen ? '▾' : '▸'), el('span', { class: 'st' }, 'Files (' + lib.files.length + ')'), el('span', { class: 'ss' }, bad ? bad + ' with errors' : 'kind and licence')));
        if (filesOpen) {
            const body = el('div', { class: 'secbody' });
            lib.files.forEach(f => {
                body.append(el('div', { class: 'row wrap', style: { marginTop: '6px' } }, el('b', { class: 'grow', title: f.file, style: { overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', fontSize: '11.5px' } }, f.title || f.file, f.builtin ? el('span', { class: 'note', style: { margin: '0 0 0 6px', fontWeight: 400 } }, 'built in') : null), k.seg([['window', 'Windows'], ['door', 'Door'], ['frame', 'Frame']], FM.kindOf(f.file), v => FM.setKind(f.file, v))));
                if (f.error) body.append(el('div', { class: 'note', style: { color: '#ffb3c2' } }, f.file + ': ' + f.error));
                else body.append(el('div', { class: 'note', style: { margin: '0' } }, f.models.length + ' model' + (f.models.length === 1 ? '' : 's') + (f.author ? ' · by ' + f.author.replace(/\s*\(.*$/, '') : '') + (f.license ? ' · ' + f.license.replace(/\s*\(.*$/, '').replace(/-/g, ' ') : '')));
            });
            body.append(el('div', { class: 'note' }, 'The licence of a model you place goes with the export (README).'));
            root.append(body);
        }
        gameSection(root, so);
        const ch = FM.chosen ? FM.model(FM.chosen) : null;
        root.append(el('div', { class: 'note' }, ch ? 'Chosen: ' + ch.name + '. Click a wall to put it there (you can keep clicking to place more). Esc clears the choice.' : (lib.files.length ? 'Click a model to choose it, then click a wall.' : '')));
        if (ch && !ch.gta) {
            // setting the chosen model up before it is placed: a model can lie down or face the wrong way as it comes out of its file
            const turned = ch.rot && ch.rot.some((v, i) => v !== SETUP.ident[i]), odd = ch.size[2] > 4.5 || ch.size[2] < 0.3;
            root.append(el('div', { class: 'h' }, 'Set up: ' + ch.name));
            root.append(el('div', { class: 'note' }, (ch.auto ? 'Stood up automatically. ' : (turned ? 'Turned by you. ' : 'As it is in the file. ')) + 'The picture above shows it from the front: width across, up is up. If it lies down or faces the wrong way, turn it here before you place it (models already placed keep their own size).'
                + (odd ? ' It was made in another unit (' + f2(ch.size[0]) + ' x ' + f2(ch.size[2]) + ' units): it is scaled to a door\'s height when placed, and you size it with the gizmo.' : '')));
            root.append(el('div', { class: 'row wrap' }, ...[['tilt', 'Tilt 90°'], ['roll', 'Roll 90°'], ['spin', 'Spin 90°'], ['flip', 'Flip front'], ['over', 'Upside down']].map(b => el('button', { class: 'btn sm', title: 'Turn the model a quarter turn about its ' + ({ tilt: 'width', roll: 'depth', spin: 'height' }[b[0]] || 'height') + ' axis', onclick: () => FM.setup(ch, b[0]) }, b[1])),
                el('button', { class: 'btn sm', onclick: () => FM.setup(ch, 'auto') }, 'Auto'), el('button', { class: 'btn sm', onclick: () => FM.setup(ch, 'reset') }, 'As in the file')));
        }

        const it = selFit();
        if (it) {
            const m = FM.model(it.m), door = it.kind === 'door', keep = S.fitKeep !== false;
            root.append(el('div', { class: 'h' }, 'Selected: ' + (m ? m.name : 'missing model')));
            if (it.g && m) { const sc = [it.w / m.size[0], it.d / m.size[1], it.h / m.size[2]], resized = sc.some(v => Math.abs(v - 1) > 0.005);
                root.append(el('div', { class: 'row wrap' }, el('span', { class: 'note grow' }, resized ? 'Resized: the export writes a copy of the game\'s model at this size (with its collision), still a door the game moves.' : 'In its own size (' + f2(m.size[0]) + ' x ' + f2(m.size[2]) + ' m).'),
                    resized ? el('button', { class: 'btn sm', onclick: () => FM.set({ w: r3(m.size[0]), d: r3(m.size[1]), h: r3(m.size[2]) }) }, 'Own size') : null)); }
            if (it.g) root.append(el('div', { class: 'note' }, 'A model of the game. ' + (it.kind === 'window' ? 'The opening is cut to it.' : (/roll|lift/.test(it.mode || '') ? 'A garage door: client/doors.lua of the export moves it up when someone comes near.' : 'The game moves it: it swings when pushed (or your door script moves it).'))));
            if (!m) root.append(el('div', { class: 'note', style: { color: '#ffb3c2' } }, 'The model ' + it.m + ' is not in the library (is ' + it.f + ' still in the project?). It is left out of the export.'));
            const sz = (key, v) => {
                v = Math.max(0.05, v); const f = v / it[key], patch = {};
                if (keep && it[key] > 0) { patch.w = r3(it.w * f); patch.d = r3(it.d * f); patch.h = r3(it.h * f); } else patch[key] = r3(v);
                FM.set(patch);
            };
            root.append(num('Width', () => f2(it.w, 3), v => sz('w', v), '0.01', 'm'), num('Height', () => f2(it.h, 3), v => sz('h', v), '0.01', 'm'), num('Depth', () => f2(it.d, 3), v => sz('d', v), '0.01', 'm'));
            root.append(chk('Keep the proportions when I type a size', () => keep, v => { S.fitKeep = v; M.UI.renderLeft(); }));
            root.append(num('Bottom', () => f2(it.zb, 3), v => FM.set({ zb: r3(v) }), '0.01', 'm'), num('Centre x', () => f2(it.cx, 3), v => FM.set({ cx: r3(v) }), '0.01', 'm'), num('Centre y', () => f2(it.cy, 3), v => FM.set({ cy: r3(v) }), '0.01', 'm'),
                num('Turn', () => f2(it.yaw * 180 / Math.PI, 1), v => FM.set({ yaw: r3(v * Math.PI / 180) }), '1', '°'));
            root.append(el('div', { class: 'row wrap' }, el('button', { class: 'btn sm', title: 'R', onclick: () => FM.turn(Math.PI / 2) }, 'Turn 90°'), el('button', { class: 'btn sm', title: 'Shift+R', onclick: () => FM.turn(Math.PI) }, 'Turn around'),
                el('button', { class: 'btn sm', title: 'Shift+D', onclick: () => FM.duplicate() }, 'Duplicate'), el('button', { class: 'btn sm danger', onclick: () => FM.remove() }, 'Delete ', el('kbd', null, 'X'))));
            if (door) {
                const mode = it.mode || 'swing';
                root.append(el('div', { class: 'h' }, 'How it opens'));
                root.append(el('div', { class: 'row wrap' }, k.seg([['swing', 'Swings'], ['auto', 'Swings both ways'], ['slide', 'Slides'], ['lift', 'GTA / sectional'], ['roll', 'Roller shutter']], mode, v => FM.set({ mode: v }))));
                root.append(el('div', { class: 'note' }, mode === 'lift'
                    ? 'A garage door: when someone comes within 4 m (on foot or in a car, on either side) it folds up into the garage like a sectional door, about its top edge, and lies under the ceiling; it comes down again when they are gone. It folds towards the side your rooms are on. The export\'s client/doors.lua moves it; no door script is needed.'
                    : mode === 'roll'
                    ? 'A roller shutter: when someone comes within 4 m it rolls upward into the lintel and closes again when they are gone. Use a shutter or roller-door model from the GTA door search, then size it to the opening. The export\'s client/doors.lua moves it; no door script is needed.'
                    : mode === 'slide'
                    ? 'A sliding door:when someone comes within 2 m it slides aside (into the wall, towards the side set below) and slides shut when they are gone. A double door opens to both sides at once. The export\'s client/doors.lua moves it; no door script is needed.'
                    : (mode === 'auto'
                        ? 'A swing door that opens both ways by itself: when someone comes within 2 m it swings away from them (to the other side of the wall, whichever side they come from) and closes when they are gone, like a kitchen or a café door. A double door opens both leaves. The export\'s client/doors.lua moves it; no door script is needed.'
                        : 'The game\'s door: it swings about its hinge when it is pushed, or your door script (ox_doorlock...) moves it.')));
                root.append(chk('Double door: two leaves side by side', () => !!it.double, v => FM.setDouble(v)));
                if (it.double) root.append(el('div', { class: 'note' }, 'The width is the whole doorway: each leaf is half of it, hinged on the outer edges (the orange lines) and meeting in the middle where their knobs are (the right leaf is the model mirrored). Each leaf is a door prop of its own for your door script. Turning this on doubles the width (each leaf keeps the size the door had), turning it off halves it.'));
            }
            if (door && !it.double && it.mode === 'slide') root.append(el('div', { class: 'row' }, el('label', null, 'Slides to'), k.seg([['l', 'Left'], ['r', 'Right']], it.hinge || 'l', v => FM.set({ hinge: v }))), el('div', { class: 'note' }, 'Seen from the front (the green arrow points to the front): the door slides towards the orange line, by its own width, into the wall.'));
            else if (door && !it.double && it.mode !== 'lift' && it.mode !== 'roll') root.append(el('div', { class: 'row' }, el('label', null, 'Hinge'), k.seg([['l', 'Left'], ['r', 'Right']], it.hinge || 'l', v => FM.set({ hinge: v }))), el('div', { class: 'note' }, 'Seen from the front (the green arrow points to the front); the orange line is the hinge, it starts on the side opposite the knob. The door is a prop of its own that swings about the hinge, with a collision box the thickness of the leaf: your door script (ox_doorlock...) moves it. Its opening in the interior wall is centred on the door, with room each side for the leaf to turn, so it does not catch on the wall.'));
            if (door) {
                root.append(chk('Also block the doorway with solid collision (it stays when a door script opens the door)', () => !!it.solid, v => FM.set({ solid: v })));
                root.append(el('div', { class: 'note' }, 'The door prop has its own collision box. If the game gives you no collision there, turn this on: the doorway is blocked by the interior\'s own collision, which always works, but it stays blocked when the door is swung open.'));
            }
            const inFrame = door ? findFrame(it) : null;
            if (door && inFrame) {
                root.append(el('div', { class: 'h' }, 'Frame'));
                root.append(el('div', { class: 'row wrap' }, el('button', { class: 'btn sm primary', title: 'Size the door to the opening of the frame it stands in', onclick: () => FM.fitToFrame() }, 'Fit the door to its frame')));
                root.append(el('div', { class: 'note' }, 'This door stands in a frame: the frame\'s hole is the cut in the room\'s wall, and the door is sized to the frame\'s opening (the opening less room to swing).'));
            }
            if (it.kind === 'frame') {
                const fi = frameInner(it), wf = FM.isWinFrame(it);
                root.append(el('div', { class: 'h' }, wf ? 'Window frame' : 'Frame'));
                root.append(el('div', { class: 'note' }, (fi ? 'The opening inside it is ' + f2(fi.w) + ' x ' + f2(fi.h) + ' m. ' : '') + (wf
                    ? 'A window frame goes round a window: put it on an opening cut with the Window tool (or press the first button) to make its outside that size. A window you put into it takes the size of its opening (the second button does it again); the window\'s hole is then the cut in the room\'s wall. Without a window it is an empty frame with its own hole.'
                    : 'The frame sits in the wall cut and its hole is the cut in the room\'s wall. Put it over the building\'s door faces (or press the first button) to make its outside the size of that opening; doors that stand in it are sized to its opening with the second.')));
                root.append(el('div', { class: 'row wrap' }, el('button', { class: 'btn sm primary', onclick: () => FM.matchOpening() }, 'Fit to the opening'), el('button', { class: 'btn sm', onclick: () => FM.fitDoorsInFrame() }, wf ? 'Fit the windows in it' : 'Fit the doors in it')));
            }
            if (door && !inFrame) {
                const dc = FM.doorCut(it);
                root.append(el('div', { class: 'h' }, 'Wall cut'));
                root.append(num('Cut width', () => f2(dc.w, 3), v => FM.set({ cut: { w: r3(Math.max(0.3, v)), h: dc.h, du: 0, dz: it.cut ? it.cut.dz : 0 } }), '0.01', 'm'),
                    num('Cut height', () => f2(dc.h, 3), v => FM.set({ cut: { w: dc.w, h: r3(Math.max(0.5, v)), du: 0, dz: it.cut ? it.cut.dz : 0 } }), '0.01', 'm'));
                root.append(el('div', { class: 'row wrap' }, el('button', { class: 'btn sm primary', title: 'Size the door to the opening cut behind it (Door or Archway tool), else to the building\'s door-shaped faces', onclick: () => FM.matchOpening() }, 'Fit to the opening'),
                    it.cut ? el('button', { class: 'btn sm', onclick: () => FM.set({ cut: null }) }, 'Back to the door size') : null));
                root.append(el('div', { class: 'note' }, it.cut ? 'The wall cut is the size of the building\'s own door opening (the faces you delete there), so the room\'s wall and the building\'s hole line up; the door is sized to sit in it with room to swing.' : 'The wall cut is centred on the door: the door plus the same gap on each side, enough for the leaf to turn about its hinge. Put the door over the building\'s door faces (or press the button) to cut the room\'s wall to the same size as the building\'s opening, with the door in the middle of it.'));
            }
            if (it.kind === 'window') root.append(el('div', { class: 'row wrap' }, el('button', { class: 'btn sm primary', title: 'Size and move the window to the opening cut behind it with the Window or Archway tool', onclick: () => FM.matchOpening() }, 'Fit to the opening'), el('span', { class: 'note grow' }, 'A window put on a cut opening takes its size by itself.')));
            root.append(chk('Opens the interior\'s own wall here (and makes the portal / glass collision)', () => it.open !== false, v => FM.set({ open: v })));
            root.append(el('div', { class: 'h' }, 'The wall behind it'));
            root.append(el('div', { class: 'note' }, 'Nothing is cut from the building by itself. Select the faces behind the model, delete them in the Delete faces tool, and clear the building\'s collision there if the model has to be passable.'));
            root.append(el('div', { class: 'row wrap' }, el('button', { class: 'btn sm', onclick: () => IT().faces.selectBehind(FM.boxOf(it)) }, 'Select the wall faces behind it'), el('button', { class: 'btn sm', onclick: () => IT().colBehind(FM.boxOf(it)) }, 'Select the building\'s collision there')));
        }
        const list = fits();
        root.append(el('div', { class: 'h' }, 'Placed in this building (' + list.length + ')'));
        const pl = el('div', { class: 'plist', style: { maxHeight: '150px' } });
        list.forEach(f => { const m = FM.model(f.m); pl.append(el('div', { class: 'pitem', style: { padding: '4px 8px', background: f.id === FM.sel ? 'var(--accent-soft)' : '' }, onclick: () => FM.select(f.id) }, el('b', null, m ? m.name : f.m), el('span', { class: 'note' }, f2(f.w) + ' x ' + f2(f.h) + ' m'),
            el('button', { class: 'btn sm danger', style: { marginLeft: 'auto' }, onclick: (e) => { e.stopPropagation(); Model.edit(Q => { Q.import.fits = (Q.import.fits || []).filter(q => q.id !== f.id); }); if (FM.sel === f.id) FM.sel = null; M.UI.renderLeft(); } }, 'x'))); });
        if (!list.length) pl.append(el('div', { class: 'note' }, 'None yet.'));
        root.append(pl);
        root.append(el('div', { class: 'note' }, 'The game ignores the scale of a prop, so a model you size here is written to the export at that size. Windows become part of the interior; a door is a prop with its origin at the hinge.'));
    };
})(window.MLO);
