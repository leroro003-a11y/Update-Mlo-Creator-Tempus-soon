// TEMPUS website: "Upload Mlo Site" = zip of the MLO folder with a file-by-file report,
// upload to Transfer.it, then a PENDING submission: it only becomes public once a TEMPUS admin accepts it on the site.
window.MLO = window.MLO || {};
(function (M) {
    'use strict';
    const SITE = 'https://tempus-mlo-creator.fivewoodroleplay002.workers.dev';
    const CLIENT_ID = '1440063597672792164';
    const TRANSFERIT = 'https://cdn.jsdelivr.net/npm/@noxius/transferit@0.1.3/+esm';
    const MAX_ZIP_MB = 200, MAX_EXTRA_IMGS = 3, IMG_MAX_PX = 1920, KEY = 'mlo.discord';
    const TOKEN = (document.querySelector('meta[name="mlo-token"]') || {}).content || '';
    const el = M.el;
    const fr = () => !!(M.I18n && M.I18n.lang === 'fr');
    const T = (f, e) => fr() ? f : (M.tx ? M.tx(e) : e);   // other languages: i18n-extra.js
    const toast = (m, k) => (M.UI && M.UI.toast ? M.UI.toast(m, k) : console.log(m));
    const SU = M.SiteUpload = {};

    // ================= TEMPUS site link (upload does not require Discord) =================
    function openSite() {
        const url = SITE + '/#explorer';
        const w = window.open(url, '_blank');
        if (!w) window.prompt(T('La fenêtre a été bloquée. Copie ce lien dans Edge ou Chrome :', 'The window was blocked. Copy this link into Edge or Chrome:'), url);
    }

    // ================= ZIP writer (deflate via CompressionStream, store when it does not help) =================
    const CRC = (() => { const t = new Uint32Array(256); for (let n = 0; n < 256; n++) { let c = n; for (let k = 0; k < 8; k++) c = c & 1 ? 0xEDB88320 ^ (c >>> 1) : c >>> 1; t[n] = c >>> 0; } return t; })();
    function crc32(u8) { let c = 0xFFFFFFFF; for (let i = 0; i < u8.length; i++) c = CRC[(c ^ u8[i]) & 255] ^ (c >>> 8); return (c ^ 0xFFFFFFFF) >>> 0; }
    async function deflateRaw(u8) {
        if (typeof CompressionStream === 'undefined' || !u8.length) return null;
        try { const s = new Blob([u8]).stream().pipeThrough(new CompressionStream('deflate-raw')); return new Uint8Array(await new Response(s).arrayBuffer()); } catch (e) { return null; }
    }
    const NOPACK = /\.(zip|7z|rar|gz|png|jpe?g|webp|mp4|mp3|ogg)$/i;
    function dosTime(d) {
        return { time: ((d.getHours() << 11) | (d.getMinutes() << 5) | (d.getSeconds() >> 1)) & 0xFFFF, date: ((Math.max(0, d.getFullYear() - 1980) << 9) | ((d.getMonth() + 1) << 5) | d.getDate()) & 0xFFFF };
    }
    function ZipWriter() {
        const parts = [], central = []; let offset = 0, count = 0; const enc = new TextEncoder();
        async function add(path, data, date) {
            const name = enc.encode(path), u8 = data instanceof Uint8Array ? data : new Uint8Array(data);
            const crc = crc32(u8); let method = 0, body = u8;
            if (!NOPACK.test(path) && u8.length > 64) { const z = await deflateRaw(u8); if (z && z.length < u8.length * 0.97) { method = 8; body = z; } }
            const { time, date: dd } = dosTime(date || new Date());
            const h = new DataView(new ArrayBuffer(30));
            h.setUint32(0, 0x04034b50, true); h.setUint16(4, 20, true); h.setUint16(6, 0x0800, true); h.setUint16(8, method, true);
            h.setUint16(10, time, true); h.setUint16(12, dd, true); h.setUint32(14, crc, true); h.setUint32(18, body.length, true); h.setUint32(22, u8.length, true);
            h.setUint16(26, name.length, true); h.setUint16(28, 0, true);
            parts.push(h.buffer, name, body);
            const c = new DataView(new ArrayBuffer(46));
            c.setUint32(0, 0x02014b50, true); c.setUint16(4, 20, true); c.setUint16(6, 20, true); c.setUint16(8, 0x0800, true); c.setUint16(10, method, true);
            c.setUint16(12, time, true); c.setUint16(14, dd, true); c.setUint32(16, crc, true); c.setUint32(20, body.length, true); c.setUint32(24, u8.length, true);
            c.setUint16(28, name.length, true); c.setUint32(42, offset, true);
            central.push(c.buffer, name);
            offset += 30 + name.length + body.length; count++;
            if (offset > 0xFFFFFFF0 || count > 65000) throw new Error(T('ZIP trop gros (4 Go / 65 000 fichiers max).', 'ZIP too large (4 GB / 65,000 files max).'));
            return { stored: body.length, method };
        }
        function finish() {
            const size = central.reduce((t, p) => t + p.byteLength, 0), e = new DataView(new ArrayBuffer(22));
            e.setUint32(0, 0x06054b50, true); e.setUint16(8, count, true); e.setUint16(10, count, true); e.setUint32(12, size, true); e.setUint32(16, offset, true);
            return new Blob([...parts, ...central, e.buffer], { type: 'application/zip' });
        }
        return { add, finish, get size() { return offset; } };
    }
    SU._zip = ZipWriter; SU._crc32 = crc32;

    // ================= file-name analysis =================
    const CAT = {
        ydr: ['Modèles (.ydr)', 'Models (.ydr)'], ydd: ['Modèles groupés (.ydd)', 'Drawable dictionaries (.ydd)'], yft: ['Fragments (.yft)', 'Fragments (.yft)'],
        ytd: ['Textures (.ytd)', 'Textures (.ytd)'], ybn: ['Collisions (.ybn)', 'Collisions (.ybn)'], ymap: ['Placements (.ymap)', 'Placements (.ymap)'],
        ytyp: ['Archetypes MLO (.ytyp)', 'MLO archetypes (.ytyp)'], ymf: ['Manifestes (.ymf)', 'Manifests (.ymf)'], ynv: ['Navigation (.ynv)', 'Navmesh (.ynv)'],
        ycd: ['Animations (.ycd)', 'Animations (.ycd)'], manifest: ['Manifeste FiveM', 'FiveM manifest'], script: ['Scripts', 'Scripts'], meta: ['Données (.meta, .xml, .json)', 'Data (.meta, .xml, .json)'],
        tex: ['Images / textures sources', 'Images / source textures'], src3d: ['Modèles sources (.glb, .obj, .fbx)', 'Source models (.glb, .obj, .fbx)'],
        project: ['Projet MLO Creator', 'MLO Creator project'], report: ['Compte rendu', 'Report'], doc: ['Documents', 'Documents'], archive: ['Archives', 'Archives'], other: ['Autres', 'Other']
    };
    const EXT = { ydr: 'ydr', ydd: 'ydd', yft: 'yft', ytd: 'ytd', ybn: 'ybn', ymap: 'ymap', ytyp: 'ytyp', ymf: 'ymf', ynv: 'ynv', ycd: 'ycd', lua: 'script', js: 'script',
        meta: 'meta', xml: 'meta', dat: 'meta', json: 'meta', cfg: 'meta', dds: 'tex', png: 'tex', jpg: 'tex', jpeg: 'tex', tga: 'tex', webp: 'tex', bmp: 'tex',
        glb: 'src3d', gltf: 'src3d', obj: 'src3d', fbx: 'src3d', blend: 'src3d', mtl: 'src3d', txt: 'doc', md: 'doc', pdf: 'doc', zip: 'archive', rar: 'archive', '7z': 'archive' };
    const GAME = new Set(['ydr', 'ydd', 'yft', 'ytd', 'ybn', 'ymap', 'ytyp', 'ymf', 'ynv', 'ycd']);
    const HEAVY = new Set(['ydr', 'ydd', 'yft', 'ytd']);
    const BLOCKED = /\.(exe|dll|bat|cmd|com|scr|ps1|psm1|vbs|vbe|jse|wsf|wsh|msi|msp|jar|lnk|reg|hta|cpl|sys|sh|apk|appx|iso|img|url)$/i;
    const JUNK = [/(^|\/)(thumbs\.db|desktop\.ini|\.ds_store)$/i, /(^|\/)__macosx\//i, /(^|\/)~\$/, /\.(tmp|bak|log|crdownload|part)$/i, /(^|\/)\.git\//i];
    const extOf = (p) => { const n = p.split('/').pop(); const m = /\.([^.]+)$/.exec(n); return m ? m[1].toLowerCase() : ''; };
    const fmt = (b) => { b = +b || 0; const s = b >= 1048576 ? (b / 1048576).toFixed(1) + (fr() ? ' Mo' : ' MB') : b >= 1024 ? Math.round(b / 1024) + (fr() ? ' Ko' : ' KB') : b + (fr() ? ' o' : ' B'); return fr() ? s.replace('.', ',') : s; };
    SU._fmt = fmt;

    // files: [{ path, size }] -> per-file classification (+ notes) and the global checks; text = fxmanifest content when known
    function analyse(files, manifestText) {
        const L = (k) => T(CAT[k][0], CAT[k][1]);
        const hasManifest = files.some(f => /(^|\/)(fxmanifest|__resource)\.lua$/i.test(f.path));
        const seen = new Map();
        const out = files.map(f => {
            const name = f.path.split('/').pop(), ext = extOf(f.path), notes = [];
            let cat = EXT[ext] || 'other', status = 'ok';
            if (/(^|\/)(fxmanifest|__resource)\.lua$/i.test(f.path)) cat = 'manifest';
            if (/\.mlo\.json$|\.ref\.json$|\.thumb\.jpg$/i.test(name)) cat = 'project';
            if (BLOCKED.test(name)) { status = 'excluded'; notes.push(T('Fichier exécutable : exclu du ZIP par sécurité', 'Executable file: left out of the ZIP for safety')); }
            else if (JUNK.some(r => r.test(f.path))) { status = 'excluded'; notes.push(T('Fichier inutile : ignoré', 'Useless file: skipped')); }
            else {
                if (!f.size) notes.push(T('Fichier vide (0 octet)', 'Empty file (0 bytes)'));
                if (/[^\x20-\x7e]/.test(name)) notes.push(T('Accents ou caractères spéciaux dans le nom', 'Accents or special characters in the name'));
                if (GAME.has(cat)) {
                    if (/\s/.test(name)) notes.push(T('Espace dans le nom : à éviter pour FiveM', 'Space in the name: avoid it for FiveM'));
                    if (name.replace(/\.[^.]+$/, '').length > 63) notes.push(T('Nom très long (plus de 63 caractères)', 'Very long name (over 63 characters)'));
                    if (HEAVY.has(cat) && f.size >= 16 * 1048576) notes.push(T('Fichier lourd (16 Mo ou plus) : risque d\'« oversized asset » dans FiveM', 'Heavy file (16 MB or more): FiveM may flag it as an oversized asset'));
                    if (hasManifest && !/(^|\/)stream\//i.test(f.path)) notes.push(T('Hors du dossier stream : FiveM ne le chargera pas', 'Outside the stream folder: FiveM will not load it'));
                    const key = name.toLowerCase();
                    if (seen.has(key)) notes.push(T('Nom en double (aussi : ', 'Duplicate name (also: ') + seen.get(key) + T(') : FiveM n\'en chargera qu\'un', '): FiveM will only load one'));
                    else seen.set(key, f.path);
                }
                if (ext === 'js') notes.push(T('Script JavaScript : à vérifier', 'JavaScript file: check it'));
                if (cat === 'archive') notes.push(T('Archive dans l\'archive : contenu non analysé', 'Archive inside the archive: content not analysed'));
                if (notes.length) status = 'warn';
            }
            return { path: f.path, size: f.size, ext, cat, status, notes };
        });
        const inc = out.filter(f => f.status !== 'excluded'), count = (c) => inc.filter(f => f.cat === c).length;
        const checks = [];
        const add = (level, text) => checks.push({ level, text });
        if (hasManifest) {
            add('ok', T('Ressource FiveM détectée (fxmanifest.lua)', 'FiveM resource detected (fxmanifest.lua)'));
            if (manifestText != null && !/this_is_a_map\s*['"(]?\s*['"]yes['"]/i.test(manifestText)) add('warn', T('fxmanifest.lua sans « this_is_a_map \'yes\' » : le MLO risque de ne pas se charger', 'fxmanifest.lua has no "this_is_a_map \'yes\'": the MLO may not load'));
        } else add('warn', T('Aucun fxmanifest.lua : ce dossier n\'est pas une ressource FiveM prête à l\'emploi', 'No fxmanifest.lua: this folder is not a ready-to-use FiveM resource'));
        const n = (c, ok, none) => { const k = count(c); if (k) add('ok', k + ' ' + ok); else if (none) add('warn', none); };
        n('ytyp', T('fichier(s) .ytyp (archetypes du MLO)', '.ytyp file(s) (MLO archetypes)'), T('Aucun .ytyp : un MLO a normalement besoin de son fichier .ytyp', 'No .ytyp: an MLO normally needs its .ytyp file'));
        n('ymap', T('fichier(s) .ymap (placement)', '.ymap file(s) (placement)'), T('Aucun .ymap : rien ne place le MLO dans la carte', 'No .ymap: nothing places the MLO on the map'));
        n('ydr', T('modèle(s) .ydr', '.ydr model(s)'), null);
        n('ytd', T('dictionnaire(s) de textures .ytd', '.ytd texture dictionaries'), null);
        n('ybn', T('fichier(s) de collision .ybn', '.ybn collision file(s)'), T('Aucune collision (.ybn) : on risque de traverser les murs', 'No collision (.ybn): players may walk through walls'));
        const ex = out.filter(f => f.status === 'excluded').length;
        if (ex) add('warn', ex + T(' fichier(s) exclus (exécutables ou inutiles)', ' file(s) left out (executables or useless)'));
        const dup = out.filter(f => f.notes.some(x => /double|Duplicate/.test(x))).length;
        if (dup) add('warn', dup + T(' nom(s) de fichier en double', ' duplicate file name(s)'));
        const warn = out.filter(f => f.status === 'warn').length;
        if (!warn && !ex) add('ok', T('Aucun nom de fichier problématique', 'No problematic file name'));
        const byCategory = {};
        inc.forEach(f => { const b = byCategory[f.cat] || (byCategory[f.cat] = { label: L(f.cat), count: 0, bytes: 0 }); b.count++; b.bytes += f.size; });
        return { files: out, checks, byCategory };
    }
    SU._analyse = analyse;

    function reportText(r) {
        const pad = (s, n) => (s + ' '.repeat(n)).slice(0, Math.max(n, s.length));
        const lines = [T('COMPTE RENDU DU DOSSIER ZIPPÉ : MLO Creator', 'REPORT OF THE ZIPPED FOLDER: MLO Creator'), '='.repeat(52),
            T('Projet      : ', 'Project     : ') + (r.project || '-'), T('Dossier     : ', 'Folder      : ') + (r.root || '-'), T('Date        : ', 'Date        : ') + new Date(r.createdAt).toLocaleString(fr() ? 'fr-FR' : 'en-US'),
            T('Fichiers    : ', 'Files       : ') + r.totals.files + T(' analysés, ', ' analysed, ') + r.totals.included + T(' inclus, ', ' included, ') + r.totals.excluded + T(' exclus', ' left out'),
            T('Taille      : ', 'Size        : ') + fmt(r.totals.bytes) + (r.totals.zipBytes ? ' -> ZIP ' + fmt(r.totals.zipBytes) : ''), '',
            T('PAR TYPE', 'BY TYPE'), '-'.repeat(52)];
        Object.values(r.byCategory).sort((a, b) => b.count - a.count).forEach(c => lines.push('  ' + pad(c.label, 40) + pad(String(c.count), 6) + fmt(c.bytes)));
        lines.push('', T('VÉRIFICATIONS', 'CHECKS'), '-'.repeat(52));
        r.checks.forEach(c => lines.push('  ' + (c.level === 'ok' ? '[OK]  ' : c.level === 'err' ? '[ERR] ' : '[!]   ') + c.text));
        lines.push('', T('DÉTAIL DES FICHIERS', 'FILE DETAILS'), '-'.repeat(52));
        r.files.forEach(f => {
            lines.push('  ' + pad(f.status === 'excluded' ? T('[EXCLU]', '[SKIP] ') : f.status === 'warn' ? '[!]    ' : '[OK]   ', 8) + pad(f.path, 60) + ' ' + fmt(f.size));
            f.notes.forEach(n => lines.push('           ' + n));
        });
        return lines.join('\r\n') + '\r\n';
    }
    SU._reportText = reportText;

    // ================= images =================
    function canvasBlob(c, q) { return new Promise(res => c.toBlob(b => res(b), 'image/jpeg', q)); }
    async function capture3D() {
        const cv = M.App && M.App.canvas; if (!cv || !cv.width || !cv.height) return null;
        try { if (M.App.render) M.App.render(); } catch (e) { }
        const W = 1600, H = 1000, c = document.createElement('canvas'); c.width = W; c.height = H;
        const sr = cv.width / cv.height, tr = W / H; let sx = 0, sy = 0, sw = cv.width, sh = cv.height;
        if (sr > tr) { sw = cv.height * tr; sx = (cv.width - sw) / 2; } else { sh = cv.width / tr; sy = (cv.height - sh) / 2; }
        const g = c.getContext('2d'); g.drawImage(cv, sx, sy, sw, sh, 0, 0, W, H);
        const d = g.getImageData(0, 0, W, H).data; let lit = 0; for (let i = 0; i < d.length; i += 4 * 997) if (d[i] + d[i + 1] + d[i + 2] > 24) lit++;
        if (lit < 5) return null;                                   // blank frame (the 3D view was not drawn)
        return canvasBlob(c, 0.86);
    }
    async function shrink(file) {
        const bmp = await createImageBitmap(file); const k = Math.min(1, IMG_MAX_PX / Math.max(bmp.width, bmp.height));
        const c = document.createElement('canvas'); c.width = Math.round(bmp.width * k); c.height = Math.round(bmp.height * k);
        c.getContext('2d').drawImage(bmp, 0, 0, c.width, c.height);
        let q = 0.86, b = await canvasBlob(c, q); while (b && b.size > 2.8 * 1048576 && q > 0.4) { q -= 0.12; b = await canvasBlob(c, q); }
        return b;
    }
    async function thumbBlob(src) {
        if (!src) return null;
        try { const r = await fetch(src, { headers: /^data:/.test(src) ? {} : { 'X-Mlo-Token': TOKEN } }); if (!r.ok) return null; const b = await r.blob(); return b.size ? b : null; } catch (e) { return null; }
    }

    // ================= the dialog =================
    SU.dialog = function (opts) {
        opts = opts || {};
        const UI = M.UI, Model = M.Model, S = Model.state;
        const back = () => { if (busy) return; if (opts.back) opts.back(); else UI.closeModal(); };
        let busy = false, projects = [], extra = [], lastSent = null;

        // --- creator pseudo (no Discord sign-in required)
        const pseudo = el('input', { class: 'su-in', maxlength: '40', required: true, autocomplete: 'nickname', placeholder: T('Ton pseudo', 'Your username') });

        // --- form
        const proj = el('select', { class: 'su-in', 'aria-label': T('Projet', 'Project') });
        const title = el('input', { class: 'su-in', maxlength: '80', placeholder: T('Nom affiché sur le site', 'Name shown on the website') });
        const cat = el('select', { class: 'su-in' }, el('option', { value: 'interior' }, T('Intérieur', 'Interior')), el('option', { value: 'exterior' }, T('Extérieur', 'Exterior')), el('option', { value: 'business' }, 'Business'));
        const desc = el('textarea', { class: 'su-in', rows: '3', maxlength: '500', placeholder: T('Description (facultatif)', 'Description (optional)') });
        const shot = el('input', { type: 'checkbox', checked: true });
        const withProj = el('input', { type: 'checkbox', checked: true });
        const thumbs = el('div', { class: 'su-thumbs' });
        const imgIn = el('input', { type: 'file', accept: 'image/jpeg,image/png,image/webp', multiple: true, hidden: true });
        const dirIn = el('input', { type: 'file', multiple: true, hidden: true }); dirIn.webkitdirectory = true; dirIn.setAttribute('webkitdirectory', ''); dirIn.setAttribute('directory', '');
        const hint = el('div', { class: 'su-hint' });
        const bar = el('i'), status = el('div', { class: 'su-status', role: 'status' }), live = el('div', { class: 'su-live' }), result = el('div', { class: 'su-result' });
        const prog = el('div', { class: 'su-prog', hidden: true }, el('div', { class: 'su-bar' }, bar), status, live);
        const sendBtn = el('button', { class: 'btn primary su-send', onclick: () => start() }, 'Upload Mlo Site');
        const siteBtn = el('button', { class: 'btn', onclick: openSite }, T('Ouvrir le site TEMPUS', 'Open TEMPUS website'));
        const backBtn = el('button', { class: 'btn', onclick: back }, T('Retour', 'Back'));

        // --- the folders of MLO Creator's output directory (read by MLO Studio): no file explorer needed
        const outBox = el('div', { class: 'su-out', hidden: true });
        const sent = new Set();
        let outList = null;
        const hasStudio = () => !!(M.Studio && M.Studio.get && M.Studio.fileUrl);
        const baseLabel = () => outList ? T('Autre dossier…', 'Other folder…') : 'Upload Mlo Site';
        const agoTxt = (ms) => {
            if (!ms) return ''; const s = (Date.now() - ms) / 1000;
            if (s < 3600) return T('il y a ', '') + Math.max(1, Math.round(s / 60)) + ' min' + T('', ' ago');
            if (s < 86400) return T('il y a ', '') + Math.round(s / 3600) + ' h' + T('', ' ago');
            return new Date(ms).toLocaleDateString(fr() ? 'fr-FR' : 'en-US');
        };
        async function loadOut() {
            if (!hasStudio()) return;
            outBox.hidden = false;
            outBox.replaceChildren(el('div', { class: 'su-out-h' }, el('b', null, T('Dossiers du répertoire output', 'Folders of the output directory')), el('span', { class: 'su-out-dir' }, T('Lecture…', 'Reading…'))));
            const r = await M.Studio.get('outdir/list', null, 20000);
            if (!r || !r.ok) {
                outList = null; sendBtn.textContent = lastSent && lastSent.retry ? sendBtn.textContent : baseLabel();
                outBox.replaceChildren(el('div', { class: 'su-out-h' }, el('b', null, T('Dossiers du répertoire output', 'Folders of the output directory')),
                    el('button', { class: 'btn sm', type: 'button', onclick: loadOut }, T('Réessayer', 'Try again'))),
                    el('div', { class: 'su-out-empty' }, T('Lance MloStudio.exe pour voir ici les dossiers de output. Sinon, choisis le dossier avec le bouton en bas.', 'Start MloStudio.exe to see the output folders here. Otherwise pick the folder with the button below.')));
                return;
            }
            outList = r; if (!(lastSent && lastSent.retry)) sendBtn.textContent = baseLabel();
            drawOut();
        }
        function drawOut() {
            const r = outList; if (!r) return;
            const lastDir = (() => { try { return (localStorage.getItem('mlo.lastExport.' + proj.value) || '').replace(/[\\/]+$/, ''); } catch (e) { return ''; } })().toLowerCase();
            const folders = (r.folders || []).slice().sort((a, b) => (b.modified || 0) - (a.modified || 0));
            outBox.replaceChildren(el('div', { class: 'su-out-h' },
                el('b', null, T('Dossiers du répertoire output', 'Folders of the output directory')),
                el('span', { class: 'su-out-dir', title: r.dir }, r.dir),
                el('button', { class: 'btn sm', type: 'button', disabled: busy, onclick: loadOut }, T('Actualiser', 'Refresh'))));
            if (!r.exists || !folders.length) {
                outBox.append(el('div', { class: 'su-out-empty' }, !r.exists ? T('Ce dossier n\'existe pas encore : exporte un projet (bouton Export).', 'This folder does not exist yet: export a project (Export button).')
                    : T('Aucun dossier dedans : exporte un projet (bouton Export).', 'No folder in it yet: export a project (Export button).')));
                return;
            }
            const list = el('div', { class: 'su-out-list' });
            folders.forEach(f => {
                const an = analyse((f.files || []).map(x => ({ path: f.name + '/' + x.path, size: x.size })), null);
                const inc = an.files.filter(x => x.status !== 'excluded'), n = (ext) => inc.filter(x => x.ext === ext).length;
                const manifest = inc.some(x => x.cat === 'manifest'), warns = an.files.filter(x => x.status === 'warn').length, ex = an.files.length - inc.length;
                const ready = manifest && n('ytyp') > 0 && n('ymap') > 0;
                const isLast = !!lastDir && (lastDir.endsWith('\\' + f.name.toLowerCase()) || lastDir.endsWith('/' + f.name.toLowerCase()));
                const chip = (txt, cls) => el('span', { class: 'su-chip ' + (cls || '') }, txt);
                const kinds = ['ytyp', 'ymap', 'ydr', 'ytd', 'ybn'].filter(e => n(e)).map(e => chip(n(e) + ' .' + e));
                const row = el('div', { class: 'su-out-row' + (ready ? ' ready' : '') + (sent.has(f.name) ? ' sent' : '') },
                    el('div', { class: 'su-out-main' },
                        el('div', { class: 'su-out-name' }, f.name,
                            isLast ? el('span', { class: 'su-out-tag' }, T('dernier export', 'last export')) : null,
                            sent.has(f.name) ? el('span', { class: 'su-out-tag ok' }, T('envoyé · en attente', 'sent · pending')) : null),
                        el('div', { class: 'su-out-meta' }, inc.length + T(' fichiers · ', ' files · ') + fmt(f.bytes) + (f.modified ? ' · ' + agoTxt(f.modified) : '') + (f.truncated ? T(' · liste coupée', ' · list cut short') : '')),
                        el('div', { class: 'su-chips' },
                            chip(manifest ? 'fxmanifest ✓' : T('pas de fxmanifest', 'no fxmanifest'), manifest ? '' : 'err'),
                            kinds, warns ? chip(warns + T(' alerte(s)', ' warning(s)'), 'warn') : null, ex ? chip(ex + T(' exclu(s)', ' left out'), 'err') : null),
                        el('details', { class: 'su-out-det' }, el('summary', null, T('Analyse', 'Analysis')),
                            el('ul', { class: 'su-checks' }, an.checks.map(c => el('li', { class: c.level }, c.text))))),
                    el('button', { class: 'btn ' + (ready ? 'primary' : '') + ' su-out-send', type: 'button', disabled: busy || !inc.length || !!f.truncated, onclick: () => sendFolder(f) },
                        sent.has(f.name) ? T('Renvoyer', 'Send again') : T('Envoyer sur le site', 'Send to the website')));
                list.append(row);
            });
            outBox.append(list);
        }
        function remoteFile(rel, x) {
            const get = async () => {
                const u = M.Studio.fileUrl(rel); if (!u) throw new Error(T('MLO Studio n\'est plus lancé.', 'MLO Studio is not running any more.'));
                const r = await fetch(u, { cache: 'no-store' });
                if (!r.ok) throw new Error(T('Lecture impossible : ', 'Could not read: ') + rel + ' (HTTP ' + r.status + ')');
                return r;
            };
            return { name: rel.split('/').pop(), size: x.size, lastModified: x.mtime || Date.now(), webkitRelativePath: rel,
                arrayBuffer: async () => (await get()).arrayBuffer(), text: async () => (await get()).text() };
        }
        function sendFolder(f) {
            if (busy) return;
            if (f && f.truncated) return toast(T('La liste de fichiers est incomplète : actualise ou choisis le dossier manuellement.', 'This file list is incomplete: refresh it or choose the folder manually.'), 'warn');
            if (!pseudo.value.trim()) { pseudo.focus(); return toast(T('Indique ton pseudo.', 'Enter your username.'), 'warn'); }
            if (!title.dataset.touched || !title.value.trim()) title.value = f.name;
            const picked = (f.files || []).map(x => remoteFile(f.name + '/' + x.path, x));
            if (!picked.length) return toast(T('Ce dossier est vide.', 'This folder is empty.'), 'warn');
            lastSent = null;
            run(picked).catch(e => { say(T('Erreur : ', 'Error: ') + e.message, 'err'); lock(false); drawOut(); });
        }

        function drawThumbs() {
            thumbs.innerHTML = '';
            (thumbs._objectUrls || []).forEach(u => URL.revokeObjectURL(u)); thumbs._objectUrls = [];
            extra.forEach((f, i) => { const u = URL.createObjectURL(f); thumbs._objectUrls.push(u); const t = el('div', { class: 'su-thumb', style: { backgroundImage: 'url("' + u + '")' } }, el('button', { class: 'su-x', title: T('Retirer', 'Remove'), onclick: () => { extra.splice(i, 1); drawThumbs(); } }, '×')); thumbs.append(t); });
            if (extra.length < MAX_EXTRA_IMGS) thumbs.append(el('button', { class: 'btn sm', onclick: () => imgIn.click() }, T('+ Ajouter des images', '+ Add images')));
        }
        imgIn.addEventListener('change', () => { [...imgIn.files].forEach(f => { if (extra.length < MAX_EXTRA_IMGS) extra.push(f); }); imgIn.value = ''; drawThumbs(); });
        function drawHint() {
            const n = proj.value, dir = (() => { try { return localStorage.getItem('mlo.lastExport.' + n) || ''; } catch (e) { return ''; } })();
            hint.innerHTML = '';
            hint.append(el('b', null, T('Au clic sur « Upload Mlo Site », choisis le dossier du MLO', 'When you click "Upload Mlo Site", pick the MLO folder')),
                el('span', null, dir ? T('Dernier export de ce projet : ', 'Last export of this project: ') + dir : T('Conseil : exporte d\'abord le projet (bouton Export) puis choisis le dossier de la ressource exportée.', 'Tip: export the project first (Export button), then pick the exported resource folder.')));
            const open = n && n === S.project.name; shot.disabled = !open; shot.parentNode && shot.parentNode.classList.toggle('off', !open);
            if (!title.dataset.touched) title.value = n || '';
        }
        title.addEventListener('input', () => { title.dataset.touched = '1'; });
        proj.addEventListener('change', () => { drawHint(); drawOut(); });
        Model.listProjects().then(items => {
            projects = items || [];
            projects.forEach(p => proj.append(el('option', { value: p.name }, p.name + (p.name === S.project.name ? T(' · ouvert', ' · open') : ''))));
            if (!projects.length) proj.append(el('option', { value: S.project.name || '' }, S.project.name || T('Projet ouvert', 'Open project')));
            proj.value = projects.some(p => p.name === S.project.name) ? S.project.name : (projects[0] ? projects[0].name : S.project.name || '');
            drawHint();
        }).catch(() => { proj.append(el('option', { value: S.project.name || '' }, S.project.name || '')); drawHint(); });

        const field = (label, input) => el('label', { class: 'su-field' }, el('span', null, label), input);
        UI.modal(el('div', { class: 'start sp share-dialog su', 'data-noi18n': '' },
            el('div', { class: 'np-head' }, el('h2', null, opts.title || 'Upload Mlo Site'), el('span', { class: 'su-off' }, T('Pas besoin de connexion Discord', 'No Discord sign-in needed'))),
            el('div', { class: 'su-body' },
                el('div', { class: 'su-grid' },
                    field(T('Projet', 'Project'), proj), field(T('Catégorie', 'Category'), cat),
                    el('div', { class: 'su-wide' }, field(T('Pseudo du créateur', 'Creator username'), pseudo)),
                    el('div', { class: 'su-wide' }, field(T('Nom sur le site', 'Name on the website'), title)),
                    el('div', { class: 'su-wide' }, field('Description', desc))),
                el('div', { class: 'su-opts' },
                    el('label', { class: 'su-check' }, shot, el('span', null, T('Ajouter une capture de la vue 3D (couverture)', 'Add a capture of the 3D view (cover)'))),
                    el('label', { class: 'su-check' }, withProj, el('span', null, T('Inclure le fichier projet MLO Creator (.mlo.json)', 'Include the MLO Creator project file (.mlo.json)')))),
                thumbs, outBox, hint, prog, result, imgIn, dirIn),
            el('div', { class: 'np-foot' }, siteBtn, sendBtn, backBtn)), { sticky: true });
        drawThumbs();
        loadOut();

        const say = (t, k) => { status.textContent = t; status.className = 'su-status' + (k ? ' ' + k : ''); };
        const setBar = (p) => { bar.style.width = Math.max(0, Math.min(100, p)) + '%'; };
        const logLine = (cls, text) => { const d = el('div', { class: 'l ' + cls }, text); live.append(d); while (live.childNodes.length > 400) live.firstChild.remove(); live.scrollTop = live.scrollHeight; };
        function lock(on) { busy = on; [sendBtn, backBtn, proj, cat, pseudo, title, desc, shot, withProj].forEach(x => { x.disabled = on; }); outBox.querySelectorAll('button').forEach(b => { b.disabled = on; }); }

        // --- upload: pseudo required, then open the folder picker directly from the click
        function start() {
            if (busy) return;
            if (lastSent && lastSent.retry) return retryPost();
            if (!pseudo.value.trim()) { pseudo.focus(); return toast(T('Indique ton pseudo.', 'Enter your username.'), 'warn'); }
            if (!title.value.trim()) { title.focus(); return toast(T('Donne un nom à ton MLO.', 'Give your MLO a name.'), 'warn'); }
            dirIn.value = ''; dirIn.click();
        }
        dirIn.addEventListener('change', () => { const files = [...dirIn.files]; if (files.length) run(files).catch(e => { say(T('Erreur : ', 'Error: ') + e.message, 'err'); lock(false); }); });

        async function run(picked) {
            lock(true); prog.hidden = false; result.innerHTML = ''; live.innerHTML = ''; setBar(0); lastSent = null;
            const name = proj.value, safe = Model.safeName ? Model.safeName(name) : name, cur = name === S.project.name;
            const root = (picked[0].webkitRelativePath || picked[0].name).split('/')[0] || safe || 'MLO';
            // 1. save the open project
            if (cur) { say(T('Enregistrement du projet…', 'Saving the project…')); try { await Model.save(); if (S.project.kind === 'import' && S.ref && Model.saveRef) await Model.saveRef(); } catch (e) { logLine('warn', T('Projet non enregistré : ', 'Project not saved: ') + e.message); } }
            // 2. names first: the analysis of every file name
            say(T('Analyse des noms de fichiers…', 'Analysing the file names…'));
            const list = picked.map(f => ({ file: f, path: (f.webkitRelativePath || f.name).replace(/\\/g, '/'), size: f.size }));
            const extras = [];
            if (withProj.checked && name) {
                try { const pj = await Model.api('project?name=' + encodeURIComponent(name)); if (pj) extras.push({ path: root + '/_mlo-creator/' + safe + '.mlo.json', data: new TextEncoder().encode(JSON.stringify(pj, null, 1)) }); } catch (e) { logLine('warn', T('Fichier projet introuvable : ', 'Project file not found: ') + e.message); }
                try { const rf = await Model.api('ref?name=' + encodeURIComponent(name)); if (rf) extras.push({ path: root + '/_mlo-creator/' + safe + '.ref.json', data: new TextEncoder().encode(JSON.stringify(rf)) }); } catch (e) { }
            }
            extras.forEach(x => list.push({ data: x.data, path: x.path, size: x.data.length }));
            list.sort((a, b) => a.path.localeCompare(b.path));
            const mf = list.find(f => /(^|\/)(fxmanifest|__resource)\.lua$/i.test(f.path) && f.file);
            let manifestText = null; if (mf) { try { manifestText = await mf.file.text(); } catch (e) { } }
            const an = analyse(list.map(f => ({ path: f.path, size: f.size })), manifestText);
            const inc = an.files.filter(f => f.status !== 'excluded'), bytes = inc.reduce((t, f) => t + f.size, 0);
            if (!inc.length) throw new Error(T('Le dossier ne contient aucun fichier à envoyer.', 'The folder has no file to send.'));
            if (bytes > MAX_ZIP_MB * 1048576) throw new Error(T('Dossier trop lourd (', 'Folder too large (') + fmt(bytes) + ').');
            logLine('ok', an.files.length + T(' fichiers trouvés dans « ', ' files found in "') + root + T(' » · ', '" · ') + fmt(bytes));
            // 3. zip, file by file, with the live report
            const zw = ZipWriter(); let done = 0;
            for (let i = 0; i < list.length; i++) {
                const f = list[i], a = an.files[i];
                if (a.status === 'excluded') { logLine('err', T('EXCLU  ', 'SKIP   ') + f.path + ' · ' + a.notes.join(' · ')); continue; }
                say(T('Compression ', 'Zipping ') + (i + 1) + ' / ' + list.length + ' : ' + f.path.split('/').pop());
                const data = f.data || new Uint8Array(await f.file.arrayBuffer());
                const r = await zw.add(f.path, data, f.file ? new Date(f.file.lastModified) : new Date());
                a.zipSize = r.stored; done += f.size;
                logLine(a.status, (a.status === 'warn' ? '!  ' : '✓  ') + f.path + ' · ' + T(CAT[a.cat][0], CAT[a.cat][1]) + ' · ' + fmt(f.size) + (a.notes.length ? ' · ' + a.notes.join(' · ') : ''));
                setBar(5 + 40 * done / Math.max(1, bytes));
            }
            const report = {
                version: 1, app: 'MLO Creator', project: name, root, createdAt: Date.now(),
                totals: { files: an.files.length, included: inc.length + 1, excluded: an.files.length - inc.length, bytes, zipBytes: 0 },
                byCategory: an.byCategory, checks: an.checks, files: an.files
            };
            report.byCategory.report = { label: T(CAT.report[0], CAT.report[1]), count: 1, bytes: 0 };
            const txt = new TextEncoder().encode(reportText(Object.assign({}, report, { totals: Object.assign({}, report.totals, { zipBytes: zw.size }) })));
            await zw.add(root + '/RAPPORT-MLO.txt', txt, new Date());
            const zip = zw.finish(); report.totals.zipBytes = zip.size;
            if (zip.size > MAX_ZIP_MB * 1048576) throw new Error(T('ZIP trop lourd : ', 'ZIP too large: ') + fmt(zip.size) + T(' (max ', ' (max ') + MAX_ZIP_MB + (fr() ? ' Mo).' : ' MB).'));
            logLine('ok', T('ZIP prêt : ', 'ZIP ready: ') + fmt(zip.size) + T(' · compte rendu ajouté (RAPPORT-MLO.txt)', ' · report added (RAPPORT-MLO.txt)'));
            const warns = an.files.filter(f => f.status === 'warn').length;
            // 4. pictures
            say(T('Préparation des images…', 'Preparing the pictures…'));
            const imgs = [];
            if (shot.checked && !shot.disabled) { const b = await capture3D().catch(() => null); if (b) imgs.push(b); }
            if (!imgs.length) { const p = projects.find(x => x.name === name); const b = await thumbBlob(p && p.thumb); if (b) imgs.push(b); }
            for (const f of extra) { try { const b = await shrink(f); if (b) imgs.push(b); } catch (e) { logLine('warn', f.name + T(' : image illisible', ': unreadable picture')); } }
            // 5. Transfer.it
            say(T('Connexion à Transfer.it…', 'Connecting to Transfer.it…'));
            let tx = null, url = '';
            try {
                const { Transferit } = await import(TRANSFERIT);
                tx = new Transferit();
                const zfile = new File([zip], (safe || 'mlo').replace(/[^\w.-]+/g, '_') + '.zip', { type: 'application/zip' });
                const up = await tx.upload(zfile, { title: title.value.trim(), onProgress: (sent, total) => { if (total > 0) { const p = Math.round(sent / total * 100); setBar(45 + p * 0.45); say(T('Envoi vers Transfer.it… ', 'Uploading to Transfer.it… ') + p + '%'); } } });
                url = up && up.url;
            } finally { if (tx && typeof tx.close === 'function') { try { tx.close(); } catch (e) { } } }
            if (!url) throw new Error(T('Transfer.it n\'a pas renvoyé de lien.', 'Transfer.it returned no link.'));
            logLine('ok', 'Transfer.it : ' + url);
            lastSent = { url, report, imgs, txt, root, warns, name: title.value.trim(), pseudo: pseudo.value.trim().slice(0, 40) };
            await post();
        }

        function slimReport(r) {
            let s = JSON.stringify(r); if (s.length < 380000) return s;
            const c = Object.assign({}, r, { files: r.files.filter(f => f.status !== 'ok').concat(r.files.filter(f => f.status === 'ok').slice(0, 500)), truncated: true });
            s = JSON.stringify(c); if (s.length < 380000) return s;
            return JSON.stringify(Object.assign({}, r, { files: r.files.filter(f => f.status !== 'ok').slice(0, 1500), truncated: true }));
        }
        async function post() {
            const L = lastSent;
            say(T('Envoi de la fiche au site (en attente de validation)…', 'Sending the listing to the website (pending review)…')); setBar(93);
            const fd = new FormData();
            fd.append('name', L.name); fd.append('pseudo', L.pseudo); fd.append('category', cat.value); fd.append('description', desc.value.trim()); fd.append('url', L.url); fd.append('report', slimReport(L.report));
            L.imgs.slice(0, 4).forEach((b, i) => fd.append('images', b, 'image-' + (i + 1) + '.jpg'));
            let r, j = {};
            try { r = await fetch(SITE + '/api/submissions', { method: 'POST', body: fd }); try { j = await r.json(); } catch (e) { } }
            catch (e) { r = null; }
            if (!r || !r.ok) {
                if (r && r.status === 401 && typeof setSession === 'function') setSession(null);
                L.retry = true; lock(false); sendBtn.textContent = T('Réessayer l\'envoi de la fiche', 'Retry sending the listing');
                say(T('Le ZIP est sur Transfer.it mais le site a refusé la fiche : ', 'The ZIP is on Transfer.it but the website refused the listing: ') + ((j && j.error) || (r ? 'HTTP ' + r.status : T('site injoignable', 'website unreachable'))), 'err');
                showResult(false); return;
            }
            L.retry = false; setBar(100); lock(false); sendBtn.textContent = baseLabel(); sent.add(L.root); drawOut();
            say(T('Envoyé ! Ton MLO est en attente de validation par un admin TEMPUS.', 'Sent! Your MLO is waiting for a TEMPUS admin to review it.'), 'ok');
            toast(T('MLO envoyé : en attente de validation.', 'MLO sent: pending review.'), 'ok');
            showResult(true);
        }
        function retryPost() { lock(true); post().catch(e => { say(e.message, 'err'); lock(false); }); }
        function showResult(ok) {
            const L = lastSent, r = L.report, t = r.totals; result.innerHTML = '';
            const chip = (n, label, cls) => el('span', { class: 'su-chip ' + (cls || '') }, el('b', null, String(n)), label);
            const save = () => { const a = el('a', { href: URL.createObjectURL(new Blob([L.txt], { type: 'text/plain' })), download: 'RAPPORT-MLO-' + (L.root || 'mlo') + '.txt' }); document.body.append(a); a.click(); setTimeout(() => { URL.revokeObjectURL(a.href); a.remove(); }, 2000); };
            result.append(el('div', { class: 'su-rhead' }, el('b', null, T('Compte rendu du ZIP', 'ZIP report')), el('span', null, ok ? T('envoyé avec le MLO', 'sent with the MLO') : '')),
                el('div', { class: 'su-chips' }, chip(t.included, T('inclus', 'included')), t.excluded ? chip(t.excluded, T('exclus', 'left out'), 'err') : null, L.warns ? chip(L.warns, T('alertes', 'warnings'), 'warn') : null, chip(fmt(t.zipBytes), 'ZIP')),
                el('ul', { class: 'su-checks' }, r.checks.map(c => el('li', { class: c.level }, c.text))),
                el('div', { class: 'su-ract' }, el('button', { class: 'btn sm', onclick: save }, T('Enregistrer le compte rendu (.txt)', 'Save the report (.txt)')), el('button', { class: 'btn sm', onclick: () => window.open(L.url, '_blank') }, T('Voir sur Transfer.it', 'View on Transfer.it'))));
        }
    };

    // Some merged builds omit the optional uploader header initializer. Do not let that
    // optional module throw during startup and pollute the editor's crash log.
    if (typeof drawTop === 'function') {
        if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', drawTop); else drawTop();
    }
})(window.MLO);
