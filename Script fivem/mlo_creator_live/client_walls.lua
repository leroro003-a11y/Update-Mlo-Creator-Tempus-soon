-- MLO Creator live, the wall editor (client): /mlomurs <projet>. Draw walls on the floor with a free camera, select them, move, turn, copy and delete
-- them, change their height, thickness and texture, and cut doors, windows and passages into them (a door of the game hangs in a door opening).
-- The walls are built like MLO Creator's (gamewalls.js): boxes between the openings, over and under them. Every player sees them, drawn with DrawPoly:
-- it is a preview without collision. The real walls (model, collision, portals) come from MLO Creator's export, after "Coller les murs de FiveM".
local sessions = {}              -- name -> { name, walls = { id -> wall }, geo = { id -> drawn faces }, doors = { id -> { entity } }, tok = { id -> token } }
local editing, lastName = nil, nil
local cam, camPos, camRot = nil, nil, nil
local sel, hover, grab = nil, nil, nil
local drawMode, drawA, drawZ, drawB = false, nil, nil, nil
local inspecting, help = false, true
local moveI, turnI = 2, 3
local undo = {}
local defaults = { h = Config.Wall.Height, t = Config.Wall.Thickness, tex = Config.Wall.Texture }
MloWallsEditing = false

-- the textures of MLO Creator (their main colour, for the preview)
local COLORS = {
    brick_red = { 150, 82, 66 }, brick_brown = { 116, 82, 62 }, brick_cream = { 198, 182, 150 }, brick_london = { 172, 148, 106 }, brick_grey = { 126, 127, 125 }, brick_charcoal = { 72, 74, 78 },
    stone_ash = { 150, 148, 140 }, stone_sand = { 192, 174, 138 }, stone_slate = { 88, 92, 96 },
    concrete = { 166, 165, 160 }, concrete_dark = { 112, 112, 110 }, concrete_panel = { 170, 168, 162 }, concrete_block = { 158, 157, 150 },
    plaster_white = { 232, 230, 224 }, plaster_cream = { 214, 205, 188 }, plaster_grey = { 190, 190, 188 }, plaster_warm = { 200, 186, 168 }, plaster_sage = { 150, 168, 146 },
    plaster_blue = { 146, 162, 178 }, plaster_terra = { 184, 124, 98 }, plaster_char = { 84, 86, 90 }, plaster_navy = { 56, 66, 86 },
    tile_white = { 198, 200, 198 }, tile_grey = { 138, 142, 144 }, tile_black = { 58, 60, 62 }, tile_check = { 160, 160, 158 }, tile_terra = { 166, 104, 76 },
    wood_oak = { 168, 130, 92 }, wood_walnut = { 98, 68, 48 }, wood_pine = { 196, 164, 118 }, wood_ash = { 170, 160, 146 }, wood_dark = { 60, 46, 38 }, wood_white = { 220, 218, 210 },
    metal_sheet = { 150, 154, 156 }, trim_white = { 236, 236, 232 }, trim_dark = { 60, 56, 52 }, trim_wood = { 112, 80, 56 },
    photo_oak_grey = { 150, 145, 138 }, photo_oak_natural = { 176, 136, 96 }
}
local TEXLIST = {}
for k in pairs(COLORS) do TEXLIST[#TEXLIST + 1] = k end
table.sort(TEXLIST)

-- ---------- small helpers ----------
local function r3(v) return math.floor(v * 1000 + 0.5) / 1000 end
local function snap5(v) return math.floor(v / 0.05 + 0.5) * 0.05 end
local function copy(t) if type(t) ~= 'table' then return t end; local o = {}; for k, v in pairs(t) do o[k] = copy(v) end; return o end

CreateThread(function() Wait(500); SendNUIMessage({ type = 'locale', lang = Config.Locale == 'fr' and 'fr' or 'en' }) end)

CreateThread(function() Wait(500); SendNUIMessage({ type = 'locale', lang = Config.Locale == 'fr' and 'fr' or 'en' }) end)
local function notify(text, kind) SendNUIMessage({ type = 'toast', text = text, kind = kind or 'info' }) end
local function newId() return ('w%x%03x'):format(GetGameTimer() % 0xffffff, math.random(0, 0xfff)) end
local function clean(w)
    local ops = {}
    for _, o in ipairs(w.ops or {}) do ops[#ops + 1] = { id = o.id, type = o.type, u = o.u, w = o.w, z0 = o.z0, z1 = o.z1, door = o.door, flip = o.flip == true } end
    return { id = w.id, a = { w.a[1], w.a[2] }, b = { w.b[1], w.b[2] }, z = w.z, h = w.h, t = w.t, tex = w.tex, room = w.room, ops = ops }
end
local function loadModel(h)
    if not IsModelInCdimage(h) then return false end
    RequestModel(h); local t = GetGameTimer() + 8000
    while not HasModelLoaded(h) and GetGameTimer() < t do Wait(0) end
    return HasModelLoaded(h)
end

-- ---------- a wall's frame and pieces (as in MLO Creator) ----------
local function frame(w)
    local dx, dy = w.b[1] - w.a[1], w.b[2] - w.a[2]
    local L = math.sqrt(dx * dx + dy * dy); if L < 1e-6 then L = 1e-6 end
    local ux, uy = dx / L, dy / L
    return { L = L, ux = ux, uy = uy, nx = -uy, ny = ux, yaw = math.atan(dy, dx) }
end
local function openings(w, L)
    local out = {}
    for _, o in ipairs(w.ops or {}) do
        local ow = math.min(o.w, L - 0.1); local hw = ow / 2
        local u0 = math.max(0.05, math.min(L - 0.05 - 2 * hw, o.u - hw))
        out[#out + 1] = { id = o.id, type = o.type, door = o.door, flip = o.flip, u0 = u0, u1 = u0 + ow, z0 = math.max(0, math.min(o.z0, w.h - 0.1)), z1 = math.max(0.1, math.min(o.z1, w.h)) }
    end
    table.sort(out, function(p, q) return p.u0 < q.u0 end)
    return out
end
-- boxes in the wall's frame: { u0, u1, v0, v1, z0, z1, glass }
local function pieces(w)
    local f = frame(w); local t = w.t / 2; local out = {}; local u = 0
    for _, o in ipairs(openings(w, f.L)) do
        local a = math.max(u, o.u0)
        if a > u + 0.005 then out[#out + 1] = { u, a, -t, t, 0, w.h } end
        local b = math.max(a, o.u1)
        if o.z1 < w.h - 0.005 then out[#out + 1] = { a, b, -t, t, o.z1, w.h } end
        if o.z0 > 0.005 then out[#out + 1] = { a, b, -t, t, 0, o.z0 } end
        if o.type == 'window' then out[#out + 1] = { a, b, -0.01, 0.01, o.z0, o.z1, glass = true } end
        u = math.max(u, b)
    end
    if f.L > u + 0.005 then out[#out + 1] = { u, f.L, -t, t, 0, w.h } end
    return out, f
end
local function toW(w, f, u, v, z) return vector3(w.a[1] + f.ux * u + f.nx * v, w.a[2] + f.uy * u + f.ny * v, w.z + z) end

-- the faces to draw: triangles with a colour, shaded by the way each face looks
local function geometry(w, tint)
    local tris = {}
    local base = COLORS[w.tex] or { 205, 200, 190 }
    local ps, f = pieces(w)
    for _, p in ipairs(ps) do
        local u0, u1, v0, v1, z0, z1 = p[1], p[2], p[3], p[4], p[5], p[6]
        local col = p.glass and { 170, 210, 235 } or (tint or base)
        local alpha = p.glass and 90 or (tint and 150 or 255)
        local function P(u, v, z) return toW(w, f, u, v, z) end
        local function quad(c1, c2, c3, c4, sh)
            local r, g, b = math.floor(col[1] * sh), math.floor(col[2] * sh), math.floor(col[3] * sh)
            tris[#tris + 1] = { c1, c2, c3, r, g, b, alpha }; tris[#tris + 1] = { c1, c3, c4, r, g, b, alpha }
        end
        quad(P(u0, v0, z0), P(u1, v0, z0), P(u1, v0, z1), P(u0, v0, z1), 0.88)
        quad(P(u1, v1, z0), P(u0, v1, z0), P(u0, v1, z1), P(u1, v1, z1), 0.76)
        quad(P(u0, v1, z0), P(u0, v0, z0), P(u0, v0, z1), P(u0, v1, z1), 0.82)
        quad(P(u1, v0, z0), P(u1, v1, z0), P(u1, v1, z1), P(u1, v0, z1), 0.82)
        quad(P(u0, v0, z1), P(u1, v0, z1), P(u1, v1, z1), P(u0, v1, z1), 1.0)
        quad(P(u0, v1, z0), P(u1, v1, z0), P(u1, v0, z0), P(u0, v0, z0), 0.6)
    end
    return { tris = tris, mid = toW(w, f, f.L / 2, 0, w.h / 2), r = f.L / 2 + w.h }
end
local function drawGeo(g)
    for _, t in ipairs(g.tris) do
        local a, b, c = t[1], t[2], t[3]
        DrawPoly(a.x, a.y, a.z, b.x, b.y, b.z, c.x, c.y, c.z, t[4], t[5], t[6], t[7])
        DrawPoly(a.x, a.y, a.z, c.x, c.y, c.z, b.x, b.y, b.z, t[4], t[5], t[6], t[7])
    end
end

-- ---------- the doors in the door openings: objects of the game, hung at one side of the opening ----------
local function clearDoors(S, id)
    S.tok[id] = nil
    for _, o in ipairs(S.doors[id] or {}) do if DoesEntityExist(o) then DeleteObject(o) end end
    S.doors[id] = nil
end
local function spawnDoors(S, w)
    clearDoors(S, w.id)
    local f = frame(w); local want = {}
    for _, o in ipairs(openings(w, f.L)) do if o.type == 'door' and o.door and o.door ~= '' then want[#want + 1] = o end end
    if #want == 0 then return end
    local token = {}; S.tok[w.id] = token; local list = {}; S.doors[w.id] = list
    CreateThread(function()
        for _, o in ipairs(want) do
            local h = GetHashKey(o.door)
            if loadModel(h) then
                if S.tok[w.id] ~= token then SetModelAsNoLongerNeeded(h) return end
                local mn, mx = GetModelDimensions(h)
                local neg = math.abs(mn.x) > math.abs(mx.x); local flip = o.flip == true
                local u = (neg == flip) and o.u0 or o.u1
                local yaw = f.yaw + (flip and math.pi or 0)
                local p = toW(w, f, u, 0, -mn.z)
                local e = CreateObjectNoOffset(h, p.x, p.y, p.z, false, false, false)
                SetEntityQuaternion(e, 0.0, 0.0, math.sin(yaw / 2), math.cos(yaw / 2)); FreezeEntityPosition(e, true); SetModelAsNoLongerNeeded(h)
                list[#list + 1] = e
            end
        end
    end)
end

-- ---------- the walls of a session ----------
local function put(S, w, noDoors)
    if type(w.ops) ~= 'table' then w.ops = {} end
    S.walls[w.id] = w; S.geo[w.id] = geometry(w)
    if not noDoors then spawnDoors(S, w) end
end
local function drop(S, id) S.walls[id] = nil; S.geo[id] = nil; clearDoors(S, id) end
local function clearSession(name)
    local S = sessions[name]; if not S then return end
    for id in pairs(S.walls) do clearDoors(S, id) end
    sessions[name] = nil
end
local function listOf(S) local l = {}; for _, w in pairs(S.walls) do l[#l + 1] = clean(w) end; return l end

RegisterNetEvent('mlomurs:session', function(name, walls)
    clearSession(name)
    local S = { name = name, walls = {}, geo = {}, doors = {}, tok = {} }; sessions[name] = S
    for _, w in ipairs(walls or {}) do put(S, w) end
    if editing == name and sel and not S.walls[sel] then sel = nil end
end)
RegisterNetEvent('mlomurs:wall', function(name, w) local S = sessions[name]; if S and not (grab and grab.id == w.id) then put(S, w) end end)
RegisterNetEvent('mlomurs:removed', function(name, id) local S = sessions[name]; if S then drop(S, id); if sel == id then sel = nil end end end)

CreateThread(function()
    while not NetworkIsSessionStarted() do Wait(500) end
    TriggerServerEvent('mlomurs:hello')
end)

-- every player sees the walls of the open sessions
CreateThread(function()
    while true do
        if next(sessions) == nil then Wait(500) else
            Wait(0)
            local cp = GetFinalRenderedCamCoord()
            for _, S in pairs(sessions) do
                for _, g in pairs(S.geo) do if #(g.mid - cp) < Config.Wall.DrawDistance + g.r then drawGeo(g) end end
            end
        end
    end
end)

-- ---------- changing (each change one step of undo) ----------
local function pushUndo(u) undo[#undo + 1] = u; if #undo > 200 then table.remove(undo, 1) end end
local function change(w, noUndo, before)
    local S = editing and sessions[editing]; if not S then return end
    if not noUndo then local b = before or S.walls[w.id]; pushUndo({ id = w.id, before = b and copy(b) or false }) end
    put(S, w); TriggerServerEvent('mlomurs:set', editing, clean(w))
end
local function remove(id, noUndo)
    local S = editing and sessions[editing]; if not S or not S.walls[id] then return end
    if not noUndo then pushUndo({ id = id, before = copy(S.walls[id]) }) end
    drop(S, id); if sel == id then sel = nil end
    TriggerServerEvent('mlomurs:remove', editing, id)
end
local function doUndo()
    local u = table.remove(undo); if not u then return end
    if u.before then change(copy(u.before), true) else remove(u.id, true) end
end
local function moveWall(w, dx, dy, dz)
    local n = copy(w)
    n.a = { r3(w.a[1] + dx), r3(w.a[2] + dy) }; n.b = { r3(w.b[1] + dx), r3(w.b[2] + dy) }; n.z = r3(w.z + (dz or 0))
    return n
end
local function turnWall(w, deg)
    local n = copy(w); local mx, my = (w.a[1] + w.b[1]) / 2, (w.a[2] + w.b[2]) / 2
    local c, s = math.cos(math.rad(deg)), math.sin(math.rad(deg))
    local function rot(p) local x, y = p[1] - mx, p[2] - my; return { r3(mx + x * c - y * s), r3(my + x * s + y * c) } end
    n.a = rot(w.a); n.b = rot(w.b)
    return n
end

-- ---------- the camera, the crosshair, picking ----------
local function dirOf(rot)
    local p, y = math.rad(rot.x), math.rad(rot.z)
    return vector3(-math.sin(y) * math.cos(p), math.cos(y) * math.cos(p), math.sin(p))
end
local function worldHit(from, dir)
    local to = from + dir * 80.0
    local h = StartExpensiveSynchronousShapeTestLosProbe(from.x, from.y, from.z, to.x, to.y, to.z, -1, PlayerPedId(), 4)
    local _, hit, pos = GetShapeTestResult(h)
    if hit == 1 or hit == true then return pos end
    return nil
end
local function planeHit(from, dir, z)
    if math.abs(dir.z) < 1e-4 then return nil end
    local t = (z - from.z) / dir.z; if t <= 0 or t > 80 then return nil end
    return from + dir * t
end
local function rayBox(o, d, mn, mx)
    local t0, t1 = -1e9, 1e9
    for i = 1, 3 do
        if math.abs(d[i]) < 1e-9 then
            if o[i] < mn[i] or o[i] > mx[i] then return nil end
        else
            local a, b = (mn[i] - o[i]) / d[i], (mx[i] - o[i]) / d[i]
            if a > b then a, b = b, a end
            if a > t0 then t0 = a end
            if b < t1 then t1 = b end
            if t0 > t1 then return nil end
        end
    end
    if t1 < 0 then return nil end
    return t0 >= 0 and t0 or t1
end
local function pickWall(S, from, dir)
    local best, bt = nil, 80.0
    for id, w in pairs(S.walls) do
        local ps, f = pieces(w)
        local ox, oy = from.x - w.a[1], from.y - w.a[2]
        local lo = { ox * f.ux + oy * f.uy, ox * f.nx + oy * f.ny, from.z - w.z }
        local ld = { dir.x * f.ux + dir.y * f.uy, dir.x * f.nx + dir.y * f.ny, dir.z }
        for _, p in ipairs(ps) do
            local t = rayBox(lo, ld, { p[1], p[3], p[5] }, { p[2], p[4], p[6] })
            if t and t > 1e-4 and t < bt then best, bt = id, t end
        end
    end
    return best
end
-- an end close to the end of another wall goes onto it (so walls meet), else onto a 5 cm grid
local function snapEnd(S, x, y, free)
    local best, bd = nil, 0.2
    for _, w in pairs(S.walls) do
        for _, p in ipairs({ w.a, w.b }) do local d = math.sqrt((p[1] - x) ^ 2 + (p[2] - y) ^ 2); if d < bd then best, bd = p, d end end
    end
    if best then return { best[1], best[2] }, true end
    if free then return { r3(x), r3(y) }, false end
    return { r3(snap5(x)), r3(snap5(y)) }, false
end
local function outline(w, r, g, b)
    local f = frame(w); local t = w.t / 2
    local c = { toW(w, f, 0, -t, 0), toW(w, f, f.L, -t, 0), toW(w, f, f.L, t, 0), toW(w, f, 0, t, 0), toW(w, f, 0, -t, w.h), toW(w, f, f.L, -t, w.h), toW(w, f, f.L, t, w.h), toW(w, f, 0, t, w.h) }
    for _, e in ipairs({ { 1, 2 }, { 2, 3 }, { 3, 4 }, { 4, 1 }, { 5, 6 }, { 6, 7 }, { 7, 8 }, { 8, 5 }, { 1, 5 }, { 2, 6 }, { 3, 7 }, { 4, 8 } }) do
        local p, q = c[e[1]], c[e[2]]; DrawLine(p.x, p.y, p.z, q.x, q.y, q.z, r, g, b, 255)
    end
    for _, o in ipairs(openings(w, f.L)) do
        local q = { toW(w, f, o.u0, 0, o.z0), toW(w, f, o.u1, 0, o.z0), toW(w, f, o.u1, 0, o.z1), toW(w, f, o.u0, 0, o.z1) }
        for k = 1, 4 do local p1, p2 = q[k], q[k % 4 + 1]; DrawLine(p1.x, p1.y, p1.z, p2.x, p2.y, p2.z, 115, 215, 255, 255) end
    end
end
local function text3d(p, s)
    SetDrawOrigin(p.x, p.y, p.z, 0)
    SetTextScale(0.0, 0.32); SetTextFont(4); SetTextCentre(true); SetTextOutline(); SetTextColour(255, 255, 255, 230)
    BeginTextCommandDisplayText('STRING'); AddTextComponentSubstringPlayerName(s); EndTextCommandDisplayText(0.0, 0.0)
    ClearDrawOrigin()
end

local function panel()
    local S = editing and sessions[editing]; local w = S and sel and S.walls[sel]
    local n = 0; if S then for _ in pairs(S.walls) do n = n + 1 end end
    SendNUIMessage({ type = 'walls:state', open = editing ~= nil, name = editing, help = help, draw = drawMode, drawing = drawA ~= nil, grab = grab ~= nil, count = n,
        move = Config.MoveSteps[moveI], turn = Config.TurnSteps[turnI], undo = #undo,
        sel = w and { l = frame(w).L, h = w.h, t = w.t, tex = w.tex, ops = #(w.ops or {}) } or nil, hover = hover ~= nil and hover ~= sel })
end

-- ---------- the editor ----------
local function stop()
    if not editing then return end
    editing = nil; grab = nil; sel = nil; hover = nil; drawA = nil; drawB = nil; inspecting = false; MloWallsEditing = false
    RenderScriptCams(false, false, 0, true, true); if cam then DestroyCam(cam, false) end; cam = nil
    ClearFocus(); FreezeEntityPosition(PlayerPedId(), false); SetNuiFocus(false, false)
    SendNUIMessage({ type = 'walls:inspect', wall = false }); panel()
end

local function inspect()
    local S = editing and sessions[editing]; local w = S and sel and S.walls[sel]; if not w then return end
    inspecting = true; SetNuiFocus(true, true)
    SendNUIMessage({ type = 'walls:inspect', wall = clean(w), textures = TEXLIST })
end

local function start(name)
    if editing or not sessions[name] then return end
    if MloLiveEditing then notify("Ferme d'abord l'éditeur d'objets (" .. Config.Key .. ').', 'error') return end
    editing = name; lastName = name; undo = {}; MloWallsEditing = true; drawMode = false
    local p, r = GetGameplayCamCoord(), GetGameplayCamRot(2)
    camPos, camRot = p, vector3(r.x, 0.0, r.z)
    cam = CreateCam('DEFAULT_SCRIPTED_CAMERA', true); SetCamCoord(cam, p.x, p.y, p.z); SetCamRot(cam, r.x, 0.0, r.z, 2); SetCamFov(cam, 60.0)
    RenderScriptCams(true, false, 0, true, true); FreezeEntityPosition(PlayerPedId(), true)
    notify('Éditeur de murs : ' .. name .. '. R dessine, H montre les touches, ' .. Config.WallKey .. ' arrête.', 'success')
    CreateThread(function()
        local tick = 0
        while editing do
            Wait(0)
            DisableAllControlActions(0); EnableControlAction(0, 245, true); EnableControlAction(0, 249, true)
            local S = sessions[editing]; if not S then stop() break end
            local dir = dirOf(camRot)
            local right = vector3(math.cos(math.rad(camRot.z)), math.sin(math.rad(camRot.z)), 0.0)
            if not inspecting then
                -- look and fly
                local mx, my = GetDisabledControlNormal(0, 1), GetDisabledControlNormal(0, 2)
                camRot = vector3(math.max(-89.0, math.min(89.0, camRot.x - my * 8.0)), 0.0, camRot.z - mx * 8.0)
                dir = dirOf(camRot); right = vector3(math.cos(math.rad(camRot.z)), math.sin(math.rad(camRot.z)), 0.0)
                local sp = Config.CamSpeed * GetFrameTime() * (IsDisabledControlPressed(0, 21) and 4.0 or 1.0) * (IsDisabledControlPressed(0, 36) and 0.2 or 1.0)
                if IsDisabledControlPressed(0, 32) then camPos = camPos + dir * sp end
                if IsDisabledControlPressed(0, 33) then camPos = camPos - dir * sp end
                if IsDisabledControlPressed(0, 34) then camPos = camPos - right * sp end
                if IsDisabledControlPressed(0, 35) then camPos = camPos + right * sp end
                if IsDisabledControlPressed(0, 22) then camPos = camPos + vector3(0, 0, sp) end
                if IsDisabledControlPressed(0, 26) then camPos = camPos - vector3(0, 0, sp) end
            end
            SetCamCoord(cam, camPos.x, camPos.y, camPos.z); SetCamRot(cam, camRot.x, 0.0, camRot.z, 2); SetFocusPosAndVel(camPos.x, camPos.y, camPos.z, 0.0, 0.0, 0.0)
            DrawRect(0.5, 0.5, 0.002, 0.003, 255, 255, 255, 200)
            local free = IsDisabledControlPressed(0, 19)                 -- Alt: no snapping
            local click = not inspecting and IsDisabledControlJustPressed(0, 24)
            local back = not inspecting and (IsDisabledControlJustPressed(0, 25) or IsDisabledControlJustPressed(0, 200))

            if drawMode then
                -- drawing: click where a wall starts, click where it ends; the next wall starts there (right click ends the line, again leaves drawing)
                local hit = worldHit(camPos, dir)
                if drawA then
                    local ph = planeHit(camPos, dir, drawZ) or hit
                    if ph then
                        local b, joined = snapEnd(S, ph.x, ph.y, free)
                        if not free and not joined then          -- 15° and 5 cm steps, unless the end joins another wall
                            local dx, dy = b[1] - drawA[1], b[2] - drawA[2]; local L = math.sqrt(dx * dx + dy * dy)
                            local ang = math.floor(math.atan(dy, dx) / (math.pi / 12) + 0.5) * (math.pi / 12)
                            if L > 0.01 then b = { r3(drawA[1] + math.cos(ang) * snap5(L)), r3(drawA[2] + math.sin(ang) * snap5(L)) } end
                        end
                        drawB = b
                    end
                    if drawB then
                        local gw = { a = drawA, b = drawB, z = drawZ, h = defaults.h, t = defaults.t, tex = defaults.tex, ops = {} }
                        local L = frame(gw).L
                        if L >= 0.05 then drawGeo(geometry(gw, { 90, 230, 140 })); outline(gw, 90, 240, 150) end
                        text3d(vector3((drawA[1] + drawB[1]) / 2, (drawA[2] + drawB[2]) / 2, drawZ + defaults.h + 0.3), ('%.2f m'):format(L))
                    end
                elseif hit then
                    local p = snapEnd(S, hit.x, hit.y, free)
                    DrawLine(p[1] - 0.2, p[2], hit.z + 0.01, p[1] + 0.2, p[2], hit.z + 0.01, 90, 240, 150, 255)
                    DrawLine(p[1], p[2] - 0.2, hit.z + 0.01, p[1], p[2] + 0.2, hit.z + 0.01, 90, 240, 150, 255)
                end
                if click then
                    if not drawA then
                        if hit then drawA = snapEnd(S, hit.x, hit.y, free); drawZ = r3(hit.z); drawB = nil end
                    elseif drawB then
                        local dx, dy = drawB[1] - drawA[1], drawB[2] - drawA[2]
                        if math.sqrt(dx * dx + dy * dy) >= 0.2 then
                            local w = { id = newId(), a = drawA, b = drawB, z = drawZ, h = defaults.h, t = defaults.t, tex = defaults.tex, ops = {} }
                            change(w); sel = w.id; drawA = { drawB[1], drawB[2] }; drawB = nil
                        end
                    end
                end
                if back then if drawA then drawA = nil; drawB = nil else drawMode = false end end
            else
                -- selecting and changing
                local w = sel and S.walls[sel]
                if grab and w then
                    local hit = planeHit(camPos, dir, grab.orig.z) or worldHit(camPos, dir)
                    if hit then
                        local mx, my = (grab.orig.a[1] + grab.orig.b[1]) / 2, (grab.orig.a[2] + grab.orig.b[2]) / 2
                        local tx, ty = hit.x, hit.y; if not free then tx, ty = snap5(tx), snap5(ty) end
                        local n = moveWall(grab.orig, tx - mx, ty - my, 0); n.z = w.z
                        put(S, n, true); w = n
                    end
                    if click then change(w, false, grab.orig); grab = nil
                    elseif back then put(S, grab.orig); grab = nil end
                else
                    if not inspecting then
                        hover = pickWall(S, camPos, dir)
                        if click then sel = hover end
                        if back then sel = nil end
                    end
                end
                w = sel and S.walls[sel]
                if hover and hover ~= sel and S.walls[hover] then outline(S.walls[hover], 255, 255, 255) end
                if w then
                    outline(w, 255, 220, 60)
                    local f = frame(w); text3d(toW(w, f, f.L / 2, 0, w.h + 0.3), ('%.2f m · h %.2f m'):format(f.L, w.h))
                end
                if w and not grab and not inspecting then
                    local step = Config.MoveSteps[moveI] * (IsDisabledControlPressed(0, 21) and 0.2 or 1.0)
                    local fwd = vector3(-math.sin(math.rad(camRot.z)), math.cos(math.rad(camRot.z)), 0.0)
                    local mv = nil
                    if IsDisabledControlJustPressed(0, 172) then mv = fwd * step elseif IsDisabledControlJustPressed(0, 173) then mv = -fwd * step
                    elseif IsDisabledControlJustPressed(0, 174) then mv = -right * step elseif IsDisabledControlJustPressed(0, 175) then mv = right * step end
                    if mv then change(moveWall(w, mv.x, mv.y, 0)) end
                    if IsDisabledControlJustPressed(0, 10) then change(moveWall(w, 0, 0, step)) end
                    if IsDisabledControlJustPressed(0, 11) then change(moveWall(w, 0, 0, -step)) end
                    local turn = (IsDisabledControlJustPressed(0, 44) and 1) or (IsDisabledControlJustPressed(0, 38) and -1) or 0
                    if turn ~= 0 then change(turnWall(w, turn * Config.TurnSteps[turnI])) end
                    if IsDisabledControlJustPressed(0, 47) then grab = { id = w.id, orig = copy(w) } end
                    if IsDisabledControlJustPressed(0, 23) then
                        local f = frame(w); local d = w.t + 0.5
                        local n = moveWall(w, f.nx * d, f.ny * d, 0); n.id = newId(); n.room = nil
                        change(n); sel = n.id
                    end
                    if IsDisabledControlJustPressed(0, 73) or IsDisabledControlJustPressed(0, 178) then remove(w.id) end
                    if IsDisabledControlJustPressed(0, 191) then inspect() end
                end
            end
            if not inspecting then
                if IsDisabledControlJustPressed(0, 45) then drawMode = not drawMode; drawA = nil; drawB = nil; grab = nil end
                if IsDisabledControlJustPressed(0, 20) and #undo > 0 then doUndo() end
                if IsDisabledControlJustPressed(0, 157) then moveI = math.max(1, moveI - 1) end
                if IsDisabledControlJustPressed(0, 158) then moveI = math.min(#Config.MoveSteps, moveI + 1) end
                if IsDisabledControlJustPressed(0, 159) then turnI = math.max(1, turnI - 1) end
                if IsDisabledControlJustPressed(0, 160) then turnI = math.min(#Config.TurnSteps, turnI + 1) end
                if IsDisabledControlJustPressed(0, 74) then help = not help end
            end
            tick = tick + 1; if tick % 10 == 0 then panel() end
        end
    end)
end

-- ---------- the inspector (the panel of the selected wall) ----------
local function num(v, def) v = tonumber(v); if not v or v ~= v then return def end; return r3(v) end
RegisterNUICallback('wallsUpdate', function(data, cb)
    cb({})
    local S = editing and sessions[editing]; local cur = S and sel and S.walls[sel]; local w = data and data.wall
    if not cur or type(w) ~= 'table' or w.id ~= cur.id or type(w.a) ~= 'table' or type(w.b) ~= 'table' then return end
    local n = { id = cur.id, room = cur.room, tex = tostring(w.tex or cur.tex):lower():gsub('[^a-z0-9_]', ''),
        a = { num(w.a[1], cur.a[1]), num(w.a[2], cur.a[2]) }, b = { num(w.b[1], cur.b[1]), num(w.b[2], cur.b[2]) },
        z = num(w.z, cur.z), h = math.max(0.3, num(w.h, cur.h)), t = math.max(0.03, num(w.t, cur.t)), ops = {} }
    if n.tex == '' then n.tex = cur.tex end
    for _, o in ipairs(type(w.ops) == 'table' and w.ops or {}) do
        if type(o) == 'table' then n.ops[#n.ops + 1] = { id = tostring(o.id or newId()), type = o.type, u = num(o.u, 0), w = math.max(0.2, num(o.w, 0.9)), z0 = math.max(0, num(o.z0, 0)), z1 = math.max(0.1, num(o.z1, 2.1)), door = o.door, flip = o.flip == true } end
    end
    defaults.h, defaults.t, defaults.tex = n.h, n.t, n.tex
    change(n)
end)
-- a door model of the game in a door opening: the opening takes the door's size (2 cm round it)
RegisterNUICallback('wallsDoor', function(data, cb)
    cb({})
    CreateThread(function()
        local S = editing and sessions[editing]; local cur = S and sel and S.walls[sel]; if not cur or type(data) ~= 'table' then return end
        local m = tostring(data.model or ''):lower():gsub('[^a-z0-9_]', '')
        local n = copy(cur); local op = nil
        for _, o in ipairs(n.ops) do if o.id == data.oid then op = o end end
        if not op then return end
        if m == '' then op.door = nil
        else
            local h = GetHashKey(m)
            if not IsModelInCdimage(h) or not loadModel(h) then notify("Le jeu n'a pas de modèle " .. m .. '.', 'error') return end
            local mn, mx = GetModelDimensions(h); SetModelAsNoLongerNeeded(h)
            op.door = m; op.w = r3(mx.x - mn.x + 0.02); op.z0 = 0; op.z1 = r3(math.min(n.h, mx.z - mn.z + 0.02))
        end
        change(n)
        if inspecting then SendNUIMessage({ type = 'walls:inspect', wall = clean(n), textures = TEXLIST }) end
    end)
end)
RegisterNUICallback('wallsDelete', function(_, cb) cb({}); if sel then remove(sel) end; inspecting = false; SetNuiFocus(false, false) end)
RegisterNUICallback('wallsClose', function(_, cb) cb({}); inspecting = false; SetNuiFocus(false, false) end)

-- ---------- with MLO Creator, through the clipboard ----------
RegisterNUICallback('wallsPaste', function(data, cb)
    cb({}); SetNuiFocus(false, false)
    local name = editing or lastName; if not name or not sessions[name] then return end
    local ok, d = pcall(json.decode, tostring(data and data.text or ''))
    if not ok or type(d) ~= 'table' or d.mlocreator ~= 'walls' or type(d.walls) ~= 'table' then notify("Ce texte ne vient pas de MLO Creator (bouton « Copier les murs pour FiveM »).", 'error') return end
    undo = {}; sel = nil
    TriggerServerEvent('mlomurs:import', name, d.walls)
end)
RegisterNUICallback('wallsCancel', function(_, cb) cb({}); SetNuiFocus(false, false) end)

RegisterNetEvent('mlomurs:edit', function(name) start(name) end)
RegisterNetEvent('mlomurs:closed', function(name) if editing == name then stop() end; clearSession(name) end)

RegisterCommand('mlomurs', function(_, args)
    local a = tostring(args[1] or ''):lower()
    if a == '' then notify('Usage : /mlomurs <projet> · /mlomurs copier · /mlomurs coller · /mlomurs fermer', 'info') return end
    if a == 'fermer' or a == 'close' then
        if lastName then local n = lastName; stop(); TriggerServerEvent('mlomurs:close', n) end
    elseif a == 'copier' or a == 'copy' then
        local S = lastName and sessions[lastName]
        if not S then notify("Ouvre d'abord un projet : /mlomurs <projet>", 'error') return end
        SendNUIMessage({ type = 'walls:copy', text = json.encode({ mlocreator = 'walls', v = 1, project = lastName, walls = listOf(S) }) })
    elseif a == 'coller' or a == 'paste' then
        if not lastName or not sessions[lastName] then notify("Ouvre d'abord un projet : /mlomurs <projet>", 'error') return end
        SetNuiFocus(true, true); SendNUIMessage({ type = 'walls:paste' })
    else
        TriggerServerEvent('mlomurs:open', a)
    end
end, false)
RegisterCommand('mlomurs_toggle', function() if editing then stop() elseif lastName and sessions[lastName] then start(lastName) end end, false)
RegisterKeyMapping('mlomurs_toggle', Config.Locale == 'fr' and 'Éditeur de murs de MLO Creator activé / désactivé' or 'MLO Creator wall editor on / off', 'keyboard', Config.WallKey)

AddEventHandler('onResourceStop', function(r)
    if r ~= GetCurrentResourceName() then return end
    stop(); for name in pairs(sessions) do clearSession(name) end
end)
