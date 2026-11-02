// Copy and paste (Ctrl+C, Ctrl+V) of what is selected: a window / door model, a piece of furniture, collision boxes, a room. A copy is pasted where the pointer
// is: a window or door on the wall under it (same model, size and height), furniture and boxes on the floor under it, a room with its middle there; with the
// pointer on nothing it goes next to the original. The copy is kept until something else is copied (in this window only, not the system clipboard).
window.MLO = window.MLO || {};
(function (M) {
    'use strict';
    const { Model } = M, S = Model.state, bus = Model.bus;
    const toast = (t, k) => bus.emit('toast', { text: t, kind: k });
    const r3 = (v) => Math.round(v * 1000) / 1000;
    const randId = () => Math.random().toString(36).slice(2, 8);
    const api = () => M.Tools.api;
    const clone = (o) => JSON.parse(JSON.stringify(o));
    const CB = M.Clipboard = { clip: null };
    let lastEvt = null;
    window.addEventListener('mousemove', (e) => { if (e.target === M.App.canvas) lastEvt = e; }, true);
    const ray = () => lastEvt ? api().pointerRay(lastEvt) : null;
    const ground = () => { const r = ray(), g = r ? api().planeHit(r, 0) : null; return g ? [g.x, g.y] : null; };

    // the selection of the active tool, as a copy: { type, items } or null
    function selection() {
        if (S.project.kind !== 'import') return null;
        const t = S.shellTool, I = S.project.import, sh = S.project.shell;
        if (t === 'fit' && M.FitModels.sel) { const f = (I.fits || []).find(q => q.id === M.FitModels.sel); return f ? { type: 'fit', items: [clone(f)] } : null; }
        if (t === 'furniture' && M.Furniture.sel) { const f = (sh.furniture || []).find(q => q.id === M.Furniture.sel); return f ? { type: 'furniture', items: [clone(f)] } : null; }
        if (t === 'cbox') { const ids = new Set(M.ImportTools.cbox.selected()), bs = (I.cboxes || []).filter(b => ids.has(b.id)); return bs.length ? { type: 'cbox', items: clone(bs) } : null; }
        if (t === 'select' && S.opSel != null && sh.ops[S.opSel]) return { type: 'room', items: [clone(sh.ops[S.opSel])] };
        return null;
    }
    const NAMES = { fit: ['model', 'models'], furniture: ['piece of furniture', 'pieces of furniture'], cbox: ['collision box', 'collision boxes'], room: ['room', 'rooms'] };
    const TOOL = { fit: 'fit', furniture: 'furniture', cbox: 'cbox', room: 'select' };
    const what = (c) => c.items.length + ' ' + NAMES[c.type][c.items.length === 1 ? 0 : 1];

    CB.copy = function () {
        const c = selection();
        if (!c) { toast('Select something first: a window or door model, a piece of furniture, collision boxes or a room.', 'warn'); return false; }
        CB.clip = c; toast('Copied: ' + what(c) + '. Ctrl+V puts it where the pointer is.', 'ok'); return true;
    };
    CB.paste = function () {
        const c = CB.clip; if (!c) { toast('Nothing copied yet: select something and press Ctrl+C.', 'warn'); return false; }
        if (S.project.kind !== 'import') return false;
        if (S.shellTool !== TOOL[c.type]) M.App.setTool(TOOL[c.type]);
        const done = ({ fit: pasteFit, furniture: pasteFurniture, cbox: pasteBoxes, room: pasteRoom })[c.type](c.items);
        if (done) toast('Pasted: ' + what(c) + '. Ctrl+Z takes it back.', 'ok');
        return done;
    };

    // a window or door model: on the wall under the pointer, facing out of it like a new one, with the copy's size, height and settings
    function pasteFit(items) {
        const it = items[0], FM = M.FitModels, m = FM.model(it.m), r = ray(), s = r ? M.ImportTools.surfaceAt(r) : null, nf = (m && s) ? FM.newFit(m, s) : null;
        const cp = Object.assign(clone(it), { id: randId() });
        if (nf) {
            // the middle of the wall's thickness the new one would sit at, for the copy's depth
            const back = (cp.d - nf.d) / 2, nx = -Math.sin(nf.yaw), ny = Math.cos(nf.yaw);
            cp.cx = r3(nf.cx - nx * back); cp.cy = r3(nf.cy - ny * back); cp.yaw = nf.yaw;
            if (cp.kind === 'door' || (cp.kind === 'frame' && !FM.isWinFrame(cp))) cp.zb = nf.zb;            // (on the floor; a window or a window frame keeps its height above the floor)
        } else { const cs = Math.cos(it.yaw), sn = Math.sin(it.yaw); cp.cx = r3(it.cx + cs * (it.w + 0.1)); cp.cy = r3(it.cy + sn * (it.w + 0.1)); }
        Model.edit(P => { (P.import.fits = P.import.fits || []).push(cp); }); FM.select(cp.id); return true;
    }
    function pasteFurniture(items) {
        const it = items[0], g = ground(), cp = Object.assign(clone(it), { id: randId() });
        if (g) { cp.x = r3(Math.round(g[0] / 0.05) * 0.05); cp.y = r3(Math.round(g[1] / 0.05) * 0.05); } else { cp.x = r3(it.x + 0.5); cp.y = r3(it.y + 0.5); }
        Model.edit(P => { (P.shell.furniture = P.shell.furniture || []).push(cp); }); M.Furniture.select(cp.id); return true;
    }
    // the boxes keep where they are to each other; their middle goes to the pointer
    function pasteBoxes(items) {
        const g = ground(); let dx = 0.25, dy = 0.25;
        if (g) { const mx = items.reduce((a, b) => a + b.cx, 0) / items.length, my = items.reduce((a, b) => a + b.cy, 0) / items.length; dx = Math.round((g[0] - mx) / 0.05) * 0.05; dy = Math.round((g[1] - my) / 0.05) * 0.05; }
        const copies = items.map(b => Object.assign(clone(b), { id: randId(), cx: r3(b.cx + dx), cy: r3(b.cy + dy) }));
        Model.edit(P => { P.import.cboxes = P.import.cboxes || []; copies.forEach(b => P.import.cboxes.push(b)); });
        copies.forEach((b, i) => M.ImportTools.cbox.select(b.id, i > 0)); return true;
    }
    function pasteRoom(items) {
        const o = clone(items[0]), r = o.r, g = ground(), w = r[2] - r[0], d = r[3] - r[1];
        const x0 = g ? Math.round((g[0] - w / 2) / 0.05) * 0.05 : r[0] + 0.5, y0 = g ? Math.round((g[1] - d / 2) / 0.05) * 0.05 : r[1] + 0.5;
        o.r = [r3(x0), r3(y0), r3(x0 + w), r3(y0 + d)];
        let at = -1; Model.edit(P => { P.shell.ops.push(o); at = P.shell.ops.length - 1; }); S.opSel = at; M.UI.renderLeft(); return true;
    }
})(window.MLO);
