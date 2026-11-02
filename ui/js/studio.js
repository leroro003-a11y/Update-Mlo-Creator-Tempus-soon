// ---------- MLO Studio: the "Applications" button of the top bar ----------
// MloStudio.exe (next to MloCreator.exe) shows MLO Creator, CodeWalker and any other program in one window, as tabs or side by side.
// While it runs it writes js/studio-config.js (its port on 127.0.0.1 and a key); this file reads it and asks MLO Studio to open,
// show or arrange the programs. Without MLO Studio the button explains how to start it. Nothing here touches the project.
window.MLO = window.MLO || {};
(function (M) {
    'use strict';
    const $ = (id) => document.getElementById(id);
    const isFr = () => !M.I18n || !M.I18n.lang || M.I18n.lang === 'fr';
    const t = (fr, en) => (isFr() ? fr : (M.tx ? M.tx(en) : en));   // other languages: i18n-extra.js
    let cfg = window.MLO_STUDIO || null;
    let lastJson = '', pollTimer = 0;

    function el(tag, attrs, ...kids) {
        const e = document.createElement(tag);
        if (attrs) for (const k in attrs) {
            const v = attrs[k];
            if (v == null || v === false) continue;
            if (k === 'class') e.className = v;
            else if (k.startsWith('on')) e.addEventListener(k.slice(2), v);
            else if (k === 'html') e.innerHTML = v;
            else if (v === true) e.setAttribute(k, '');
            else e.setAttribute(k, v);
        }
        for (const kid of kids.flat()) { if (kid == null || kid === false) continue; e.append(kid.nodeType ? kid : document.createTextNode(String(kid))); }
        return e;
    }
    const svg = (paths) => el('span', { class: 'studio-ic', html: '<svg viewBox="0 0 24 24" aria-hidden="true">' + paths + '</svg>' });
    const ICONS = {
        apps: '<rect x="3" y="4" width="18" height="16" rx="2"/><path d="M3 9h18"/><path d="M10 9v11"/>',
        map: '<path d="M9 4 3 6v14l6-2 6 2 6-2V4l-6 2-6-2z"/><path d="M9 4v14M15 6v14"/>',
        files: '<path d="M4 6a2 2 0 0 1 2-2h4l2 2h6a2 2 0 0 1 2 2v10a2 2 0 0 1-2 2H6a2 2 0 0 1-2-2z"/><path d="M9 13h6"/>',
        add: '<rect x="3" y="3" width="18" height="18" rx="3"/><path d="M12 8v8M8 12h8"/>',
        split: '<rect x="3" y="4" width="18" height="16" rx="2"/><path d="M12 4v16"/>',
        share: '<path d="M12 15V3"/><path d="m7 8 5-5 5 5"/><path d="M5 13v6a2 2 0 0 0 2 2h10a2 2 0 0 0 2-2v-6"/>',
        live: '<path d="M3 21h18"/><path d="M5 21V8l7-5 7 5v13"/><path d="M9 21v-6h6v6"/><circle cx="18" cy="5" r="2.2"/>'
    };

    // the key file is rewritten each time MLO Studio starts: read it again when a call fails
    function loadCfg(withQuery) {
        return new Promise((res) => {
            const s = document.createElement('script');
            s.src = 'js/studio-config.js' + (withQuery ? '?t=' + Date.now() : '');
            s.onload = () => { s.remove(); cfg = window.MLO_STUDIO || null; res(true); };
            s.onerror = () => { s.remove(); res(false); };
            document.head.append(s);
        });
    }
    async function raw(path, params, ms) {
        if (!cfg || !cfg.port || !cfg.token) return null;
        const q = new URLSearchParams(Object.assign({ token: cfg.token, lang: (M.I18n && M.I18n.lang) || 'fr' }, params || {}));
        const ctl = new AbortController();
        const timer = setTimeout(() => ctl.abort(), ms || 2500);
        try {
            const r = await fetch('http://127.0.0.1:' + cfg.port + '/' + path + '?' + q.toString(), { cache: 'no-store', signal: ctl.signal });
            return r.ok ? await r.json() : null;
        } catch (e) { return null; } finally { clearTimeout(timer); }
    }
    async function call(path, params) {
        let r = await raw(path, params);
        if (!r) {
            if (!(await loadCfg(true))) await loadCfg(false);
            r = await raw(path, params);
        }
        return r;
    }

    // longer calls (the output folder list) and the address of one file of the output folder, for "Share your project"
    async function get(path, params, ms) {
        let r = await raw(path, params, ms);
        if (!r) { if (!(await loadCfg(true))) await loadCfg(false); r = await raw(path, params, ms); }
        return r;
    }
    function fileUrl(rel) {
        if (!cfg || !cfg.port || !cfg.token) return null;
        return 'http://127.0.0.1:' + cfg.port + '/outdir/file?' + new URLSearchParams({ token: cfg.token, path: rel }).toString();
    }

    function stateText(s) {
        return ({
            embedded: t('affichée ici', 'shown here'), searching: t('ouverture…', 'opening…'), detached: t('dans sa propre fenêtre', 'in its own window'),
            closed: t('fermée', 'closed'), idle: t('pas lancée', 'not started')
        })[s] || s;
    }

    function card(icon, title, sub, onclick, on, extra) {
        return el('button', { class: 'studio-card' + (on ? ' on' : '') + (extra ? ' ' + extra : ''), type: 'button', onclick }, svg(ICONS[icon]), el('span', null, el('b', null, title), el('small', null, sub)));
    }

    // ---------- "Share your project" ----------
    // Same system as the "Upload Mlo Site" dialog (siteupload.js): the mapping's folder is checked file by file, zipped with a report,
    // sent to the TEMPUS website and kept pending there until a staff member accepts it. MLO Studio's own "Share your project" card
    // queues the request; this page asks MLO Studio for it about once a second (path "inbox") and opens the dialog.
    let shareWait = 0;
    function openShare() {
        clearTimeout(shareWait);
        if (document.querySelector('.share-dialog.su')) return;   // already open (maybe uploading): leave it alone
        const ready = M.UI && M.UI.modal && M.Model && M.Model.state && M.Model.state.project && M.SiteUpload && M.SiteUpload.dialog;
        if (!ready) { const t0 = openShare.t0 || (openShare.t0 = Date.now()); if (Date.now() - t0 < 30000) shareWait = setTimeout(openShare, 400); else openShare.t0 = 0; return; }
        openShare.t0 = 0;
        const fromHome = !!document.querySelector('.welcome-home') && M.UI.startDialog;   // came over the start screen: Back returns to it
        M.SiteUpload.dialog({ title: 'Share your project', back: fromHome ? () => M.UI.startDialog() : null });
    }
    // ---------- "Modification live" ----------
    // MLO Studio's "Modification live" window follows what is selected in CodeWalker; "Edit this building" queues it and this page
    // picks it up (path "inbox", field live = { name, raw, hasPos, x, y, z }). The building is looked up like in "Building of the game":
    // an interior of that name opens in the editor at once; otherwise the interiors round the position are listed, one click opens one.
    // Once it is open, the object clicked in CodeWalker (a prop of the interior) is selected and framed. Every change shows live in the 3D view.
    let liveWait = 0, liveRun = 0;
    function openLive(L) {
        clearTimeout(liveWait);
        const ready = M.UI && M.UI.modal && M.Model && M.Model.state && M.Model.state.project && M.Buildings && M.Buildings.dialog;
        if (!ready) { const t0 = openLive.t0 || (openLive.t0 = Date.now()); if (Date.now() - t0 < 30000) liveWait = setTimeout(() => openLive(L), 400); else openLive.t0 = 0; return; }
        openLive.t0 = 0;
        runLive(L).catch(e => M.UI.toast(t('Modification live : ', 'Live edit: ') + e.message, 'err'));
    }
    async function runLive(L) {
        const B = M.Buildings, run = ++liveRun;
        const name = String(L.name || '').trim().toLowerCase();
        const pt = L.hasPos ? Math.round(L.x) + ' ' + Math.round(L.y) : '';
        if (!name && !pt) return;
        if (B.busy) { M.UI.toast(t('Une recherche de bâtiment est déjà en cours : réessaie dans un instant.', 'A building search is already running: try again in a moment.'), 'err'); return; }
        const before = M.Model.state.project;
        M.UI.toast(t('Modification live : recherche de ', 'Live edit: looking up ') + (name || pt) + '…', 'ok');
        B.dialog();
        const interiors = () => (B.results || []).filter(r => r.kind === 'interior');
        let hit = null;
        if (name) { await B.search(name); hit = interiors().find(r => String(r.name || '').toLowerCase() === name) || null; }
        if (run !== liveRun) return;
        // not an interior's name (a prop, a part of the building): what is round the spot CodeWalker looks at
        if (!hit && pt && !interiors().length) await B.search(pt);
        if (run !== liveRun) return;
        if (!hit && interiors().length === 1 && !name) hit = interiors()[0];
        if (hit) await B.openInEditor(hit);
        else if (interiors().length) M.UI.toast(t('Choisis le bâtiment dans la liste puis « Open in the editor ».', 'Pick the building in the list, then "Open in the editor".'), 'ok');
        if (name) followLive(before, name, run);
    }
    // the project opened (now or by a click in the list): select the object that was clicked in CodeWalker
    function followLive(before, name, run) {
        const t0 = Date.now();
        const step = () => {
            if (run !== liveRun || Date.now() - t0 > 120000) return;
            const P = M.Model.state.project, GM = M.GameMlo;
            if (!P || P === before || P.kind !== 'game' || !GM || !GM.active || GM.loading) { setTimeout(step, 500); return; }
            const list = (P.game && P.game.entities) || [];
            const i = list.findIndex(e => String(e.n || '').toLowerCase() === name);
            if (i < 0) return;
            try { GM.select(i); if (GM.look) GM.look(i); M.UI.toast(t('Sélectionné comme dans CodeWalker : ', 'Selected as in CodeWalker: ') + name, 'ok'); } catch (e) { }
        };
        setTimeout(step, 500);
    }

    let inboxTimer = 0, inboxMiss = 0;
    function inbox() {
        clearTimeout(inboxTimer);
        inboxTimer = setTimeout(async () => {
            if (!cfg || !cfg.port) {
                if (++inboxMiss % 8 === 0) await loadCfg(true);   // MLO Studio started after this page: its key file shows up later
                return inbox();
            }
            const r = await raw('inbox');
            if (!r) { if (++inboxMiss % 8 === 0) await loadCfg(true); }
            else { inboxMiss = 0; if (r.share) openShare(); if (r.live) openLive(r.live); }
            inbox();
        }, 1100);
    }

    function render(box, st) {
        box.replaceChildren();
        box.append(el('h2', null, 'Applications'));
        if (!st) {
            box.append(
                el('div', { class: 'studio-off' },
                    el('div', { class: 'studio-off-t' }, t('MLO Studio n\'est pas lancé', 'MLO Studio is not running')),
                    el('div', { class: 'note' }, t('Ferme MLO Creator et ouvre plutôt ', 'Close MLO Creator and open '), el('b', null, 'MloStudio.exe'),
                        t(' (même dossier). MLO Creator s\'ouvre dedans, et ce bouton affiche CodeWalker, ou n\'importe quel logiciel, juste à côté.', ' instead (same folder). MLO Creator opens inside it, and this button shows CodeWalker, or any program, right next to it.')),
                    el('div', { class: 'note' }, t('Pas encore de MloStudio.exe ? Double-clique ', 'No MloStudio.exe yet? Double-click '), el('b', null, t('Construire MLO Studio.bat', 'Construire MLO Studio.bat')), t(' dans le dossier du logiciel.', ' in the program folder.'))),
                el('div', { class: 'foot' },
                    el('button', { class: 'btn', type: 'button', onclick: () => openDialog() }, t('Réessayer', 'Try again')),
                    el('button', { class: 'btn primary', type: 'button', onclick: () => M.UI.closeModal() }, t('Fermer', 'Close'))));
            return;
        }
        const cw = (st.apps || []).filter(a => a.kind === 'codewalker');
        const cwSub = (args) => { const a = cw.find(x => x.name === args); return a ? stateText(a.state) : (st.codewalker ? t('CodeWalker · World View', 'CodeWalker · World View') : t('tu choisiras CodeWalker.exe', 'you will pick CodeWalker.exe')); };
        box.append(el('div', { class: 'studio-grid' },
            card('share', 'Share your project', t('Analyse, ZIP et envoi sur le site TEMPUS · en attente jusqu\'à ce qu\'un staff l\'accepte', 'Check, ZIP and send to the TEMPUS website · pending until a staff member accepts it'), () => { M.UI.closeModal(); openShare(); }, false, 'wide share'),
            card('live', t('Modification live', 'Live edit'), t('Sélectionne un bâtiment dans CodeWalker et édite-le ici avec un aperçu en direct', 'Pick a building in CodeWalker and edit it here with a live preview'), () => act('live', null, true), false, 'wide'),
            card('map', t('Carte du monde', 'World map'), cwSub('CodeWalker'), () => act('codewalker', { mode: 'world' }, true)),
            card('files', 'RPF Explorer', t('Fichiers du jeu (CodeWalker)', 'Game files (CodeWalker)'), () => act('codewalker', { mode: 'explorer' }, true)),
            card('add', t('Ajouter une application', 'Add an application'), t('Un .exe ou une fenêtre déjà ouverte', 'An .exe or a window already open'), () => act('add', null, true)),
            card('split', t('Côte à côte', 'Side by side'), st.split ? t('Oui : MLO Creator à gauche', 'On: MLO Creator on the left') : t('MLO Creator + l\'appli à droite', 'MLO Creator + the program on the right'), () => act('split', { on: 'toggle' }), st.split)));
        const apps = st.apps || [];
        if (apps.length) {
            box.append(el('div', { class: 'h' }, t('Dans MLO Studio', 'In MLO Studio')));
            box.append(el('div', { class: 'studio-list' }, apps.map(a => el('div', { class: 'studio-row' + (a.active ? ' on' : '') },
                el('span', { class: 'sdot ' + a.state }),
                el('span', { class: 'nm' }, a.name),
                el('span', { class: 'stt' }, stateText(a.state)),
                el('span', { class: 'grow' }),
                a.kind === 'mlo' ? null : el('button', { class: 'btn sm', type: 'button', onclick: () => act('show', { id: a.id }, true) }, a.state === 'closed' || a.state === 'idle' ? t('Lancer', 'Start') : t('Afficher', 'Show'))))));
        }
        box.append(el('div', { class: 'foot' },
            el('span', { class: 'note studio-tip' }, t('Clic droit sur un onglet de MLO Studio : détacher, renommer, fermer.', 'Right-click a tab of MLO Studio: pop out, rename, close.')),
            el('button', { class: 'btn primary', type: 'button', onclick: () => M.UI.closeModal() }, t('Fermer', 'Close'))));
    }

    async function act(path, params, thenClose) {
        const st = await call(path, params);
        if (!st) { const box = document.querySelector('.studio-dlg'); if (box) render(box, null); return; }
        if (thenClose) {
            M.UI.closeModal();
            if (path === 'codewalker') M.UI.toast(t('CodeWalker s\'ouvre dans MLO Studio…', 'CodeWalker is opening in MLO Studio…'), 'ok');
            if (path === 'live') M.UI.toast(t('Modification live : clique un bâtiment dans CodeWalker, puis « Éditer ce bâtiment ».', 'Live edit: click a building in CodeWalker, then "Edit this building".'), 'ok');
            return;
        }
        const box = document.querySelector('.studio-dlg');
        if (box) { lastJson = JSON.stringify(st); render(box, st); }
    }

    // while the dialog is open, follow the programs' states (CodeWalker takes a while to show its window)
    function poll() {
        clearTimeout(pollTimer);
        pollTimer = setTimeout(async () => {
            const box = document.querySelector('.studio-dlg');
            if (!box || !box.isConnected) return;
            const st = await raw('status');
            if (!st) { poll(); return; }
            const j = JSON.stringify(st);
            if (j !== lastJson && box.isConnected) { lastJson = j; render(box, st); }
            poll();
        }, 1500);
    }

    async function openDialog() {
        if (!M.UI) return;
        const box = el('div', { class: 'dlg wide studio-dlg', 'data-noi18n': '' }, el('h2', null, 'Applications'), el('div', { class: 'note' }, t('Connexion à MLO Studio…', 'Connecting to MLO Studio…')));
        M.UI.modal(box);
        const st = await call('status');
        if (!box.isConnected) return;
        lastJson = st ? JSON.stringify(st) : '';
        render(box, st);
        if (st) poll();
    }

    function label() {
        const b = $('b-apps');
        if (!b) return;
        b.querySelector('.lbl').textContent = 'Applications';
        b.title = t('CodeWalker et tes autres logiciels, affichés dans MLO Studio', 'CodeWalker and your other programs, shown inside MLO Studio');
    }

    function init() {
        const actions = document.querySelector('#top .actions');
        if (!actions || $('b-apps')) return;
        const b = el('button', { class: 'btn', id: 'b-apps', type: 'button', 'data-noi18n': '', html: '<svg viewBox="0 0 24 24" aria-hidden="true">' + ICONS.apps + '</svg>' }, el('span', { class: 'lbl' }));
        b.addEventListener('click', openDialog);
        actions.insertBefore(b, $('b-share') || null);
        label();
        const sel = $('language-select');
        if (sel) sel.addEventListener('change', () => setTimeout(label, 60));
    }

    M.Studio = { open: openDialog, call, get, fileUrl, share: openShare, live: openLive };
    const boot = () => { init(); inbox(); };
    if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', boot); else boot();
})(window.MLO);
