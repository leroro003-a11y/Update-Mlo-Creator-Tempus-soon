// Shared ownership for source-face deletions. The public arrays keep their
// legacy shapes because the native host and export pipeline consume them.
window.MLO = window.MLO || {};
(function (M) {
    'use strict';
    const DEL = M.FaceDeletions = {};

    const targetFile = (I) => I && I.target || '';
    const keyOf = (file, g, tri) => String(file || '') + '|' + g + '|' + tri;
    const targetKey = (g, tri) => g + ':' + tri;
    const detailKey = (file, g, tri) => file + '|' + g + ':' + tri;
    const arrays = (P, file, targetHint) => {
        const I = P.import;
        if (targetHint === true || (targetHint == null && file && file === targetFile(I))) {
            I.deletes = Array.isArray(I.deletes) ? I.deletes : [];
            return { rows: I.deletes, target: true };
        }
        I.mdeletes = Array.isArray(I.mdeletes) ? I.mdeletes : [];
        return { rows: I.mdeletes, target: false };
    };
    const rowHas = (rows, file, g, tri, target) =>
        rows.some(d => target ? d[0] === g && d[1] === tri : d[0] === file && d[1] === g && d[2] === tri);
    const removeRows = (rows, file, g, tri, target) => {
        for (let i = rows.length - 1; i >= 0; i--)
            if (target ? rows[i][0] === g && rows[i][1] === tri : rows[i][0] === file && rows[i][1] === g && rows[i][2] === tri)
                rows.splice(i, 1);
    };

    // One-time migration is conservative: old array entries with no known
    // producer are marked unowned and therefore will never be auto-restored.
    function normalize(P) {
        const I = P.import;
        I.deletes = Array.isArray(I.deletes) ? I.deletes : [];
        I.mdeletes = Array.isArray(I.mdeletes) ? I.mdeletes : [];
        const owners = I.faceDeleteOwners = I.faceDeleteOwners && typeof I.faceDeleteOwners === 'object' ? I.faceDeleteOwners : {};
        const migrateLegacy = !I.faceDeleteOwnersMigrated;
        const ensure = (file, g, tri) => {
            const key = keyOf(file, g, tri);
            return owners[key] || (owners[key] = { file, g, tri, target: file === tf, owners: [], unowned: false });
        };
        const claim = (file, g, tri, owner, unowned) => {
            if (!file || !Number.isInteger(+g) || !Number.isInteger(+tri)) return;
            const rec = ensure(file, +g, +tri);
            if (owner && !rec.owners.includes(owner)) rec.owners.push(owner);
            if (unowned) rec.unowned = true;
        };

        const tf = targetFile(I);
        if (migrateLegacy) {
            (I.cutters || []).forEach(c => {
                const f = c && c.face;
                if (!f || !tf || !Array.isArray(f.tris)) return;
                const owner = f.owner || ('cutter:' + c.id);
                (f.claimed || f.added || []).forEach(tri => claim(tf, f.g, tri, owner, false));
            });
            (I.parts || []).forEach(part => {
                if (!part || !part.f) return;
                const owner = part.owner || ('part:' + part.f + ':' + part.g);
                (part.owned || part.added || []).forEach(tri => claim(part.f, part.g, tri, owner, false));
            });
            Object.keys(I.plantFaceOwners || {}).forEach(k => {
                const plant = I.plantFaceOwners[k];
                if (!plant || !plant.file) return;
                (plant.owners || []).forEach(owner => claim(plant.file, plant.g, plant.tri, 'plant:' + owner, false));
                if (plant.preexisting) claim(plant.file, plant.g, plant.tri, null, true);
            });
            if (I.plantFaceOwners) delete I.plantFaceOwners;
            I.faceDeleteOwnersMigrated = true;
        }

        if (migrateLegacy) {
            I.deletes.forEach(d => {
                if (!d || d.length < 2 || !tf) return;
                const rec = ensure(tf, d[0], d[1]);
                if (!rec.owners.length && !rec.unowned) rec.unowned = true;
            });
            I.mdeletes.forEach(d => {
                if (!d || d.length < 3) return;
                const rec = ensure(d[0], d[1], d[2]);
                if (!rec.owners.length && !rec.unowned) rec.unowned = true;
            });
        }
        return owners;
    }

    DEL.key = keyOf;
    DEL.has = function (P, file, g, tri) {
        const a = arrays(P, file);
        return rowHas(a.rows, file, g, tri, a.target);
    };
    DEL.claim = function (P, file, g, tri, owner) {
        return DEL.claimMany(P, file, g, [tri], owner).length > 0;
    };
    DEL.claimMany = function (P, file, g, triangles, owner) {
        if (!owner) throw new Error('Face deletion owner is required.');
        const owners = normalize(P), a = arrays(P, file), added = [];
        const existing = new Set();
        a.rows.forEach(d => {
            if (a.target) { if (d[0] === g) existing.add(targetKey(d[0], d[1])); }
            else if (d[0] === file && d[1] === g) existing.add(targetKey(d[1], d[2]));
        });
        (triangles || []).forEach(tri => {
            const key = keyOf(file, g, tri), existed = existing.has(targetKey(g, tri));
            let rec = owners[key];
            if (!rec) rec = owners[key] = { file, g, tri, target: a.target, owners: [], unowned: existed };
            else if (existed && !rec.owners.length && !rec.unowned) rec.unowned = true;
            if (!rec.owners.includes(owner)) rec.owners.push(owner);
            if (!existing.has(targetKey(g, tri))) {
                a.rows.push(a.target ? [g, tri] : [file, g, tri]);
                existing.add(targetKey(g, tri)); added.push(tri);
            }
        });
        return added;
    };
    DEL.release = function (P, file, g, tri, owner) {
        if (!owner) return false;
        const owners = normalize(P), key = keyOf(file, g, tri), rec = owners[key], a = arrays(P, file, rec && rec.target);
        if (!detachOwner(owners, key, rec, owner)) return false;
        removeRows(a.rows, file, g, tri, a.target);
        return true;
    };
    function detachOwner(owners, key, rec, owner) {
        if (!rec || !rec.owners.includes(owner)) return false;
        rec.owners = rec.owners.filter(x => x !== owner);
        if (rec.owners.length || rec.unowned) return false;
        delete owners[key];
        return true;
    }
    DEL.releaseMany = function (P, file, g, triangles, owner) {
        if (!owner) return 0;
        const owners = normalize(P), targetRemove = new Set(), detailRemove = new Set(); let restored = 0;
        (triangles || []).forEach(tri => {
            const key = keyOf(file, g, tri), rec = owners[key];
            if (detachOwner(owners, key, rec, owner)) {
                restored++;
                if (rec.target) targetRemove.add(targetKey(g, tri));
                else detailRemove.add(detailKey(file, g, tri));
            }
        });
        if (targetRemove.size) P.import.deletes = P.import.deletes.filter(d => !targetRemove.has(targetKey(d[0], d[1])));
        if (detailRemove.size) P.import.mdeletes = P.import.mdeletes.filter(d => !detailRemove.has(detailKey(d[0], d[1], d[2])));
        return restored;
    };
    DEL.releaseOwner = function (P, owner) {
        if (!owner) return 0;
        const I = P.import, owners = normalize(P), keys = Object.keys(owners), targetRemove = new Set(), detailRemove = new Set();
        let restored = 0;
        keys.forEach(key => {
            const rec = owners[key];
            if (!rec || !rec.owners.includes(owner)) return;
            const a = arrays(P, rec.file, rec.target);
            if (detachOwner(owners, key, rec, owner)) {
                restored++;
                if (a.target) targetRemove.add(targetKey(rec.g, rec.tri));
                else detailRemove.add(detailKey(rec.file, rec.g, rec.tri));
            }
        });
        if (targetRemove.size) I.deletes = I.deletes.filter(d => !targetRemove.has(targetKey(d[0], d[1])));
        if (detailRemove.size) I.mdeletes = I.mdeletes.filter(d => !detailRemove.has(detailKey(d[0], d[1], d[2])));
        return restored;
    };
    DEL.restoreFile = function (P, file) {
        const I = P.import;
        const owners = normalize(P), a = arrays(P, file);
        if (a.target) I.deletes = [];
        else I.mdeletes = I.mdeletes.filter(d => d[0] !== file);
        Object.keys(owners).forEach(key => { if (owners[key].file === file) delete owners[key]; });
        if (!Object.keys(owners).length) delete I.faceDeleteOwners;
    };
    DEL.summary = function (P) {
        const owners = normalize(P);
        return Object.keys(owners).reduce((out, key) => {
            const rec = owners[key];
            out.faces++; out.owned += rec.owners.length; if (rec.unowned) out.legacyOrManual++;
            return out;
        }, { faces: 0, owned: 0, legacyOrManual: 0 });
    };
})(window.MLO);
