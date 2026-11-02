-- MLO Creator live editor, the client.
-- Every player sees the open sessions: the game's objects that were moved or deleted are hidden where they stand (a model hide), and the moved, copied and
-- added ones stand as objects of their own. A player allowed to edit flies a free camera through the interior, picks objects with the crosshair and moves,
-- turns, copies, deletes and adds them; each change goes to the server, which saves it for MLO Creator and sends it to everyone.
local sessions = {}              -- name -> { s = the session, byId = { id -> entity }, objs = { id -> object }, hides = { id -> true } }
local editing, lastName = nil, nil
local cam, camPos, camRot = nil, nil, nil
local sel, hover, grab = nil, nil, nil
local moveI, turnI, help = 2, 3, true
local undo = {}
local dims = {}

-- ---------- quaternions (x, y, z, w) and small helpers ----------
local function qmul(a, b) return { a[4] * b[1] + a[1] * b[4] + a[2] * b[3] - a[3] * b[2], a[4] * b[2] - a[1] * b[3] + a[2] * b[4] + a[3] * b[1], a[4] * b[3] + a[1] * b[2] - a[2] * b[1] + a[3] * b[4], a[4] * b[4] - a[1] * b[1] - a[2] * b[2] - a[3] * b[3] } end
local function qrot(q, v)
    local qx, qy, qz, qw = q[1], q[2], q[3], q[4]
    local tx, ty, tz = 2 * (qy * v.z - qz * v.y), 2 * (qz * v.x - qx * v.z), 2 * (qx * v.y - qy * v.x)
    return vector3(v.x + qw * tx + (qy * tz - qz * ty), v.y + qw * ty + (qz * tx - qx * tz), v.z + qw * tz + (qx * ty - qy * tx))
end
local function qz(deg) local h = math.rad(deg) / 2; return { 0.0, 0.0, math.sin(h), math.cos(h) } end
local function qof(e) return { e.qx or 0.0, e.qy or 0.0, e.qz or 0.0, e.qw or 1.0 } end
local function r3(v) return math.floor(v * 1000 + 0.5) / 1000 end
local function r6(v) return math.floor(v * 1000000 + 0.5) / 1000000 end
local function headingOf(e) local q = qof(e); return math.deg(math.atan(2 * (q[4] * q[3] + q[1] * q[2]), 1 - 2 * (q[2] * q[2] + q[3] * q[3]))) end
local function hashOf(e) e.hash = e.hash or GetHashKey(e.n); return e.hash end
local function moved(e)
    if not e.game or not e.ox then return false end
    if math.abs(e.x - e.ox) + math.abs(e.y - e.oy) + math.abs(e.z - e.oz) > 0.005 then return true end
    local d = (e.qx or 0) * (e.oqx or 0) + (e.qy or 0) * (e.oqy or 0) + (e.qz or 0) * (e.oqz or 0) + (e.qw or 1) * (e.oqw or 1)
    return math.abs(math.abs(d) - 1) > 0.00002
end
local function notify(text, kind) SendNUIMessage({ type = 'toast', text = text, kind = kind or 'info' }) end
RegisterNetEvent('mlolive:notify', notify)

local function loadModel(h)
    if not IsModelInCdimage(h) then return false end
    RequestModel(h); local t = GetGameTimer() + 8000
    while not HasModelLoaded(h) and GetGameTimer() < t do Wait(0) end
    return HasModelLoaded(h)
end
local function dimsOf(e)
    local h = hashOf(e); local d = dims[h]
    if not d then local mn, mx = GetModelDimensions(h); d = { mn = mn, mx = mx }; dims[h] = d end
    return d
end

-- ---------- what everyone sees ----------
local function apply(S, e)
    local h = hashOf(e)
    local changed = e.game and (e.del or moved(e))
    if changed and not S.hides[e.id] then CreateModelHide(e.ox, e.oy, e.oz, 0.3, h, true); S.hides[e.id] = true
    elseif not changed and S.hides[e.id] then RemoveModelHide(e.ox, e.oy, e.oz, 0.3, h, false); S.hides[e.id] = nil end
    local want = not e.del and (not e.game or moved(e))
    local o = S.objs[e.id]
    if want then
        if not o or not DoesEntityExist(o) then
            if not loadModel(h) then return end
            o = CreateObjectNoOffset(h, e.x, e.y, e.z, false, false, false)
            FreezeEntityPosition(o, true); SetEntityInvincible(o, true); SetModelAsNoLongerNeeded(h); S.objs[e.id] = o
        end
        SetEntityCoordsNoOffset(o, e.x, e.y, e.z, false, false, false); SetEntityQuaternion(o, e.qx or 0.0, e.qy or 0.0, e.qz or 0.0, e.qw or 1.0)
    elseif o then
        if DoesEntityExist(o) then DeleteObject(o) end; S.objs[e.id] = nil
    end
end
local function clear(name)
    local S = sessions[name]; if not S then return end
    for id, o in pairs(S.objs) do if DoesEntityExist(o) then DeleteObject(o) end end
    for id in pairs(S.hides) do local e = S.byId[id]; if e then RemoveModelHide(e.ox, e.oy, e.oz, 0.3, hashOf(e), false) end end
    sessions[name] = nil
end

RegisterNetEvent('mlolive:session', function(name, s)
    clear(name)
    local S = { s = s, byId = {}, objs = {}, hides = {} }; sessions[name] = S
    for _, e in ipairs(s.entities) do S.byId[e.id] = e end
    for _, e in ipairs(s.entities) do if e.del or not e.game or moved(e) then apply(S, e) end end
end)
RegisterNetEvent('mlolive:changed', function(name, list, from)
    local S = sessions[name]; if not S then return end
    for _, u in ipairs(list) do
        local e = S.byId[u.id]
        if not e then e = { id = u.id, n = u.n, game = false }; S.s.entities[#S.s.entities + 1] = e; S.byId[u.id] = e end
        for k, v in pairs(u) do if k ~= 'id' and k ~= 'n' then e[k] = v end end
        apply(S, e)
    end
end)
RegisterNetEvent('mlolive:closed', function(name)
    if editing == name then TriggerEvent('mlolive:stop') end
    clear(name)
end)
RegisterNetEvent('mlolive:allowed', function(ok) SendNUIMessage({ type = 'allowed', ok = ok }) end)

CreateThread(function()
    while not NetworkIsSessionStarted() do Wait(500) end
    TriggerServerEvent('mlolive:hello')
end)

-- ---------- changing (each change one step of undo) ----------
local function send(e, fields)
    local u = { id = e.id }; for k, v in pairs(fields) do u[k] = v end
    if not e.game and not e.sent then u.n = e.n; e.sent = true end
    TriggerServerEvent('mlolive:change', editing, { u })
end
local function change(e, fields, noUndo)
    if not noUndo then
        local before = {}; for k in pairs(fields) do before[k] = e[k] end
        if before.del == nil and fields.del ~= nil then before.del = false end
        undo[#undo + 1] = { id = e.id, f = before, created = e._justCreated == true }
        if #undo > 200 then table.remove(undo, 1) end
    end
    for k, v in pairs(fields) do e[k] = v end
    e._justCreated = nil
    apply(sessions[editing], e); send(e, fields)
end
local function place(e, pos, q) return { x = r3(pos.x), y = r3(pos.y), z = r3(pos.z), qx = r6(q[1]), qy = r6(q[2]), qz = r6(q[3]), qw = r6(q[4]) } end
local function newId() return ('g%x%04x'):format(GetGameTimer(), math.random(0, 0xffff)) end
local function addEntity(n, pos, q)
    local S = sessions[editing]; local e = { id = newId(), n = n:lower(), game = false, _justCreated = true }
    S.s.entities[#S.s.entities + 1] = e; S.byId[e.id] = e
    change(e, place(e, pos, q)); return e
end

-- ---------- the free camera and picking ----------
local function dirOf(rot)
    local p, y = math.rad(rot.x), math.rad(rot.z)
    return vector3(-math.sin(y) * math.cos(p), math.cos(y) * math.cos(p), math.sin(p))
end
local function rayHit(from, dir, ignore)
    local to = from + dir * 60.0
    local h = StartExpensiveSynchronousShapeTestLosProbe(from.x, from.y, from.z, to.x, to.y, to.z, -1, ignore or 0, 4)
    local _, hit, pos = GetShapeTestResult(h)
    if hit == 1 or hit == true then return pos end
    return nil
end
-- the object the crosshair points at: the nearest one whose ball (its model's box) the line passes through, pieces of the building left out
local function pick(S, from, dir)
    local best, bt = nil, 1e9
    for _, e in ipairs(S.s.entities) do
        if not e.del and e.x then
            local d = dimsOf(e); local half = (d.mx - d.mn) * 0.5; local r = #half
            if r * 2 <= Config.MaxPick and r > 0.01 then
                local c = vector3(e.x, e.y, e.z) + qrot(qof(e), (d.mn + d.mx) * 0.5)
                local v = c - from; local t = v.x * dir.x + v.y * dir.y + v.z * dir.z
                if t > 0 and t < 60 and t < bt then local off = v - dir * t; if #off < math.max(0.25, r * 0.7) then best, bt = e, t end end
            end
        end
    end
    return best
end
local function drawBox(e, r, g, b)
    local d = dimsOf(e); local q = qof(e); local p = vector3(e.x, e.y, e.z); local c = {}
    for i = 0, 7 do
        local v = vector3((i & 1) == 0 and d.mn.x or d.mx.x, (i & 2) == 0 and d.mn.y or d.mx.y, (i & 4) == 0 and d.mn.z or d.mx.z)
        c[i] = p + qrot(q, v)
    end
    for _, ed in ipairs({ { 0, 1 }, { 1, 3 }, { 3, 2 }, { 2, 0 }, { 4, 5 }, { 5, 7 }, { 7, 6 }, { 6, 4 }, { 0, 4 }, { 1, 5 }, { 2, 6 }, { 3, 7 } }) do
        DrawLine(c[ed[1]].x, c[ed[1]].y, c[ed[1]].z, c[ed[2]].x, c[ed[2]].y, c[ed[2]].z, r, g, b, 255)
    end
end

local function panel()
    local S = editing and sessions[editing]; local e = S and sel and S.byId[sel]
    SendNUIMessage({ type = 'state', open = editing ~= nil, name = editing, help = help, grab = grab ~= nil,
        move = Config.MoveSteps[moveI], turn = Config.TurnSteps[turnI],
        sel = e and { n = e.n, x = e.x, y = e.y, z = e.z, h = headingOf(e), game = e.game, del = e.del } or nil,
        hover = (hover and S and S.byId[hover] and S.byId[hover].n) or nil, undo = #undo })
end

local function stop()
    if not editing then return end
    editing = nil; grab = nil; sel = nil; hover = nil; MloLiveEditing = false
    RenderScriptCams(false, false, 0, true, true); if cam then DestroyCam(cam, false) end; cam = nil
    ClearFocus(); FreezeEntityPosition(PlayerPedId(), false); SetNuiFocus(false, false); panel()
end
AddEventHandler('mlolive:stop', stop)

local function start(name)
    if editing or not sessions[name] then return end
    if MloWallsEditing then notify("Ferme d'abord l'éditeur de murs (" .. Config.WallKey .. ').', 'error') return end
    editing = name; lastName = name; undo = {}; MloLiveEditing = true
    local p, r = GetGameplayCamCoord(), GetGameplayCamRot(2)
    camPos, camRot = p, vector3(r.x, 0.0, r.z)
    cam = CreateCam('DEFAULT_SCRIPTED_CAMERA', true); SetCamCoord(cam, p.x, p.y, p.z); SetCamRot(cam, r.x, 0.0, r.z, 2); SetCamFov(cam, 60.0)
    RenderScriptCams(true, false, 0, true, true); FreezeEntityPosition(PlayerPedId(), true)
    notify('Live editor: ' .. name .. '. H shows the keys, ' .. Config.Key .. ' stops.', 'success')
    CreateThread(function()
        local tick = 0
        while editing do
            Wait(0)
            DisableAllControlActions(0); EnableControlAction(0, 245, true); EnableControlAction(0, 249, true)       -- (chat and push to talk stay)
            local S = sessions[editing]; if not S then stop() break end
            -- look and fly
            local mx, my = GetDisabledControlNormal(0, 1), GetDisabledControlNormal(0, 2)
            camRot = vector3(math.max(-89.0, math.min(89.0, camRot.x - my * 8.0)), 0.0, camRot.z - mx * 8.0)
            local dir = dirOf(camRot); local right = vector3(math.cos(math.rad(camRot.z)), math.sin(math.rad(camRot.z)), 0.0)
            local sp = Config.CamSpeed * GetFrameTime() * (IsDisabledControlPressed(0, 21) and 4.0 or 1.0) * (IsDisabledControlPressed(0, 36) and 0.2 or 1.0)
            if IsDisabledControlPressed(0, 32) then camPos = camPos + dir * sp end
            if IsDisabledControlPressed(0, 33) then camPos = camPos - dir * sp end
            if IsDisabledControlPressed(0, 34) then camPos = camPos - right * sp end
            if IsDisabledControlPressed(0, 35) then camPos = camPos + right * sp end
            if IsDisabledControlPressed(0, 22) then camPos = camPos + vector3(0, 0, sp) end
            if IsDisabledControlPressed(0, 26) then camPos = camPos - vector3(0, 0, sp) end
            SetCamCoord(cam, camPos.x, camPos.y, camPos.z); SetCamRot(cam, camRot.x, 0.0, camRot.z, 2); SetFocusPosAndVel(camPos.x, camPos.y, camPos.z, 0.0, 0.0, 0.0)
            DrawRect(0.5, 0.5, 0.002, 0.003, 255, 255, 255, 200)
            -- hold an object at the crosshair (G), put it down with a click
            local e = sel and S.byId[sel]
            if grab and e then
                local hit = rayHit(camPos, dir, S.objs[e.id])
                if hit then local d = dimsOf(e); e.x, e.y, e.z = r3(hit.x), r3(hit.y), r3(hit.z - d.mn.z); apply(S, e) end
                if IsDisabledControlJustPressed(0, 24) then change(e, { x = e.x, y = e.y, z = e.z, qx = e.qx, qy = e.qy, qz = e.qz, qw = e.qw }, true); undo[#undo + 1] = { id = e.id, f = grab }; grab = nil end
                if IsDisabledControlJustPressed(0, 25) or IsDisabledControlJustPressed(0, 200) then for k, v in pairs(grab) do e[k] = v end; apply(S, e); grab = nil end
            else
                hover = (function() local h = pick(S, camPos, dir); return h and h.id end)()
                if IsDisabledControlJustPressed(0, 24) then sel = hover end
                if IsDisabledControlJustPressed(0, 25) or IsDisabledControlJustPressed(0, 200) then sel = nil end
            end
            e = sel and S.byId[sel]
            if hover and hover ~= sel and S.byId[hover] then drawBox(S.byId[hover], 255, 255, 255) end
            if e and not e.del then drawBox(e, 255, 220, 60) end
            -- the selected object: arrows move it along the view, PageUp / PageDown up and down, Q / E turn, G holds it, F copies, X deletes
            local step = Config.MoveSteps[moveI] * (IsDisabledControlPressed(0, 21) and 0.2 or 1.0)
            if e and not grab then
                local fwd = vector3(-math.sin(math.rad(camRot.z)), math.cos(math.rad(camRot.z)), 0.0)
                local mv = nil
                if IsDisabledControlJustPressed(0, 172) then mv = fwd * step elseif IsDisabledControlJustPressed(0, 173) then mv = -fwd * step
                elseif IsDisabledControlJustPressed(0, 174) then mv = -right * step elseif IsDisabledControlJustPressed(0, 175) then mv = right * step
                elseif IsDisabledControlJustPressed(0, 10) then mv = vector3(0, 0, step) elseif IsDisabledControlJustPressed(0, 11) then mv = vector3(0, 0, -step) end
                if mv and not e.del then change(e, place(e, vector3(e.x, e.y, e.z) + mv, qof(e))) end
                local turn = (IsDisabledControlJustPressed(0, 44) and 1) or (IsDisabledControlJustPressed(0, 38) and -1) or 0
                if turn ~= 0 and not e.del then change(e, place(e, vector3(e.x, e.y, e.z), qmul(qz(turn * Config.TurnSteps[turnI]), qof(e)))) end
                if IsDisabledControlJustPressed(0, 47) and not e.del then grab = { x = e.x, y = e.y, z = e.z } end
                if IsDisabledControlJustPressed(0, 23) and not e.del then local c = addEntity(e.n, vector3(e.x, e.y, e.z) + right * 0.5, qof(e)); sel = c.id end
                if IsDisabledControlJustPressed(0, 73) or IsDisabledControlJustPressed(0, 178) then change(e, { del = not e.del }) end
            end
            -- undo, steps, help, add a prop (B), stop
            if IsDisabledControlJustPressed(0, 20) and #undo > 0 then
                local u = table.remove(undo); local ue = S.byId[u.id]
                if ue then
                    if u.created then change(ue, { del = true }, true)
                    else change(ue, u.f, true) end
                end
            end
            if IsDisabledControlJustPressed(0, 157) then moveI = math.max(1, moveI - 1) end
            if IsDisabledControlJustPressed(0, 158) then moveI = math.min(#Config.MoveSteps, moveI + 1) end
            if IsDisabledControlJustPressed(0, 159) then turnI = math.max(1, turnI - 1) end
            if IsDisabledControlJustPressed(0, 160) then turnI = math.min(#Config.TurnSteps, turnI + 1) end
            if IsDisabledControlJustPressed(0, 74) then help = not help end
            if IsDisabledControlJustPressed(0, 29) then SetNuiFocus(true, true); SendNUIMessage({ type = 'ask' }) end
            tick = tick + 1; if tick % 10 == 0 then panel() end
        end
    end)
end

-- the model name typed in the panel: the new prop stands where the crosshair points
RegisterNUICallback('add', function(data, cb)
    SetNuiFocus(false, false); cb({})
    local n = tostring(data.model or ''):lower():gsub('[^a-z0-9_]', ''); if n == '' or not editing then return end
    local h = GetHashKey(n); if not IsModelInCdimage(h) then notify('The game has no model ' .. n .. '.', 'error') return end
    local dir = dirOf(camRot); local hit = rayHit(camPos, dir) or (camPos + dir * 3.0)
    local mn = GetModelDimensions(h)
    local e = addEntity(n, vector3(hit.x, hit.y, hit.z - mn.z), qz(camRot.z + 180.0)); sel = e.id
end)
RegisterNUICallback('cancel', function(_, cb) SetNuiFocus(false, false); cb({}) end)

RegisterNetEvent('mlolive:edit', function(name) start(name) end)
RegisterCommand('mlolive', function(_, args)
    local a = args[1]
    if not a then notify('Usage: /mlolive <project> · /mlolive <project> reload · /mlolive close', 'info') return end
    if a == 'close' then if lastName then local n = lastName; stop(); TriggerServerEvent('mlolive:close', n) end return end
    TriggerServerEvent('mlolive:open', a, args[2] == 'reload')
end, false)
RegisterCommand('mlolive_toggle', function() if editing then stop() elseif lastName and sessions[lastName] then start(lastName) end end, false)
RegisterKeyMapping('mlolive_toggle', 'MLO Creator live editor on / off', 'keyboard', Config.Key)

AddEventHandler('onResourceStop', function(r)
    if r ~= GetCurrentResourceName() then return end
    stop(); for name in pairs(sessions) do clear(name) end
end)
