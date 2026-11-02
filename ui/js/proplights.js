// The lights built into props (a lamp's, Vanilla.LightsOf): each one switched on or off, its colour, brightness, range and softness, seen in the night preview
// of the view (render.js: by night the scene is lit by up to 16 of these lights, the nearest to where the camera looks). The changes act on the model, so on
// every object that shows it; the export writes the model under a name of its own with the changed lights (Buildings.ExportModels). They are kept in a game
// interior with the model's other changes (game.mods[model].lights), in the other projects in propLights[model]: { light number: { on, c, k, f, e } }.
window.MLO = window.MLO || {};
(function (M) {
    'use strict';
    const { el, Model } = M, S = Model.state;
    const PL = M.PropLights = { night: false };
    const hex = (c) => '#' + c.map(v => ('0' + Math.max(0, Math.min(255, Math.round(v))).toString(16)).slice(-2)).join('');
    const unhex = (h) => [1, 3, 5].map(i => parseInt(h.substr(i, 2), 16));
    const f2 = (v, d) => (+v).toFixed(d == null ? 2 : d);

    // the changes of a model's lights (create: make the place for them)
    function store(n, create) {
        const P = S.project; if (!P) return null;
        if (P.kind === 'game') {
            const g = P.game; if (!g.mods) { if (!create) return null; g.mods = {}; }
            let m = g.mods[n]; if (!m) { if (!create) return null; m = g.mods[n] = {}; }
            if (!m.lights) { if (!create) return null; m.lights = {}; } return m.lights;
        }
        if (!P.propLights) { if (!create) return null; P.propLights = {}; }
        if (!P.propLights[n]) { if (!create) return null; P.propLights[n] = {}; } return P.propLights[n];
    }
    // a light as it is now: the model's own values with the changes over them
    PL.value = function (n, i, L) {
        const ch = (store(n, false) || {})[i] || {};
        return { on: ch.on !== false, c: ch.c || L.c, k: ch.k != null ? ch.k : L.k, f: ch.f != null ? ch.f : L.f, e: ch.e != null ? ch.e : L.e, changed: Object.keys(ch).length > 0 };
    };
    function set(n, i, patch) { const st = store(n, true); st[i] = Object.assign({}, st[i] || {}, patch); Model.touch(); }
    function reset(n, i) { const st = store(n, false); if (st) { delete st[i]; Model.touch(); } }

    PL.setNight = function (on) {
        PL.night = !!on; const R = M.App && M.App.renderer;
        if (R && !R.lightsFn) R.lightsFn = (cam) => PL.night ? PL.collect(cam) : null;
        M.UI.renderLeft(); M.UI.renderRight();
    };
    PL.nightToggle = () => el('label', { class: 'chk' }, el('input', { type: 'checkbox', checked: PL.night ? true : null, onchange: (e) => PL.setNight(e.target.checked) }), 'Night preview (lit by the lamps)');

    // ---------- the lights of the scene, in the view's frame ----------
    const qrot = (q, v) => {          // v turned by the quaternion q = [x, y, z, w]
        const [x, y, z, w] = q, ix = w * v[0] + y * v[2] - z * v[1], iy = w * v[1] + z * v[0] - x * v[2], iz = w * v[2] + x * v[1] - y * v[0], iw = -x * v[0] - y * v[1] - z * v[2];
        return [ix * w + iw * -x + iy * -z - iz * -y, iy * w + iw * -y + iz * -x - ix * -z, iz * w + iw * -z + ix * -y - iy * -x];
    };
    function push(out, L, v, pos, dir) {
        if (!v.on || v.k <= 0 || v.f <= 0) return;
        const k = v.k / 7, spot = /spot/i.test(L.t || '') && L.cone > 0;
        out.push({ p: pos, r: v.f, c: [v.c[0] / 255 * k, v.c[1] / 255 * k, v.c[2] / 255 * k], e: Math.max(0.6, Math.min(3, v.e / 16)), d: spot ? dir : null, cone: spot ? Math.cos(Math.min(89, L.cone) * Math.PI / 180) : -2 });
    }
    PL.collect = function (cam) {
        const P = S.project, out = []; if (!P) return out;
        if (P.kind === 'game' && M.GameMlo && M.GameMlo.active) {
            const GM = M.GameMlo;
            P.game.entities.forEach((e, i) => {
                if (e.del || (GM.hidden && GM.hidden.has(i)) || (e.ext && GM.showOutside === false)) return;
                const m = GM.model(e.n); if (!m || !m.lights || !m.lights.length) return; const sc = (e.s && e.s[0]) || 1, sz = (e.s && e.s[1]) || 1;
                m.lights.forEach((L, k) => { const v = PL.value(e.n, k, L), o = qrot(e.q, [L.p[0] * sc, L.p[1] * sc, L.p[2] * sz]); push(out, L, v, [e.p[0] + o[0], e.p[1] + o[1], e.p[2] + o[2]], qrot(e.q, L.d || [0, 0, -1])); });
            });
        } else if (P.kind === 'import' && M.Furniture) {
            ((P.shell && P.shell.furniture) || []).forEach(f => {
                const m = M.Furniture.model(f.n); if (!m || !m.lights || !m.lights.length) return; const h = (f.h || 0) * Math.PI / 180, c = Math.cos(h), s = Math.sin(h);
                m.lights.forEach((L, k) => { const v = PL.value(f.n, k, L), d = L.d || [0, 0, -1]; push(out, L, v, [f.x + L.p[0] * c - L.p[1] * s, f.y + L.p[0] * s + L.p[1] * c, (f.z || 0) + L.p[2]], [d[0] * c - d[1] * s, d[0] * s + d[1] * c, d[2]]); });
            });
            // the lamps of the Light tool (warm white, as the export writes them)
            const top = (P.settings && P.settings.ceilH) || 2.45;
            ((P.shell && P.shell.lights) || []).forEach(l => out.push({ p: [l.x, l.y, top - 0.15], r: 6, c: [4 / 7, 4 * 238 / 255 / 7, 4 * 210 / 255 / 7], e: 1.5, d: null, cone: -2 }));
        }
        // the nearest to where the camera looks (the shader takes 16)
        const t = cam ? cam.target : [0, 0, 0], d2 = (q) => (q.p[0] - t[0]) ** 2 + (q.p[1] - t[1]) ** 2 + (q.p[2] - t[2]) ** 2;
        out.sort((a, b) => d2(a) - d2(b)); return out.slice(0, 16);
    };

    // ---------- the panel of a selected object's lights (n: its model, m: the model as the page has it, with lights and frag) ----------
    PL.panel = function (root, n, m) {
        if (!m || !m.lights || !m.lights.length) return;
        root.append(el('div', { class: 'h' }, 'Its lights (' + m.lights.length + ')'));
        root.append(PL.nightToggle());
        if (m.frag) { root.append(el('div', { class: 'note' }, 'A model that breaks or moves (.yft): its lights show in the preview, but they cannot be changed.')); }
        root.append(el('div', { class: 'note' }, 'Changes act on the model ' + n + ', so on every object that shows it. The export gives it a name of its own with the changed lights; the same model elsewhere in the world stays as it was.'));
        const slider = (label, min, max, step, val, unit, onSet) => {
            const out = el('span', { class: 'note', style: { minWidth: '52px', textAlign: 'right' } }, f2(val, step < 1 ? 1 : 0) + unit);
            return el('div', { class: 'row' }, el('label', null, label), el('input', { type: 'range', class: 'grow', min, max, step, value: val, disabled: m.frag ? true : null,
                oninput: (e) => { const v = parseFloat(e.target.value); out.textContent = f2(v, step < 1 ? 1 : 0) + unit; onSet(v); } }), out);
        };
        m.lights.forEach((L, i) => {
            const v = PL.value(n, i, L), kind = /spot/i.test(L.t || '') ? 'spot, ' + Math.round(L.cone) + '°' : (L.t || 'point').toLowerCase();
            const box = el('div', { style: { borderLeft: '2px solid ' + (v.changed ? 'var(--accent)' : 'var(--line2)'), paddingLeft: '8px', margin: '6px 0' } });
            box.append(el('div', { class: 'row wrap' },
                el('label', { class: 'chk', style: { margin: 0 } }, el('input', { type: 'checkbox', checked: v.on ? true : null, disabled: m.frag ? true : null, onchange: (e) => { set(n, i, { on: e.target.checked }); M.UI.renderRight(); } }), 'Light ' + (i + 1)),
                el('span', { class: 'note grow' }, kind),
                el('input', { type: 'color', value: hex(v.c), disabled: m.frag ? true : null, title: 'Its colour', style: { width: '38px', height: '24px', padding: 0, border: 0, background: 'none' }, oninput: (e) => set(n, i, { c: unhex(e.target.value) }) }),
                v.changed ? el('button', { class: 'btn sm', title: 'Back to the model\'s own values', onclick: () => { reset(n, i); M.UI.renderRight(); } }, 'Reset') : null));
            box.append(slider('Brightness', 0, Math.max(64, Math.ceil(L.k * 2)), 0.5, v.k, '', x => set(n, i, { k: x })),
                slider('Range', 0.2, Math.max(25, Math.ceil(L.f * 2)), 0.1, v.f, ' m', x => set(n, i, { f: x })),
                slider('Softness', 1, 64, 1, v.e, '', x => set(n, i, { e: x })));
            root.append(box);
        });
        if (!PL.night) root.append(el('div', { class: 'note' }, 'Turn on the night preview to see the light in the view.'));
    };
})(window.MLO);
