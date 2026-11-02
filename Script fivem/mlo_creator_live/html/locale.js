// Bilingual translator for the standalone FiveM NUI. Locale is set by Config.Locale in config.lua.
(function () {
    'use strict';
    const MAP = {"en_to_fr":{"MLO Creator":"MLO Creator","MLO Creator ":"MLO Creator ","prop_chair_01a, v_ilev_ph_door01...":"prop_chair_01a, v_ilev_ph_door01...","{\"mlocreator\":\"walls\", ...}":"{\"mlocreator\":\"walls\", ...}","live":"live","Add a prop of the game":"Ajouter un objet du jeu","Enter: put it where the crosshair points · Esc: cancel":"Entrée : placez-le à l’endroit visé par le réticule · Esc : annuler","Mouse":"Souris","Look":"Regarder","W A S D":"W A S D","Fly":"Voler","Space / C":"Espace / C","Up / down":"Monter / descendre","Shift / Ctrl":"Shift / Ctrl","Faster / slower":"Plus vite / plus lentement","Left click":"Clic gauche","Select":"Sélectionner","Right click / Esc":"Clic droit / Esc","Select none":"Désélectionner","Arrows":"Flèches","Move it along the view":"Déplacer dans l’axe du regard","PageUp / PageDown":"PageUp / PageDown","Raise / lower":"Monter / descendre","Q / E":"Q / E","Turn":"Tourner","Hold it at the crosshair, click puts it down":"Le maintenir au viseur ; cliquer pour le poser","Copy":"Copier","X / Del":"X / Suppr","Delete or bring back":"Supprimer ou restaurer","Add a prop":"Ajouter un objet","Undo":"Annuler","1 / 2":"1 / 2","Move step":"Pas de déplacement","3 / 4":"3 / 4","Turn step":"Pas de rotation","Hide these keys":"Masquer ces touches","Project: ":"Projet : "," change":" modification"," to undo":" à annuler","(unnamed)":"(sans nom)"," deleted":" supprimé"," · added":" · ajouté"," · held: click puts it down":" · tenu : cliquer pour le poser"," · heading ":" · orientation ","Click to select ":"Cliquez pour sélectionner ","Point the crosshair at an object and click.":"Visez un objet avec le réticule et cliquez.","Move step ":"Pas de déplacement "," m · turn step ":" m · pas de rotation ","Alt":"Alt","Live editor: ":"Éditeur en direct : ",". H shows the keys, ":". H affiche les touches, "," stops.":" arrête l’éditeur.","The game has no model ":"Le jeu ne possède pas le modèle ","Usage: /mlolive <project> · /mlolive <project> reload · /mlolive close":"Utilisation : /mlolive <project> · /mlolive <project> reload · /mlolive close","MLO Creator live editor on / off":"MLO Creator : éditeur en direct activé / désactivé","You may not use the MLO Creator live editor (":"Vous n’êtes pas autorisé à utiliser l’éditeur en direct de MLO Creator (","Usage: /mlolive <project name>  (the name MLO Creator shows when it sends a project)":"Utilisation : /mlolive <project name> (nom du projet affiché par MLO Creator lors de son envoi)","There is no project \"":"Aucun projet « ","\" in ":" » n’existe dans ","/data. Send it from MLO Creator first.":"/data. Envoyez-le d’abord depuis MLO Creator.","Live project \"":"Projet actif « ","\" closed; its changes are saved for MLO Creator.":" » fermé ; ses modifications sont enregistrées pour MLO Creator.","MLO Creator live editor: change a game interior in the game (objects and walls), together with MLO Creator":"Éditeur en direct de MLO Creator : modifiez un intérieur du jeu (objets et murs) en jeu, avec MLO Creator.","%.2f m":"%.2f m","%.2f m · h %.2f m":"%.2f m · hauteur %.2f m"},"fr_to_en":{"MLO Creator":"MLO Creator","murs":"walls","v_ilev_ph_door01, prop_door_01...":"v_ilev_ph_door01, prop_door_01...","Alt":"Alt","W A S D":"W A S D","PageUp / PageDown":"PageUp / PageDown","Q / E":"Q / E","Coller les murs de MLO Creator":"Paste walls from MLO Creator","Dans MLO Creator : panneau Murs, « Copier les murs pour FiveM », puis Ctrl+V ici. Les murs de la session sont remplacés.":"In MLO Creator: open the Walls panel, choose “Copy walls for FiveM,” then press Ctrl+V here. The session’s walls will be replaced.","Coller":"Paste","Annuler":"Cancel","Dessiner / sélectionner":"Draw / select","Clic":"Click","Début, puis fin du mur":"Start, then end the wall","Clic droit":"Right click","Finir la ligne":"End the line","Sans aimantation":"No snapping","Souris · W A S D":"Mouse · W A S D","Regarder · voler":"Look · fly","Espace / C":"Space / C","Monter / descendre":"Up / down","Sélectionner un mur":"Select a wall","Entrée":"Enter","Modifier (hauteur, portes...)":"Edit (height, doors...)","Déplacer":"Move","Monter / descendre le mur":"Raise / lower the wall","Tourner":"Rotate","Prendre au viseur":"Grab at the crosshair","Copier":"Copy","X / Suppr":"X / Del","Supprimer":"Delete","1 / 2 · 3 / 4":"1 / 2 · 3 / 4","Pas de déplacement · rotation":"Move step · turn step","Cacher les touches":"Hide these keys","Projet : ":"Project: "," m · rotation ":" m · rotation ","Flèches":"Arrows"," mur":" wall"," à annuler":" to undo","DESSIN":"DRAW","SÉLECTION":"SELECTION","Clique où le mur finit · clic droit : finir la ligne":"Click where the wall ends · right-click to finish the line","Clique au sol où le mur commence":"Click on the ground where the wall starts","Mur ":"Wall "," · tenu : clic pour poser":" · held: click to place","hauteur ":"height "," m · épaisseur ":" m · thickness "," ouverture":" opening","Entrée : modifier":"Enter: edit","Clique pour sélectionner ce mur":"Click to select this wall","Vise un mur et clique, ou R pour dessiner.":"Aim at a wall and click, or press R to draw.","Pas ":"Move step ","rotation ":"rotation ","Longueur (m)":"Length (m)","Hauteur (m)":"Height (m)","Épaisseur (m)":"Thickness (m)","Pied, Z (m)":"Base, Z (m)","Texture":"Texture","+ Porte":"+ Door","+ Fenêtre":"+ Window","+ Passage":"+ Opening","Inverser":"Reverse","Porte":"Door","Fenêtre":"Window","Passage":"Opening","Depuis le début (m)":"From start (m)","Largeur (m)":"Width (m)","Allège (m)":"Sill height (m)","Haut (m)":"Top (m)","Porte du jeu":"In-game door","Mettre cette porte":"Set this door","Sens inverse":"Reverse direction","Sans porte":"No door","Retirer":"Remove","Fermer (Échap)":"Close (Esc)","Supprimer le mur":"Delete wall","Murs copiés. Dans MLO Creator : panneau Murs, « Coller les murs de FiveM ».":"Walls copied. In MLO Creator: open the Walls panel and choose “Paste walls from FiveM.”","La copie n'a pas marché.":"Copy failed.","Ferme d'abord l'éditeur de murs (":"Close the wall editor first (","Ferme d'abord l'éditeur d'objets (":"Close the object editor first (","Éditeur de murs : ":"Wall editor: ",". R dessine, H montre les touches, ":". R draws, H shows the keys, "," arrête.":" stops.","Le jeu n'a pas de modèle ":"The game has no model ","Ce texte ne vient pas de MLO Creator (bouton « Copier les murs pour FiveM »).":"This text is not from MLO Creator (the “Copy walls for FiveM” button).","Usage : /mlomurs <projet> · /mlomurs copier · /mlomurs coller · /mlomurs fermer":"Usage: /mlomurs <project> · /mlomurs copy · /mlomurs paste · /mlomurs close","Ouvre d'abord un projet : /mlomurs <projet>":"Open a project first: /mlomurs <project>","MLO Creator : éditeur de murs on / off":"MLO Creator: wall editor on / off","Tu n'as pas le droit d'utiliser l'éditeur de murs (":"You are not allowed to use the wall editor (","Usage : /mlomurs <projet>":"Usage: /mlomurs <project>","Trop de murs dans ce projet (":"Too many walls in this project ("," au plus).":" maximum)."," mur(s) collé(s) dans \"":" wall(s) pasted into “","\".":"”.","Murs de \"":"Walls for “","\" fermés et sauvegardés.":"” closed and saved.","%.2f m":"%.2f m","%.2f m · h %.2f m":"%.2f m · height %.2f m","MLO Creator : éditeur en direct activé / désactivé":"MLO Creator live editor on / off","Project: ":"Project: "}};
    const SKIP = new Set(['SCRIPT','STYLE','NOSCRIPT']);
    let lang = 'en', translating = false;
    const originals = new WeakMap(), applied = new WeakMap(), attrOriginals = new WeakMap(), attrApplied = new WeakMap();
    function replaceText(source) {
        const map = lang === 'fr' ? MAP.en_to_fr : MAP.fr_to_en;
        if (Object.prototype.hasOwnProperty.call(map, source)) return map[source];
        let out = source;
        const keys = Object.keys(map).filter(k => k.length >= 3 && map[k] !== k).sort((a,b) => b.length-a.length);
        for (const k of keys) {
            const escaped = k.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
            const left = /^[\p{L}\p{N}_]/u.test(k) ? '(?<![\p{L}\p{N}_])' : '';
            const right = /[\p{L}\p{N}_]$/u.test(k) ? '(?![\p{L}\p{N}_])' : '';
            out = out.replace(new RegExp(left + escaped + right, 'gu'), map[k]);
        }
        return out;
    }
    function textNode(n) {
        if (!n.parentNode) return;
        for (let p=n.parentNode; p && p.nodeType===1; p=p.parentNode) if (SKIP.has(p.nodeName)) return;
        const cur=n.data, prev=applied.get(n);
        if (prev===cur) return;
        const src=(prev!==undefined && cur!==prev) ? cur : (originals.has(n) ? originals.get(n) : cur);
        originals.set(n,src); const out=replaceText(src); applied.set(n,out);
        if (out!==cur) n.data=out;
    }
    function attrs(e) {
        let orig=attrOriginals.get(e); if(!orig){orig={};attrOriginals.set(e,orig)}
        let done=attrApplied.get(e); if(!done){done={};attrApplied.set(e,done)}
        for(const a of ['title','placeholder','aria-label']) {
            if(!e.hasAttribute(a)) continue; const cur=e.getAttribute(a); if(done[a]===cur) continue;
            const src=(done[a]!==undefined && cur!==done[a])?cur:(orig[a]!==undefined?orig[a]:cur);
            orig[a]=src; const out=replaceText(src); done[a]=out; if(out!==cur)e.setAttribute(a,out);
        }
    }
    function walk(root) {
        if(root.nodeType===3){textNode(root);return;}
        if(root.nodeType!==1 || SKIP.has(root.nodeName)) return;
        attrs(root); const w=document.createTreeWalker(root,NodeFilter.SHOW_ELEMENT|NodeFilter.SHOW_TEXT);
        let n; while((n=w.nextNode())) { if(n.nodeType===3)textNode(n); else if(n.nodeType===1&&!SKIP.has(n.nodeName))attrs(n); }
    }
    function rerun() {
        translating=true;
        const tw=document.createTreeWalker(document.body,NodeFilter.SHOW_ELEMENT|NodeFilter.SHOW_TEXT);
        const nodes=[document.body],texts=[]; let n; while((n=tw.nextNode())) (n.nodeType===3?texts:nodes).push(n);
        texts.forEach(t=>{if(applied.has(t)&&t.data===applied.get(t))t.data=originals.get(t);});
        nodes.forEach(e=>{const o=attrOriginals.get(e),d=attrApplied.get(e);if(o&&d)for(const a of Object.keys(d))if(e.hasAttribute(a)&&e.getAttribute(a)===d[a])e.setAttribute(a,o[a]);});
        walk(document.body); translating=false;
    }
    const observer=new MutationObserver(list=>{if(translating)return;for(const r of list){if(r.type==='childList')r.addedNodes.forEach(walk);else if(r.type==='characterData')textNode(r.target);else if(r.type==='attributes')attrs(r.target);}});
    observer.observe(document.documentElement,{subtree:true,childList:true,characterData:true,attributes:true,attributeFilter:['title','placeholder','aria-label']});
    walk(document.body);
    window.addEventListener('message',ev=>{const m=ev.data||{};if(m.type==='locale'){lang=m.lang==='fr'?'fr':'en';document.documentElement.lang=lang;rerun();}});
})();
