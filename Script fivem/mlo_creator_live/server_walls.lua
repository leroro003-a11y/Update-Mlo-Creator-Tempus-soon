-- MLO Creator live, the wall editor (server): keeps the walls drawn in the game for each project (data/<name>.walls.json), checks the changes of the
-- players allowed to edit and sends them to every player. The walls are in the world's frame; MLO Creator turns them into its interior's frame when you
-- paste them there (Walls panel: "Coller les murs de FiveM").
local resource = GetCurrentResourceName()
local sessions = {}          -- name -> { id -> wall }
local saveSoon = {}
local MAX_WALLS, MAX_OPS = 400, 16

local function allowed(src) return src == 0 or IsPlayerAceAllowed(src, Config.Ace) end
local function clean(name) return (tostring(name or ''):lower():gsub('[^a-z0-9_]', '')) end
local function tell(src, text, kind) if src and src > 0 then TriggerClientEvent('mlolive:notify', src, text, kind or 'info') end end
local function num(v, lo, hi, def)
    v = tonumber(v); if not v or v ~= v or v == math.huge or v == -math.huge then return def end
    if v < lo then v = lo elseif v > hi then v = hi end
    return math.floor(v * 1000 + 0.5) / 1000
end
local function ident(v, max) local s = (tostring(v or ''):gsub('[^%w_%-]', '')); if s == '' then return nil end; return s:sub(1, max) end

-- a wall as the game may keep it: { id, a = {x, y}, b = {x, y}, z, h, t, tex, room, ops = { { id, type, u, w, z0, z1, door, flip } } }
local function cleanWall(w)
    if type(w) ~= 'table' or type(w.a) ~= 'table' or type(w.b) ~= 'table' then return nil end
    local id = ident(w.id, 24); if not id then return nil end
    local out = {
        id = id,
        a = { num(w.a[1], -20000, 20000, 0), num(w.a[2], -20000, 20000, 0) },
        b = { num(w.b[1], -20000, 20000, 0), num(w.b[2], -20000, 20000, 0) },
        z = num(w.z, -500, 3000, 0), h = num(w.h, 0.3, 30, 2.6), t = num(w.t, 0.03, 2, 0.12),
        tex = ident(w.tex, 48) or 'plaster_white', ops = {}
    }
    if type(w.room) == 'number' and w.room >= -2 and w.room < 1000 then out.room = math.floor(w.room) end
    local dx, dy = out.b[1] - out.a[1], out.b[2] - out.a[2]
    local L = math.sqrt(dx * dx + dy * dy); if L < 0.2 or L > 200 then return nil end
    if type(w.ops) == 'table' then
        for _, o in ipairs(w.ops) do
            if #out.ops >= MAX_OPS then break end
            if type(o) == 'table' and (o.type == 'door' or o.type == 'window' or o.type == 'pass') then
                local oid = ident(o.id, 24)
                if oid then
                    local op = { id = oid, type = o.type, u = num(o.u, 0, L, L / 2), w = num(o.w, 0.2, L, math.min(0.9, L)), z0 = num(o.z0, 0, out.h, 0), z1 = num(o.z1, 0.1, out.h, math.min(2.1, out.h)), flip = o.flip == true }
                    if o.type == 'door' and type(o.door) == 'string' then local d = (o.door:lower():gsub('[^a-z0-9_]', '')); if d ~= '' then op.door = d:sub(1, 80) end end
                    out.ops[#out.ops + 1] = op
                end
            end
        end
    end
    return out
end

local function listOf(name) local l = {}; for _, w in pairs(sessions[name] or {}) do l[#l + 1] = w end; return l end
local function load(name)
    local s = {}
    local raw = LoadResourceFile(resource, 'data/' .. name .. '.walls.json')
    if raw then
        local ok, d = pcall(json.decode, raw)
        if ok and type(d) == 'table' and type(d.walls) == 'table' then for _, w in ipairs(d.walls) do local c = cleanWall(w); if c then s[c.id] = c end end end
    end
    return s
end
local function save(name)
    if not sessions[name] then return end
    SaveResourceFile(resource, 'data/' .. name .. '.walls.json', json.encode({ mlocreator = 'walls', v = 1, project = name, walls = listOf(name) }), -1)
end
local function saveLater(name)
    if saveSoon[name] then return end; saveSoon[name] = true
    SetTimeout(1500, function() saveSoon[name] = nil; save(name) end)
end
local function send(target, name) TriggerLatentClientEvent('mlomurs:session', target, 200000, name, listOf(name)) end
local function count(name) local n = 0; for _ in pairs(sessions[name] or {}) do n = n + 1 end; return n end

RegisterNetEvent('mlomurs:open', function(name)
    local src = source; name = clean(name)
    if not allowed(src) then tell(src, "Tu n'as pas le droit d'utiliser l'éditeur de murs (" .. Config.Ace .. ').', 'error') return end
    if name == '' then tell(src, 'Usage : /mlomurs <projet>', 'error') return end
    if not sessions[name] then sessions[name] = load(name) end
    send(-1, name)
    TriggerClientEvent('mlomurs:edit', src, name)
end)

RegisterNetEvent('mlomurs:set', function(name, wall)
    local src = source; name = clean(name); local s = sessions[name]
    if not s or not allowed(src) then return end
    local w = cleanWall(wall); if not w then return end
    if not s[w.id] and count(name) >= MAX_WALLS then tell(src, 'Trop de murs dans ce projet (' .. MAX_WALLS .. ' au plus).', 'error') return end
    s[w.id] = w; saveLater(name)
    TriggerClientEvent('mlomurs:wall', -1, name, w)
end)

RegisterNetEvent('mlomurs:remove', function(name, id)
    local src = source; name = clean(name); local s = sessions[name]
    if not s or not allowed(src) then return end
    id = ident(id, 24); if not id or not s[id] then return end
    s[id] = nil; saveLater(name)
    TriggerClientEvent('mlomurs:removed', -1, name, id)
end)

-- every wall at once: what MLO Creator copied ("Copier les murs pour FiveM"), pasted in the game with /mlomurs coller
RegisterNetEvent('mlomurs:import', function(name, walls)
    local src = source; name = clean(name)
    if not sessions[name] or not allowed(src) or type(walls) ~= 'table' then return end
    local s, n = {}, 0
    for _, w in ipairs(walls) do if n >= MAX_WALLS then break end; local c = cleanWall(w); if c then s[c.id] = c; n = n + 1 end end
    sessions[name] = s; save(name); send(-1, name)
    if Config.Locale == 'fr' then
        tell(src, n .. (n == 1 and ' mur collé dans « ' or ' murs collés dans « ') .. name .. ' ».', 'success')
    else
        tell(src, n .. (n == 1 and ' wall pasted into “' or ' walls pasted into “') .. name .. '”.', 'success')
    end
end)

RegisterNetEvent('mlomurs:close', function(name)
    local src = source; name = clean(name); if not allowed(src) or not sessions[name] then return end
    save(name); sessions[name] = nil
    TriggerClientEvent('mlomurs:closed', -1, name)
    tell(src, 'Murs de "' .. name .. '" fermés et sauvegardés.', 'success')
end)

RegisterNetEvent('mlomurs:hello', function() local src = source; for name in pairs(sessions) do send(src, name) end end)
AddEventHandler('onResourceStop', function(r) if r == resource then for name in pairs(sessions) do save(name) end end end)
