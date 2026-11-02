// Pure geometry helpers shared by automatic door/window detection and its tests.
window.MLO = window.MLO || {};
(function (M) {
    'use strict';

    function overlapFraction(a, b) {
        if (!a || !b || ![a.cx, a.cy, a.zb, a.w, a.h, a.yaw, b.cx, b.cy, b.zb, b.w, b.h, b.yaw].every(Number.isFinite)) return 0;
        if (Math.abs(Math.cos(a.yaw - b.yaw)) < 0.985) return 0;
        const cs = Math.cos(a.yaw), sn = Math.sin(a.yaw), dx = b.cx - a.cx, dy = b.cy - a.cy;
        const du = Math.abs(dx * cs + dy * sn), dn = Math.abs(-dx * sn + dy * cs);
        if (dn > 0.3) return 0;
        const width = Math.max(0, Math.min(a.w / 2, du + b.w / 2) - Math.max(-a.w / 2, du - b.w / 2));
        const height = Math.max(0, Math.min(a.zb + a.h, b.zb + b.h) - Math.max(a.zb, b.zb));
        const smaller = Math.min(a.w * a.h, b.w * b.h);
        return smaller > 0 ? width * height / smaller : 0;
    }

    function markTypeConflicts(candidates, existing) {
        const rows = candidates || [], active = existing || [];
        rows.forEach(a => {
            const peers = rows.filter(b => b !== a && b.type !== a.type && overlapFraction(a, b) >= 0.68)
                .map(b => ({ id: b.id, type: b.type, w: b.w, h: b.h, source: b.autoDetection && b.autoDetection.source }));
            const already = active.filter(b => b.type !== a.type && overlapFraction(a, b) >= 0.68)
                .map(b => ({ id: b.id, type: b.type, w: b.w, h: b.h, existing: true }));
            if (peers.length || already.length) a.typeConflict = { peers, existing: already };
            else delete a.typeConflict;
        });
        return rows;
    }

    M.OpeningGeometry = { overlapFraction, markTypeConflicts };
})(window.MLO);
