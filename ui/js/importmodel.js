// The imported model in the editor: loads the files through the host, puts the model into the project's frame (floor at z = 0, walls square to the grid),
// shows it textured, picks its triangles with the mouse, and asks the host for the cut result whenever cutters or deleted faces change.
window.MLO = window.MLO || {};
(function (M) {
    'use strict';
    const { Model } = M, S = Model.state, bus = Model.bus;
    const IM = M.ImportModel = {
        models: [], textures: {}, files: [], entities: [], log: [], cutGeoms: new Map(), stats: null, busy: false, loading: false, loaded: false,
        showDetails: false, clipOn: false, clipR: 45, clipZ: 1e9, batches: [], tgt: [], error: '',
        cutOn: false, cutAuto: true, clipH: null
    };
    // The cutaway hides the model above a height (the roof and the upper floors) so you can see and click the walls below. cutOn is the C key / button;
    // cutAuto also does it while the Door or Window tool is active. clipZ is what the renderer and the picking use.
    IM.cutH = function () { return IM.clipH != null ? IM.clipH : (S.project.settings.ceilH || 2.45) + 0.75; };
    IM.cutByTool = function () { const t = S.shellTool; return !!IM.cutAuto && (t === 'door' || t === 'window' || t === 'figure'); };
    IM.cutActive = function () { return IM.cutOn || IM.cutByTool(); };
    IM.applyCut = function () { const z = IM.cutActive() ? IM.cutH() : 1e9; if (IM.clipZ !== z) IM.clipZ = z; };
    const imp = () => S.project.import;
    const safe = () => encodeURIComponent(Model.safeName(S.project.name));
    const toast = (t, k) => bus.emit('toast', { text: t, kind: k });

    function bytes(s) { const bin = atob(s), u = new Uint8Array(bin.length); for (let i = 0; i < bin.length; i++) u[i] = bin.charCodeAt(i); return u; }
    const f32 = (s) => new Float32Array(bytes(s).buffer);
    const u16 = (s) => new Uint16Array(bytes(s).buffer);

    // ---------- frame: shell = model local turned and shifted ----------
    function trig() { const h = (imp().frame.heading || 0) * Math.PI / 180; return [Math.cos(h), Math.sin(h)]; }
    IM.toShellWithFrame = function (x, y, z, frame) { const f = frame || imp().frame, h = (f.heading || 0) * Math.PI / 180, c = Math.cos(h), s = Math.sin(h), dx = x - f.x, dy = y - f.y; return [dx * c + dy * s, -dx * s + dy * c, z - f.z]; };
    IM.toShell = function (x, y, z) { return IM.toShellWithFrame(x, y, z, imp().frame); };
    IM.fromShell = function (x, y, z) { const f = imp().frame, c = trig(); return [f.x + x * c[0] - y * c[1], f.y + x * c[1] + y * c[0], f.z + z]; };
    IM.dirToShell = function (x, y) { const c = trig(); return [x * c[0] + y * c[1], -x * c[1] + y * c[0]]; };

    // ---------- colours for surfaces whose texture is not in the imported files ----------
    function colorFor(t, shader) {
        t = (t || '') + ' ' + (shader || ''); t = t.toLowerCase();
        if (/window|glass/.test(t)) return [0.55, 0.70, 0.85];
        if (/roof/.test(t)) return [0.50, 0.33, 0.27];
        if (/door|wood|bark/.test(t)) return [0.46, 0.34, 0.24];
        if (/tarp/.test(t)) return [0.52, 0.58, 0.62];
        if (/crop|detail|leaf|grass|plant|bush/.test(t)) return [0.30, 0.46, 0.27];
        if (/concrete|noise/.test(t)) return [0.60, 0.60, 0.58];
        if (/decal/.test(t)) return [0.55, 0.52, 0.48];
        if (/wall|plaster|tpage|stucco/.test(t)) return [0.76, 0.72, 0.65];
        return [0.66, 0.63, 0.58];
    }

    // ---------- loading ----------
    IM.reset = function () {
        IM._loadSeq = (IM._loadSeq || 0) + 1;
        cutSeq++; colSeq++; detSeq++; clearTimeout(colTimer); clearTimeout(cutTimer);
        IM.cutDet = new Map(); IM.clearDet = null; IM.clearCnt = null;
        IM.models = []; IM.textures = {}; IM.missingTex = []; IM.fromGame = 0; IM.cutGeoms.clear(); IM.stats = null; IM.batches = []; IM.tgt = []; IM.loaded = false; IM.error = ''; IM.files = []; IM.entities = []; IM.log = [];
        IM.lines = null; IM.orig = null; IM.origD = null; IM.adj = {}; IM.isl = {}; IM.partGeo = null; IM._syncKey = null; IM._weld = null; IM.colInside = null; IM.colPolys = null; IM.colFinal = null; IM._colLoading = null; IM._colPolysLoadSeq = (IM._colPolysLoadSeq || 0) + 1; frameDepthIndex = null; autoTriCache = null; gapCache.clear(); IM.cutVer = (IM.cutVer || 0) + 1;
        if (M.App.renderer) { M.App.renderer.setModelBatches([]); M.App.renderer.resetImgTextures(); }
        if (M.FitModels) M.FitModels.reset();
        if (M.Plants && M.Plants.reset) M.Plants.reset();
    };

    IM.refreshFiles = async function () {
        const r = await Model.api('import/files?name=' + safe()); IM.files = r.files || [];
        bus.emit('importfiles');
    };

    IM.load = async function () {
        if (S.project.kind !== 'import') return;
        const seq = IM._loadSeq = (IM._loadSeq || 0) + 1, P = S.project;
        const current = () => seq === IM._loadSeq && S.project === P && S.project.kind === 'import';
        IM.loading = true; IM.error = ''; bus.emit('importstatus');
        try {
            const r = await Model.api('import/model?name=' + safe() + '&target=' + encodeURIComponent(P.import.target || ''));
            if (!current()) return;
            IM.files = r.files || []; IM.entities = r.entities || []; IM.log = r.log || [];
            IM.textures = {}; (r.textures || []).forEach(t => { IM.textures[t.name] = { w: t.w, h: t.h, rgba: bytes(t.rgba) }; });
            IM.missingTex = r.missing || []; IM.fromGame = r.fromGame || 0;                                 // textures no file has (drawn in plain colours), and the ones looked up in the game
            IM.models = (r.models || []).map(m => ({
                file: m.file, target: !!m.target, bmin: m.bmin, bmax: m.bmax, tris: m.tris,
                geoms: m.geoms.map(g => ({ g: g.g, tex: (g.tex || '').toLowerCase(), texName: g.tex, shader: g.shader, bucket: g.bucket, tris: g.tris, pos: f32(g.pos), nrm: f32(g.nrm), uv: f32(g.uv), idx: u16(g.idx) }))
            }));
            // no target chosen yet (or it was removed): the biggest model is the building
            if (!IM.models.some(m => m.target) && IM.models.length) {
                const big = IM.models.slice().sort((a, b) => b.tris - a.tris)[0]; big.target = true; imp().target = big.file; Model.touch();
            }
            IM.cutGeoms.clear(); IM.stats = null; IM.lines = null; IM.orig = null; IM.origD = null; IM.adj = {}; IM.isl = {}; IM.partGeo = null; IM._weld = null; IM.cutVer = (IM.cutVer || 0) + 1;
            if (M.App.renderer) M.App.renderer.resetImgTextures();
            IM._placeKey = null; IM.applyPlaces();
            IM.segment(); IM.rebuildMembers();
            IM.loaded = true; IM.rebuild(); IM.requestCollision(); IM.autoPlaces();
            if (M.FitModels) M.FitModels.loadLib();                                                     // the window and door models (.glb files) of the project
            if (imp().cutters.length || imp().deletes.length || (imp().fills || []).length || IM.clearSpec()) IM.requestCut();
        } catch (e) {
            if (!current()) return;
            IM.error = e.message; toast('Could not read the model files: ' + e.message, 'err'); M.Errors.report('loading', e, { quiet: true });
        } finally {
            if (current()) { IM.loading = false; bus.emit('importstatus'); bus.emit('importfiles'); }
        }
    };

    IM.targetModel = function () { return IM.models.find(m => m.target) || null; };

    // ---------- buildings: the separate objects of the model (vertices that coincide belong together) ----------
    IM.segment = function () {
        IM.comp = null; IM.gIdx = new Map(); IM.member = null; const m = IM.targetModel(); if (!m) return;
        m.geoms.forEach((g, i) => IM.gIdx.set(g.g, i));
        const key = new Map(), par = []; let nid = 0;
        const find = (a) => { while (par[a] !== a) { par[a] = par[par[a]]; a = par[a]; } return a; };
        const uni = (a, b) => { a = find(a); b = find(b); if (a !== b) par[a] = b; };
        const vid = m.geoms.map(g => {
            const n = Math.floor(g.pos.length / 3), a = new Int32Array(n); a.fill(-1);
            for (let i = 0; i < n; i++) {
                const x = g.pos[i * 3], y = g.pos[i * 3 + 1], z = g.pos[i * 3 + 2]; if (![x, y, z].every(Number.isFinite)) continue;
                const k = Math.round(x * 500) + ',' + Math.round(y * 500) + ',' + Math.round(z * 500); let v = key.get(k);
                if (v === undefined) { v = nid++; key.set(k, v); par.push(v); } a[i] = v;
            }
            return a;
        });
        m.geoms.forEach((g, gi) => {
            for (let t = 0; t + 2 < g.idx.length; t += 3) {
                const a = g.idx[t], b = g.idx[t + 1], ic = g.idx[t + 2], ids = vid[gi];
                if (a >= ids.length || b >= ids.length || ic >= ids.length || ids[a] < 0 || ids[b] < 0 || ids[ic] < 0) continue;
                const p = g.pos, ax = p[a * 3], ay = p[a * 3 + 1], az = p[a * 3 + 2], ux = p[b * 3] - ax, uy = p[b * 3 + 1] - ay, uz = p[b * 3 + 2] - az,
                    vx = p[ic * 3] - ax, vy = p[ic * 3 + 1] - ay, vz = p[ic * 3 + 2] - az, area2 = Math.hypot(uy * vz - uz * vy, uz * vx - ux * vz, ux * vy - uy * vx);
                if (!Number.isFinite(area2) || area2 < 1e-10) continue;
                uni(ids[a], ids[b]); uni(ids[a], ids[ic]);
            }
        });
        const root = new Map(), comps = [], triComp = m.geoms.map(g => { const a = new Int32Array(Math.floor(g.idx.length / 3)); a.fill(-1); return a; });
        m.geoms.forEach((g, gi) => {
            for (let t = 0; t + 2 < g.idx.length; t += 3) {
                const a = g.idx[t], b = g.idx[t + 1], ic = g.idx[t + 2], ids = vid[gi];
                if (a >= ids.length || b >= ids.length || ic >= ids.length || ids[a] < 0 || ids[b] < 0 || ids[ic] < 0) continue;
                const p = g.pos, ux = p[b * 3] - p[a * 3], uy = p[b * 3 + 1] - p[a * 3 + 1], uz = p[b * 3 + 2] - p[a * 3 + 2],
                    vx = p[ic * 3] - p[a * 3], vy = p[ic * 3 + 1] - p[a * 3 + 1], vz = p[ic * 3 + 2] - p[a * 3 + 2], area2 = Math.hypot(uy * vz - uz * vy, uz * vx - ux * vz, ux * vy - uy * vx);
                if (!Number.isFinite(area2) || area2 < 1e-10) continue;
                const r = find(ids[a]); let id = root.get(r);
                if (id === undefined) { id = comps.length; root.set(r, id); comps.push({ id, tris: 0, mn: [1e9, 1e9, 1e9], mx: [-1e9, -1e9, -1e9], seed: [g.g, t / 3] }); }
                triComp[gi][t / 3] = id; const c = comps[id]; c.tris++;
                for (let k = 0; k < 3; k++) for (let a = 0; a < 3; a++) { const v = g.pos[g.idx[t + k] * 3 + a]; if (v < c.mn[a]) c.mn[a] = v; if (v > c.mx[a]) c.mx[a] = v; }
            }
        });
        IM.comp = { triComp, comps }; IM.fitCache = {};
    };
    IM.compAt = function (gdoc, tri) { const gi = IM.gIdx && IM.gIdx.get(gdoc); return (gi === undefined || !IM.comp) ? -1 : IM.comp.triComp[gi][tri]; };
    // the project remembers one triangle per part of the selected building
    IM.rebuildMembers = function () {
        IM.member = null; IM.selComps = null; const B = imp().building; if (!B || !B.parts || !B.parts.length || !IM.comp) return;
        const sel = new Set(); B.parts.forEach(p => { const c = IM.compAt(p[0], p[1]); if (c >= 0) sel.add(c); });
        if (!sel.size) return;
        IM.selComps = sel; IM.member = IM.comp.triComp.map(tc => { const a = new Uint8Array(tc.length); for (let i = 0; i < tc.length; i++) a[i] = sel.has(tc[i]) ? 1 : 0; return a; });
    };
    IM.isoMode = () => (imp().iso || 'hide');
    IM.isolating = () => !!IM.member && IM.isoMode() !== 'show';
    IM.buildingInfo = function () {
        if (!IM.selComps) return null; let tris = 0, mn = [1e9, 1e9, 1e9], mx = [-1e9, -1e9, -1e9];
        IM.selComps.forEach(id => { const c = IM.comp.comps[id]; tris += c.tris; for (let a = 0; a < 3; a++) { mn[a] = Math.min(mn[a], c.mn[a]); mx[a] = Math.max(mx[a], c.mx[a]); } });
        return { parts: IM.selComps.size, tris, size: [mx[0] - mn[0], mx[1] - mn[1], mx[2] - mn[2]] };
    };

    // the turn of the walls, the floor level and the footprint of some parts of the model (original, uncut triangles, model coordinates)
    IM.fitFrame = function (ids) {
        const m = IM.targetModel(), tc = IM.comp.triComp, set = new Set(ids), angs = [], wts = [], bins = new Float64Array(90), pts = [];
        let zmin = 1e9, zmax = -1e9, zWall = 1e9;
        m.geoms.forEach((g, gi) => {
            const p = g.pos, ix = g.idx;
            for (let t = 0; t + 2 < ix.length; t += 3) {
                if (!set.has(tc[gi][t / 3])) continue;
                const a = ix[t] * 3, b = ix[t + 1] * 3, c = ix[t + 2] * 3, e1 = [p[b] - p[a], p[b + 1] - p[a + 1], p[b + 2] - p[a + 2]], e2 = [p[c] - p[a], p[c + 1] - p[a + 1], p[c + 2] - p[a + 2]];
                const n = [e1[1] * e2[2] - e1[2] * e2[1], e1[2] * e2[0] - e1[0] * e2[2], e1[0] * e2[1] - e1[1] * e2[0]], l = Math.hypot(n[0], n[1], n[2]);
                if (l >= 0.2 && Math.abs(n[2] / l) < 0.1) {
                    const ang = (((Math.atan2(n[1], n[0]) * 180 / Math.PI) % 90) + 90) % 90; angs.push(ang); wts.push(l / 2); bins[Math.floor(ang) % 90] += l / 2;
                    if (l / 2 >= 0.5) zWall = Math.min(zWall, p[a + 2], p[b + 2], p[c + 2]);
                }
                for (const o of [a, b, c]) { pts.push(p[o], p[o + 1]); zmin = Math.min(zmin, p[o + 2]); zmax = Math.max(zmax, p[o + 2]); }
            }
        });
        let heading = imp().frame.heading || 0;
        if (wts.length) {
            let pk = 0, best = -1; for (let i = 0; i < 90; i++) { const s = bins[(i + 89) % 90] + bins[i] + bins[(i + 1) % 90]; if (s > best) { best = s; pk = i; } }
            const pa = pk + 0.5; let sw = 0, sd = 0;
            for (let i = 0; i < angs.length; i++) { const d = ((((angs[i] - pa + 45) % 90) + 90) % 90) - 45; if (Math.abs(d) <= 3) { sw += wts[i]; sd += wts[i] * d; } }
            heading = pa + (sw ? sd / sw : 0); heading = ((heading % 90) + 90) % 90; if (heading > 45) heading -= 90; heading = Math.round(heading * 100) / 100;
        }
        const h = heading * Math.PI / 180, c = Math.cos(h), s = Math.sin(h); let x0 = 1e9, x1 = -1e9, y0 = 1e9, y1 = -1e9;
        for (let i = 0; i < pts.length; i += 2) { const sx = pts[i] * c + pts[i + 1] * s, sy = -pts[i] * s + pts[i + 1] * c; x0 = Math.min(x0, sx); x1 = Math.max(x1, sx); y0 = Math.min(y0, sy); y1 = Math.max(y1, sy); }
        const cx = (x0 + x1) / 2, cy = (y0 + y1) / 2;
        return { heading, x: Math.round((cx * c - cy * s) * 1000) / 1000, y: Math.round((cx * s + cy * c) * 1000) / 1000, z: Math.round((zWall < 1e8 ? zWall : zmin) * 1000) / 1000, minx: x0, maxx: x1, miny: y0, maxy: y1, size: [x1 - x0, y1 - y0, zmax - zmin] };
    };
    // small parts that belong to a building (porch, steps, a shed roof): their middle lies in its footprint and they are smaller than it
    IM.attachedParts = function (ci) {
        const comps = IM.comp.comps, C = comps[ci], fit = IM.fitFrame([ci]), h = fit.heading * Math.PI / 180, c = Math.cos(h), s = Math.sin(h), out = [];
        const areaC = (C.mx[0] - C.mn[0]) * (C.mx[1] - C.mn[1]);
        comps.forEach(D => {
            if (D.id === ci) return; const mx = (D.mn[0] + D.mx[0]) / 2, my = (D.mn[1] + D.mx[1]) / 2, rx = mx * c + my * s, ry = -mx * s + my * c;
            if (rx < fit.minx - 0.5 || rx > fit.maxx + 0.5 || ry < fit.miny - 0.5 || ry > fit.maxy + 0.5) return;
            if ((D.mx[0] - D.mn[0]) * (D.mx[1] - D.mn[1]) > areaC * 0.8) return;
            if (D.mn[2] > C.mx[2] + 0.5 || D.mx[2] < C.mn[2] - 0.5) return; out.push(D.id);
        });
        return out;
    };
    // click on a part: the building is that part and what is attached to it; Shift adds or removes one part
    IM.selectBuilding = function (gdoc, tri, add) {
        const ci = IM.compAt(gdoc, tri); if (ci < 0) return null;
        let ids; if (add && IM.selComps) { ids = new Set(IM.selComps); if (ids.has(ci)) ids.delete(ci); else ids.add(ci); ids = [...ids]; } else ids = [ci].concat(IM.attachedParts(ci));
        if (!ids.length) return null;
        const parts = ids.map(id => IM.comp.comps[id].seed);
        Model.edit(P => { P.import.building = { parts }; if (!P.import.iso) P.import.iso = 'hide'; });
        return ids;
    };
    IM.centerOnBuilding = function () {
        if (!IM.selComps) return false; const fit = IM.fitFrame([...IM.selComps]);
        Model.edit(P => { P.import.frame = { x: fit.x, y: fit.y, z: fit.z, heading: fit.heading }; P.import.frameSet = true; }); return true;
    };
    IM.clearBuilding = function () { Model.edit(P => { delete P.import.building; }); };
    // raise (dz > 0) or lower the rooms against the model: the grid's floor height moves, and the cutters keep their place on the model.
    // The camera follows by the same amount, so the model stays where it is on screen while the rooms rise or sink.
    IM.shiftLevel = function (dz, keepView) {
        dz = Math.round(dz * 1000) / 1000; if (!dz) return false;
        const done = Model.edit(P => { const I = P.import; I.frame.z = Math.round((I.frame.z + dz) * 1000) / 1000; I.frameSet = true; I.cutters.forEach(k => { k.zb = Math.round((k.zb - dz) * 1000) / 1000; }); const lv = Model.ensureFloors(I).find(l => l.id === I.activeL); lv.z = Math.round((lv.z + dz) * 1000) / 1000; });
        if (done && !keepView && M.App.renderer) M.App.renderer.camera.target[2] += dz;
        return done;
    };
    // an object of the model as a box in the project's frame (for outlines)
    IM.compBox = function (ci) {
        // turned to the object's own walls, not to the model's axes
        IM.fitCache = IM.fitCache || {}; const fit = IM.fitCache[ci] || (IM.fitCache[ci] = IM.fitFrame([ci])), C = IM.comp.comps[ci], fh = fit.heading * Math.PI / 180;
        const cx = (fit.minx + fit.maxx) / 2, cy = (fit.miny + fit.maxy) / 2, mid = IM.toShell(cx * Math.cos(fh) - cy * Math.sin(fh), cx * Math.sin(fh) + cy * Math.cos(fh), (C.mn[2] + C.mx[2]) / 2);
        return { c: mid, hu: (fit.maxx - fit.minx) / 2, hn: (fit.maxy - fit.miny) / 2, hz: (C.mx[2] - C.mn[2]) / 2, yaw: (fit.heading - (imp().frame.heading || 0)) * Math.PI / 180 };
    };

    // With a building selected the other buildings are hidden; the detail models go with the whole block, so only the faces near the building are shown (and can be picked):
    // the box of the selected parts of the building, 2 m wider, in the model's own coordinates. Null when no building is selected.
    IM.detailBox = function () {
        if (!IM.isolating() || !IM.selComps || !IM.comp) return null; const mn = [1e9, 1e9, 1e9], mx = [-1e9, -1e9, -1e9];
        IM.selComps.forEach(id => { const c = IM.comp.comps[id]; for (let a = 0; a < 3; a++) { mn[a] = Math.min(mn[a], c.mn[a]); mx[a] = Math.max(mx[a], c.mx[a]); } });
        return { mn: mn.map(v => v - 2), mx: mx.map(v => v + 2) };
    };
    function inBox(box, pos, idx, t) {
        let x = 0, y = 0, z = 0; for (let q = 0; q < 3; q++) { const i = idx[t * 3 + q] * 3; x += pos[i] / 3; y += pos[i + 1] / 3; z += pos[i + 2] / 3; }
        return x >= box.mn[0] && x <= box.mx[0] && y >= box.mn[1] && y <= box.mx[1] && z >= box.mn[2] && z <= box.mx[2];
    }

    // ---------- batches in the project's frame ----------
    IM.rebuild = function () {
        const R = M.App.renderer; if (!R) return;
        if (IM.applyPlaces()) IM.requestCut();                                                      // (the detail models first go to where they stand)
        const f = imp().frame, c = trig(), batches = [], tgt = [], ghost = S.refMode === 'ghost', iso = IM.isoMode(), hasB = !!IM.member && iso !== 'show';
        const dmf = imp().doorModel ? imp().doorModel.file : null;
        IM.models.forEach(m => {
            if (!m.target && (!IM.showDetails || m.file === dmf)) return;
            const md = m.target ? null : mdelSet(m.file), box = (!m.target && hasB) ? IM.detailBox() : null;       // md: faces deleted from a detail model; box: with a building selected, only the details near it
            m.geoms.forEach((g, gi) => {
                const dcut = (!m.target && IM.cutDet.has(m.file)) ? IM.cutDet.get(m.file).get(g.g) : null;                   // a detail model's part with the rooms cleared out of it
                const src = (m.target && IM.cutGeoms.has(g.g)) ? IM.cutGeoms.get(g.g) : (dcut || g), nv = src.pos.length / 3, pos = new Float32Array(nv * 3), nrm = new Float32Array(nv * 3);
                for (let i = 0; i < nv; i++) {
                    const dx = src.pos[i * 3] - f.x, dy = src.pos[i * 3 + 1] - f.y; pos[i * 3] = dx * c[0] + dy * c[1]; pos[i * 3 + 1] = -dx * c[1] + dy * c[0]; pos[i * 3 + 2] = src.pos[i * 3 + 2] - f.z;
                    const nx = src.nrm[i * 3], ny = src.nrm[i * 3 + 1]; nrm[i * 3] = nx * c[0] + ny * c[1]; nrm[i * 3 + 1] = -nx * c[1] + ny * c[0]; nrm[i * 3 + 2] = src.nrm[i * 3 + 2];
                }
                let keep = src.idx, other = null;
                if (!m.target && ((md && md.size) || box)) {
                    const k2 = [];
                    for (let t = 0; t * 3 < src.idx.length; t++) {
                        if (md.has(g.g + ':' + (src.src ? src.src[t] : t))) continue;                              // (a cut part: the original triangle it came from)
                        if (box && !inBox(box, src.pos, src.idx, t)) continue;
                        k2.push(src.idx[t * 3], src.idx[t * 3 + 1], src.idx[t * 3 + 2]);
                    }
                    keep = Uint16Array.from(k2);
                }
                if (m.target && hasB) {
                    // the selected building's triangles (cut triangles know which original one they came from) and the rest
                    const mem = IM.member[gi], n = src.idx.length / 3, k = [], o = [];
                    for (let t = 0; t < n; t++) { const orig = src.src ? src.src[t] : t, dst = mem[orig] ? k : o; dst.push(src.idx[t * 3], src.idx[t * 3 + 1], src.idx[t * 3 + 2]); }
                    keep = Uint16Array.from(k); other = Uint16Array.from(o);
                }
                if (keep.length) batches.push({ level: 0, kind: 'model', group: 'model', tex: '', imgKey: IM.textures[g.tex] ? g.tex : null, flat: colorFor(g.texName, g.shader), alpha: ghost ? 0.3 : 1, noCull: true, clip: true, pos, nrm, uv: src.uv, idx: keep, glass: false, model: m.file });
                if (other && other.length && iso === 'ghost') batches.push({ level: 0, kind: 'model', group: 'model', tex: '', imgKey: null, flat: [0.62, 0.66, 0.74], alpha: 0.13, noCull: true, clip: true, pos, nrm, uv: src.uv, idx: other, glass: false, model: m.file });
                if (m.target) tgt.push({ g: g.g, pos, idx: keep });
            });
        });
        if (M.Plants) { try { M.Plants.modelBatches().forEach(b => batches.push(b)); } catch (e) { M.Errors.report('plants', e, { quiet: true }); } }          // (the map's plants, when "Show the plant models" is on)
        IM.batches = batches; IM.tgt = tgt; IM.lines = null; IM.orig = null; IM.origD = null; IM.partGeo = null;
        R.setModelBatches(batches);
        bus.emit('importmesh');
    };

    // ---------- cutting ----------
    let cutTimer = null, cutSeq = 0;
    IM.requestCut = function () { clearTimeout(cutTimer); cutTimer = setTimeout(IM.cutNow, 140); };
    IM.cutNow = async function () {
        if (S.project.kind !== 'import' || !IM.models.length) return;
        const I = imp(), seq = ++cutSeq, cutters = IM.allCutters(), clear = IM.clearSpec();           // the openings of every building, and the rooms that clear parts of the model
        const fills = I.fills || [];
        IM.cutDetails();                                                                                // the detail models are cleared by the rooms too
        if (!cutters.length && !I.deletes.length && !fills.length && !clear) {
            IM.clearCnt = null;
            if (IM.cutGeoms.size) { IM.cutGeoms.clear(); IM.stats = null; IM.cutVer = (IM.cutVer || 0) + 1; IM.rebuild(); }
            if (seq === cutSeq) { IM.busy = false; bus.emit('importstatus'); }
            return;
        }
        IM.busy = true; bus.emit('importstatus');
        try {
            const r = await Model.api('import/cut?name=' + safe(), 'POST', { target: I.target, origin: IM.NOFRAME, cutters, deletes: I.deletes, fills, clear });
            if (seq !== cutSeq) return;
            IM.cutVer = (IM.cutVer || 0) + 1;
            IM.cutGeoms.clear();
            (r.geoms || []).forEach(g => IM.cutGeoms.set(g.g, { pos: f32(g.pos), nrm: f32(g.nrm), uv: f32(g.uv), idx: u16(g.idx), tris: g.tris, src: g.src ? new Int32Array(bytes(g.src).buffer) : null }));
            IM.stats = { before: r.before, after: r.after, removed: r.removed, added: r.added }; IM.clearCnt = clear ? r.cleared : null; IM.rebuild();
        } catch (e) { toast('Cut failed: ' + e.message, 'err'); }
        if (seq === cutSeq) { IM.busy = false; bus.emit('importstatus'); }
    };

    // ---------- the door model ----------
    IM.doorModel = function () { const dm = imp().doorModel; return dm ? (IM.models.find(m => m.file === dm.file) || null) : null; };
    IM.doorSize = function () {
        const m = IM.doorModel(); if (!m) return null; const ex = m.bmax[0] - m.bmin[0], ey = m.bmax[1] - m.bmin[1];
        return { w: Math.max(ex, ey), t: Math.min(ex, ey), h: m.bmax[2] - m.bmin[2], widthAxisX: ex >= ey };
    };
    // ---------- openings made from the model's own faces (Door and Window tools) ----------
    // The faces are deleted from the model; the cutter that goes with them only opens the collision and the interior walls. Its size and place
    // are read from the faces (in the grid's frame), so they follow the grid when it moves.
    IM.faceRect = function (face) {
        const m = IM.targetModel(); if (!m || !face) return null; const g = m.geoms.find(x => x.g === face.g); if (!g) return null;
        let nx = 0, ny = 0, nz = 0, rx = 0, ry = 0, rz = 0, area = 0; const pts = [];
        face.tris.forEach(t => {
            if (!Number.isInteger(t) || t < 0 || t * 3 + 2 >= g.idx.length) return;
            const ids = [g.idx[t * 3], g.idx[t * 3 + 1], g.idx[t * 3 + 2]], nv = Math.floor(g.pos.length / 3);
            if (ids.some(i => !Number.isInteger(i) || i < 0 || i >= nv)) return;
            const v = ids.map(id => { const i = id * 3; return IM.toShell(g.pos[i], g.pos[i + 1], g.pos[i + 2]); });
            const e1 = [v[1][0] - v[0][0], v[1][1] - v[0][1], v[1][2] - v[0][2]], e2 = [v[2][0] - v[0][0], v[2][1] - v[0][1], v[2][2] - v[0][2]];
            let ax = e1[1] * e2[2] - e1[2] * e2[1], ay = e1[2] * e2[0] - e1[0] * e2[2], az = e1[0] * e2[1] - e1[1] * e2[0];
            const al = Math.hypot(ax, ay, az); if (!Number.isFinite(al) || al < 1e-10 || v.some(p => !p.every(Number.isFinite))) return;
            if (rx * rx + ry * ry + rz * rz > 1e-16 && ax * rx + ay * ry + az * rz < 0) { ax = -ax; ay = -ay; az = -az; }
            else if (rx * rx + ry * ry + rz * rz <= 1e-16) { rx = ax / al; ry = ay / al; rz = az / al; }
            nx += ax; ny += ay; nz += az; area += al / 2; v.forEach(p => pts.push(p));
        });
        const l = Math.hypot(nx, ny, nz); if (!pts.length || l < 1e-9 || Math.abs(nz / l) > 0.5 || Math.hypot(nx, ny) < 1e-9) return null;    // a floor or a roof is not a door or a window
        const yaw = Math.atan2(-nx, ny), cs = Math.cos(yaw), sn = Math.sin(yaw);
        let u0 = 1e9, u1 = -1e9, z0 = 1e9, z1 = -1e9, ns = 0, plane = 0;
        pts.forEach(p => { const u = p[0] * cs + p[1] * sn, n = -p[0] * sn + p[1] * cs; u0 = Math.min(u0, u); u1 = Math.max(u1, u); z0 = Math.min(z0, p[2]); z1 = Math.max(z1, p[2]); ns += n; plane += nx * p[0] + ny * p[1] + nz * p[2]; });
        const uc = (u0 + u1) / 2, nc = ns / pts.length, planeAt = plane / pts.length, planarity = pts.reduce((mx, p) => Math.max(mx, Math.abs((nx * p[0] + ny * p[1] + nz * p[2] - planeAt) / l)), 0), w = u1 - u0, h = z1 - z0, r3 = (v) => Math.round(v * 1000) / 1000;
        if (!(w > 0) || !(h > 0) || !Number.isFinite(planarity)) return null;
        return { cx: r3(uc * cs - nc * sn), cy: r3(uc * sn + nc * cs), zb: r3(z0), w: r3(w), h: r3(h), yaw: Math.round(yaw * 100000) / 100000, d: 0.8,
            planarity: r3(planarity), areaRatio: Math.min(1, area / Math.max(1e-9, w * h)) };
    };
    // How deep the frame of an opening sits: the model's own pieces that are left around the hole (the frame, the reveal) lie a few cm behind the
    // faces that were cut out, so glass and a door go to that depth ("in the frame") and not onto the outside surface. Metres along the outward
    // normal from the plane of the cut-out faces (negative = into the wall): the median of what is left near the opening, between 30 cm behind
    // and level with that plane; 3 cm behind when nothing is left. `extra` = faces about to be deleted (a Set of "geom:tri").
    let frameDepthIndex = null;
    IM.frameDepthMany = function (openings, extras) {
        const m = IM.targetModel(); if (!m) return (openings || []).map(() => -0.03);
        const frameKey = JSON.stringify(imp().frame || null);
        if (!frameDepthIndex || frameDepthIndex.model !== m || frameDepthIndex.frameKey !== frameKey) {
            let max = 0; m.geoms.forEach(g => { max += Math.floor(g.idx.length / 3); });
            // Larger buckets keep the index's map overhead bounded on very dense buildings.
            // The exact geometric bounds are still checked after retrieval, so this changes only
            // broad-phase granularity, not which faces qualify.
            const cell = max > 500000 ? 4 : (max > 150000 ? 2 : 1);
            const xyz = new Float32Array(max * 3), geomIds = new Uint32Array(max), triIds = new Uint32Array(max), buckets = new Map();
            let count = 0;
            m.geoms.forEach((g, gi) => {
                const p = g.pos, ix = g.idx;
                for (let t = 0; t * 3 + 2 < ix.length; t++) {
                    const a = ix[t * 3] * 3, b = ix[t * 3 + 1] * 3, c = ix[t * 3 + 2] * 3;
                    const s = IM.toShell((p[a] + p[b] + p[c]) / 3, (p[a + 1] + p[b + 1] + p[c + 1]) / 3, (p[a + 2] + p[b + 2] + p[c + 2]) / 3);
                    if (!s.every(Number.isFinite)) continue;
                    xyz[count * 3] = s[0]; xyz[count * 3 + 1] = s[1]; xyz[count * 3 + 2] = s[2];
                    geomIds[count] = gi; triIds[count] = t;
                    const key = Math.floor(s[0] / cell) + '|' + Math.floor(s[1] / cell) + '|' + Math.floor(s[2] / cell);
                    let list = buckets.get(key); if (!list) buckets.set(key, list = []); list.push(count++);
                }
            });
            frameDepthIndex = { model: m, frameKey, cell, xyz: xyz.subarray(0, count * 3), geomIds: geomIds.subarray(0, count), triIds: triIds.subarray(0, count), buckets };
        }
        const index = frameDepthIndex, cell = index.cell, deleted = new Set((imp().deletes || []).map(d => d[0] + ':' + d[1]));
        return (openings || []).map((k, oi) => {
            const extra = extras && extras[oi], skipped = extra ? new Set([...deleted, ...extra]) : deleted;
            const cs = Math.cos(k.yaw || 0), sn = Math.sin(k.yaw || 0), hu = k.w / 2 + 0.12, z0 = k.zb - 0.12, z1 = k.zb + k.h + 0.12;
            const corners = [];
            for (const u of [-hu, hu]) for (const n of [-0.3, 0.02]) corners.push([k.cx + u * cs - n * sn, k.cy + u * sn + n * cs]);
            const xs = corners.map(p => p[0]), ys = corners.map(p => p[1]), offs = [];
            const ix0 = Math.floor(Math.min(...xs) / cell), ix1 = Math.floor(Math.max(...xs) / cell), iy0 = Math.floor(Math.min(...ys) / cell), iy1 = Math.floor(Math.max(...ys) / cell);
            for (let iz = Math.floor(z0 / cell); iz <= Math.floor(z1 / cell); iz++)
                for (let iy = iy0; iy <= iy1; iy++)
                    for (let ix = ix0; ix <= ix1; ix++) {
                        const list = index.buckets.get(ix + '|' + iy + '|' + iz); if (!list) continue;
                        for (const id of list) {
                            const gi = index.geomIds[id], tri = index.triIds[id], g = m.geoms[gi];
                            if (skipped.has(g.g + ':' + tri)) continue;
                            const x = index.xyz[id * 3] - k.cx, y = index.xyz[id * 3 + 1] - k.cy, z = index.xyz[id * 3 + 2];
                            const su = x * cs + y * sn, sn2 = -x * sn + y * cs;
                            if (Math.abs(su) < hu && z > z0 && z < z1 && sn2 > -0.3 && sn2 < 0.02) offs.push(sn2);
                        }
                    }
            if (!offs.length) return -0.03;
            offs.sort((a, b) => a - b);
            return Math.round(Math.max(-0.25, Math.min(0, offs[offs.length >> 1])) * 1000) / 1000;
        });
    };
    IM.frameDepth = function (k, extra) {
        return IM.frameDepthMany([k], [extra || new Set()])[0];
    };
    // ---------- gaps in the model's wall beside a cut-out ----------
    // The hole in the model's wall is not always just the faces that were cut out: on the model's small windows the wall has a slit a few cm below
    // the cut-out that a painted frame used to cover, and that frame is gone with the faces, so from outside you look straight through it.
    // The remaining triangles of the model are drawn into a 1 cm grid in the plane of the opening (along it, up); cells that nothing covers,
    // that touch the cut-out and are closed in on all sides within 20 cm, are the gap. The result says how far it reaches beyond the cut-out on each
    // side (l, r, b, t, metres) and how deep the wall around it lies (dw, metres along the outward normal). Not counted: the space below a door
    // (the floor), and anything that reaches 20 cm out (a missing piece of wall or a big opening is not a small gap). Null when there is no gap.
    let shellCache = null; const gapCache = new Map();
    function shellTris(m) {
        const f = imp().frame, key = m.file + '|' + f.x + '|' + f.y + '|' + f.z + '|' + f.heading;
        if (shellCache && shellCache.key === key) return shellCache;
        let n = 0; m.geoms.forEach(g => { n += g.idx.length / 3; });
        const p = new Float32Array(n * 9), gg = new Int32Array(n), tt = new Int32Array(n); let o = 0;
        m.geoms.forEach(g => { for (let t = 0; t * 3 < g.idx.length; t++, o++) { gg[o] = g.g; tt[o] = t; for (let q = 0; q < 3; q++) { const i = g.idx[t * 3 + q] * 3, s = IM.toShell(g.pos[i], g.pos[i + 1], g.pos[i + 2]); p[o * 9 + q * 3] = s[0]; p[o * 9 + q * 3 + 1] = s[1]; p[o * 9 + q * 3 + 2] = s[2]; } } });
        return (shellCache = { key, n, p, g: gg, t: tt });
    }
    IM.gapAround = function (k) {
        if (!k.face || S.project.kind !== 'import') return null; const m = IM.targetModel(); if (!m) return null; const I = imp();
        const frame = I.frame || {}, faceKey = k.face.tris.join(','), deleteKey = I.deletes.map(d => d[0] + ':' + d[1]).join(',');
        const key = [S.project.name, k.id, k.type, k.cx, k.cy, k.zb, k.w, k.h, k.yaw, frame.x, frame.y, frame.z, frame.heading, k.face.g, faceKey, deleteKey, m.file].join('|');
        if (gapCache.has(key)) return gapCache.get(key);
        const R = 0.01, MG = 0.2, hw = k.w / 2, nu = Math.ceil((k.w + 2 * MG) / R), nz = Math.ceil((k.h + 2 * MG) / R), u0 = -hw - MG, z0 = -MG;
        const cov = new Uint8Array(nu * nz), dnc = new Float32Array(nu * nz), st = shellTris(m), del = new Set(I.deletes.map(d => d[0] + ':' + d[1])), cs = Math.cos(k.yaw), sn = Math.sin(k.yaw), L = new Float64Array(9);
        for (let t = 0; t < st.n; t++) {
            const o = t * 9; if (del.has(st.g[t] + ':' + st.t[t])) continue;
            let dm = 0; for (let q = 0; q < 3; q++) { const dx = st.p[o + q * 3] - k.cx, dy = st.p[o + q * 3 + 1] - k.cy; L[q * 3] = dx * cs + dy * sn; L[q * 3 + 1] = st.p[o + q * 3 + 2] - k.zb; L[q * 3 + 2] = -dx * sn + dy * cs; dm += L[q * 3 + 2]; }
            dm /= 3; if (dm < -0.8 || dm > 0.4) continue;
            const umn = Math.min(L[0], L[3], L[6]), umx = Math.max(L[0], L[3], L[6]), zmn = Math.min(L[1], L[4], L[7]), zmx = Math.max(L[1], L[4], L[7]);
            if (umx < u0 || umn > u0 + nu * R || zmx < z0 || zmn > z0 + nz * R) continue;
            const a2 = (L[3] - L[0]) * (L[7] - L[1]) - (L[6] - L[0]) * (L[4] - L[1]); if (Math.abs(a2) < 1e-6) continue;       // edge-on to the opening: lips and reveals cover nothing
            const i0 = Math.max(0, Math.floor((umn - u0) / R)), i1 = Math.min(nu - 1, Math.floor((umx - u0) / R)), j0 = Math.max(0, Math.floor((zmn - z0) / R)), j1 = Math.min(nz - 1, Math.floor((zmx - z0) / R));
            for (let j = j0; j <= j1; j++) for (let i = i0; i <= i1; i++) {
                const px = u0 + (i + 0.5) * R, pz = z0 + (j + 0.5) * R;
                const w0 = ((L[3] - px) * (L[7] - pz) - (L[6] - px) * (L[4] - pz)) / a2, w1 = ((L[6] - px) * (L[1] - pz) - (L[0] - px) * (L[7] - pz)) / a2, w2 = 1 - w0 - w1;
                if (w0 >= -1e-3 && w1 >= -1e-3 && w2 >= -1e-3) { cov[j * nu + i] = 1; dnc[j * nu + i] = dm; }
            }
        }
        const inRect = (i, j) => { const px = u0 + (i + 0.5) * R, pz = z0 + (j + 0.5) * R; return Math.abs(px) < hw && pz > 0 && pz < k.h; };
        if (k.type === 'door') for (let j = 0; j < nz; j++) if (z0 + (j + 0.5) * R < 0) for (let i = 0; i < nu; i++) cov[j * nu + i] = 1;   // the floor
        const seen = new Uint8Array(nu * nz); let l = 0, r = 0, b = 0, tp = 0; const dws = [];
        const nb = [[1, 0], [-1, 0], [0, 1], [0, -1]];
        for (let j = 0; j < nz; j++) for (let i = 0; i < nu; i++) {
            if (cov[j * nu + i] || seen[j * nu + i] || inRect(i, j)) continue;
            if (!nb.some(d => { const a = i + d[0], c = j + d[1]; return a >= 0 && c >= 0 && a < nu && c < nz && inRect(a, c); })) continue;       // seeds touch the cut-out
            const stack = [[i, j]], cells = []; let open = false; seen[j * nu + i] = 1;
            while (stack.length) {
                const c = stack.pop(); cells.push(c); if (c[0] === 0 || c[1] === 0 || c[0] === nu - 1 || c[1] === nz - 1) open = true;
                nb.forEach(d => { const a = c[0] + d[0], e = c[1] + d[1]; if (a < 0 || e < 0 || a >= nu || e >= nz || seen[e * nu + a] || cov[e * nu + a] || inRect(a, e)) return; seen[e * nu + a] = 1; stack.push([a, e]); });
            }
            if (open) continue;
            cells.forEach(c => {
                const px = u0 + (c[0] + 0.5) * R, pz = z0 + (c[1] + 0.5) * R;
                if (px < -hw) l = Math.max(l, -hw - (px - R / 2)); if (px > hw) r = Math.max(r, (px + R / 2) - hw);
                if (pz < 0) b = Math.max(b, -(pz - R / 2)); if (pz > k.h) tp = Math.max(tp, (pz + R / 2) - k.h);
                nb.forEach(d => { const a = c[0] + d[0], e = c[1] + d[1]; if (a >= 0 && e >= 0 && a < nu && e < nz && cov[e * nu + a] && !(k.type === 'door' && z0 + (e + 0.5) * R < 0)) dws.push(dnc[e * nu + a]); });
            });
        }
        const up = (v) => v > 0.015 ? Math.round((v + 0.005) * 1000) / 1000 : 0;
        l = up(l); r = up(r); b = up(b); tp = up(tp); let out = null;
        if (l || r || b || tp) { dws.sort((x, y) => x - y); out = { l, r, b, t: tp, dw: dws.length ? Math.round(dws[dws.length >> 1] * 1000) / 1000 : IM.depthOf(k) }; }
        if (gapCache.size > 400) gapCache.clear(); gapCache.set(key, out); return out;
    };
    // How far behind the faces that were cut out of the model the frame, glass and door of an opening sit ("Depth in the wall", k.dd), held between these limits wherever it
    // is used. (+10 cm in front of the faces is allowed on purpose: a window that sits further in than the wall's siding is brought forward into the interior wall with it.)
    IM.DEPTH_MIN = -0.5; IM.DEPTH_MAX = 0.1;
    IM.depthOf = function (k) { const v = k && k.dd != null ? +k.dd : 0; return Math.max(IM.DEPTH_MIN, Math.min(IM.DEPTH_MAX, isNaN(v) ? 0 : v)); };
    // after the grid moved or turned: read the openings again from their faces. Returns true when something changed.
    IM.syncFaceCutters = function () {
        let changed = false;
        imp().cutters.forEach(k => {
            if (!k.face) return; const r = IM.faceRect(k.face); if (!r) return;
            ['cx', 'cy', 'zb', 'w', 'h', 'yaw', 'd'].forEach(key => { if (Math.abs((k[key] || 0) - r[key]) > 1e-4) { k[key] = r[key]; changed = true; } });
            if (k.dd === undefined) { k.dd = IM.frameDepth(k); changed = true; }                    // openings made before frame depth existed get it now
        });
        return changed;
    };
    // removing an opening gives its faces back (inside an edit)
    IM.removeCutterIn = function (P, id) {
        const c = P.import.cutters.find(k => k.id === id); if (!c) return;
        if (c.face) M.FaceDeletions.releaseOwner(P, c.face.owner || ('cutter:' + c.id));
        P.import.cutters = P.import.cutters.filter(k => k.id !== id);
    };

    // The door model always keeps its own size. The game ignores the scale of an entity inside an interior (measured on a real test: the door came
    // out at 1.00 while the editor showed 1.06), so scaling a door to its opening cannot work; the frame generated around the door (see shell.js)
    // closes the difference between the door and the opening instead. Kept as a function because the transform and the export read it.
    IM.doorFit = function (k) { return { sxy: 1, sz: 1 }; };
    // the size the frame is built to: the door leaf, or two leaves side by side for double doors
    IM.doorGroup = function (k) { const s = IM.doorSize(); return s ? { w: s.w * (k.double ? 2 : 1), h: s.h } : null; };
    // How far the frame around a door reaches (the same numbers shell.js builds it from): half its outer width `ju` and the height of its top `top` (from the grid's floor).
    // It is built to the door model, so it can be bigger than the opening that was cut out of the model's faces; then the model's own wall is still there between the
    // opening and the frame. The wall is cut out to the MIDDLE of the frame's bars (`cu`: half the width, `ct`: the height; never less than the opening): half of every
    // bar sits in the wall and hides the wall's cut edge. The walls and the collision of the interior open to the same size (allCutters, shell.js). Null: no frame.
    IM.doorFrameExtent = function (k) {
        if (!k.face || k.type !== 'door' || !k.leaf) return null; const dg = IM.doorGroup(k); if (!dg) return null;
        // the model's own frame (k.vframe): nothing is built, the door model's own frame is the frame, so the wall is cut out to the size of the door model
        if (k.vframe) { const hw0 = k.w / 2, zt0 = k.zb + k.h, cu0 = Math.max(hw0, dg.w / 2), ct0 = Math.max(zt0, k.zb + dg.h); return { ju: cu0, top: ct0, hw: hw0, zt: zt0, cu: cu0, ct: ct0 }; }
        if (k.frame === false) return null;
        const bw = k.bw || 0.05, hw = k.w / 2, zt = k.zb + k.h, dw = dg.w / 2, dt = k.zb + dg.h, ju = Math.max(hw, dw + bw), top = Math.max(zt, dt + bw);
        return { ju, top, hw, zt, cu: Math.max(hw, (dw + ju) / 2), ct: Math.max(zt, (dt + top) / 2) };
    };
    // where the door model stands for a cutter: its width lies along the cutter, its bottom on the cutter's bottom
    IM.doorTransform = function (k) {
        const m = IM.doorModel(), s = IM.doorSize(); if (!m) return null; const fit = IM.doorFit(k);
        const ctr = [(m.bmin[0] + m.bmax[0]) / 2 * fit.sxy, (m.bmin[1] + m.bmax[1]) / 2 * fit.sxy];
        const phi = k.yaw - (s.widthAxisX ? 0 : Math.PI / 2) + (k.flip ? Math.PI : 0), nx = -Math.sin(k.yaw), ny = Math.cos(k.yaw), lo = (k.lo || 0) + (k.face && k.dd != null ? IM.depthOf(k) : 0);   // dd: the depth of the frame
        const tx = k.cx + nx * lo, ty = k.cy + ny * lo, c = Math.cos(phi), sn = Math.sin(phi);
        return { x: tx - (ctr[0] * c - ctr[1] * sn), y: ty - (ctr[0] * sn + ctr[1] * c), z: k.zb - m.bmin[2] * fit.sz, yaw: phi, sxy: fit.sxy, sz: fit.sz };
    };
    // every leaf of the door model a cutter places: one, or two for double doors (side by side, meeting in the middle of the opening, each as wide as the model)
    IM.doorTransforms = function (k) {
        const t = IM.doorTransform(k), s = IM.doorSize(); if (!t) return [];
        if (!k.double) return [t];
        const off = s.w * t.sxy / 2, ux = Math.cos(k.yaw), uy = Math.sin(k.yaw), one = (sign, flip) => IM.doorTransform(Object.assign({}, k, { cx: k.cx + ux * off * sign, cy: k.cy + uy * off * sign, flip, lo: k.lo || 0 }));
        return [one(-1, true), one(1, false)];                // the model's origin is its hinge and its knob is at the free end: hinges at the outer edges, knobs meet in the middle
    };
    // the door model drawn in every cutter that places one
    IM.doorBatches = function () {
        const out = []; if (S.project.kind !== 'import') return out; const m = IM.doorModel(); if (!m) return out;
        imp().cutters.forEach(k => {
            if (!k.leaf) return;
            IM.doorTransforms(k).forEach(t => { const c = Math.cos(t.yaw), s = Math.sin(t.yaw);
            m.geoms.forEach(g => {
                const nv = g.pos.length / 3, pos = new Float32Array(nv * 3), nrm = new Float32Array(nv * 3);
                for (let i = 0; i < nv; i++) {
                    const x = g.pos[i * 3] * t.sxy, y = g.pos[i * 3 + 1] * t.sxy, z = g.pos[i * 3 + 2] * t.sz; pos[i * 3] = t.x + x * c - y * s; pos[i * 3 + 1] = t.y + x * s + y * c; pos[i * 3 + 2] = t.z + z;
                    const a = g.nrm[i * 3], b = g.nrm[i * 3 + 1]; nrm[i * 3] = a * c - b * s; nrm[i * 3 + 1] = a * s + b * c; nrm[i * 3 + 2] = g.nrm[i * 3 + 2];
                }
                out.push({ level: 0, kind: 'door', group: 'door', tex: '', imgKey: IM.textures[g.tex] ? g.tex : null, flat: colorFor(g.texName, g.shader), alpha: 1, noCull: true, pos, nrm, uv: g.uv, idx: g.idx, glass: false });
            }); });
        });
        return out;
    };

    // ---------- the building's walls, for fitting the rooms to them and for the inner skin ----------
    // The upright faces of the building as it is cut (deleted faces gone, openings cut), in the grid's frame: { p: [9], n, c, area }. The faces of a model only look
    // outwards, so a face's back is the room behind it.
    let wallCache = null;
    IM.wallFaces = function () {
        const m = IM.targetModel(); if (!m || S.project.kind !== 'import') return [];
        const I = imp(), key = [S.project.name, m, IM.cutVer || 0, JSON.stringify(I.deletes), JSON.stringify(I.frame)].join('|');
        if (wallCache && wallCache.key === key) return wallCache.list;
        const list = [], dels = delSet();
        m.geoms.forEach(g => {
            const cut = IM.cutGeoms.has(g.g), s = cut ? IM.cutGeoms.get(g.g) : g;
            for (let t = 0; t * 3 < s.idx.length; t++) {
                if (!cut && dels.has(g.g + ':' + t)) continue;
                const P3 = [0, 1, 2].map(q => { const i = s.idx[t * 3 + q] * 3; return IM.toShell(s.pos[i], s.pos[i + 1], s.pos[i + 2]); });
                const e1 = [P3[1][0] - P3[0][0], P3[1][1] - P3[0][1], P3[1][2] - P3[0][2]], e2 = [P3[2][0] - P3[0][0], P3[2][1] - P3[0][1], P3[2][2] - P3[0][2]];
                const n = [e1[1] * e2[2] - e1[2] * e2[1], e1[2] * e2[0] - e1[0] * e2[2], e1[0] * e2[1] - e1[1] * e2[0]], l = Math.hypot(n[0], n[1], n[2]); if (l < 2e-4) continue;
                const nn = [n[0] / l, n[1] / l, n[2] / l]; if (Math.abs(nn[2]) > 0.35) continue;                      // walls only, not roofs and floors
                list.push({ p: [].concat(P3[0], P3[1], P3[2]), n: nn, c: [(P3[0][0] + P3[1][0] + P3[2][0]) / 3, (P3[0][1] + P3[1][1] + P3[2][1]) / 3, (P3[0][2] + P3[1][2] + P3[2][2]) / 3], area: l / 2 });
            }
        });
        wallCache = { key, list }; return list;
    };
    // Where each edge of each room should be so it lies exactly on the building's wall: the wall faces that look away from the room (their normal points out
    // of the edge), overlap it and lie within `tol` of it vote for a plane, the plane with the most wall wins and is taken as the average of its faces.
    // Returns [{ op, side, from, to, wall }] (side: 0 west, 1 south, 2 east, 3 north); `apply` moves the edges.
    IM.fitRooms = function (tol, apply) {
        tol = tol == null ? 0.25 : Number(tol); if (!Number.isFinite(tol) || tol < 0) tol = 0.25;
        const H = S.project.settings.ceilH || 2.45, faces = IM.wallFaces(), found = [];
        S.project.shell.ops.forEach((op, oi) => {
            if (op.op !== 'add') return; const r = op.r;
            for (let side = 0; side < 4; side++) {
                const horiz = side === 0 || side === 2, pos = r[side], dir = side === 0 || side === 1 ? -1 : 1, a0 = horiz ? r[1] : r[0], a1 = horiz ? r[3] : r[2];
                const bins = new Map();
                for (const f of faces) {
                    const nd = horiz ? f.n[0] : f.n[1]; if (nd * dir < 0.98) continue;
                    const pl = horiz ? f.c[0] : f.c[1]; if (Math.abs(pl - pos) > tol) continue;
                    if (f.c[2] < -0.2 || f.c[2] > H + 0.3) continue;
                    let lo = 1e9, hi = -1e9; for (let q = 0; q < 3; q++) { const v = f.p[q * 3 + (horiz ? 1 : 0)]; lo = Math.min(lo, v); hi = Math.max(hi, v); }
                    const ov = Math.min(hi, a1) - Math.max(lo, a0); if (ov < 0.05) continue;
                    const k = Math.round(pl * 200); let b = bins.get(k); if (!b) bins.set(k, b = { w: 0, s: 0 }); const w = f.area * (ov / Math.max(1e-6, hi - lo)); b.w += w; b.s += pl * w;
                }
                let best = null; bins.forEach(b => { if (!best || b.w > best.w) best = b; });
                if (!best || best.w < 0.4) continue;
                const to = Math.round(best.s / best.w * 1000) / 1000;
                found.push({ op: oi, side, from: pos, to, wall: best.w });                    // also edges that are already there: they take part in choosing the plane of a line
            }
        });
        // Edges of different rooms that lie on one line (within 1.2 cm, along the same direction) must end on one line: they all take the plane of the one with the most
        // wall behind it, whether or not each of them found a wall itself.
        const all = []; S.project.shell.ops.forEach((op, oi) => { if (op.op !== 'add') return; for (let side = 0; side < 4; side++) all.push({ op: oi, side, pos: op.r[side], par: side % 2 }); });
        const fnd = new Map(found.map(f => [f.op + ':' + f.side, f])), out = [], seenE = new Set();
        all.forEach(e0 => {
            if (seenE.has(e0.op + ':' + e0.side)) return;
            const cl = [e0], st = [e0]; seenE.add(e0.op + ':' + e0.side);
            while (st.length) { const e = st.pop(); all.forEach(o => { if (!seenE.has(o.op + ':' + o.side) && o.par === e.par && Math.abs(o.pos - e.pos) < 0.012) { seenE.add(o.op + ':' + o.side); cl.push(o); st.push(o); } }); }
            let best = null; cl.forEach(e => { const f = fnd.get(e.op + ':' + e.side); if (f && (!best || f.wall > best.wall)) best = f; });
            if (!best) return;
            cl.forEach(e => { if (Math.abs(e.pos - best.to) > 0.0005) out.push({ op: e.op, side: e.side, from: e.pos, to: best.to, wall: (fnd.get(e.op + ':' + e.side) || { wall: 0 }).wall }); });
        });
        if (apply && out.length) Model.edit(P => { out.forEach(f => { P.shell.ops[f.op].r[f.side] = f.to; }); });
        return out;
    };
    // ---------- rooms in one click: the inside of the building's shell as ONE room on the grid ----------
    // Everything works on rasters of the building in the grid's frame. A slice of the building at a height is drawn into a raster; the outside is flooded in
    // from the raster's edges (gaps in the walls up to a door's width are closed first, then the outside grows back up to the walls); what is left is inside.
    // Only what the building's roof covers is inside: not a yard between retaining walls, not the space under an outside stair.

    // the building's triangles (the selected one, else the whole model; all: the whole model anyway) in the grid's frame, as [positions, a, b, c, ...], and their
    // extent (1 m wider)
    let autoTriCache = null;
    function autoTris(all) {
        const m = IM.targetModel(); if (!m) return null;
        const frameKey = JSON.stringify(imp().frame || null);
        if (!autoTriCache || autoTriCache.model !== m || autoTriCache.frameKey !== frameKey) {
            // Auto Room and floor detection revisit the same model in one frame several times.
            // Cache transformed vertices to avoid rebuilding large Float32Arrays and triggering GC.
            const positions = m.geoms.map(g => {
                const sh = new Float32Array(g.pos.length), p = g.pos;
                for (let i = 0; i + 2 < p.length; i += 3) {
                    const s = IM.toShell(p[i], p[i + 1], p[i + 2]);
                    sh[i] = s[0]; sh[i + 1] = s[1]; sh[i + 2] = s[2];
                }
                return sh;
            });
            autoTriCache = { model: m, frameKey, positions, member: IM.member, all: null, selected: null };
        }
        if (autoTriCache.member !== IM.member) { autoTriCache.member = IM.member; autoTriCache.selected = null; }
        const key = all || !IM.member ? 'all' : 'selected';
        if (autoTriCache[key]) return autoTriCache[key];
        const mem = key === 'all' ? null : IM.member, tris = [];
        let zmin = 1e9, zmax = -1e9, x0 = 1e9, y0 = 1e9, x1 = -1e9, y1 = -1e9;
        m.geoms.forEach((g, gi) => {
            const ix = g.idx, sh = autoTriCache.positions[gi];
            for (let t = 0; t * 3 < ix.length; t++) {
                if (mem && !mem[gi][t]) continue;
                const a = ix[t * 3], b = ix[t * 3 + 1], c = ix[t * 3 + 2], ia = a * 3, ib = b * 3, ic = c * 3;
                if (a === undefined || b === undefined || c === undefined || ia + 2 >= sh.length || ib + 2 >= sh.length || ic + 2 >= sh.length) continue;
                if (![sh[ia], sh[ia + 1], sh[ia + 2], sh[ib], sh[ib + 1], sh[ib + 2], sh[ic], sh[ic + 1], sh[ic + 2]].every(Number.isFinite)) continue;
                const ux = sh[ib] - sh[ia], uy = sh[ib + 1] - sh[ia + 1], uz = sh[ib + 2] - sh[ia + 2],
                    vx = sh[ic] - sh[ia], vy = sh[ic + 1] - sh[ia + 1], vz = sh[ic + 2] - sh[ia + 2],
                    area2 = Math.hypot(uy * vz - uz * vy, uz * vx - ux * vz, ux * vy - uy * vx);
                if (!Number.isFinite(area2) || area2 < 1e-10) continue;
                tris.push(sh, ia, ib, ic);
                for (const o of [ia, ib, ic]) { zmin = Math.min(zmin, sh[o + 2]); zmax = Math.max(zmax, sh[o + 2]); x0 = Math.min(x0, sh[o]); x1 = Math.max(x1, sh[o]); y0 = Math.min(y0, sh[o + 1]); y1 = Math.max(y1, sh[o + 1]); }
            }
        });
        return (autoTriCache[key] = tris.length ? { tris, zmin, zmax, x0: x0 - 1, y0: y0 - 1, x1: x1 + 1, y1: y1 + 1 } : null);
    }
    const rasterOf = (B, res) => {
        const w = Math.max(0.1, B.x1 - B.x0), h = Math.max(0.1, B.y1 - B.y0), maxCells = 2000000;
        res = Math.max(0.01, Number(res) || 0.05, Math.sqrt(w * h / maxCells));
        let nx = Math.max(1, Math.ceil(w / res)), ny = Math.max(1, Math.ceil(h / res));
        while (nx * ny > maxCells) { res *= 1.01; nx = Math.max(1, Math.ceil(w / res)); ny = Math.max(1, Math.ceil(h / res)); }
        return { x0: B.x0, y0: B.y0, res, nx, ny, N: nx * ny };
    };
    // Intersect a triangle with a horizontal plane. Inclusive vertex handling prevents exact sill/head heights
    // from opening raster leaks; fully coplanar triangles are ignored because they do not define a wall trace.
    function sliceTriangleAtZ(s, a, b, c, z) {
        const za = s[a + 2], zb = s[b + 2], zc = s[c + 2], ztol = 1e-7 * Math.max(1, Math.abs(z), Math.abs(za), Math.abs(zb), Math.abs(zc));
        if (Math.max(za, zb, zc) - Math.min(za, zb, zc) <= ztol || z < Math.min(za, zb, zc) - ztol || z > Math.max(za, zb, zc) + ztol) return null;
        const pts = [], add = (x, y) => { if (!pts.some(p => Math.hypot(p[0] - x, p[1] - y) <= 1e-7)) pts.push([x, y]); };
        for (const e of [[a, b], [b, c], [c, a]]) {
            const z0 = s[e[0] + 2], z1 = s[e[1] + 2], d0 = z0 - z, d1 = z1 - z;
            if (Math.abs(d0) <= ztol) add(s[e[0]], s[e[0] + 1]);
            if ((d0 < -ztol && d1 > ztol) || (d0 > ztol && d1 < -ztol)) {
                const f = (z - z0) / (z1 - z0);
                add(s[e[0]] + (s[e[1]] - s[e[0]]) * f, s[e[0] + 1] + (s[e[1] + 1] - s[e[0] + 1]) * f);
            }
        }
        return pts.length >= 2 ? [pts[0], pts[1]] : null;
    }
    // where the triangles cross the height z, drawn into `solid`
    function sliceInto(solid, G, tris, z) {
        const { x0, y0, res, nx, ny } = G, cell = (x, y) => { const i = Math.floor((x - x0) / res), j = Math.floor((y - y0) / res); if (i >= 0 && j >= 0 && i < nx && j < ny) solid[j * nx + i] = 1; };
        for (let k = 0; k < tris.length; k += 4) {
            const s = tris[k], a = tris[k + 1], b = tris[k + 2], c = tris[k + 3], pts = sliceTriangleAtZ(s, a, b, c, z);
            if (!pts) continue; const n = Math.max(1, Math.ceil(Math.hypot(pts[1][0] - pts[0][0], pts[1][1] - pts[0][1]) / (res * 0.5)));
            const p0 = pts[0], p1 = pts[1];
            for (let i = 0; i <= n; i++) cell(p0[0] + (p1[0] - p0[0]) * i / n, p0[1] + (p1[1] - p0[1]) * i / n);
        }
    }
    // a mask grown by rc cells (a square)
    function dilate(src, G, rc) {
        const { nx, ny, N } = G, tmp = new Uint8Array(N), dst = new Uint8Array(N);
        for (let j = 0; j < ny; j++) { let last = -1e9; for (let i = 0; i < nx; i++) { if (src[j * nx + i]) last = i; if (i - last <= rc) tmp[j * nx + i] = 1; } last = 1e9; for (let i = nx - 1; i >= 0; i--) { if (src[j * nx + i]) last = i; if (last - i <= rc) tmp[j * nx + i] = 1; } }
        for (let i = 0; i < nx; i++) { let last = -1e9; for (let j = 0; j < ny; j++) { if (tmp[j * nx + i]) last = j; if (j - last <= rc) dst[j * nx + i] = 1; } last = 1e9; for (let j = ny - 1; j >= 0; j--) { if (tmp[j * nx + i]) last = j; if (last - j <= rc) dst[j * nx + i] = 1; } }
        return dst;
    }
    // the outside: flooded in from the edges past the walls thickened by rc cells, then grown back up to the walls (not through them)
    function floodOut(solid, G, rc) {
        const { nx, N } = G, bar = dilate(solid, G, rc), out = new Uint8Array(N), st = [];
        const seed = (i) => { if (!bar[i] && !out[i]) { out[i] = 1; st.push(i); } };
        for (let i = 0; i < nx; i++) { seed(i); seed(N - nx + i); } for (let j = 0; j < G.ny; j++) { seed(j * nx); seed(j * nx + nx - 1); }
        while (st.length) { const i = st.pop(), x = i % nx; if (x > 0) seed(i - 1); if (x < nx - 1) seed(i + 1); if (i >= nx) seed(i - nx); if (i < N - nx) seed(i + nx); }
        let front = []; for (let i = 0; i < N; i++) if (out[i]) front.push(i);
        for (let step = 0; step < rc + 1 && front.length; step++) {
            const nf = [], grow = (i) => { if (!out[i] && !solid[i]) { out[i] = 1; nf.push(i); } };
            for (const i of front) { const x = i % nx; if (x > 0) grow(i - 1); if (x < nx - 1) grow(i + 1); if (i >= nx) grow(i - nx); if (i < N - nx) grow(i + nx); }
            front = nf;
        }
        return out;
    }
    // the roof's triangles: the whole model's, not only the selected building's (a roof can be a part of its own that does not touch the walls; another building's
    // roof only counts where it is over this one)
    const roofTris = (B) => (IM.member ? (autoTris(true) || B) : B).tris;
    // the triangles that close the building in: the selected building's and every other part of the model within its extent and height (windows, glass doors and
    // door leaves are often parts of their own that do not touch the walls; without them the walls have holes)
    const wallTris = (B) => {
        if (!IM.member) return B.tris; const A = autoTris(true); if (!A) return B.tris;
        if (autoTriCache && autoTriCache.wallFor === B) return autoTriCache.wallTris;
        const out = [];
        for (let k = 0; k < A.tris.length; k += 4) {
            const s = A.tris[k], a = A.tris[k + 1], b = A.tris[k + 2], c = A.tris[k + 3];
            const ax = Math.min(s[a], s[b], s[c]), bx = Math.max(s[a], s[b], s[c]), ay = Math.min(s[a + 1], s[b + 1], s[c + 1]), by = Math.max(s[a + 1], s[b + 1], s[c + 1]);
            const az = Math.min(s[a + 2], s[b + 2], s[c + 2]), bz = Math.max(s[a + 2], s[b + 2], s[c + 2]);
            // Include triangles that intersect the building's expanded bounds, not only those whose centroid happens to fall inside.
            if (bx >= B.x0 && ax <= B.x1 && by >= B.y0 && ay <= B.y1 && bz >= B.zmin - 0.5 && az <= B.zmax + 0.5) out.push(s, a, b, c);
        }
        autoTriCache.wallFor = B; autoTriCache.wallTris = out;
        return out;
    };
    // The highest roof-like face at each cell center. Interpolate its actual height and ignore near-vertical faces.
    function topRaster(G, tris) {
        const { x0, y0, res, nx, ny } = G, top = new Float32Array(nx * ny).fill(-1e9);
        for (let k = 0; k < tris.length; k += 4) {
            const s = tris[k], A = tris[k + 1], B = tris[k + 2], C = tris[k + 3], ax = s[A], ay = s[A + 1], bx = s[B], by = s[B + 1], cx = s[C], cy = s[C + 1];
            const az = s[A + 2], bz = s[B + 2], cz = s[C + 2], d = (bx - ax) * (cy - ay) - (by - ay) * (cx - ax);
            if (Math.abs(d) < 1e-6) continue;
            const e1 = [bx - ax, by - ay, bz - az], e2 = [cx - ax, cy - ay, cz - az],
                nz = e1[0] * e2[1] - e1[1] * e2[0], nl = Math.hypot(e1[1] * e2[2] - e1[2] * e2[1], e1[2] * e2[0] - e1[0] * e2[2], nz);
            if (!Number.isFinite(nl) || nl < 1e-8 || Math.abs(nz / nl) < 0.2) continue;
            const e = -0.02;
            const i0 = Math.max(0, Math.floor((Math.min(ax, bx, cx) - x0) / res)), i1 = Math.min(nx - 1, Math.floor((Math.max(ax, bx, cx) - x0) / res));
            const j0 = Math.max(0, Math.floor((Math.min(ay, by, cy) - y0) / res)), j1 = Math.min(ny - 1, Math.floor((Math.max(ay, by, cy) - y0) / res));
            for (let j = j0; j <= j1; j++) for (let i = i0; i <= i1; i++) {
                const px = x0 + (i + 0.5) * res, py = y0 + (j + 0.5) * res, w0 = ((bx - px) * (cy - py) - (by - py) * (cx - px)) / d, w1 = ((cx - px) * (ay - py) - (cy - py) * (ax - px)) / d;
                const w2 = 1 - w0 - w1;
                if (w0 >= e && w1 >= e && w2 >= e) {
                    const z = w0 * az + w1 * bz + w2 * cz, o = j * nx + i;
                    if (Number.isFinite(z) && top[o] < z) top[o] = z;
                }
            }
        }
        return top;
    }

    // ---------- the roof over the active floor, for walls and ceilings that follow its slopes ----------
    // A raster (20 cm) of the lowest face of the building that is not a wall and is more than 40 cm above the grid's floor, over each point: the height of
    // that face there (an attic's roof slopes, a flat roof, the building's own slab over a floor). roofAt() returns (x, y) -> that height above the floor
    // (Infinity where nothing of the building is over it), or null without a model. Kept until the grid or the building changes.
    // (zFrom: for a floor that far above the active one; the heights are then above that floor)
    let roofCache = {};
    IM.roofAt = function (zFrom) {
        zFrom = zFrom || 0; const m = IM.targetModel(); if (!m || !IM.comp) return null;
        const key = JSON.stringify([imp().frame, imp().building, m.file, IM.comp.comps.length, zFrom]);
        if (roofCache[zFrom] && roofCache[zFrom].key === key) return roofCache[zFrom].fn;
        const B = autoTris(); if (!B) return null;
        const G = rasterOf(B, 0.2), { x0, y0, res, nx, ny } = G, low = new Float32Array(nx * ny).fill(Infinity), tris = roofTris(B);          // (the roof can be a part of its own)
        for (let k = 0; k < tris.length; k += 4) {
            const s = tris[k], A = tris[k + 1], Bq = tris[k + 2], C = tris[k + 3], ax = s[A], ay = s[A + 1], az = s[A + 2], bx = s[Bq], by = s[Bq + 1], bz = s[Bq + 2], cx = s[C], cy = s[C + 1], cz = s[C + 2];
            if (Math.max(az, bz, cz) < zFrom + 0.4) continue;
            const e1 = [bx - ax, by - ay, bz - az], e2 = [cx - ax, cy - ay, cz - az], nz = e1[0] * e2[1] - e1[1] * e2[0], l = Math.hypot(e1[1] * e2[2] - e1[2] * e2[1], e1[2] * e2[0] - e1[0] * e2[2], nz);
            if (l < 1e-6 || Math.abs(nz / l) < 0.2) continue;                                           // (walls are not a roof)
            const d = (bx - ax) * (cy - ay) - (by - ay) * (cx - ax); if (Math.abs(d) < 1e-8) continue;
            const i0 = Math.max(0, Math.floor((Math.min(ax, bx, cx) - x0) / res)), i1 = Math.min(nx - 1, Math.floor((Math.max(ax, bx, cx) - x0) / res));
            const j0 = Math.max(0, Math.floor((Math.min(ay, by, cy) - y0) / res)), j1 = Math.min(ny - 1, Math.floor((Math.max(ay, by, cy) - y0) / res));
            for (let j = j0; j <= j1; j++) for (let i = i0; i <= i1; i++) {
                const px = x0 + (i + 0.5) * res, py = y0 + (j + 0.5) * res, wa = ((bx - px) * (cy - py) - (by - py) * (cx - px)) / d, wb = ((cx - px) * (ay - py) - (cy - py) * (ax - px)) / d, wc = 1 - wa - wb;
                if (wa < -0.02 || wb < -0.02 || wc < -0.02) continue;
                const z = wa * az + wb * bz + wc * cz - zFrom, o = j * nx + i; if (z > 0.4 && z < low[o]) low[o] = z;
            }
        }
        // between the cells it is the mix of the four round the point; where one of them has nothing over it, the nearest one
        const cellAt = (i, j) => (i < 0 || j < 0 || i >= nx || j >= ny) ? Infinity : low[j * nx + i];
        const fn = (x, y) => {
            const fx = (x - x0) / res - 0.5, fy = (y - y0) / res - 0.5, i = Math.floor(fx), j = Math.floor(fy), tx = fx - i, ty = fy - j;
            const a = cellAt(i, j), b = cellAt(i + 1, j), c = cellAt(i, j + 1), dd = cellAt(i + 1, j + 1);
            if (a === Infinity || b === Infinity || c === Infinity || dd === Infinity) return cellAt(Math.round(fx), Math.round(fy));
            return (a * (1 - tx) + b * tx) * (1 - ty) + (c * (1 - tx) + dd * tx) * ty;
        };
        roofCache[zFrom] = { key, fn }; return fn;
    };
    // The active floor's rooms cut to the roof: what of them has less than `minH` (1 m) under the roof goes (a cut-out), the rest stays one room; and its walls
    // and ceiling follow the roof from now on (shell.roofFit). Returns { cuts, area } or { error }.
    IM.fitFloorToRoof = function (minH) {
        minH = minH || 1.0; const roof = IM.roofAt(), sh = S.project.shell; if (!roof) return { error: 'Import the model first.' };
        if (!sh.ops.some(o => o.op === 'add')) return { error: 'This floor has no rooms yet.' };
        const g = M.Shell.regionGrid(sh), inReg = (x, y) => { for (let i = 0; i < g.nx; i++) if (x >= g.X[i] && x < g.X[i + 1]) { for (let j = 0; j < g.ny; j++) if (y >= g.Y[j] && y < g.Y[j + 1]) return g.mask[i][j]; } return false; };
        const res = 0.25, bx0 = g.X[0], by0 = g.Y[0], ni = Math.max(1, Math.round((g.X[g.nx] - bx0) / res)), nj = Math.max(1, Math.round((g.Y[g.ny] - by0) / res)), rx = (g.X[g.nx] - bx0) / ni, ry = (g.Y[g.ny] - by0) / nj;
        const on = []; let any = false;
        // (a cell stays when the roof is high enough 30 cm round it as well: the room keeps away from a step down in the roof)
        const roofMin = (x, y) => { let m = Infinity; for (const dx of [-0.3, 0, 0.3]) for (const dy of [-0.3, 0, 0.3]) m = Math.min(m, roof(x + dx, y + dy)); return m; };
        for (let j = 0; j < nj; j++) { on.push([]); for (let i = 0; i < ni; i++) { const cx = bx0 + (i + 0.5) * rx, cy = by0 + (j + 0.5) * ry, v = inReg(cx, cy) && roofMin(cx, cy) >= minH; on[j].push(v); if (v) any = true; } }
        if (!any) return { error: 'The roof is lower than ' + minH.toFixed(1) + ' m over the whole floor: raise the floor or make it lower.' };
        // the room round what stays, and the rest cut out of it: the biggest rectangle of cells that do not stay, then the biggest of the rest...
        let i0 = ni, i1 = -1, j0 = nj, j1 = -1; for (let j = 0; j < nj; j++) for (let i = 0; i < ni; i++) if (on[j][i]) { i0 = Math.min(i0, i); i1 = Math.max(i1, i); j0 = Math.min(j0, j); j1 = Math.max(j1, j); }
        const r3 = (v) => Math.round(v * 1000) / 1000, X = (i) => r3(bx0 + i * rx), Y = (j) => r3(by0 + j * ry), off = [];
        for (let j = j0; j <= j1; j++) { off.push([]); for (let i = i0; i <= i1; i++) off[j - j0].push(!on[j][i]); }
        const cuts = [], W = i1 - i0 + 1, Hh = j1 - j0 + 1;
        for (;;) {
            let best = null; const hgt = new Array(W).fill(0);
            for (let j = 0; j < Hh; j++) {
                for (let i = 0; i < W; i++) hgt[i] = off[j][i] ? hgt[i] + 1 : 0;
                for (let i = 0; i < W; i++) { if (!hgt[i]) continue; let h = hgt[i]; for (let k = i; k < W && hgt[k]; k++) { h = Math.min(h, hgt[k]); const a = (k + 1 - i) * h; if (!best || a > best.a) best = { a, i0: i, i1: k + 1, j0: j + 1 - h, j1: j + 1 }; } }
            }
            if (!best) break;
            for (let j = best.j0; j < best.j1; j++) for (let i = best.i0; i < best.i1; i++) off[j][i] = false;
            cuts.push([X(i0 + best.i0), Y(j0 + best.j0), X(i0 + best.i1), Y(j0 + best.j1)]);
        }
        const room = [X(i0), Y(j0), X(i1 + 1), Y(j1 + 1)];
        Model.edit(P => { P.shell.ops = [{ op: 'add', r: room }].concat(cuts.map(c => ({ op: 'cut', r: c }))); P.shell.roofFit = true; });
        let area = 0; on.forEach(row => row.forEach(v => { if (v) area += rx * ry; }));
        return { cuts: cuts.length, area };
    };

    // The building's floor above the grid's floor. An exterior model has no floor inside: its outer walls start at the floor. So the heights from the model's
    // bottom up are tried in 10 cm steps: a slice of the walls 15 cm above each one, flooded from outside, gives the area they close in under the roof. The
    // floor is the lowest height at which that area is at least 60 % of the biggest one (a terrace or a retaining wall below the building closes in less; a
    // ground floor that is narrower than the floors over it does not), at the height where most of the walls crossed there start (not the model's lowest
    // point, which is often a bit of the facade reaching into the ground). Returns the height, or null when the walls close nothing in anywhere.
    IM.autoFloor = function () {
        const B = autoTris(); if (!B) return null;
        const G = rasterOf(B, Math.max(0.15, Math.max(B.x1 - B.x0, B.y1 - B.y0) / 400)), top = topRaster(G, roofTris(B)), rc = Math.ceil(0.6 / G.res);
        // only walls are sliced: a sloped roof cut through would close its own eaves in
        // (the walls that close it in: with its windows and doors; where its own walls start: the building's alone)
        const walls = [], starts = new Map();
        const upright = (T, k) => { const s = T[k], a = T[k + 1], b = T[k + 2], c = T[k + 3], e1 = [s[b] - s[a], s[b + 1] - s[a + 1], s[b + 2] - s[a + 2]], e2 = [s[c] - s[a], s[c + 1] - s[a + 1], s[c + 2] - s[a + 2]], nz = e1[0] * e2[1] - e1[1] * e2[0], l = Math.hypot(e1[1] * e2[2] - e1[2] * e2[1], e1[2] * e2[0] - e1[0] * e2[2], nz); return l > 1e-6 && Math.abs(nz / l) < 0.3 ? l / 2 : 0; };
        const WT = wallTris(B); for (let k = 0; k < WT.length; k += 4) if (upright(WT, k)) walls.push(WT[k], WT[k + 1], WT[k + 2], WT[k + 3]);
        for (let k = 0; k < B.tris.length; k += 4) {
            const ar = upright(B.tris, k); if (!ar) continue; const s = B.tris[k], zb = Math.min(s[B.tris[k + 1] + 2], s[B.tris[k + 2] + 2], s[B.tris[k + 3] + 2]), q = Math.round(zb * 50);
            let st = starts.get(q); if (!st) starts.set(q, st = { w: 0, s: 0 }); st.w += ar; st.s += zb * ar;
        }
        const levels = [];
        for (let L = B.zmin; L <= B.zmax - 2; L += 0.1) {
            const solid = new Uint8Array(G.N); sliceInto(solid, G, walls, L + 0.15);
            const out = floodOut(solid, G, rc); let n = 0;
            for (let i = 0; i < G.N; i++) if (!out[i] && !solid[i] && top[i] > L + 2) n++;
            levels.push({ L, a: n * G.res * G.res });
        }
        const best = levels.reduce((m, l) => Math.max(m, l.a), 0); if (best < 4) return null;
        // A model that has a floor slab inside (faces that look up, under at least 40 % of that area, at a height where the walls close in at least half of it):
        // the lowest such slab is the floor (foundation or basement walls below it close in as much). Without one, the floor is where the walls start.
        const slabs = new Map();
        for (let k = 0; k < B.tris.length; k += 4) {
            const s = B.tris[k], a = B.tris[k + 1], b = B.tris[k + 2], c = B.tris[k + 3];
            const e1 = [s[b] - s[a], s[b + 1] - s[a + 1], s[b + 2] - s[a + 2]], e2 = [s[c] - s[a], s[c + 1] - s[a + 1], s[c + 2] - s[a + 2]];
            const nz = e1[0] * e2[1] - e1[1] * e2[0], l = Math.hypot(e1[1] * e2[2] - e1[2] * e2[1], e1[2] * e2[0] - e1[0] * e2[2], nz); if (l < 1e-6 || nz / l < 0.95) continue;
            const z = (s[a + 2] + s[b + 2] + s[c + 2]) / 3, key = Math.round(z * 10); let sb = slabs.get(key); if (!sb) slabs.set(key, sb = { w: 0, s: 0 }); sb.w += l / 2; sb.s += z * l / 2;
        }
        const encl = (z) => { const l = levels[Math.max(0, Math.min(levels.length - 1, Math.round((z - B.zmin) / 0.1)))]; return l ? l.a : 0; };
        const floors = [...slabs.values()].map(sb => ({ z: sb.s / sb.w, w: sb.w })).filter(f => f.w >= 0.4 * best && encl(f.z) >= 0.5 * best).sort((p, q) => p.z - q.z);
        if (floors.length) return Math.round(floors[0].z * 1000) / 1000;
        // (the slice at L + 15 cm crosses the walls that start from 10 cm below the step before up to it: the most wall area of those decides)
        const L = levels.find(l => l.a >= 0.6 * best).L; let foot = null;
        starts.forEach(st => { const z = st.s / st.w; if (z >= L - 0.12 && z <= L + 0.15 && (!foot || st.w > foot.w)) foot = { z, w: st.w }; });
        return Math.round((foot ? foot.z : L) * 1000) / 1000;
    };

    // The inside of the building at the grid's floor (slices 0.3 to 2.3 m above it, below the ceiling), the model's own inner walls closed over so the floor
    // is one, cut into cells by the planes of the building's outer walls that are square to the grid. The room is the rectangle round it; the cells that are
    // not inside are cut out of it. Returns { room, cuts, area, res } or { error }.
    IM.autoRoomRects = function () {
        if (!IM.comp) return { error: 'Import the model first.' };
        const B = autoTris(); if (!B) return { error: 'The building has no faces.' };
        const H = S.project.settings.ceilH || 2.45, tris = wallTris(B);          // (with its windows and doors, which can be parts of their own)
        if (B.zmax < 0.5 || B.zmin > H) return { error: 'Nothing of the building is between the floor and the ceiling: set the grid on the building\'s floor first (Frame tool).' };
        // Keep auto-room detection responsive on large imported buildings. The old 1400-cell
        // target allowed nearly two million raster cells; flood-fill and morphology run several
        // full passes over that grid on the UI thread. 700 caps the normal worst case at ~490k.
        const G = rasterOf(B, Math.max(0.05, Math.max(B.x1 - B.x0, B.y1 - B.y0) / 700)), { x0, y0, res, nx, ny, N } = G;
        const solid = new Uint8Array(N), solidHi = new Uint8Array(N), votes = new Uint8Array(N), hiVotes = new Uint8Array(N);
        const sliceHeights = [0.3, 0.8, 1.3, 1.8, Math.min(2.3, H - 0.1)].filter((z, i, a) => z > 0.2 && z < H - 0.05 && a.indexOf(z) === i);
        sliceHeights.forEach(z => {
            const one = new Uint8Array(N); sliceInto(one, G, tris, z);
            for (let i = 0; i < N; i++) if (one[i]) { votes[i]++; if (z >= 1.25 && z <= 2) hiVotes[i]++; }
        });
        // A real wall persists across several heights; a sill, parapet or lintel alone must not become a full-height flood barrier.
        const minVotes = Math.max(1, Math.ceil(sliceHeights.length / 2)), hiHeights = sliceHeights.filter(z => z >= 1.25 && z <= 2), minHiVotes = Math.max(1, Math.ceil(hiHeights.length / 2));
        for (let i = 0; i < N; i++) { solid[i] = votes[i] >= minVotes ? 1 : 0; solidHi[i] = hiVotes[i] >= minHiVotes ? 1 : 0; }
        const top = topRaster(G, roofTris(B)), lab = new Int32Array(N);
        // the inside for a gap closing of r: the outside flooded in, then each piece of what is left kept when it is at least 1 m² and mostly under the roof;
        // a small closed-in piece of the building in it (a column, a chimney breast) belongs to it
        const inside = (r, solid) => {
            const out = floodOut(solid, G, Math.ceil(r / res)), ins = new Uint8Array(N); let cnt = 0;
            for (let i = 0; i < N; i++) if (!out[i] && !solid[i]) ins[i] = 1;
            lab.fill(-1);
            for (let i0 = 0; i0 < N; i0++) {
                if (!ins[i0] || lab[i0] >= 0) continue; const comp = [i0], st = [i0]; lab[i0] = i0; let roof = 0, edgeOpen = 0;
                while (st.length) {
                    const i = st.pop(), x = i % nx;
                    if (top[i] > H - 0.1) roof++;
                    const left = x > 0 ? i - 1 : -1, right = x < nx - 1 ? i + 1 : -1, down = i - nx, up = i + nx;
                    if (left >= 0 && ins[left] && lab[left] < 0) { lab[left] = i0; comp.push(left); st.push(left); } else if (left < 0 || out[left]) edgeOpen++;
                    if (right >= 0 && ins[right] && lab[right] < 0) { lab[right] = i0; comp.push(right); st.push(right); } else if (right < 0 || out[right]) edgeOpen++;
                    if (down >= 0 && ins[down] && lab[down] < 0) { lab[down] = i0; comp.push(down); st.push(down); } else if (down < 0 || out[down]) edgeOpen++;
                    if (up < N && ins[up] && lab[up] < 0) { lab[up] = i0; comp.push(up); st.push(up); } else if (up >= N || out[up]) edgeOpen++;
                }
                const openRatio = edgeOpen / Math.max(1, comp.length * 4);
                if (comp.length * res * res < 1 || roof < comp.length * 0.5 || (openRatio > 0.18 && roof < comp.length * 0.7)) comp.forEach(i => { ins[i] = 0; }); else cnt += comp.length;
            }
            const hole = new Uint8Array(N), maxHole = 2.5 / (res * res);
            for (let i0 = 0; i0 < N; i0++) {
                if (ins[i0] || out[i0] || hole[i0]) continue; const comp = [i0], st = [i0]; hole[i0] = 1; let open = false;
                while (st.length) {
                    const i = st.pop(), x = i % nx;
                    const left = x > 0 ? i - 1 : -1, right = x < nx - 1 ? i + 1 : -1, down = i - nx, up = i + nx;
                    if (left < 0) open = true; else if (out[left]) open = true; else if (!ins[left] && !hole[left]) { hole[left] = 1; comp.push(left); st.push(left); }
                    if (right < 0) open = true; else if (out[right]) open = true; else if (!ins[right] && !hole[right]) { hole[right] = 1; comp.push(right); st.push(right); }
                    if (down < 0) open = true; else if (out[down]) open = true; else if (!ins[down] && !hole[down]) { hole[down] = 1; comp.push(down); st.push(down); }
                    if (up >= N) open = true; else if (out[up]) open = true; else if (!ins[up] && !hole[up]) { hole[up] = 1; comp.push(up); st.push(up); }
                }
                if (!open && comp.length <= maxHole) { comp.forEach(i => { ins[i] = 1; }); cnt += comp.length; }
            }
            return { ins, out, cnt };
        };
        const pick = (sol) => { for (const r of [0.12, 0.3, 0.6]) { const f = inside(r, sol); if (f.cnt * res * res >= 3) return f; } return null; };
        const F = pick(solid);
        if (!F) return { error: 'No closed inside under the roof was found: the building\'s walls have a gap wider than a door, or the floor could not be found (set the grid on the building\'s floor with the Frame tool and try again).' };
        // Low parts in front of the walls under the eaves (a box under a window, a plinth, a porch's parapet) and high ones (an awning over a door) close in
        // a strip outside the walls: what of the inside the walls between 1.25 and 2 m do not close in as well (15 cm grace, gaps up to a double door's
        // width closed) is outside. When those walls leak (a shop window without glass), the inside of all of them stays as it is.
        const FH = inside(0.8, solidHi);
        if (FH && FH.cnt >= 0.7 * F.cnt) { const keep = dilate(FH.ins, G, Math.ceil(0.15 / res)); for (let i = 0; i < N; i++) if (F.ins[i] && !keep[i]) { F.ins[i] = 0; F.out[i] = 1; } }
        // keep only the main enclosed cavity; open porch/terrace strips that are only open on the outside edge are not counted as rooms.
        const trimOpenPerimeter = (mask, outside) => {
            const out = mask.slice();
            for (let i = 0; i < N; i++) {
                if (!mask[i]) continue;
                let sideOpen = 0;
                const x = i % nx, y = (i - x) / nx;
                if (x <= 1 || outside[i - 1]) sideOpen++;
                if (x >= nx - 2 || outside[i + 1]) sideOpen++;
                if (y <= 1 || outside[i - nx]) sideOpen++;
                if (y >= ny - 2 || outside[i + nx]) sideOpen++;
                if (sideOpen >= 2) out[i] = 0;
            }
            return out;
        };
        // the model's own inner walls are not walls of the room: the inside is closed over walls up to 70 cm thick (grown and shrunk again); it never reaches
        // past the outer walls
        const rcl = Math.ceil(0.35 / res), grown = dilate(F.ins, G, rcl), notGrown = new Uint8Array(N); for (let i = 0; i < N; i++) notGrown[i] = grown[i] ? 0 : 1;
        const shrunkOut = dilate(notGrown, G, rcl), ins = new Uint8Array(N);
        for (let i = 0; i < N; i++) ins[i] = (F.ins[i] || (!shrunkOut[i] && !F.out[i] && top[i] > H - 0.1)) ? 1 : 0;
        // what is beyond a wall and not the room: the outside, and also a space closed in only low or not under the roof (a porch behind its parapet, a yard)
        const beyond = new Uint8Array(N); for (let i = 0; i < N; i++) beyond[i] = (!ins[i] && !solid[i]) ? 1 : 0;
        const trimmed = trimOpenPerimeter(ins, beyond);
        for (let i = 0; i < N; i++) ins[i] = trimmed[i];
        // the planes of the walls that are square to the grid, and the extent of the inside: they cut the inside into cells
        let ix0 = nx, ix1 = -1, iy0 = ny, iy1 = -1; for (let i = 0; i < N; i++) if (ins[i]) { const x = i % nx, y = (i - x) / nx; ix0 = Math.min(ix0, x); ix1 = Math.max(ix1, x); iy0 = Math.min(iy0, y); iy1 = Math.max(iy1, y); }
        const bx0 = x0 + ix0 * res, bx1 = x0 + (ix1 + 1) * res, by0 = y0 + iy0 * res, by1 = y0 + (iy1 + 1) * res, cand = [[], []];
        for (let k = 0; k < tris.length; k += 4) {
            const s = tris[k], a = tris[k + 1], b = tris[k + 2], c = tris[k + 3];
            const e1 = [s[b] - s[a], s[b + 1] - s[a + 1], s[b + 2] - s[a + 2]], e2 = [s[c] - s[a], s[c + 1] - s[a + 1], s[c + 2] - s[a + 2]];
            const n = [e1[1] * e2[2] - e1[2] * e2[1], e1[2] * e2[0] - e1[0] * e2[2], e1[0] * e2[1] - e1[1] * e2[0]], l = Math.hypot(n[0], n[1], n[2]); if (l < 1e-6) continue;
            const cz = (s[a + 2] + s[b + 2] + s[c + 2]) / 3; if (cz < 0 || cz > H) continue;
            const cx = (s[a] + s[b] + s[c]) / 3, cy = (s[a + 1] + s[b + 1] + s[c + 1]) / 3;
            for (let ax = 0; ax < 2; ax++) {
                if (Math.abs(n[ax] / l) < 0.97) continue; const v = ax ? cy : cx;
                // only a face between the inside and the rest is a wall of the rooms (not a column inside, not the facade's decoration outside)
                const sg = n[ax] > 0 ? 1 : -1, at = (m, d) => { const px = ax ? cx : cx + d, py = ax ? cy + d : cy, i = Math.floor((px - x0) / res), j = Math.floor((py - y0) / res); return i >= 0 && j >= 0 && i < nx && j < ny && !!m[j * nx + i]; };
                const inA = at(ins, 0.12 * sg), inB = at(ins, -0.12 * sg); if (inA === inB) continue;
                // and an outer wall: behind it what is not the room begins within 80 cm (a wall of the model inside the building is not an edge of the room)
                const away = inA ? -sg : sg; let outer = false; for (let d = 0.05; d <= 0.8 && !outer; d += res) outer = at(beyond, away * d);
                if (!outer) continue;
                if (v < (ax ? by0 : bx0) - 0.5 || v > (ax ? by1 : bx1) + 0.5) continue; cand[ax].push([v, l / 2]);
            }
        }
        const lines = cand.map((cs, ax) => {
            cs.sort((p, q) => p[0] - q[0]); const planes = [], lo = ax ? by0 : bx0, hi = ax ? by1 : bx1;
            for (let i = 0; i < cs.length;) { let j = i, w = 0, sw = 0; while (j < cs.length && cs[j][0] - cs[i][0] < 0.03) { w += cs[j][1]; sw += cs[j][0] * cs[j][1]; j++; } if (w >= 0.25) planes.push(sw / w); i = j; }
            // the ends: the outermost wall plane near the raster's extent (the raster is only 5 cm exact), else the extent itself
            const near = (e) => planes.filter(v => Math.abs(v - e) <= 0.15).sort((p, q) => Math.abs(p - e) - Math.abs(q - e))[0];
            const a0 = near(lo), a1 = near(hi), e0 = a0 != null ? a0 : lo, e1 = a1 != null ? a1 : hi;
            // (planes closer than 8 cm are the two faces of one thin thing: one line is enough)
            const out = [e0]; planes.filter(v => v > e0 + 0.08 && v < e1 - 0.08).sort((p, q) => p - q).forEach(v => { if (v - out[out.length - 1] > 0.08) out.push(v); }); out.push(e1);
            return out;
        });
        // how much of each cell is inside: a summed-area table of the raster
        const sat = new Float64Array((nx + 1) * (ny + 1));
        for (let j = 0; j < ny; j++) { let row = 0; for (let i = 0; i < nx; i++) { row += ins[j * nx + i]; sat[(j + 1) * (nx + 1) + i + 1] = sat[j * (nx + 1) + i + 1] + row; } }
        const sum = (i0, j0, i1, j1) => sat[j1 * (nx + 1) + i1] - sat[j0 * (nx + 1) + i1] - sat[j1 * (nx + 1) + i0] + sat[j0 * (nx + 1) + i0];
        const LX = lines[0], LY = lines[1], on = [];
        for (let j = 0; j + 1 < LY.length; j++) {
            on.push([]);
            for (let i = 0; i + 1 < LX.length; i++) {
                // (a cell thinner than the raster is judged by the raster row or column it lies in)
                const ci0 = Math.round((LX[i] - x0) / res), ci1 = Math.max(ci0 + 1, Math.round((LX[i + 1] - x0) / res)), cj0 = Math.round((LY[j] - y0) / res), cj1 = Math.max(cj0 + 1, Math.round((LY[j + 1] - y0) / res));
                const area = (ci1 - ci0) * (cj1 - cj0); on[j].push(sum(ci0, cj0, ci1, cj1) / area >= 0.5);
            }
        }
        // ONE room: the rectangle round the whole inside; the cells of it that are not inside (the missing corner of an L, a notch of the outline) are cut out of it,
        // each cut-out the biggest rectangle of such cells, then the biggest of the rest, and so on
        const r3 = (v) => Math.round(v * 1000) / 1000, cuts = [], nI = LX.length - 1, nJ = on.length;
        if (!on.some(row => row.some(v => v))) return { error: 'The inside that was found is too small for a room.' };
        const off = on.map(row => row.map(v => !v));
        for (;;) {
            let best = null; const hgt = new Array(nI).fill(0);
            for (let j = 0; j < nJ; j++) {
                for (let i = 0; i < nI; i++) hgt[i] = off[j][i] ? hgt[i] + 1 : 0;
                for (let i = 0; i < nI; i++) {
                    if (!hgt[i]) continue; let h = hgt[i];
                    for (let k = i; k < nI && hgt[k]; k++) { h = Math.min(h, hgt[k]); const a = (LX[k + 1] - LX[i]) * (LY[j + 1] - LY[j + 1 - h]); if (!best || a > best.a) best = { a, i0: i, i1: k + 1, j0: j + 1 - h, j1: j + 1 }; }
                }
            }
            if (!best) break;
            for (let j = best.j0; j < best.j1; j++) for (let i = best.i0; i < best.i1; i++) off[j][i] = false;
            cuts.push([r3(LX[best.i0]), r3(LY[best.j0]), r3(LX[best.i1]), r3(LY[best.j1])]);
        }
        const room = [r3(LX[0]), r3(LY[0]), r3(LX[nI]), r3(LY[nJ])], ar = (r) => (r[2] - r[0]) * (r[3] - r[1]), area = ar(room) - cuts.reduce((a, r) => a + ar(r), 0);
        // a cut-out that reaches the room's edge goes 50 cm past it, so it still does when the edge is fitted onto the wall
        cuts.forEach(c => { if (c[0] <= room[0]) c[0] = r3(room[0] - 0.5); if (c[1] <= room[1]) c[1] = r3(room[1] - 0.5); if (c[2] >= room[2]) c[2] = r3(room[2] + 0.5); if (c[3] >= room[3]) c[3] = r3(room[3] + 0.5); });
        // Read-only room candidates: persistent internal wall traces are thickened across ordinary door-width gaps,
        // then connected open areas are labeled. This is an analysis aid only, not a game-room/export generator.
        const barrier = dilate(solid, G, Math.ceil(0.6 / res)), visited = new Uint8Array(N), roomCandidates = [];
        for (let seed = 0; seed < N; seed++) {
            if (visited[seed] || !ins[seed] || barrier[seed]) continue;
            const queue = [seed], cells = []; visited[seed] = 1;
            let roof = 0, sx = 0, sy = 0, ix0 = nx, ix1 = -1, iy0 = ny, iy1 = -1;
            while (queue.length) {
                const at = queue.pop(), x = at % nx, y = Math.floor(at / nx);
                cells.push(at); sx += x; sy += y;
                ix0 = Math.min(ix0, x); ix1 = Math.max(ix1, x); iy0 = Math.min(iy0, y); iy1 = Math.max(iy1, y);
                if (top[at] >= H - 0.1) roof++;
                const left = x > 0 ? at - 1 : -1, right = x + 1 < nx ? at + 1 : -1, down = y > 0 ? at - nx : -1, up = y + 1 < ny ? at + nx : -1;
                if (left >= 0 && !visited[left] && ins[left] && !barrier[left]) { visited[left] = 1; queue.push(left); }
                if (right >= 0 && !visited[right] && ins[right] && !barrier[right]) { visited[right] = 1; queue.push(right); }
                if (down >= 0 && !visited[down] && ins[down] && !barrier[down]) { visited[down] = 1; queue.push(down); }
                if (up >= 0 && !visited[up] && ins[up] && !barrier[up]) { visited[up] = 1; queue.push(up); }
            }
            const candidateArea = cells.length * res * res;
            if (candidateArea < 1.5) continue;
            const roofRatio = roof / Math.max(1, cells.length);
            roomCandidates.push({
                id: roomCandidates.length + 1, area: candidateArea, roofRatio,
                box: [r3(x0 + ix0 * res), r3(y0 + iy0 * res), r3(x0 + (ix1 + 1) * res), r3(y0 + (iy1 + 1) * res)],
                centroid: [r3(x0 + sx / cells.length * res), r3(y0 + sy / cells.length * res)],
                cells: Uint32Array.from(cells)
            });
        }
        roomCandidates.sort((a, b) => b.area - a.area).forEach((c, i) => { c.id = i + 1; });
        let wallSeen = 0, wallPersistent = 0, insideCells = 0, roofCells = 0;
        for (let i = 0; i < N; i++) {
            if (votes[i]) { wallSeen++; if (votes[i] >= minVotes) wallPersistent++; }
            if (ins[i]) { insideCells++; if (top[i] > H - 0.1) roofCells++; }
        }
        const wallPersistence = wallSeen ? wallPersistent / wallSeen : 0, roofCoverage = insideCells ? roofCells / insideCells : 0;
        const confidence = Math.round(Math.max(0, Math.min(1, wallPersistence * 0.5 + roofCoverage * 0.5)) * 100);
        return { room, cuts, area, res, confidence, evidence: { wallPersistence, roofCoverage }, roomCandidates, grid: { x0, y0, nx, ny } };
    };
    IM.previewAutoRooms = function (opts) {
        opts = opts || {};
        if (!IM.loaded || !IM.comp) return { error: 'Importe d’abord le modèle du bâtiment.' };
        const original = imp().frame, frameIds = IM.selComps ? [...IM.selComps] : (IM.comp.comps.length === 1 ? [0] : null);
        const originalOps = S.project.shell.ops;
        if (!frameIds) return { error: 'Le modèle contient plusieurs bâtiments : sélectionne d’abord le bâtiment à traiter.' };
        let frame = Object.assign({ x: 0, y: 0, z: 0, heading: 0 }, original || {}), fitFrame = null;
        const frameSet = original && [original.x, original.y, original.z, original.heading].every(Number.isFinite) &&
            (imp().frameSet === true || ['x', 'y', 'z', 'heading'].some(k => Math.abs(+original[k] || 0) > 1e-8));
        if (!frameSet) frame = fitFrame = IM.fitFrame(frameIds);
        else if (frameIds) {
            const fit = fitFrame = IM.fitFrame(frameIds), delta = ((fit.heading - frame.heading + 45) % 90 + 90) % 90 - 45;
            if (Math.abs(delta) > 0.75) {
                if (opts.alignDiagonal === false) return { error: 'Le bâtiment est en diagonale par rapport au quadrillage. Active l’alignement automatique pour prévisualiser.' };
                const sh = S.project.shell || {};
                if ((sh.parts || []).length || (sh.openings || []).length || (sh.floors || []).length)
                    return { error: 'Aligne d’abord le quadrillage manuellement pour préserver les cloisons et ouvertures existantes.' };
                frame = fit;
            }
        }
        try {
            imp().frame = { x: frame.x, y: frame.y, z: frame.z, heading: frame.heading };
            const levels = Model.levelsOf({ import: imp(), shell: S.project.shell, settings: S.project.settings }), lowest = levels[0].active;
            const floorShift = lowest ? IM.autoFloor() : null;
            if (floorShift != null && Math.abs(floorShift) > 0.02) imp().frame.z = Math.round((imp().frame.z + floorShift) * 1000) / 1000;
            const rects = IM.autoRoomRects(); if (rects.error) return rects;
            const clearance = Math.max(0, Math.min(0.5, Number(opts.clearance == null ? 0.05 : opts.clearance) || 0));
            if (rects.room[2] - rects.room[0] <= clearance * 2 || rects.room[3] - rects.room[1] <= clearance * 2)
                return { error: 'La pièce détectée est trop étroite pour cette marge. Réduis-la puis réessaie.' };
            const tempOps = [{ op: 'add', r: rects.room.slice() }].concat(rects.cuts.map(r => ({ op: 'cut', r: r.slice() })));
            S.project.shell.ops = tempOps;
            const fitted = IM.fitRooms(0.25, false);
            fitted.forEach(f => { tempOps[f.op].r[f.side] = f.to; });
            if (clearance > 0) {
                const add = tempOps.find(o => o.op === 'add').r;
                add[0] = Math.round((add[0] + clearance) * 1000) / 1000; add[1] = Math.round((add[1] + clearance) * 1000) / 1000;
                add[2] = Math.round((add[2] - clearance) * 1000) / 1000; add[3] = Math.round((add[3] - clearance) * 1000) / 1000;
            }
            const rg = M.Shell.regionGrid({ ops: tempOps }); let area = 0;
            for (let i = 0; i < rg.nx; i++) for (let j = 0; j < rg.ny; j++) if (rg.mask[i][j]) area += (rg.X[i + 1] - rg.X[i]) * (rg.Y[j + 1] - rg.Y[j]);
            return Object.assign(rects, { room: tempOps.find(o => o.op === 'add').r, cuts: tempOps.filter(o => o.op === 'cut').map(o => o.r), area, fitted: fitted.length, clearance, floorShift: floorShift || 0, frame: Object.assign({}, imp().frame), _fitFrame: fitFrame, _previewState: { projectName: S.project.name, target: imp().target, frame: JSON.stringify(original || null), ops: JSON.stringify(originalOps), building: JSON.stringify(imp().building || null), selected: JSON.stringify(IM.selComps ? [...IM.selComps].sort((a, b) => a - b) : null), deletes: JSON.stringify(imp().deletes || []), ceiling: S.project.settings.ceilH || 2.45 } });
        } catch (e) {
            return { error: e.message };
        } finally {
            imp().frame = original;
            S.project.shell.ops = originalOps;
        }
    };
    // creates the rooms (replacing the rooms and cut-outs there are); the grid is put on the building first when it was never set
    IM.autoRooms = function (opts) {
        opts = opts || {};
        // Preflight before the legacy alignment/floor edits below. A failed detection must not dirty the project.
        const preflight = opts.preview || IM.previewAutoRooms(opts);
        if (preflight.error) return preflight;
        const stamp = preflight._previewState;
        if (stamp && (stamp.projectName !== S.project.name || stamp.target !== imp().target || stamp.frame !== JSON.stringify(imp().frame || null) || stamp.ops !== JSON.stringify(S.project.shell.ops) || stamp.building !== JSON.stringify(imp().building || null) || stamp.selected !== JSON.stringify(IM.selComps ? [...IM.selComps].sort((a, b) => a - b) : null) || stamp.deletes !== JSON.stringify(imp().deletes || []) || stamp.ceiling !== (S.project.settings.ceilH || 2.45)))
            return { error: 'Le projet, le quadrillage ou les pièces ont changé depuis l’aperçu. Relance l’automatisation.' };
        const f = imp().frame;
        const frameIsSet = !!f && [f.x, f.y, f.z, f.heading].every(Number.isFinite) &&
            (imp().frameSet === true || ['x', 'y', 'z', 'heading'].some(k => Math.abs(+f[k] || 0) > 1e-8));
        let alignedDiagonal = false, alignmentSkipped = false;
        const frameIds = IM.selComps ? [...IM.selComps] : (IM.comp && IM.comp.comps.length === 1 ? [0] : null);
        if (!frameIds && IM.comp && IM.comp.comps.length > 1) return { error: 'The model contains several buildings. Select the building first (Select building, B), then run room detection.' };
        if (!frameIsSet) {
            if (frameIds && IM.selComps) { const fit = preflight._fitFrame || IM.fitFrame(frameIds); Model.edit(P => { P.import.frame = { x: fit.x, y: fit.y, z: fit.z, heading: fit.heading }; P.import.frameSet = true; }); }
            else if (frameIds) { const fit = preflight._fitFrame || IM.fitFrame(frameIds); Model.edit(P => { P.import.frame = { x: fit.x, y: fit.y, z: fit.z, heading: fit.heading }; P.import.frameSet = true; }); alignedDiagonal = Math.abs(fit.heading) > 0.75; }
            else return { error: 'The model holds several buildings: select the building first (Select building, B).' };
        } else if (frameIds) {
            const fit = preflight._fitFrame || IM.fitFrame(frameIds), old = Object.assign({ x: 0, y: 0, z: 0, heading: 0 }, imp().frame);
            let delta = ((fit.heading - old.heading + 45) % 90 + 90) % 90 - 45;
            if (Math.abs(delta) > 0.75) {
                if (opts.alignDiagonal === false) return { error: 'Le bâtiment est en diagonale par rapport au quadrillage. Active l’alignement automatique ou aligne le quadrillage manuellement avant de créer les pièces.' };
                const sh = S.project.shell || {}, complexWalls = (sh.parts || []).length || (sh.openings || []).length || (sh.floors || []).length;
                if (!complexWalls) {
                    const a0 = old.heading * Math.PI / 180, a1 = fit.heading * Math.PI / 180, c0 = Math.cos(a0), s0 = Math.sin(a0), c1 = Math.cos(a1), s1 = Math.sin(a1), dz = old.z - fit.z;
                    const carry = (o, hasYaw) => {
                        if (o.cx == null || o.cy == null) return;
                        const wx = old.x + o.cx * c0 - o.cy * s0, wy = old.y + o.cx * s0 + o.cy * c0, dx = wx - fit.x, dy = wy - fit.y;
                        o.cx = Math.round((dx * c1 + dy * s1) * 1000) / 1000; o.cy = Math.round((-dx * s1 + dy * c1) * 1000) / 1000;
                        if (hasYaw && o.yaw != null) o.yaw = Math.round((o.yaw - delta * Math.PI / 180) * 100000) / 100000;
                        if (o.zb != null) o.zb = Math.round((o.zb + dz) * 1000) / 1000;
                    };
                    Model.edit(P => {
                        const I = P.import; I.cutters.forEach(o => carry(o, true)); (I.fits || []).forEach(o => carry(o, true)); (I.cboxes || []).forEach(o => carry(o, true));
                        (P.shell.lights || []).forEach(o => { const v = { cx: o.x, cy: o.y }; carry(v, false); o.x = v.cx; o.y = v.cy; });
                        I.frame = { x: fit.x, y: fit.y, z: fit.z, heading: fit.heading }; I.frameSet = true;
                    });
                    alignedDiagonal = true;
                } else {
                    alignmentSkipped = true;
                    return { error: 'L’alignement automatique est bloqué pour préserver les cloisons/ouvertures existantes. Aligne d’abord le quadrillage sur un mur droit, puis relance.' };
                }
            }
        }
        // the room's floor goes on the building's floor (its walls' bottom), wherever the grid's floor was
        const lvs = Model.levelsOf({ import: imp(), shell: S.project.shell, settings: S.project.settings }), lowest = lvs[0].active;          // (an upper floor stays where it was put)
        const fl = lowest ? preflight.floorShift : null; if (fl != null && Math.abs(fl) > 0.02) IM.shiftLevel(fl, true);
        const r = preflight, clearance = r.clearance || 0;
        // The read-only preflight already fitted and inset these exact rectangles. Commit that result instead of rerunning expensive detection.
        Model.edit(P => {
            P.shell.ops = [{ op: 'add', r: r.room.slice() }].concat(r.cuts.map(rc => ({ op: 'cut', r: rc.slice() })));
        });
        const rg = M.Shell.regionGrid(S.project.shell); let actualArea = 0;
        for (let i = 0; i < rg.nx; i++) for (let j = 0; j < rg.ny; j++) if (rg.mask[i][j]) actualArea += (rg.X[i + 1] - rg.X[i]) * (rg.Y[j + 1] - rg.Y[j]);
        r.area = actualArea;
        return Object.assign(r, { alignedDiagonal, alignmentSkipped });
    };
    // ---------- Analyse des murs des pièces ----------
    // Pour chaque mur de pièce (le bord de la zone add/cut), on mesure tous les 5 cm la distance jusqu'à la face intérieure du mur du bâtiment derrière lui,
    // à 3 hauteurs (60 cm, 1,20 m, 1,80 m). On en déduit : collé / dans le mur / trop près / bon / trop loin, et la forme du mur du bâtiment (droit, en
    // diagonale, arrondi). IM.fixRooms corrige ensuite : un mur droit recule de ce qu'il faut, un mur en diagonale ou arrondi est suivi par paliers.
    IM.roomCheck = null;
    IM.analyzeRooms = function (opts) {
        opts = opts || {};
        if (!IM.comp) return { error: 'Importe d’abord le modèle du bâtiment.' };
        const sh = S.project.shell; if (!sh || !sh.ops.some(o => o.op === 'add')) return { error: 'Aucune pièce à analyser : crée d’abord les pièces.' };
        const B = autoTris(); if (!B) return { error: 'Le bâtiment n’a pas de faces.' };
        const H = S.project.settings.ceilH || 2.45, tris = wallTris(B);
        const clearance = Math.max(0, Math.min(0.5, Number(opts.clearance == null ? 0.05 : opts.clearance) || 0));
        const g = M.Shell.regionGrid(sh), segs = M.Shell.boundary(g); if (!segs.length) return { error: 'Aucune pièce à analyser : crée d’abord les pièces.' };
        const REACH = 1.0, BACK = 1.5, STEP = 0.05;
        const bx0 = g.X[0] - REACH - 0.2, bx1 = g.X[g.X.length - 1] + REACH + 0.2, by0 = g.Y[0] - REACH - 0.2, by1 = g.Y[g.Y.length - 1] + REACH + 0.2;
        // the faces of the building's walls cut at each height: 2D segments with the face's normal
        const heights = [0.6, 1.2, 1.8].filter(z => z < H - 0.1), cuts = heights.map(z => {
            const out = [];
            for (let k = 0; k < tris.length; k += 4) {
                const s = tris[k], a = tris[k + 1], b = tris[k + 2], c = tris[k + 3];
                const pts = sliceTriangleAtZ(s, a, b, c, z); if (!pts) continue;
                const e1x = s[b] - s[a], e1y = s[b + 1] - s[a + 1], e1z = s[b + 2] - s[a + 2], e2x = s[c] - s[a], e2y = s[c + 1] - s[a + 1], e2z = s[c + 2] - s[a + 2];
                let nx = e1y * e2z - e1z * e2y, ny = e1z * e2x - e1x * e2z; const nz = e1x * e2y - e1y * e2x, l = Math.hypot(nx, ny, nz); if (l < 1e-9) continue;
                const lh = Math.hypot(nx, ny); if (lh / l < 0.5) continue; nx /= lh; ny /= lh;          // (a floor, a sill's top or a ceiling is not a wall face)
                const p0 = pts[0], p1 = pts[1];
                if (Math.max(p0[0], p1[0]) < bx0 || Math.min(p0[0], p1[0]) > bx1 || Math.max(p0[1], p1[1]) < by0 || Math.min(p0[1], p1[1]) > by1) continue;
                out.push(p0[0], p0[1], p1[0], p1[1], nx, ny);
            }
            return out;
        });
        // distance from a point of a room's wall to the inner face of the building's wall behind it, along the wall's normal (null: nothing within 1 m, an
        // opening). Negative: the room's wall is inside the building's wall by that much.
        const measure = (o, c, u, out) => {
            let best = null;
            cuts.forEach(cs => {
                const hits = [];
                for (let k = 0; k < cs.length; k += 6) {
                    const ax = o === 'H' ? cs[k] : cs[k + 1], ay = o === 'H' ? cs[k + 1] : cs[k], bx = o === 'H' ? cs[k + 2] : cs[k + 3], by = o === 'H' ? cs[k + 3] : cs[k + 2];
                    if ((ax - u) * (bx - u) > 0 || ax === bx) continue;
                    const t = (u - ax) / (bx - ax), off = (ay + (by - ay) * t - c) * out; if (off < -BACK || off > REACH) continue;
                    const nO = (o === 'H' ? cs[k + 5] : cs[k + 4]) * out; if (Math.abs(nO) < 0.15) continue;
                    hits.push([off, nO < 0]);                                   // (true: the face looks back at the room, the inner face of a wall)
                }
                if (!hits.length) return;
                hits.sort((p, q) => p[0] - q[0]);
                const fwd = hits.find(h => h[0] >= 0); let d = null;
                if (fwd && fwd[1]) d = fwd[0];                                   // the first face ahead is a wall's inner face: the gap
                else { const back = hits.filter(h => h[0] < 0 && h[1]); if (back.length) d = back[back.length - 1][0]; else if (fwd) d = null; }   // inside a wall
                if (d != null && (best == null || d < best)) best = d;
            });
            return best;
        };
        const fit = (pts, deg) => {           // least squares d = a + b u (+ c u²): rms of the residuals and the slope
            const n = pts.length, m = pts.reduce((s, p) => s + p.u, 0) / n, X = pts.map(p => p.u - m), Y = pts.map(p => p.d);
            const cols = deg === 2 ? [X.map(() => 1), X, X.map(x => x * x)] : [X.map(() => 1), X], k = cols.length, A = [], bb = [];
            for (let i = 0; i < k; i++) { A.push([]); for (let j = 0; j < k; j++) A[i].push(cols[i].reduce((s, v, q) => s + v * cols[j][q], 0)); bb.push(cols[i].reduce((s, v, q) => s + v * Y[q], 0)); }
            for (let i = 0; i < k; i++) { let p = i; for (let r = i + 1; r < k; r++) if (Math.abs(A[r][i]) > Math.abs(A[p][i])) p = r; [A[i], A[p]] = [A[p], A[i]]; [bb[i], bb[p]] = [bb[p], bb[i]]; if (Math.abs(A[i][i]) < 1e-12) return { rms: 1e9, b: 0 }; for (let r = 0; r < k; r++) if (r !== i) { const f = A[r][i] / A[i][i]; for (let q = i; q < k; q++) A[r][q] -= f * A[i][q]; bb[r] -= f * bb[i]; } }
            const co = bb.map((v, i) => v / A[i][i]); let ss = 0; for (let q = 0; q < n; q++) { let y = 0; for (let i = 0; i < k; i++) y += co[i] * cols[i][q]; ss += (Y[q] - y) * (Y[q] - y); }
            return { rms: Math.sqrt(ss / n), b: co[1] || 0, at: (u) => { const x = u - m; return co[0] + co[1] * x + (deg === 2 ? co[2] * x * x : 0); } };
        };
        const pct = (a, p) => { const s = a.slice().sort((x, y) => x - y); return s[Math.min(s.length - 1, Math.max(0, Math.floor(p * (s.length - 1))))]; };
        const statusOf = (d) => d == null ? 'none' : d < -0.005 ? 'inside' : d < 0.015 ? 'touch' : d < clearance - 0.01 ? 'close' : d > Math.max(0.35, clearance + 0.3) ? 'far' : 'ok';
        const walls = [];
        segs.forEach(s => {
            const len = s.u1 - s.u0; if (len < 0.08) return;
            const out = -s.inward, n = Math.max(2, Math.round(len / STEP)), samples = [];
            for (let k = 0; k < n; k++) { const u = s.u0 + (k + 0.5) * len / n, d = measure(s.o, s.c, u, out); samples.push({ u, d, st: statusOf(d) }); }
            const valid = samples.filter(p => p.d != null), w = { o: s.o, c: s.c, u0: s.u0, u1: s.u1, inward: s.inward, len, samples, shape: 'none', angle: 0, dmin: null, dmed: null, status: 'none' };
            w.openingIntervals = (sh.openings || []).filter(op => op.o === s.o && Math.abs(op.c - s.c) < 0.01 && op.u1 > s.u0 && op.u0 < s.u1)
                .map(op => [Math.max(s.u0, op.u0), Math.min(s.u1, op.u1)]);
            w.hasOpening = w.openingIntervals.length > 0;
            if (valid.length >= Math.max(2, 0.3 * samples.length)) {
                w.dmin = pct(valid.map(p => p.d), 0.05); w.dmed = pct(valid.map(p => p.d), 0.5);
                const L1 = valid.length >= 4 ? fit(valid, 1) : { rms: 0, b: 0 }, L2 = valid.length >= 6 ? fit(valid, 2) : L1, span = pct(valid.map(p => p.d), 0.95) - w.dmin;
                w.span = span; w.shape = 'straight';
                if (span <= 0.03) w.shape = 'straight';
                else if (Math.abs(L1.b) > 0.035 && L1.rms < 0.025) { w.shape = 'diagonal'; w.angle = Math.atan(Math.abs(L1.b)) * 180 / Math.PI; }
                else if (span > 0.06 && L2.rms < 0.02 && L2.rms < L1.rms * 0.55) w.shape = 'round';
                else w.shape = 'mixed';                                          // (in part straight, in part slanted or stepped: a corner cut off, a bay)
                const worst = ['inside', 'touch', 'close'].find(k => valid.some(p => p.st === k && true) && valid.filter(p => p.st === k).length * STEP >= 0.1);
                w.status = worst || (w.shape === 'straight' && w.dmed > Math.max(0.35, clearance + 0.3) ? 'far' : 'ok');
                w.badLen = valid.filter(p => p.st === 'inside' || p.st === 'touch' || p.st === 'close').length * len / n;
            }
            walls.push(w);
        });
        const sum = (f) => walls.filter(f).reduce((a, w) => a + w.len, 0);
        const r = {
            walls, clearance, key: JSON.stringify(sh.ops),
            total: sum(() => true), bad: walls.reduce((a, w) => a + (w.badLen || 0), 0),
            n: { inside: walls.filter(w => w.status === 'inside').length, touch: walls.filter(w => w.status === 'touch').length, close: walls.filter(w => w.status === 'close').length, far: walls.filter(w => w.status === 'far').length, ok: walls.filter(w => w.status === 'ok').length, none: walls.filter(w => w.status === 'none').length },
            diagonal: walls.filter(w => w.shape === 'diagonal'), round: walls.filter(w => w.shape === 'round'), mixed: walls.filter(w => w.shape === 'mixed')
        };
        // the whole building turned against the grid: most of the wall length is diagonal at about one angle
        const dl = r.diagonal.concat(r.mixed).reduce((a, w) => a + w.len, 0);
        r.turned = dl > 0.5 * r.total && r.diagonal.length + r.mixed.length >= 2;
        IM.roomCheck = r;
        return r;
    };
    // the room's walls moved off the building's walls: a straight wall steps back as one; a diagonal or round one is followed in steps of `step` metres
    // (the rooms are rectangles, so a slanted wall becomes a staircase of short straight pieces); only the opening spans themselves are left alone.
    IM.fixRooms = function (opts) {
        // up to 3 passes: the steps of a slanted wall make short new walls of their own, a second pass puts those right too
        let tot = null;
        for (let pass = 0; pass < 3; pass++) {
            const f = fixPass(opts); if (f.error) return f;
            if (!tot) tot = f; else if (!f.nothing) { tot.added += f.added; tot.after = f.after; }
            if (f.nothing || !f.after || !(f.after.n.inside + f.after.n.touch + f.after.n.close)) break;
            opts = Object.assign({}, opts, { grow: false });
        }
        return tot;
    };
    function fixPass(opts) {
        opts = opts || {};
        const clearance = Math.max(0, Math.min(0.5, Number(opts.clearance == null ? 0.05 : opts.clearance) || 0)), step = Math.max(0.05, Math.min(1, Number(opts.step) || 0.1));
        const follow = opts.follow !== false, grow = opts.grow !== false;
        const pct = (a, p) => { const s = a.slice().sort((x, y) => x - y); return s[Math.min(s.length - 1, Math.max(0, Math.floor(p * (s.length - 1))))]; };
        const A = IM.analyzeRooms({ clearance }); if (A.error) return A;
        const r3 = (v) => Math.round(v * 1000) / 1000, ops = [], skipped = [];
        let moved = 0, followed = 0;
        const strip = (w, u0, u1, depth, add) => {          // depth > 0: into the room (cut); add: out of the room towards the building's wall
            // (the side on the room's wall line keeps its exact value and a cut reaches 1 mm past it, so no sliver of the old wall is left)
            const dir = add ? -w.inward : w.inward, a = add ? w.c : w.c - dir * 0.001, bb = r3(w.c + dir * depth), lo = Math.min(a, bb), hi = Math.max(a, bb);
            const ul = u0 <= w.u0 + 1e-9 ? w.u0 : r3(u0), uh = u1 >= w.u1 - 1e-9 ? w.u1 : r3(u1);
            if (hi - lo < 0.002 || uh - ul < 0.01) return;
            ops.push({ op: add ? 'add' : 'cut', r: w.o === 'H' ? [ul, lo, uh, hi] : [lo, ul, hi, uh] });
        };
        A.walls.forEach(w => {
            if (w.dmin == null) return;
            const needs = w.status === 'inside' || w.status === 'touch' || w.status === 'close', curved = follow && w.span > 0.03;
            if (!needs && !(curved && grow)) return;
            const spans = []; let cursor = w.u0;
            (w.openingIntervals || []).slice().sort((a, b) => a[0] - b[0]).forEach(([a, b]) => {
                if (a > cursor + 0.01) spans.push([cursor, a]);
                cursor = Math.max(cursor, b);
            });
            if (cursor < w.u1 - 0.01) spans.push([cursor, w.u1]);
            if (w.openingIntervals && w.openingIntervals.length) skipped.push(Object.assign({}, w, { skippedOpeningParts: true }));
            spans.forEach(([span0, span1]) => {
                if (!curved) {
                    const ds = w.samples.filter(p => p.u >= span0 && p.u <= span1 && p.d != null).map(p => p.d);
                    if (!ds.length) return;
                    const back = clearance - pct(ds, 0.05);
                    if (back > 0.002) { strip(w, span0, span1, back, false); moved++; }
                    return;
                }
                // Step along each non-opening interval; never alter the actual doorway/window span.
                const pieces = [], nP = Math.max(1, Math.ceil((span1 - span0) / step));
                for (let k = 0; k < nP; k++) {
                    const u0 = span0 + (span1 - span0) * k / nP, u1 = span0 + (span1 - span0) * (k + 1) / nP;
                    const ds = w.samples.filter(p => p.u >= u0 - 0.026 && p.u <= u1 + 0.026 && p.d != null).map(p => p.d);
                    if (!ds.length) { pieces.push({ u0, u1, o: 0 }); continue; }
                    let o = Math.min(...ds) - clearance; if (o > 0 && !grow) o = 0; o = Math.min(o, 0.6);
                    pieces.push({ u0, u1, o: Math.round(o * 200) / 200 });
                }
                const joined = []; pieces.forEach(p => { const l = joined[joined.length - 1]; if (l && Math.abs(l.o - p.o) < 0.004) l.u1 = p.u1; else joined.push(Object.assign({}, p)); });
                joined.forEach(p => { if (p.o < -0.002) strip(w, p.u0, p.u1, -p.o, false); else if (p.o > 0.01) strip(w, p.u0, p.u1, p.o, true); });
                followed++;
            });
        });
        if (!ops.length) return Object.assign({ moved: 0, followed: 0, added: 0, skipped: skipped.length }, { nothing: true });
        // the cut-outs first, then what grows towards a slanted wall (an add after a cut wins where they meet)
        ops.sort((p, q) => (p.op === 'cut' ? 0 : 1) - (q.op === 'cut' ? 0 : 1));
        Model.edit(P => { ops.forEach(o => P.shell.ops.push(o)); });
        const after = IM.analyzeRooms({ clearance });
        return { moved, followed, added: ops.length, skipped: skipped.length, after };
    }
    // the result in the 3D view: a coloured band along each room wall (red: in the wall or touching it, orange: too close, green: good, blue: far from it)
    IM.drawRoomCheck = function (R) {
        const A = IM.roomCheck; if (!A || S.showRoomCheck === false) return;
        const stale = A.key !== JSON.stringify(S.project.shell.ops);
        const COL = { inside: [1, 0.2, 0.3, 0.85], touch: [1, 0.3, 0.3, 0.8], close: [1, 0.68, 0.2, 0.8], ok: [0.3, 0.9, 0.55, 0.6], far: [0.35, 0.65, 1, 0.65], none: [0.6, 0.6, 0.65, 0.25] };
        A.walls.forEach(w => {
            const n = w.samples.length, du = w.len / n, off = w.inward * 0.012;
            w.samples.forEach(p => {
                const col = stale ? [0.6, 0.6, 0.65, 0.3] : COL[p.st], a = p.u - du / 2, b = p.u + du / 2, z0 = 0.04, z1 = p.st === 'ok' || p.st === 'none' || stale ? 0.22 : 0.6;
                if (w.o === 'H') R.ovTopQuad([a, w.c + off, z0], [b, w.c + off, z0], [b, w.c + off, z1], [a, w.c + off, z1], col);
                else R.ovTopQuad([w.c + off, a, z0], [w.c + off, b, z0], [w.c + off, b, z1], [w.c + off, a, z1], col);
            });
        });
    };
    // the height of the walls around the rooms, in metres above the floor: the top that most of the wall area around the rooms has (5 cm steps, tops under 2.2 m are
    // window pieces and are ignored); null when there is no wall
    IM.wallTop = function () {
        const g = M.Shell.regionGrid(S.project.shell), faces = IM.wallFaces(), inRoom = (x, y) => { for (let i = 0; i < g.nx; i++) if (x >= g.X[i] && x < g.X[i + 1]) { for (let j = 0; j < g.ny; j++) if (y >= g.Y[j] && y < g.Y[j + 1]) return g.mask[i][j]; } return false; };
        const bins = new Map();
        for (const f of faces) {
            const nh = Math.hypot(f.n[0], f.n[1]); if (nh < 0.5) continue; const bx = f.c[0] - f.n[0] / nh * 0.1, by = f.c[1] - f.n[1] / nh * 0.1; if (!inRoom(bx, by)) continue;
            const top = Math.max(f.p[2], f.p[5], f.p[8]); if (top < 2.2) continue; const k = Math.round(top * 20); let b = bins.get(k); if (!b) bins.set(k, b = { w: 0, s: 0 }); b.w += f.area; b.s += top * f.area;
        }
        let best = null; bins.forEach(b => { if (!best || b.w > best.w) best = b; });
        return best ? Math.round(best.s / best.w * 100) / 100 : null;
    };

    // ---------- parts: the materials (geometries) of the building and of its detail models ----------
    // A part is one geometry of a model: all the faces that share a texture. Removing a part deletes all of its faces (in the building: through `deletes`, like
    // Delete faces; in a detail model: through `mdeletes`) and remembers which faces it took (`import.parts`) so it can be given back without touching faces
    // that were deleted for another reason.
    IM.partModels = function () {
        const dmf = imp().doorModel ? imp().doorModel.file : null;
        return IM.models.filter(m => m.file !== dmf && (m.target || Math.max(m.bmax[0] - m.bmin[0], m.bmax[1] - m.bmin[1]) > 4)).sort((a, b) => (b.target ? 1 : 0) - (a.target ? 1 : 0));
    };
    IM.partRecord = function (file, g) { return (imp().parts || []).find(p => p.f === file && p.g === g) || null; };
    // faces of the part that are still there / in all
    IM.partCount = function (m, geo) {
        const del = m.target ? delSet() : mdelSet(m.file); let left = 0, n = geo.idx.length / 3; for (let t = 0; t < n; t++) if (!del.has(geo.g + ':' + t)) left++; return { left, total: n };
    };
    IM.removePart = function (file, g) {
        const m = IM.models.find(x => x.file === file), geo = m && m.geoms.find(x => x.g === g); if (!geo || IM.partRecord(file, g)) return false;
        return Model.edit(P => {
            const I = P.import, owner = 'part:' + file + ':' + g, n = geo.idx.length / 3, owned = Array.from({ length: n }, (_, t) => t);
            const added = M.FaceDeletions.claimMany(P, file, g, owned, owner);
            I.parts = I.parts || []; I.parts.push({ f: file, g, name: geo.texName, added, owned, owner });
        });
    };
    IM.restorePart = function (file, g) {
        const rec = IM.partRecord(file, g); if (!rec) return false;
        return Model.edit(P => {
            const I = P.import, owner = rec.owner || ('part:' + file + ':' + g);
            M.FaceDeletions.releaseMany(P, file, g, Array.isArray(rec.owned) ? rec.owned : (rec.added || []), owner);
            I.parts = I.parts.filter(p => !(p.f === file && p.g === g));
        });
    };
    // the faces of a part still there, as triangle corners in the grid's frame (for the highlight); cached until the model is rebuilt
    IM.partTris = function (file, g) {
        IM.partGeo = IM.partGeo || {}; const k = file + '|' + g; if (IM.partGeo[k]) return IM.partGeo[k];
        const m = IM.models.find(x => x.file === file), geo = m && m.geoms.find(x => x.g === g); if (!geo) return null;
        const del = m.target ? delSet() : mdelSet(file), out = [];
        for (let t = 0; t * 3 < geo.idx.length; t++) { if (del.has(g + ':' + t)) continue; for (let q = 0; q < 3; q++) { const i = geo.idx[t * 3 + q] * 3, s = IM.toShell(geo.pos[i], geo.pos[i + 1], geo.pos[i + 2]); out.push(s[0], s[1], s[2]); } }
        return (IM.partGeo[k] = Float32Array.from(out));
    };
    // a small picture of the texture of a part
    IM.partThumb = function (geo, size) {
        const t = IM.textures[geo.tex]; const c = document.createElement('canvas'); c.width = c.height = size || 36; c.className = 'pthumb';
        if (!t) return c; const tmp = document.createElement('canvas'); tmp.width = t.w; tmp.height = t.h; tmp.getContext('2d').putImageData(new ImageData(new Uint8ClampedArray(t.rgba), t.w, t.h), 0, 0);
        c.getContext('2d').drawImage(tmp, 0, 0, c.width, c.height); return c;
    };

    // ---------- open edges of the model (Edges tool) ----------
    // An open edge belongs to exactly one triangle of what is shown. Next to faces you deleted they are the rim of a hole. Everything here is in the model's
    // own coordinates (a fill is stored with the model, not with the grid). Vertices that lie within 1 mm count as one.
    const EKEY = 4194304; let edgeCache = null, viewCache = null;
    const ekey = (a, b) => a < b ? a * EKEY + b : b * EKEY + a;
    function weldOf(m) {
        if (IM._weld && IM._weld.file === m.file) return IM._weld;
        const vid = new Map(), vpos = [], W = { file: m.file, vid, vpos, orig: new Map() };
        W.id = (x, y, z) => { const k = Math.round(x * 1000) + ',' + Math.round(y * 1000) + ',' + Math.round(z * 1000); let v = vid.get(k); if (v === undefined) { v = vpos.length; vid.set(k, v); vpos.push([x, y, z]); } return v; };
        m.geoms.forEach(g => { for (let t = 0; t * 3 < g.idx.length; t++) { const v = [0, 1, 2].map(q => { const i = g.idx[t * 3 + q] * 3; return W.id(g.pos[i], g.pos[i + 1], g.pos[i + 2]); }); for (let q = 0; q < 3; q++) { const a = v[q], b = v[(q + 1) % 3]; if (a !== b) { const k = ekey(a, b); W.orig.set(k, (W.orig.get(k) || 0) + 1); } } } });
        return (IM._weld = W);
    }
    IM.edgeData = function () {
        const m = IM.targetModel(); if (!m || S.project.kind !== 'import') return null; const I = imp();
        const key = [S.project.name, m.file, IM.cutVer || 0, JSON.stringify(I.deletes), JSON.stringify(I.fills || [])].join('|');
        if (edgeCache && edgeCache.key === key) return edgeCache;
        const W = weldOf(m), edges = new Map();
        m.geoms.forEach(g => {
            const s = IM.cutGeoms.has(g.g) ? IM.cutGeoms.get(g.g) : g;
            for (let t = 0; t * 3 < s.idx.length; t++) {
                const P3 = [0, 1, 2].map(q => { const i = s.idx[t * 3 + q] * 3; return [s.pos[i], s.pos[i + 1], s.pos[i + 2]]; }), v = P3.map(p => W.id(p[0], p[1], p[2]));
                const e1 = [P3[1][0] - P3[0][0], P3[1][1] - P3[0][1], P3[1][2] - P3[0][2]], e2 = [P3[2][0] - P3[0][0], P3[2][1] - P3[0][1], P3[2][2] - P3[0][2]];
                let n = [e1[1] * e2[2] - e1[2] * e2[1], e1[2] * e2[0] - e1[0] * e2[2], e1[0] * e2[1] - e1[1] * e2[0]]; const l = Math.hypot(n[0], n[1], n[2]) || 1; n = [n[0] / l, n[1] / l, n[2] / l];
                for (let q = 0; q < 3; q++) {
                    const a = v[q], b = v[(q + 1) % 3]; if (a === b) continue; const k = ekey(a, b); let e = edges.get(k);
                    if (!e) edges.set(k, e = { k, a: Math.min(a, b), b: Math.max(a, b), n: 0, g: g.g, tri: s.src ? s.src[t] : t, nrm: n });
                    e.n++;
                }
            }
        });
        const open = [], adj = new Map(), byKey = new Map();
        edges.forEach(e => { if (e.n !== 1) return; e.hole = (W.orig.get(e.k) || 0) >= 2; open.push(e); byKey.set(e.k, e); [e.a, e.b].forEach(v => { let l = adj.get(v); if (!l) adj.set(v, l = []); l.push(e); }); });
        return (edgeCache = { key, open, adj, byKey, vpos: W.vpos });
    };
    // the open edges worth showing: those near the rooms (within 1.5 m of a rectangle, up to a little above the ceiling), without the outlines of cut-out windows
    // and doors unless asked for; holesOnly keeps just the rims of holes that deleting faces made
    IM.edgeView = function (opts) {
        const D = IM.edgeData(); if (!D) return [];
        opts = opts || {}; const I = imp(), fk = JSON.stringify(I.frame);
        const ck = D.key + '|' + (opts.holesOnly ? 1 : 0) + (opts.outlines ? 1 : 0) + '|' + fk + '|' + I.cutters.length + '|' + JSON.stringify(S.project.shell.ops) + '|' + S.project.settings.ceilH;
        if (viewCache && viewCache.key === ck) return viewCache.list;
        const faceCut = I.cutters.filter(k => k.face), H = S.project.settings.ceilH || 2.45, ops = S.project.shell.ops.filter(o => o.op === 'add');
        const onOutline = (mid) => faceCut.some(k => {
            const cs = Math.cos(k.yaw), sn = Math.sin(k.yaw), dx = mid[0] - k.cx, dy = mid[1] - k.cy, u = dx * cs + dy * sn, n = -dx * sn + dy * cs, z = mid[2] - k.zb;
            return Math.abs(u) <= k.w / 2 + 0.1 && z >= -0.1 && z <= k.h + 0.1 && n >= -0.4 && n <= 0.15;
        });
        const nearRooms = (mid) => mid[2] > -0.3 && mid[2] < H + 0.5 && ops.some(o => mid[0] > o.r[0] - 1.5 && mid[0] < o.r[2] + 1.5 && mid[1] > o.r[1] - 1.5 && mid[1] < o.r[3] + 1.5);
        const list = [];
        for (const e of D.open) {
            if (opts.holesOnly && !e.hole) continue;
            const A = D.vpos[e.a], B = D.vpos[e.b], sa = IM.toShell(A[0], A[1], A[2]), sb = IM.toShell(B[0], B[1], B[2]), mid = [(sa[0] + sb[0]) / 2, (sa[1] + sb[1]) / 2, (sa[2] + sb[2]) / 2];
            if (!nearRooms(mid) || (!opts.outlines && onOutline(mid))) continue;
            e.sa = sa; e.sb = sb; list.push(e); if (list.length >= 4000) break;       // sa, sb: the ends in the grid's frame (the cache key holds the frame)
        }
        viewCache = { key: ck, list }; return list;
    };
    // loop select: from one open edge along the open edges, through vertices where exactly two meet
    IM.edgeLoop = function (seed) {
        const D = IM.edgeData(); if (!D || !seed) return [];
        const out = new Set([seed.k]), walk = (v, from) => {
            for (let guard = 0; guard < 5000; guard++) {
                const l = D.adj.get(v) || []; if (l.length !== 2) return; const nx = l[0] === from ? l[1] : l[0]; if (out.has(nx.k)) return; out.add(nx.k); v = nx.a === v ? nx.b : nx.a; from = nx;
            }
        };
        walk(seed.a, seed); walk(seed.b, seed); return [...out];
    };
    // triangles over a polygon (3D points, in order): ear clipping in the plane of the polygon; the winding follows the polygon
    function triangulate(P) {
        let nx = 0, ny = 0, nz = 0; for (let i = 0; i < P.length; i++) { const a = P[i], b = P[(i + 1) % P.length]; nx += (a[1] - b[1]) * (a[2] + b[2]); ny += (a[2] - b[2]) * (a[0] + b[0]); nz += (a[0] - b[0]) * (a[1] + b[1]); }
        const l = Math.hypot(nx, ny, nz); if (l < 1e-9) return null; const N = [nx / l, ny / l, nz / l];
        const ax = Math.abs(N[0]) >= Math.abs(N[1]) && Math.abs(N[0]) >= Math.abs(N[2]) ? 0 : (Math.abs(N[1]) >= Math.abs(N[2]) ? 1 : 2), i0 = (ax + 1) % 3, i1 = (ax + 2) % 3, sg = N[ax] >= 0 ? 1 : -1;
        const Q = P.map(p => [p[i0] * sg, p[i1]]), idx = P.map((_, i) => i), tris = [];
        const cr = (a, b, c) => (b[0] - a[0]) * (c[1] - a[1]) - (b[1] - a[1]) * (c[0] - a[0]);
        let guard = 0;
        while (idx.length > 3 && guard++ < 10000) {
            let cut = false;
            for (let k = 0; k < idx.length; k++) {
                const ia = idx[(k + idx.length - 1) % idx.length], ib = idx[k], ic = idx[(k + 1) % idx.length], a = Q[ia], b = Q[ib], c = Q[ic];
                if (cr(a, b, c) <= 1e-12) continue;
                let inside = false; for (const j of idx) { if (j === ia || j === ib || j === ic) continue; const p = Q[j]; if (cr(a, b, p) >= -1e-12 && cr(b, c, p) >= -1e-12 && cr(c, a, p) >= -1e-12) { inside = true; break; } }
                if (inside) continue; tris.push([ia, ib, ic]); idx.splice(k, 1); cut = true; break;
            }
            if (!cut) { for (let k = 1; k + 1 < idx.length; k++) tris.push([idx[0], idx[k], idx[k + 1]]); idx.length = 0; }       // not a simple polygon: a fan
        }
        if (idx.length === 3) tris.push([idx[0], idx[1], idx[2]]);
        return { tris, normal: N };
    }
    // fills for the selected open edges: one per loop (or per open chain, which closes with a straight line, like F in Blender). The faces look the way the faces
    // around the hole look, or towards `eye` when those disagree. Returns { fills, skipped }.
    IM.fillFromEdges = function (edgeKeys, eye) {
        const D = IM.edgeData(); const out = { fills: [], skipped: 0 }; if (!D) return out;
        const sel = edgeKeys.map(k => D.byKey.get(k)).filter(Boolean), adj = new Map();
        sel.forEach(e => [e.a, e.b].forEach(v => { let l = adj.get(v); if (!l) adj.set(v, l = []); l.push(e); }));
        const seen = new Set();
        sel.forEach(e0 => {
            if (seen.has(e0.k)) return; const comp = [], st = [e0]; seen.add(e0.k);
            while (st.length) { const e = st.pop(); comp.push(e); [e.a, e.b].forEach(v => adj.get(v).forEach(o => { if (!seen.has(o.k)) { seen.add(o.k); st.push(o); } })); }
            const verts = new Set(); comp.forEach(e => { verts.add(e.a); verts.add(e.b); }); const ends = []; let bad = false;
            verts.forEach(v => { const d = adj.get(v).length; if (d === 1) ends.push(v); else if (d !== 2) bad = true; });
            if (bad || (ends.length !== 0 && ends.length !== 2)) { out.skipped++; return; }
            const start = ends.length ? ends[0] : comp[0].a, used = new Set(), order = [start]; let v = start;
            for (let guard = 0; guard < 10000; guard++) { const e = adj.get(v).find(x => !used.has(x.k)); if (!e) break; used.add(e.k); v = e.a === v ? e.b : e.a; if (v === start) break; order.push(v); }
            if (order.length < 3) { out.skipped++; return; }
            const pts = order.map(i => D.vpos[i]), tr = triangulate(pts); if (!tr || !tr.tris.length) { out.skipped++; return; }
            // which way the faces look: the sum of the faces around the hole, or towards the viewer
            let ref = [0, 0, 0]; comp.forEach(e => { ref[0] += e.nrm[0]; ref[1] += e.nrm[1]; ref[2] += e.nrm[2]; });
            if (Math.hypot(ref[0], ref[1], ref[2]) < 0.5 * comp.length && eye) { const c = [0, 1, 2].map(a => pts.reduce((s, p) => s + p[a], 0) / pts.length); ref = [eye[0] - c[0], eye[1] - c[1], eye[2] - c[2]]; }
            const flip = tr.normal[0] * ref[0] + tr.normal[1] * ref[1] + tr.normal[2] * ref[2] < 0;
            // the geometry that most of the rim belongs to (the new faces are part of it) and one of its triangles
            const cnt = new Map(); comp.forEach(e => cnt.set(e.g, (cnt.get(e.g) || 0) + 1)); let g = comp[0].g, bn = 0; cnt.forEach((n, gg) => { if (n > bn) { bn = n; g = gg; } });
            const src = (comp.find(e => e.g === g) || comp[0]).tri;
            const r4 = (x) => Math.round(x * 10000) / 10000;
            out.fills.push({ id: Math.random().toString(36).slice(2, 6), g, src, pts: pts.map(p => [r4(p[0]), r4(p[1]), r4(p[2])]), tris: tr.tris.map(t => flip ? [t[0], t[2], t[1]] : t) });
        });
        return out;
    };
    IM.fillArea = function (f) {
        let a = 0; f.tris.forEach(t => { const p = t.map(i => f.pts[i]), u = [p[1][0] - p[0][0], p[1][1] - p[0][1], p[1][2] - p[0][2]], v = [p[2][0] - p[0][0], p[2][1] - p[0][1], p[2][2] - p[0][2]]; a += Math.hypot(u[1] * v[2] - u[2] * v[1], u[2] * v[0] - u[0] * v[2], u[0] * v[1] - u[1] * v[0]) / 2; }); return a;
    };

    // ---------- clearing the building's collision out of the rooms ----------
    // The building's own collision fills its rooms (measured on a real building: a solid block 4 x 8 x 3 m, a wall slab 38 cm thick that reaches 29 cm past the visible
    // wall, window frames and panels), so the interior is blocked by things you cannot see. Every room (the region of your rectangles as a few boxes, from 2 cm above
    // the floor up to the ceiling) is cut out of that collision, like a cutter that only works on collision. What is outside the room edge stays, the floor stays, and
    // the interior's own wall collision stands at the room edge. Switched off with import.clearCollision = false. Same shape as a cutter, in the grid's frame.
    IM.roomVolumes = function (force) {
        const P = S.project, I = P.import; if (!I || (I.clearCollision === false && !force) || !P.shell.ops.length) return [];
        const H = P.settings.ceilH || 2.45, z0 = 0.02, r4 = (v) => Math.round(v * 10000) / 10000;
        return M.Shell.regionRects(P.shell).map((r, i) => ({ id: 'room' + i, type: 'room', mesh: false, cx: r4((r[0] + r[2]) / 2), cy: r4((r[1] + r[3]) / 2), zb: z0, w: r4(r[2] - r[0]), h: r4(H - z0), d: r4(r[3] - r[1]), yaw: 0 }));
    };

    // ---------- several buildings: the model is cut by the openings of ALL of them ----------
    // One file is written for the model (and one for each collision file), so the cut preview, the collision and the export are given the cutters and the rooms of every
    // building. Each building has its own grid, so they are turned into the model's own coordinates here (and the host is told there is no grid: IM.NOFRAME).
    IM.NOFRAME = { x: 0, y: 0, z: 0, heading: 0 };
    const q4 = (v) => Math.round(v * 10000) / 10000;
    // How far an opening reaches across a thick wall. The faces you click are the building's outside, and its own depth (80 cm about them) does not reach the
    // room behind a thick wall (an old stone building's, a city hall's): the room's wall and the building's collision in between would stay shut. So it reaches
    // to the nearest wall of a room behind it (up to 1.6 m away, of the rooms whose side overlaps the opening) and 15 cm past it. Returns the span along the
    // grid's axis across the wall (y for a wall along x, x for one along y) from the opening's middle, { lo, hi }, or null (no room wall near: its own depth).
    // rooms: the room rectangles of its building ([x0, y0, x1, y1] in the grid's frame).
    IM.reach = function (k, rooms) {
        const q = (((k.yaw * 180 / Math.PI) % 360) + 360) % 360, r90 = q % 90; if (Math.min(r90, 90 - r90) > 6) return null;
        const horiz = Math.round(q / 90) % 2 === 0, cu = horiz ? k.cx : k.cy, cn = horiz ? k.cy : k.cx, hw = k.w / 2, d = k.d || 0.8; let best = null;
        (rooms || []).forEach(r => {
            const u0 = horiz ? r[0] : r[1], u1 = horiz ? r[2] : r[3]; if (Math.min(u1, cu + hw) - Math.max(u0, cu - hw) < 0.1) return;
            (horiz ? [r[1], r[3]] : [r[0], r[2]]).forEach(e => { const dn = e - cn; if (Math.abs(dn) <= 1.6 && (best === null || Math.abs(dn) < Math.abs(best))) best = dn; });
        });
        if (best === null || Math.abs(best) + 0.15 <= d / 2) return null;
        return { lo: Math.min(-d / 2, best - 0.15), hi: Math.max(d / 2, best + 0.15), wall: best, horiz };
    };
    // the room rectangles of a building (its project data d), every floor
    IM.roomRects = function (d) {
        const out = [], add = (sh) => ((sh && sh.ops) || []).forEach(o => { if (o.op === 'add' && o.r) out.push(o.r); });
        add(d.shell); ((d.import && d.import.levels) || []).forEach(l => { if (l.snap) add(l.snap.shell); });
        return out;
    };
    IM.allCutters = function () {
        const out = [];
        Model.bldAll(S.project).forEach(b => {
            const f = b.d.import.frame, h = (f.heading || 0) * Math.PI / 180, c = Math.cos(h), s = Math.sin(h), rooms = IM.roomRects(b.d);
            const push = (id, type, mesh, cx, cy, zb, w, hh, d, yaw) => out.push({ id, type, mesh, cx: q4(f.x + cx * c - cy * s), cy: q4(f.y + cx * s + cy * c), zb: q4(f.z + zb), w, h: hh, d, yaw: yaw + h });
            (b.d.import.cutters || []).forEach(k0 => {
                // (an opening in a thick wall reaches the room behind it: its box is made deeper and moved across the wall)
                const rc = IM.reach(k0, rooms), along = (lo, hi) => rc.horiz ? { cy: q4(k0.cy + (lo + hi) / 2), d: q4(hi - lo) } : { cx: q4(k0.cx + (lo + hi) / 2), d: q4(hi - lo) };
                const k = rc ? Object.assign({}, k0, along(rc.lo, rc.hi)) : k0;
                // a door whose frame is bigger than its opening: the collision opens to the frame, and the model's wall is cut out to the frame (a cutter of its own that
                // only cuts the wall around it: from 3 cm in front of the opening's plane to 31 cm behind it, where the model's own wall and its reveals are)
                const fe = IM.doorFrameExtent(k0), bigger = fe && (fe.cu > fe.hw + 0.002 || fe.ct > fe.zt + 0.002);
                push(k.id, k.type, k.mesh, k.cx, k.cy, k.zb, bigger ? q4(2 * fe.cu) : k.w, bigger ? q4(fe.ct - k.zb) : k.h, k.d, k.yaw);
                if (bigger) { const nx = -Math.sin(k0.yaw), ny = Math.cos(k0.yaw); push(k0.id + 'w', 'cut', true, k0.cx - nx * 0.14, k0.cy - ny * 0.14, k0.zb, q4(2 * fe.cu), q4(fe.ct - k0.zb), 0.34, k0.yaw); }
                // An opening made from the model's faces takes out only the faces you clicked. In a thick wall the model also has faces between them and the room (its
                // inside surface): those are cut out too, from 5 cm behind the clicked faces to 15 cm past the room's wall, 2 cm inside the opening's sides so its reveals stay.
                if (rc && k0.face) {
                    const s = rc.wall > 0 ? 1 : -1, a = s > 0 ? 0.05 : rc.wall - 0.15, b = s > 0 ? rc.wall + 0.15 : -0.05, g = along(a, b);
                    push(k0.id + 'r', 'cut', true, g.cx != null ? g.cx : k0.cx, g.cy != null ? g.cy : k0.cy, q4(k0.zb + 0.01), q4(Math.max(0.1, k0.w - 0.04)), q4(Math.max(0.1, k0.h - 0.02)), g.d, k0.yaw);
                }
            });
            // a door or a window of the game placed in a wall (Models tool): the building's wall and its collision open to it, 40 cm in front of it and behind it
            (b.d.import.fits || []).filter(f => f.g && f.open !== false && f.w > 0.1 && f.h > 0.1).forEach(f => {
                const c = f.kind === 'door' && M.FitModels ? M.FitModels.doorCut(f) : { cx: f.cx, cy: f.cy, zb: f.zb, w: f.w, h: f.h };
                push('gfit' + f.id, f.kind === 'window' ? 'window' : 'door', true, c.cx, c.cy, c.zb, q4(c.w), q4(c.h), 0.8, f.yaw);
            });
        });
        return out;
    };
    // the rooms of every building as boxes that clear the building's collision (force: also the buildings that do not clear it)
    // how high a floor's room is over the rectangle r at most everywhere (its ceiling, or under the roof on a floor that follows the roof; only for the active
    // building, whose model frame the roof is read in)
    const roomTop = (lv, active, r, H) => {
        if (!lv.shell.roofFit || !active) return H; const rf = IM.roofAt(lv.z); if (!rf) return H; let t = H;
        for (let a = 0; a <= 8; a++) for (let b = 0; b <= 8; b++) t = Math.min(t, rf(r[0] + (r[2] - r[0]) * a / 8, r[1] + (r[3] - r[1]) * b / 8) - 0.05);
        return Math.max(0, t);
    };
    IM.allRoomVolumes = function (force) {
        const out = [];
        Model.bldAll(S.project).forEach(b => {
            const d = b.d, I = d.import; if (I.clearCollision === false && !force) return;
            const LV = Model.levelsOf(d);
            LV.forEach((lv, li) => {
                // over stairs, from this floor up into the next one: the building's collision there would be an invisible floor between the floors
                const up = LV[li + 1]; if (up) (lv.shell.stairs || []).forEach((st, si) => { const f0 = I.frame, h0 = (f0.heading || 0) * Math.PI / 180, c0 = Math.cos(h0), s0 = Math.sin(h0), r = st.r, sx = (r[0] + r[2]) / 2, sy = (r[1] + r[3]) / 2, rise = up.z - lv.z;
                    out.push({ id: b.id + lv.id + 'well' + si, type: 'room', mesh: false, cx: q4(f0.x + sx * c0 - sy * s0), cy: q4(f0.y + sx * s0 + sy * c0), zb: q4(f0.z + lv.z + 0.02), w: q4(r[2] - r[0]), h: q4(rise + 0.3), d: q4(r[3] - r[1]), yaw: h0 }); });
            });
            Model.levelsOf(d).forEach(lv => { if (!lv.shell.ops.length) return;
            const f = Object.assign({}, I.frame, { z: I.frame.z + lv.z }), h = (f.heading || 0) * Math.PI / 180, c = Math.cos(h), s = Math.sin(h), H = lv.ceilH || 2.45, z0 = 0.02;
            M.Shell.regionRects(lv.shell).forEach((r, i) => { const sx = (r[0] + r[2]) / 2, sy = (r[1] + r[3]) / 2, top = roomTop(lv, b.active, r, H); if (top - z0 < 0.1) return; out.push({ id: b.id + lv.id + 'room' + i, type: 'room', mesh: false, cx: q4(f.x + sx * c - sy * s), cy: q4(f.y + sx * s + sy * c), zb: q4(f.z + z0), w: q4(r[2] - r[0]), h: q4(top - z0), d: q4(r[3] - r[1]), yaw: h }); });
            });
        });
        return out;
    };

    // ---------- clearing the model's parts out of the rooms ----------
    // What of the model lies INSIDE a room is cut away at the room's walls, like a boolean in Blender: the boxes and frames of the model's windows that stick into the room,
    // plants and weeds that reach into it, vents, anything else (each kind can be switched off, and single parts left out). A part is a kind by the name of its texture
    // or shader (the host has the same rule, ClearSpec.KindOf). The rooms act as boxes from 30 cm under the floor to the ceiling; where a side of a room is its edge it
    // is moved in by the margin (1 cm), so a wall whose plane the room edge lies on to a millimetre or two is not cut. Switched off with import.clearMesh = false.
    IM.clearOn = () => !!imp() && imp().clearMesh !== false;
    IM.clearCats = () => Object.assign({ win: true, veg: true, other: true }, imp().clearCats || {});
    IM.clearMargin = () => { const m = imp().clearMargin; return m == null ? 0.01 : m; };
    const WIN_RX = /(^|[^a-z])(window|glass)/i, VEG_RX = /(^|[^a-z])(crop|weed|bush|hedge|tree|grass|plant|leaf|leaves|foliage|shrub|vine|ivy|flower|palm|fern|veg|moss|cactus)/i;
    IM.partKind = (tex, shader) => { const s = (tex || '') + ' ' + (shader || ''); return WIN_RX.test(s) ? 'win' : (VEG_RX.test(s) ? 'veg' : 'other'); };
    IM.clearWinDepth = () => { const v = imp().clearWinDepth; return v == null ? 0.10 : v; };
    // `extra`: a further inset of the sides that are the rooms' edges (the windows' own, see clearSpec)
    IM.allClearVolumes = function (extra) {
        const out = [], mg = IM.clearMargin();
        Model.bldAll(S.project).forEach(b => {
            const d = b.d, I = d.import, LV = Model.levelsOf(d), T0 = Math.max(0, Math.min(0.5, +d.settings.wallThick || 0));
            // the stair wells (from a floor up into the next one) are cleared of the model's parts as well
            LV.forEach((lv, li) => { const up = LV[li + 1]; if (up) (lv.shell.stairs || []).forEach((st, si) => {
                const f0 = I.frame, h0 = (f0.heading || 0) * Math.PI / 180, c0 = Math.cos(h0), s0 = Math.sin(h0), ins = mg + T0 + (extra || 0), r = st.r, x0 = r[0] + ins, x1 = r[2] - ins, y0 = r[1] + ins, y1 = r[3] - ins; if (x1 - x0 < 0.05 || y1 - y0 < 0.05) return;
                const sx = (x0 + x1) / 2, sy = (y0 + y1) / 2; out.push({ id: b.id + lv.id + 'wellclr' + si, type: 'clear', cx: q4(f0.x + sx * c0 - sy * s0), cy: q4(f0.y + sx * s0 + sy * c0), zb: q4(f0.z + lv.z), w: q4(x1 - x0), h: q4(up.z - lv.z + 0.3), d: q4(y1 - y0), yaw: h0 });
            }); });
            Model.levelsOf(d).forEach(lv => { if (!lv.shell.ops.length) return;
            const f = Object.assign({}, I.frame, { z: I.frame.z + lv.z }), h = (f.heading || 0) * Math.PI / 180, c = Math.cos(h), s = Math.sin(h), H = lv.ceilH || 2.45, g = M.Shell.regionGrid(lv.shell);
            const inReg = (x, y) => { for (let i = 0; i < g.nx; i++) if (x >= g.X[i] && x < g.X[i + 1]) { for (let j = 0; j < g.ny; j++) if (y >= g.Y[j] && y < g.Y[j + 1]) return g.mask[i][j]; } return false; };
            // The room starts at the inner face of its wall, which is the wall thickness inside the room's edge: the parts of the model that lie in the thickness of the wall
            // (the window frames and boxes behind the siding, which the wall hides) stay, only what pokes past the wall's face into the room is cut.
            const T = Math.max(0, Math.min(0.5, +d.settings.wallThick || 0)), ins = mg + T + (extra || 0), zb = -0.3, top = H - mg;
            M.Shell.regionRects(lv.shell).forEach((r, i) => {
                // a side that has another part of the room next to it stays where it is (2 mm over, so no seam is left); a side that is the room's edge moves in
                const nb = (x0, y0, x1, y1) => { let n = 0; for (const q of [0.25, 0.5, 0.75]) if (inReg(x0 + (x1 - x0) * q, y0 + (y1 - y0) * q)) n++; return n >= 2; };
                const w = nb(r[0] - 0.005, r[1], r[0] - 0.005, r[3]), e = nb(r[2] + 0.005, r[1], r[2] + 0.005, r[3]), so = nb(r[0], r[1] - 0.005, r[2], r[1] - 0.005), no = nb(r[0], r[3] + 0.005, r[2], r[3] + 0.005);
                const x0 = r[0] + (w ? -0.002 : ins), x1 = r[2] + (e ? 0.002 : -ins), y0 = r[1] + (so ? -0.002 : ins), y1 = r[3] + (no ? 0.002 : -ins);
                const tp = Math.min(top, roomTop(lv, b.active, r, H) - mg);                                                    // (under a sloping roof: no higher than the roof is low)
                if (x1 - x0 < 0.05 || y1 - y0 < 0.05 || tp - zb < 0.1) return;
                const sx = (x0 + x1) / 2, sy = (y0 + y1) / 2;
                out.push({ id: b.id + lv.id + 'clr' + i, type: 'clear', cx: q4(f.x + sx * c - sy * s), cy: q4(f.y + sx * s + sy * c), zb: q4(f.z + zb), w: q4(x1 - x0), h: q4(tp - zb), d: q4(y1 - y0), yaw: h });
            });
            });
        });
        return out;
    };
    // what the host is told to clear (null: nothing)
    IM.clearSpec = function () {
        if (!IM.clearOn()) return null; const volumes = IM.allClearVolumes(); if (!volumes.length) return null;
        // windows get their own, smaller volumes: a window's frame and box may reach this far (clearWinDepth) into the room past the wall's face before they are cut
        const wd = IM.clearWinDepth(), spec = { volumes, cats: IM.clearCats(), skip: imp().clearSkip || [] };
        if (wd > 0.0005) spec.winVolumes = IM.allClearVolumes(wd);
        return spec;
    };
    IM.clearKey = () => IM.clearOn() ? JSON.stringify([IM.allClearVolumes(), IM.clearWinDepth(), IM.clearCats(), imp().clearSkip || []]) : '';
    // ---------- where the detail models stand ----------
    // Every model file of the block is centred on its own point: the building's file on the building's entity (its position in the game's map), a detail file (hedges, weeds,
    // bushes, vents: det01..05, detail_01...) on ITS entity, some metres away. The editor draws, picks and cuts in the building's coordinates, so a detail file is moved from its own
    // frame into the building's (turn by the difference of the headings, move by the difference of the positions). import.detailPlace = { file: { x, y, z, heading, ymap } } is
    // where each one stands; without it a detail file is taken to stand on the building's centre (which it does not: the bush behind a window was not where it showed).
    const rad = (d) => d * Math.PI / 180;
    IM.detailXf = function (file) {
        const e = imp().entity, p = (imp().detailPlace || {})[file]; if (!e || !p) return null;
        const hb = rad(e.heading || 0), dl = rad(p.heading || 0) - hb, dx = p.x - e.x, dy = p.y - e.y, cb = Math.cos(-hb), sb = Math.sin(-hb);
        return { c: Math.cos(dl), s: Math.sin(dl), tx: dx * cb - dy * sb, ty: dx * sb + dy * cb, tz: p.z - e.z, dl };
    };
    // the origin the host needs to put the rooms (in the building's coordinates) into a detail file's own: the inverse of the move above (same shape as a cutter's origin)
    IM.detailOrigin = function (file) {
        const xf = IM.detailXf(file); if (!xf) return IM.NOFRAME;
        return { x: -(xf.tx * xf.c + xf.ty * xf.s), y: -(-xf.tx * xf.s + xf.ty * xf.c), z: -xf.tz, heading: -xf.dl * 180 / Math.PI };
    };
    IM.xfPos = function (a, xf) { const n = a.length / 3, o = new Float32Array(n * 3); for (let i = 0; i < n; i++) { const x = a[i * 3], y = a[i * 3 + 1]; o[i * 3] = x * xf.c - y * xf.s + xf.tx; o[i * 3 + 1] = x * xf.s + y * xf.c + xf.ty; o[i * 3 + 2] = a[i * 3 + 2] + xf.tz; } return o; };
    IM.xfNrm = function (a, xf) { const n = a.length / 3, o = new Float32Array(n * 3); for (let i = 0; i < n; i++) { const x = a[i * 3], y = a[i * 3 + 1]; o[i * 3] = x * xf.c - y * xf.s; o[i * 3 + 1] = x * xf.s + y * xf.c; o[i * 3 + 2] = a[i * 3 + 2]; } return o; };
    // moves every detail model to where it stands (from the file's own coordinates, kept as rawPos); true when something changed
    IM.applyPlaces = function () {
        const key = JSON.stringify([imp() && imp().entity, imp() && imp().detailPlace, IM.models.length]); if (IM._placeKey === key) return false; IM._placeKey = key;
        IM.models.forEach(m => {
            if (m.target) return; const xf = IM.detailXf(m.file);
            m.geoms.forEach(g => { if (!g.rawPos) { g.rawPos = g.pos; g.rawNrm = g.nrm; } g.pos = xf ? IM.xfPos(g.rawPos, xf) : g.rawPos; g.nrm = xf ? IM.xfNrm(g.rawNrm, xf) : g.rawNrm; });
        });
        IM.origD = null; IM.isl = {}; IM.cutDet = new Map(); IM.clearDet = null; IM.partGeo = null; IM.cutVer = (IM.cutVer || 0) + 1; return true;
    };
    IM.detailFiles = () => { const dmf = imp().doorModel ? imp().doorModel.file : null; return IM.models.filter(m => !m.target && m.file !== dmf).map(m => m.file); };
    IM.detailsPlaced = () => { const dp = imp().detailPlace || {}, all = IM.detailFiles(); return { have: all.filter(f => dp[f]).length, total: all.length }; };
    // look up where the detail models stand: the project's .ymap files, and the game's map files when `game` (the game is only read when the user asked once: the model's placement came from it, or the button)
    IM.lookupPlaces = async function (game) {
        const I = imp(); if (!I.entity) return { err: 'Set where the model stands first.' }; const files = IM.detailFiles(); if (!files.length) return { places: {} };
        const r = await Model.api('import/places?name=' + safe(), 'POST', { files, game: !!game, gta: '', near: { x: I.entity.x, y: I.entity.y } });
        if (r.places && Object.keys(r.places).length) { Model.edit(Q => { Q.import.detailPlace = Object.assign({}, Q.import.detailPlace || {}, r.places); }); IM.rebuild(); }
        return r;
    };
    IM.autoPlaces = function () {
        const I = imp(); if (!I || !I.entity || IM._placing) return; const dp = I.detailPlace || {}; if (!IM.detailFiles().some(f => !dp[f])) return;
        IM._placing = true; IM.lookupPlaces(I.entity.source === 'game').catch(() => { }).then(() => { IM._placing = false; bus.emit('importstatus'); });
    };

    // the detail models (the other files of the block) with the rooms cleared out of them, for the view: IM.cutDet = file -> (geometry number -> cut geometry)
    IM.cutDet = IM.cutDet || new Map(); let detSeq = 0;
    IM.cutDetails = async function () {
        if (S.project.kind !== 'import') return; const seq = ++detSeq, clear = IM.clearSpec(), I = imp(), dmf = I.doorModel ? I.doorModel.file : null;
        if (!clear) { if (IM.cutDet.size || IM.clearDet) { IM.cutDet = new Map(); IM.clearDet = null; IM.rebuild(); bus.emit('importstatus'); } return; }
        const det = new Map(), tot = { win: 0, veg: 0, other: 0 };
        try {
            for (const m of IM.models.filter(x => !x.target && x.file !== dmf)) {
                const r = await Model.api('import/cut?name=' + safe(), 'POST', { target: m.file, origin: IM.detailOrigin(m.file), cutters: [], deletes: [], fills: [], clear }); if (seq !== detSeq) return;      // (the rooms in this file's own coordinates)
                const xf = IM.detailXf(m.file), gm = new Map(); (r.geoms || []).forEach(g => gm.set(g.g, { pos: xf ? IM.xfPos(f32(g.pos), xf) : f32(g.pos), nrm: xf ? IM.xfNrm(f32(g.nrm), xf) : f32(g.nrm), uv: f32(g.uv), idx: u16(g.idx), tris: g.tris, src: g.src ? new Int32Array(bytes(g.src).buffer) : null }));
                if (gm.size) det.set(m.file, gm); ['win', 'veg', 'other'].forEach(k => { tot[k] += (r.cleared && r.cleared[k]) || 0; });
            }
        } catch (e) { toast('Could not clear the detail models: ' + e.message, 'err'); return; }
        if (seq !== detSeq) return; IM.cutDet = det; IM.clearDet = tot; IM.rebuild(); bus.emit('importstatus');
    };

    // ---------- the building's collision pieces, for picking them (Collision tool) ----------
    // The host lists every triangle and box of all the collision files near the model: file, child, polygon, kind, material and 4 corners (a box's 4 stored corners
    // give its 8: the same rule as the host's wire-frame). They are the ORIGINAL pieces, before any cutting. Deleted ones are import.colDeletes = [file name, child, polygon].
    const BOXSG = [[1, 1, -1, -1], [1, -1, 1, -1], [1, -1, -1, 1]];
    IM.colBoxCorners = function (p, o) {        // the 8 corners of the box whose 4 stored corners are p[o..o+12]
        const bc = [0, 0, 0], ee = [[0, 0, 0], [0, 0, 0], [0, 0, 0]];
        for (let a = 0; a < 3; a++) { bc[a] = (p[o + a] + p[o + 3 + a] + p[o + 6 + a] + p[o + 9 + a]) / 4; for (let j = 0; j < 3; j++) ee[j][a] = (BOXSG[j][0] * p[o + a] + BOXSG[j][1] * p[o + 3 + a] + BOXSG[j][2] * p[o + 6 + a] + BOXSG[j][3] * p[o + 9 + a]) / 4; }
        const cs = []; for (let q = 0; q < 8; q++) { const c = [0, 0, 0]; for (let a = 0; a < 3; a++) c[a] = bc[a] + ((q & 1) ? -1 : 1) * ee[0][a] + ((q & 2) ? -1 : 1) * ee[1][a] + ((q & 4) ? -1 : 1) * ee[2][a]; cs.push(c); }
        return cs;
    };
    IM.COLBOXEDGES = [[0, 1], [2, 3], [4, 5], [6, 7], [0, 2], [1, 3], [4, 6], [5, 7], [0, 4], [1, 5], [2, 6], [3, 7]];
    IM.COLBOXFACES = [[0, 2, 6, 4], [1, 3, 7, 5], [0, 1, 5, 4], [2, 3, 7, 6], [0, 1, 3, 2], [4, 5, 7, 6]];
    IM.colPolysLoad = async function () {
        const I = imp(); if (S.project.kind !== 'import' || !I.entity || !(IM.files || []).some(f => f.kind === 'collision')) { IM.colPolys = null; return null; }
        const key = JSON.stringify([S.project.name, I.target, I.entity, (IM.files || []).filter(f => f.kind === 'collision').map(f => f.name || f.file)]);
        if (IM.colPolys && IM.colPolys.key === key) return IM.colPolys;
        if (IM._colLoading) return IM._colLoading;
        const seq = IM._colPolysLoadSeq = (IM._colPolysLoadSeq || 0) + 1, project = S.project;
        IM._colLoading = (async () => {
            try {
                const c0 = IM.fromShell(0, 0, 0), r = await Model.api('import/collision-polys?name=' + safe(), 'POST', { entity: I.entity, nx: c0[0], ny: c0[1], radius: 60 });
                if (seq !== IM._colPolysLoadSeq || S.project !== project || S.project.kind !== 'import') return null;
                const meta = new Int32Array(bytes(r.meta || '').buffer), verts = f32(r.verts || '');
                IM.colPolys = { key, files: r.files || [], n: meta.length / 5, meta, verts, sk: '' };
            } catch (e) { if (seq === IM._colPolysLoadSeq) { IM.colPolys = null; toast('Could not read the collision: ' + e.message, 'err'); } }
            if (seq === IM._colPolysLoadSeq) { IM._colLoading = null; bus.emit('importstatus'); }
            return IM.colPolys;
        })();
        return IM._colLoading;
    };
    // the pieces in the grid's frame: shell = 12 numbers per piece, box = the 6 numbers of its bounding box, ctr = its centre (recomputed when the grid moves)
    IM.colShell = function () {
        const cp = IM.colPolys; if (!cp) return null; const sk = JSON.stringify(imp().frame); if (cp.sk === sk) return cp;
        const n = cp.n, shell = new Float32Array(n * 12), box = new Float32Array(n * 6), ctr = new Float32Array(n * 3);
        for (let i = 0; i < n; i++) {
            const tri = cp.meta[i * 5 + 3] === 0, cnt = tri ? 3 : 4; let mn = [1e9, 1e9, 1e9], mx = [-1e9, -1e9, -1e9];
            for (let k = 0; k < 4; k++) { const s = IM.toShell(cp.verts[i * 12 + k * 3], cp.verts[i * 12 + k * 3 + 1], cp.verts[i * 12 + k * 3 + 2]); shell[i * 12 + k * 3] = s[0]; shell[i * 12 + k * 3 + 1] = s[1]; shell[i * 12 + k * 3 + 2] = s[2]; }
            const pts = []; if (tri) { for (let k = 0; k < 3; k++) pts.push([shell[i * 12 + k * 3], shell[i * 12 + k * 3 + 1], shell[i * 12 + k * 3 + 2]]); } else IM.colBoxCorners(shell, i * 12).forEach(c => pts.push(c));
            const c = [0, 0, 0]; for (let k = 0; k < cnt; k++) for (let a = 0; a < 3; a++) c[a] += shell[i * 12 + k * 3 + a] / cnt;
            pts.forEach(p => { for (let a = 0; a < 3; a++) { if (p[a] < mn[a]) mn[a] = p[a]; if (p[a] > mx[a]) mx[a] = p[a]; } });
            for (let a = 0; a < 3; a++) { box[i * 6 + a] = mn[a]; box[i * 6 + 3 + a] = mx[a]; ctr[i * 3 + a] = c[a]; }
        }
        cp.shell = shell; cp.box = box; cp.ctr = ctr; cp.sk = sk; cp.region = null; return cp;
    };
    IM.colKey = (cp, i) => cp.files[cp.meta[i * 5]] + '|' + cp.meta[i * 5 + 1] + '|' + cp.meta[i * 5 + 2];
    IM.colDelSet = function () { const s = new Set(); (imp().colDeletes || []).forEach(d => s.add(d[0] + '|' + d[1] + '|' + d[2])); return s; };
    // the pieces worth picking: within 12 m of a room (to the sides) and from 1 m under the floor to 2 m over the ceiling, and not deleted
    IM.colRegion = function () {
        const cp = IM.colShell(); if (!cp) return []; const P = S.project, I = P.import, H = P.settings.ceilH || 2.45;
        const key = JSON.stringify([P.shell.ops, H, I.colDeletes || []]); if (cp.region && cp.regionKey === key) return cp.region;
        const rects = M.Shell.regionRects(P.shell), del = IM.colDelSet(), out = [];
        for (let i = 0; i < cp.n; i++) {
            const x = cp.ctr[i * 3], y = cp.ctr[i * 3 + 1], z = cp.ctr[i * 3 + 2]; if (z < -1 || z > H + 2) continue;
            if (!rects.some(r => x > r[0] - 12 && x < r[2] + 12 && y > r[1] - 12 && y < r[3] + 12)) continue; if (del.has(IM.colKey(cp, i))) continue; out.push(i);
        }
        cp.region = out; cp.regionKey = key; return out;
    };

    // ---------- the model's collision (wire-frame, after the cutters) ----------
    let colTimer = null, colSeq = 0;
    IM.requestCollision = function () { clearTimeout(colTimer); colTimer = setTimeout(IM.collisionNow, 350); };
    // The collision overlay (orange) when it is switched on, and always the count of the building's collision inside the rooms (IM.colInside: { now, before }); what is
    // left inside the rooms is drawn in red.
    const toShellPts = (b64) => { const a = f32(b64 || ''), n = a.length / 3, pts = new Float32Array(a.length); for (let i = 0; i < n; i++) { const p = IM.toShell(a[i * 3], a[i * 3 + 1], a[i * 3 + 2]); pts[i * 3] = p[0]; pts[i * 3 + 1] = p[1]; pts[i * 3 + 2] = p[2]; } return pts; };
    IM.collisionNow = async function () {
        const R = M.App.renderer; if (!R) return; const col = [1.0, 0.55, 0.25, 0.6], red = [1.0, 0.22, 0.22, 0.95], none = () => { R.setStaticLines('collision', null, col, false); R.setStaticLines('collisionIn', null, red, false); };
        if (S.project.kind !== 'import') { none(); return; }
        const I = imp(); IM.colNote = '';
        if (!(IM.files || []).some(f => f.kind === 'collision')) { IM.colNote = S.showCollision ? 'No collision file imported.' : ''; IM.colInside = null; none(); bus.emit('importstatus'); return; }
        if (!I.entity) { IM.colNote = S.showCollision ? 'Set where the model stands in the game (Import tab) to see its collision.' : ''; IM.colInside = null; none(); bus.emit('importstatus'); return; }
        const seq = ++colSeq, c0 = IM.fromShell(0, 0, 0), show = !!S.showCollision;
        try {
            const r = await Model.api('import/collision-preview?name=' + safe(), 'POST', { cutters: IM.allCutters(), roomVolumes: IM.allRoomVolumes(), countRooms: IM.allRoomVolumes(true), colDeletes: I.colDeletes || [], lines: show, origin: IM.NOFRAME, entity: I.entity, nx: c0[0], ny: c0[1], radius: 45 });
            if (seq !== colSeq) return;
            IM.colInside = r.insideBefore != null && IM.allRoomVolumes(true).length ? { now: r.insideNow, before: r.insideBefore, clearing: I.clearCollision !== false } : null;
            if (show) { R.setStaticLines('collision', toShellPts(r.lines), col, true); R.setStaticLines('collisionIn', toShellPts(r.insideLines), red, true); IM.colNote = (r.removed || r.added) ? (r.removed + ' collision polygons cut away, ' + r.added + ' put back') : ''; }
            else none();
        } catch (e) { IM.colNote = show ? 'Collision: ' + e.message : ''; }
        bus.emit('importstatus'); const info = document.getElementById('colinside'); if (info) IM.colInsideFill(info);
    };
    // the line of the right panel that says how much of the building's collision is left inside the rooms
    IM.colInsideFill = function (node) {
        const c = IM.colInside; node.textContent = '';
        if (!c) { node.textContent = IM.allRoomVolumes(true).length ? 'Counting the building\'s collision inside the rooms...' : 'Draw a room to count the building\'s collision inside it.'; node.className = 'note'; return; }
        const left = c.now, clearing = c.clearing;
        node.className = 'note ' + (left === 0 ? 'ok' : (clearing ? '' : 'bad'));
        node.textContent = clearing ? ('Building collision inside the rooms: ' + left + ' left (' + c.before + ' before clearing)' + (left ? '. What is left is red in the view with the collision overlay on: pieces that belong to doors and windows, or that are not clear of the room.' : '.'))
            : ('Building collision inside the rooms: ' + left + ' pieces that can block you (clearing is off).');
    };

    // ---------- the building's collision as the export leaves it (for the walk check) ----------
    // Every collision file cut like the export cuts it (cutters, the rooms cleared, deleted pieces), near the rooms, in the grid's frame: n polygons, kind[i] 0 triangle / 1 box,
    // c[i*12..] the 4 stored corners (a box's 8 corners come from them). Cached until the cuts change.
    IM.colFinalKey = function () {
        const I = imp(); return JSON.stringify([S.project.name, I.target, (IM.files || []).filter(f => f.kind === 'collision').map(f => f.name || f.file), IM.allCutters(), IM.allRoomVolumes(), I.colDeletes || [], I.frame, I.entity]);
    };
    IM.colFinalLoad = async function () {
        const I = imp(); if (S.project.kind !== 'import' || !I.entity || !(IM.files || []).some(f => f.kind === 'collision')) return null;
        const rects = M.Shell.regionRects(S.project.shell); if (!rects.length) return null;
        const key = IM.colFinalKey(); if (IM.colFinal && IM.colFinal.key === key) return IM.colFinal;
        const project = S.project, seq = IM._colFinalSeq = (IM._colFinalSeq || 0) + 1;
        let x0 = 1e9, y0 = 1e9, x1 = -1e9, y1 = -1e9; rects.forEach(r => { x0 = Math.min(x0, r[0]); y0 = Math.min(y0, r[1]); x1 = Math.max(x1, r[2]); y1 = Math.max(y1, r[3]); });
        const c0 = IM.fromShell((x0 + x1) / 2, (y0 + y1) / 2, 0), rad = Math.hypot(x1 - x0, y1 - y0) / 2 + 6;
        const r = await Model.api('import/collision-final?name=' + safe(), 'POST', { cutters: IM.allCutters(), roomVolumes: IM.allRoomVolumes(), colDeletes: I.colDeletes || [], origin: IM.NOFRAME, entity: I.entity, nx: c0[0], ny: c0[1], radius: rad });
        if (seq !== IM._colFinalSeq || S.project !== project || S.project.kind !== 'import' || IM.colFinalKey() !== key) return null;
        const meta = new Int32Array(bytes(r.meta || '').buffer), v = f32(r.verts || ''), n = meta.length / 5, kind = new Uint8Array(n), mat = new Int32Array(n), c = new Float32Array(n * 12);
        for (let i = 0; i < n; i++) {
            kind[i] = meta[i * 5 + 3]; mat[i] = meta[i * 5 + 4];
            for (let k = 0; k < 4; k++) { const s = IM.toShell(v[i * 12 + k * 3], v[i * 12 + k * 3 + 1], v[i * 12 + k * 3 + 2]); c[i * 12 + k * 3] = s[0]; c[i * 12 + k * 3 + 1] = s[1]; c[i * 12 + k * 3 + 2] = s[2]; }
        }
        IM.colFinal = { key, n, kind, mat, c, files: r.files || [], meta };
        return IM.colFinal;
    };

    // ---------- picking ----------
    function rayTri(o, d, p, a, b, c) {
        const e1x = p[b] - p[a], e1y = p[b + 1] - p[a + 1], e1z = p[b + 2] - p[a + 2], e2x = p[c] - p[a], e2y = p[c + 1] - p[a + 1], e2z = p[c + 2] - p[a + 2];
        const px = d[1] * e2z - d[2] * e2y, py = d[2] * e2x - d[0] * e2z, pz = d[0] * e2y - d[1] * e2x, det = e1x * px + e1y * py + e1z * pz;
        if (Math.abs(det) < 1e-12) return -1; const inv = 1 / det, tx = o[0] - p[a], ty = o[1] - p[a + 1], tz = o[2] - p[a + 2];
        const u = (tx * px + ty * py + tz * pz) * inv; if (u < 0 || u > 1) return -1;
        const qx = ty * e1z - tz * e1y, qy = tz * e1x - tx * e1z, qz = tx * e1y - ty * e1x, v = (d[0] * qx + d[1] * qy + d[2] * qz) * inv; if (v < 0 || u + v > 1) return -1;
        const t = (e2x * qx + e2y * qy + e2z * qz) * inv; return t > 1e-4 ? t : -1;
    }
    IM.inView = function (x, y, z) {
        if (!IM.clipOn) return z <= IM.clipZ;
        const cam = M.App.renderer.camera.target, dx = x - cam[0], dy = y - cam[1]; return dx * dx + dy * dy <= IM.clipR * IM.clipR && z <= IM.clipZ;
    };
    // first triangle of the shown target model under the ray; the normal faces the viewer
    IM.pick = function (ray) {
        let best = null;
        for (const tb of IM.tgt) {
            const p = tb.pos, ix = tb.idx;
            for (let t = 0; t + 2 < ix.length; t += 3) {
                const a = ix[t] * 3, b = ix[t + 1] * 3, c = ix[t + 2] * 3, tt = rayTri(ray.o, ray.d, p, a, b, c);
                if (tt < 0 || (best && tt >= best.t)) continue;
                const cx = (p[a] + p[b] + p[c]) / 3, cy = (p[a + 1] + p[b + 1] + p[c + 1]) / 3, cz = (p[a + 2] + p[b + 2] + p[c + 2]) / 3; if (!IM.inView(cx, cy, cz)) continue;
                best = { t: tt, g: tb.g, tri: t / 3, a, b, c, p };
            }
        }
        if (!best) return null;
        const p = best.p, a = best.a, b = best.b, c = best.c;
        const e1 = [p[b] - p[a], p[b + 1] - p[a + 1], p[b + 2] - p[a + 2]], e2 = [p[c] - p[a], p[c + 1] - p[a + 1], p[c + 2] - p[a + 2]];
        let n = [e1[1] * e2[2] - e1[2] * e2[1], e1[2] * e2[0] - e1[0] * e2[2], e1[0] * e2[1] - e1[1] * e2[0]]; const l = Math.hypot(n[0], n[1], n[2]) || 1; n = [n[0] / l, n[1] / l, n[2] / l];
        if (n[0] * ray.d[0] + n[1] * ray.d[1] + n[2] * ray.d[2] > 0) n = [-n[0], -n[1], -n[2]];
        return { t: best.t, p: [ray.o[0] + ray.d[0] * best.t, ray.o[1] + ray.d[1] * best.t, ray.o[2] + ray.d[2] * best.t], n, g: best.g, tri: best.tri };
    };

    // ---------- the original (uncut) target in the shell frame, for choosing faces to delete ----------
    function shellOfModel(m) {
        const f = imp().frame, c = trig(), out = [];
        m.geoms.forEach(g => {
            const nv = g.pos.length / 3, pos = new Float32Array(nv * 3);
            for (let i = 0; i < nv; i++) { const dx = g.pos[i * 3] - f.x, dy = g.pos[i * 3 + 1] - f.y; pos[i * 3] = dx * c[0] + dy * c[1]; pos[i * 3 + 1] = -dx * c[1] + dy * c[0]; pos[i * 3 + 2] = g.pos[i * 3 + 2] - f.z; }
            out.push({ file: m.file, g: g.g, pos, idx: g.idx, lpos: g.pos });
        });
        return out;
    }
    function origShell() { if (IM.orig) return IM.orig; const m = IM.targetModel(); return (IM.orig = m ? shellOfModel(m) : []); }
    // the detail models (grilles, vents, bushes: separate files that go with the building) in the same frame; the door model is not one of them
    function origDetails() {
        if (IM.origD) return IM.origD; const dmf = imp().doorModel ? imp().doorModel.file : null, out = [];
        IM.models.forEach(m => { if (!m.target && m.file !== dmf) shellOfModel(m).forEach(t => out.push(t)); });
        return (IM.origD = out);
    }
    const isTarget = (file) => { const m = IM.targetModel(); return !file || (m && m.file === file); };
    const listOf = (file) => isTarget(file) ? origShell() : origDetails();
    // faces deleted from the detail models: Set of "geom:tri" for one file
    const mdelSet = (file) => { const s = new Set(); (imp().mdeletes || []).forEach(d => { if (d[0] === file) s.add(d[1] + ':' + d[2]); }); return s; };
    IM.mdelSet = mdelSet;
    function insideCutter(x, y, z) {
        return imp().cutters.some(k => {
            if (k.face) return false;                                            // an opening made from faces does not clip the model
            const dx = x - k.cx, dy = y - k.cy, cs = Math.cos(k.yaw), sn = Math.sin(k.yaw), u = dx * cs + dy * sn, n = -dx * sn + dy * cs;
            return Math.abs(u) < k.w / 2 && Math.abs(n) < k.d / 2 && z > k.zb && z < k.zb + k.h;
        });
    }
    const delSet = () => { const s = new Set(); imp().deletes.forEach(d => s.add(d[0] + ':' + d[1])); return s; };
    // an object of the model under the ray, for choosing a building: everything that is shown can be picked (hidden objects cannot)
    IM.pickComponent = function (ray) {
        let best = null;
        for (const tb of origShell()) {
            const p = tb.pos, ix = tb.idx, mem = (IM.member && IM.isoMode() === 'hide') ? IM.member[IM.gIdx.get(tb.g)] : null;
            for (let t = 0; t + 2 < ix.length; t += 3) {
                if (mem && !mem[t / 3]) continue;
                const a = ix[t] * 3, b = ix[t + 1] * 3, c = ix[t + 2] * 3, tt = rayTri(ray.o, ray.d, p, a, b, c);
                if (tt < 0 || (best && tt >= best.t)) continue;
                if (!IM.inView((p[a] + p[b] + p[c]) / 3, (p[a + 1] + p[b + 1] + p[c + 1]) / 3, (p[a + 2] + p[b + 2] + p[c + 2]) / 3)) continue;
                best = { t: tt, g: tb.g, tri: t / 3 };
            }
        }
        if (best) best.comp = IM.compAt(best.g, best.tri);
        return best;
    };
    // first face of the original model under the ray (opts.details: also the shown detail models); { t, g, tri, file }
    IM.pickOriginal = function (ray, opts) {
        const dels = delSet(); let best = null, mdel = {};
        const lists = [origShell()]; if (opts && opts.details && IM.showDetails) lists.push(origDetails());
        const dbox = IM.detailBox();
        for (let li = 0; li < lists.length; li++) for (const tb of lists[li]) {
            const isT = li === 0, p = tb.pos, ix = tb.idx, mem = isT && IM.isolating() ? IM.member[IM.gIdx.get(tb.g)] : null, dl = isT ? dels : (mdel[tb.file] || (mdel[tb.file] = mdelSet(tb.file)));
            for (let t = 0; t + 2 < ix.length; t += 3) {
                if (mem && !mem[t / 3]) continue;
                if (dl.has(tb.g + ':' + t / 3)) continue;
                if (!isT && dbox && !inBox(dbox, tb.lpos, ix, t / 3)) continue;
                const a = ix[t] * 3, b = ix[t + 1] * 3, c = ix[t + 2] * 3, tt = rayTri(ray.o, ray.d, p, a, b, c);
                if (tt < 0 || (best && tt >= best.t)) continue;
                const cx = (p[a] + p[b] + p[c]) / 3, cy = (p[a + 1] + p[b + 1] + p[c + 1]) / 3, cz = (p[a + 2] + p[b + 2] + p[c + 2]) / 3;
                if (!IM.inView(cx, cy, cz)) continue;
                // a triangle that lies completely inside a cutter is already gone; one that only reaches into it is still there
                if (isT && insideCutter(p[a], p[a + 1], p[a + 2]) && insideCutter(p[b], p[b + 1], p[b + 2]) && insideCutter(p[c], p[c + 1], p[c + 2])) continue;
                best = { t: tt, g: tb.g, tri: t / 3, file: tb.file };
            }
        }
        return best;
    };
    // every face that is shown and can be selected (the building, minus what is deleted, and the detail models when they are shown), in the grid's frame:
    // { file, g, tri, p: [9 numbers], c: [x, y, z] centre }. Used by box select, select all and the like.
    IM.shownFaces = function (details) {
        const out = [], dels = delSet(), lists = [origShell()]; if (details && IM.showDetails) lists.push(origDetails());
        const dbox = IM.detailBox(), mdel = {};
        for (let li = 0; li < lists.length; li++) for (const tb of lists[li]) {
            const isT = li === 0, p = tb.pos, ix = tb.idx, mem = isT && IM.isolating() ? IM.member[IM.gIdx.get(tb.g)] : null, dl = isT ? dels : (mdel[tb.file] || (mdel[tb.file] = mdelSet(tb.file)));
            for (let t = 0; t + 2 < ix.length; t += 3) {
                const tri = t / 3; if (mem && !mem[tri]) continue; if (dl.has(tb.g + ':' + tri)) continue; if (!isT && dbox && !inBox(dbox, tb.lpos, ix, tri)) continue;
                const a = ix[t] * 3, b = ix[t + 1] * 3, c = ix[t + 2] * 3, cx = (p[a] + p[b] + p[c]) / 3, cy = (p[a + 1] + p[b + 1] + p[c + 1]) / 3, cz = (p[a + 2] + p[b + 2] + p[c + 2]) / 3;
                if (!IM.inView(cx, cy, cz)) continue;
                if (isT && insideCutter(p[a], p[a + 1], p[a + 2]) && insideCutter(p[b], p[b + 1], p[b + 2]) && insideCutter(p[c], p[c + 1], p[c + 2])) continue;
                out.push({ file: tb.file, g: tb.g, tri, p: [p[a], p[a + 1], p[a + 2], p[b], p[b + 1], p[b + 2], p[c], p[c + 1], p[c + 2]], c: [cx, cy, cz] });
            }
        }
        return out;
    };
    // the connected piece of a model around one triangle: every triangle that can be reached through shared vertices (a grille, a vent, an air conditioner, a whole
    // building when it is one piece). Returns [{ g, tris }] over the geometries it spans.
    IM.isl = {};
    function islandData(file) {
        if (IM.isl[file]) return IM.isl[file]; const m = IM.models.find(x => x.file === file); if (!m) return null;
        const key = new Map(), par = []; let nid = 0;
        const find = (a) => { while (par[a] !== a) { par[a] = par[par[a]]; a = par[a]; } return a; }, uni = (a, b) => { a = find(a); b = find(b); if (a !== b) par[a] = b; };
        const vid = m.geoms.map(g => { const n = g.pos.length / 3, a = new Int32Array(n); for (let i = 0; i < n; i++) { const k = Math.round(g.pos[i * 3] * 500) + ',' + Math.round(g.pos[i * 3 + 1] * 500) + ',' + Math.round(g.pos[i * 3 + 2] * 500); let v = key.get(k); if (v === undefined) { v = nid++; key.set(k, v); par.push(v); } a[i] = v; } return a; });
        m.geoms.forEach((g, gi) => { for (let t = 0; t + 2 < g.idx.length; t += 3) { uni(vid[gi][g.idx[t]], vid[gi][g.idx[t + 1]]); uni(vid[gi][g.idx[t]], vid[gi][g.idx[t + 2]]); } });
        const groups = new Map(), tc = m.geoms.map(g => new Int32Array(g.idx.length / 3)), gIdx = new Map();
        m.geoms.forEach((g, gi) => { gIdx.set(g.g, gi); for (let t = 0; t * 3 < g.idx.length; t++) { const r = find(vid[gi][g.idx[t * 3]]); tc[gi][t] = r; let l = groups.get(r); if (!l) groups.set(r, l = new Map()); let arr = l.get(g.g); if (!arr) l.set(g.g, arr = []); arr.push(t); } });
        return (IM.isl[file] = { tc, groups, gIdx });
    }
    IM.island = function (file, g, tri) {
        const d = islandData(file || (IM.targetModel() || {}).file); if (!d) return []; const gi = d.gIdx.get(g); if (gi === undefined) return [];
        const l = d.groups.get(d.tc[gi][tri]), out = []; if (l) l.forEach((tris, gg) => out.push({ g: gg, tris })); return out;
    };
    // the flat, connected patch of triangles around one triangle (same plane, sharing edges)
    IM.flatPatch = function (g, tri, file) {
        const tb = listOf(file).find(x => x.g === g && (!file || x.file === file)); if (!tb) return [tri];
        const ix = tb.idx, P = tb.lpos, akey = tb.file + '|' + g;
        let adj = IM.adj[akey];
        if (!adj) {
            const weld = new Map(), wid = new Int32Array(Math.floor(P.length / 3)); wid.fill(-1);
            for (let i = 0; i < wid.length; i++) {
                const x = P[i * 3], y = P[i * 3 + 1], z = P[i * 3 + 2]; if (![x, y, z].every(Number.isFinite)) continue;
                const k = Math.round(x * 1000) + ',' + Math.round(y * 1000) + ',' + Math.round(z * 1000); let w = weld.get(k);
                if (w === undefined) { w = weld.size; weld.set(k, w); } wid[i] = w;
            }
            const edges = new Map(); adj = []; const nt = ix.length / 3;
            for (let t = 0; t < nt; t++) adj.push([]);
            for (let t = 0; t < nt; t++) for (let e = 0; e < 3; e++) {
                const ia = ix[t * 3 + e], ib = ix[t * 3 + (e + 1) % 3];
                if (ia >= wid.length || ib >= wid.length || ix[t * 3] >= wid.length || ix[t * 3 + 1] >= wid.length || ix[t * 3 + 2] >= wid.length) continue;
                const a = wid[ia], b = wid[ib]; if (a < 0 || b < 0 || a === b) continue; const k = a < b ? a + '_' + b : b + '_' + a, o = edges.get(k);
                if (o === undefined) edges.set(k, t); else { adj[t].push(o); adj[o].push(t); }
            }
            IM.adj[akey] = adj;
        }
        const normal = (t) => {
            if (!Number.isInteger(t) || t < 0 || t * 3 + 2 >= ix.length) return null;
            const ia = ix[t * 3], ib = ix[t * 3 + 1], ic = ix[t * 3 + 2];
            if (ia >= P.length / 3 || ib >= P.length / 3 || ic >= P.length / 3) return null;
            const a = ia * 3, b = ib * 3, c = ic * 3, e1 = [P[b] - P[a], P[b + 1] - P[a + 1], P[b + 2] - P[a + 2]], e2 = [P[c] - P[a], P[c + 1] - P[a + 1], P[c + 2] - P[a + 2]];
            const n = [e1[1] * e2[2] - e1[2] * e2[1], e1[2] * e2[0] - e1[0] * e2[2], e1[0] * e2[1] - e1[1] * e2[0]], l = Math.hypot(n[0], n[1], n[2]);
            if (!Number.isFinite(l) || l < 1e-10 || ![P[a], P[a + 1], P[a + 2]].every(Number.isFinite)) return null;
            return [n[0] / l, n[1] / l, n[2] / l, P[a], P[a + 1], P[a + 2]];
        };
        const n0 = normal(tri); if (!n0) return [];
        const d0 = n0[0] * n0[3] + n0[1] * n0[4] + n0[2] * n0[5], seen = new Set([tri]), q = [tri];
        while (q.length) {
            const t = q.pop();
            for (const o of adj[t]) {
                if (seen.has(o)) continue; const n = normal(o); if (!n) continue;
                if (Math.abs(n[0] * n0[0] + n[1] * n0[1] + n[2] * n0[2]) < 0.9995) continue;
                if (Math.abs(n0[0] * n[3] + n0[1] * n[4] + n0[2] * n[5] - d0) > 0.03) continue;
                seen.add(o); q.push(o);
            }
        }
        return [...seen];
    };
    IM.triCorners = function (g, tri, file, frame) {
        const tb = listOf(file).find(x => x.g === g && (!file || x.file === file)); if (!tb) return null;
        const o = []; for (let k = 0; k < 3; k++) { const i = tb.idx[tri * 3 + k] * 3; o.push(frame ? IM.toShellWithFrame(tb.lpos[i], tb.lpos[i + 1], tb.lpos[i + 2], frame) : [tb.pos[i], tb.pos[i + 1], tb.pos[i + 2]]); } return o;
    };

    // ---------- lines of the model's own walls, so rooms snap to them ----------
    IM.snapLines = function () {
        if (IM.lines) return IM.lines;
        const xs = new Map(), ys = new Map();
        for (const tb of IM.tgt) {
            const p = tb.pos, ix = tb.idx;
            for (let t = 0; t + 2 < ix.length; t += 3) {
                const a = ix[t] * 3, b = ix[t + 1] * 3, c = ix[t + 2] * 3, e1 = [p[b] - p[a], p[b + 1] - p[a + 1], p[b + 2] - p[a + 2]], e2 = [p[c] - p[a], p[c + 1] - p[a + 1], p[c + 2] - p[a + 2]];
                const n = [e1[1] * e2[2] - e1[2] * e2[1], e1[2] * e2[0] - e1[0] * e2[2], e1[0] * e2[1] - e1[1] * e2[0]], l = Math.hypot(n[0], n[1], n[2]); if (l < 0.4) continue;        // area under 0.2 m2
                if (Math.abs(n[2] / l) > 0.04) continue;
                const cx = (p[a] + p[b] + p[c]) / 3, cy = (p[a + 1] + p[b + 1] + p[c + 1]) / 3; if (Math.abs(cx) > 60 || Math.abs(cy) > 60) continue;
                const m = Math.abs(n[0] / l) > 0.999 ? xs : (Math.abs(n[1] / l) > 0.999 ? ys : null); if (!m) continue;
                const v = m === xs ? cx : cy, k = Math.round(v * 100); m.set(k, (m.get(k) || 0) + l / 2);
            }
        }
        const pick = (m) => [...m.entries()].filter(e => e[1] > 0.8).map(e => e[0] / 100);
        return (IM.lines = { xs: pick(xs), ys: pick(ys) });
    };

    // ---------- bounds of the target in the shell frame (for framing the camera) ----------
    IM.bounds = function (building) {
        const m = IM.targetModel(); if (!m) return null;
        const boxes = (building && IM.selComps) ? [...IM.selComps].map(id => { const c = IM.comp.comps[id]; return [c.mn, c.mx]; }) : [[m.bmin, m.bmax]];
        const mn = [1e9, 1e9, 1e9], mx = [-1e9, -1e9, -1e9];
        boxes.forEach(bx => { for (let i = 0; i < 8; i++) { const p = IM.toShell((i & 1) ? bx[1][0] : bx[0][0], (i & 2) ? bx[1][1] : bx[0][1], (i & 4) ? bx[1][2] : bx[0][2]); for (let a = 0; a < 3; a++) { mn[a] = Math.min(mn[a], p[a]); mx[a] = Math.max(mx[a], p[a]); } } });
        return { mn, mx };
    };
})(window.MLO);
