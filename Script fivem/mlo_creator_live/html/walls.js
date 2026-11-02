// The wall editor's panels: the state (top right), the inspector of the selected wall (left, Enter), the box to paste MLO Creator's walls into, and the copy.
(function () {
    const $ = (id) => document.getElementById(id);
    const post = (name, data) => fetch('https://' + GetParentResourceName() + '/' + name, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(data || {}) }).catch(() => { });
    const r3 = (v) => Math.round(v * 1000) / 1000, f2 = (v) => (+v).toFixed(2);
    const KEYS = [['R', 'Dessiner / sélectionner'], ['Clic', 'Début, puis fin du mur'], ['Clic droit', 'Finir la ligne'], ['Alt', 'Sans aimantation'],
        ['Souris · W A S D', 'Regarder · voler'], ['Espace / C', 'Monter / descendre'], ['Clic', 'Sélectionner un mur'], ['Entrée', 'Modifier (hauteur, portes...)'],
        ['Flèches', 'Déplacer'], ['PageUp / PageDown', 'Monter / descendre le mur'], ['Q / E', 'Tourner'], ['G', 'Prendre au viseur'], ['F', 'Copier'],
        ['X / Suppr', 'Supprimer'], ['Z', 'Annuler'], ['1 / 2 · 3 / 4', 'Pas de déplacement · rotation'], ['H', 'Cacher les touches']];
    const toast = (text, kind) => window.postMessage({ type: 'toast', text, kind }, '*');
    const el = (tag, attrs, ...kids) => {
        const e = document.createElement(tag);
        Object.entries(attrs || {}).forEach(([k, v]) => { if (v == null || v === false) return; if (k.startsWith('on')) e.addEventListener(k.slice(2), v); else if (k === 'class') e.className = v; else e.setAttribute(k, v === true ? '' : v); });
        kids.flat().forEach(k => { if (k != null && k !== false) e.append(k.nodeType ? k : document.createTextNode(String(k))); });
        return e;
    };

    // ---------- the state ----------
    function state(s) {
        $('wpanel').hidden = !s.open; if (!s.open) return;
        $('wname').textContent = 'Projet : ' + s.name + ' · ' + s.count + ' mur' + (s.count > 1 ? 's' : '') + (s.undo ? ' · ' + s.undo + ' à annuler' : '');
        const box = $('wsel'); box.textContent = '';
        box.append(el('span', { class: 'mode' + (s.draw ? '' : ' sel') }, s.draw ? 'DESSIN' : 'SÉLECTION'));
        if (s.draw) box.append(s.drawing ? 'Clique où le mur finit · clic droit : finir la ligne' : 'Clique au sol où le mur commence');
        else if (s.sel) {
            box.append(el('b', null, 'Mur ' + f2(s.sel.l) + ' m'), s.grab ? ' · tenu : clic pour poser' : '', el('br'),
                'hauteur ' + f2(s.sel.h) + ' m · épaisseur ' + f2(s.sel.t) + ' m', el('br'), s.sel.tex + (s.sel.ops ? ' · ' + s.sel.ops + ' ouverture' + (s.sel.ops > 1 ? 's' : '') : ''), el('br'), 'Entrée : modifier');
        } else box.append(s.hover ? 'Clique pour sélectionner ce mur' : 'Vise un mur et clique, ou R pour dessiner.');
        $('wsteps').textContent = 'Pas ' + s.move + ' m · rotation ' + s.turn + '°';
        $('whelp').hidden = !s.help;
        if (s.help && !$('whelp').childElementCount) KEYS.forEach(k => $('whelp').append(el('div', null, el('kbd', null, k[0]), el('span', null, k[1]))));
    }

    // ---------- the inspector ----------
    let cur = null, textures = [];
    const len = (w) => Math.hypot(w.b[0] - w.a[0], w.b[1] - w.a[1]);
    const send = () => post('wallsUpdate', { wall: cur });
    const randId = () => Math.random().toString(36).slice(2, 8);
    function num(label, value, step, set) {
        return el('div', { class: 'field' }, el('label', null, label), el('input', { type: 'number', step, value: r3(value), onchange: (ev) => { const v = parseFloat(ev.target.value); if (!isNaN(v)) { set(v); send(); render(); } } }));
    }
    function close() { cur = null; $('winsp').hidden = true; post('wallsClose'); }
    function render() {
        const box = $('winsp'), w = cur; box.textContent = ''; if (!w) { box.hidden = true; return; }
        box.hidden = false; const L = len(w);
        box.append(el('div', { class: 'title' }, 'Mur ', el('span', null, f2(L) + ' m')));
        box.append(num('Longueur (m)', L, 0.05, v => { const l = Math.max(0.2, v), ux = (w.b[0] - w.a[0]) / L, uy = (w.b[1] - w.a[1]) / L; w.b = [r3(w.a[0] + ux * l), r3(w.a[1] + uy * l)]; }));
        box.append(num('Hauteur (m)', w.h, 0.05, v => { w.h = r3(Math.max(0.3, v)); }));
        box.append(num('Épaisseur (m)', w.t, 0.01, v => { w.t = r3(Math.max(0.03, v)); }));
        box.append(num('Pied, Z (m)', w.z, 0.05, v => { w.z = r3(v); }));
        const list = textures.indexOf(w.tex) < 0 ? [w.tex].concat(textures) : textures;
        box.append(el('div', { class: 'field' }, el('label', null, 'Texture'), el('select', { onchange: (ev) => { w.tex = ev.target.value; send(); } }, ...list.map(t => el('option', { value: t, selected: t === w.tex }, t)))));
        box.append(el('div', { class: 'row' },
            el('button', { class: 'btn', onclick: () => addOp('door') }, '+ Porte'), el('button', { class: 'btn', onclick: () => addOp('window') }, '+ Fenêtre'),
            el('button', { class: 'btn', onclick: () => addOp('pass') }, '+ Passage'),
            el('button', { class: 'btn', onclick: () => { const a = w.a; w.a = w.b; w.b = a; w.ops.forEach(o => { o.u = r3(L - o.u); if (o.type === 'door' && o.door) o.flip = !o.flip; }); send(); render(); } }, 'Inverser')));
        w.ops.forEach((o, k) => {
            const name = { door: 'Porte', window: 'Fenêtre', pass: 'Passage' }[o.type] || o.type, box2 = el('div', { class: 'op' });
            box2.append(el('div', { class: 'h' }, name + ' ' + (k + 1)));
            box2.append(num('Depuis le début (m)', o.u, 0.05, v => { o.u = r3(v); }), num('Largeur (m)', o.w, 0.05, v => { o.w = r3(Math.max(0.2, v)); }));
            if (o.type === 'window') box2.append(num('Allège (m)', o.z0, 0.05, v => { o.z0 = r3(Math.max(0, v)); }));
            box2.append(num('Haut (m)', o.z1, 0.05, v => { o.z1 = r3(Math.max(0.3, v)); }));
            if (o.type === 'door') {
                const inp = el('input', { type: 'text', value: o.door || '', placeholder: 'v_ilev_ph_door01, prop_door_01...', spellcheck: 'false', onkeydown: (ev) => { if (ev.key === 'Enter') post('wallsDoor', { oid: o.id, model: inp.value.trim() }); } });
                box2.append(el('div', { class: 'field' }, el('label', null, 'Porte du jeu'), inp));
                box2.append(el('div', { class: 'row' }, el('button', { class: 'btn', onclick: () => post('wallsDoor', { oid: o.id, model: inp.value.trim() }) }, 'Mettre cette porte'),
                    o.door ? el('button', { class: 'btn', onclick: () => { o.flip = !o.flip; send(); } }, 'Sens inverse') : null,
                    o.door ? el('button', { class: 'btn', onclick: () => post('wallsDoor', { oid: o.id, model: '' }) }, 'Sans porte') : null));
            }
            box2.append(el('div', { class: 'row' }, el('button', { class: 'btn danger', onclick: () => { w.ops = w.ops.filter(q => q.id !== o.id); send(); render(); } }, 'Retirer')));
            box.append(box2);
        });
        box.append(el('div', { class: 'row' }, el('button', { class: 'btn primary', onclick: close }, 'Fermer (Échap)'), el('button', { class: 'btn danger', onclick: () => { cur = null; $('winsp').hidden = true; post('wallsDelete'); } }, 'Supprimer le mur')));
    }
    function addOp(type) {
        const w = cur, L = len(w), sz = type === 'door' ? [0.9, 0, 2.1] : (type === 'window' ? [1.0, 0.9, 2.1] : [1.2, 0, 2.3]);
        w.ops.push({ id: randId(), type, u: r3(L / 2), w: Math.min(sz[0], r3(L - 0.2)), z0: sz[1], z1: Math.min(sz[2], r3(w.h - 0.1)), door: null, flip: false });
        send(); render();
    }

    // ---------- copy and paste with MLO Creator ----------
    function copy(text) {
        const t = $('wcopy'); t.value = text; t.focus(); t.select();
        let ok = false; try { ok = document.execCommand('copy'); } catch (e) { ok = false; }
        t.blur(); toast(ok ? 'Murs copiés. Dans MLO Creator : panneau Murs, « Coller les murs de FiveM ».' : "La copie n'a pas marché.", ok ? 'success' : 'error');
    }
    $('wpasteok').addEventListener('click', () => { const text = $('wpastetext').value.trim(); $('wpaste').hidden = true; post('wallsPaste', { text }); });
    $('wpastecancel').addEventListener('click', () => { $('wpaste').hidden = true; post('wallsCancel'); });

    window.addEventListener('message', (ev) => {
        const m = ev.data || {};
        if (m.type === 'walls:state') state(m);
        else if (m.type === 'walls:inspect') {
            if (!m.wall) { cur = null; $('winsp').hidden = true; return; }
            cur = m.wall; cur.ops = Array.isArray(cur.ops) ? cur.ops : []; textures = Array.isArray(m.textures) ? m.textures : []; render();
        }
        else if (m.type === 'walls:copy') copy(m.text);
        else if (m.type === 'walls:paste') { $('wpastetext').value = ''; $('wpaste').hidden = false; setTimeout(() => $('wpastetext').focus(), 30); }
    });
    window.addEventListener('keydown', (e) => {
        if (e.key !== 'Escape') return;
        if (!$('wpaste').hidden) { $('wpaste').hidden = true; post('wallsCancel'); }
        else if (!$('winsp').hidden) close();
    });
})();
