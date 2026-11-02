-- MLO Creator live editor, the server: keeps the open sessions (a project MLO Creator sent: data/<name>.json), takes the changes of the players allowed to
-- edit, writes them back into the file (MLO Creator takes them from there) and sends them to every player, so everyone sees the same.
local resource = GetCurrentResourceName()
local sessions = {}          -- name -> the session (its entities with their place in the world)
local saveSoon = {}

local function allowed(src) return src == 0 or IsPlayerAceAllowed(src, Config.Ace) end
local function clean(name) return (tostring(name or ''):lower():gsub('[^a-z0-9_]', '')) end
local function tell(src, text, kind) if src and src > 0 then TriggerClientEvent('mlolive:notify', src, text, kind or 'info') end end

local function load(name)
    local raw = LoadResourceFile(resource, 'data/' .. name .. '.json'); if not raw then return nil end
    local ok, s = pcall(json.decode, raw); if not ok or type(s) ~= 'table' or type(s.entities) ~= 'table' then return nil end
    local valid = {}
    s.byId = {}
    for _, e in ipairs(s.entities) do
        if type(e) == 'table' and type(e.id) == 'string' and #e.id > 0 and #e.id <= 40 and type(e.n) == 'string' and #e.n > 0 and #e.n <= 80 then
            e.n = e.n:lower():gsub('[^a-z0-9_]', '')
            if e.n ~= '' then valid[#valid + 1] = e; s.byId[e.id] = #valid end
        end
    end
    s.entities = valid
    return s
end
local function save(name)
    local s = sessions[name]; if not s then return end
    local byId = s.byId; s.byId = nil
    SaveResourceFile(resource, 'data/' .. name .. '.json', json.encode(s), -1)
    s.byId = byId
end
local function saveLater(name)
    if saveSoon[name] then return end; saveSoon[name] = true
    SetTimeout(1500, function() saveSoon[name] = nil; save(name) end)
end
local function send(target, name)
    local s = sessions[name]; if not s then return end
    local byId = s.byId; s.byId = nil
    TriggerLatentClientEvent('mlolive:session', target, 250000, name, s)
    s.byId = byId
end

-- open (or open again, after MLO Creator sent a new version: /mlolive name reload)
RegisterNetEvent('mlolive:open', function(name, again)
    local src = source; name = clean(name)
    if not allowed(src) then tell(src, 'You may not use the MLO Creator live editor (' .. Config.Ace .. ').', 'error') return end
    if name == '' then tell(src, 'Usage: /mlolive <project name>  (the name MLO Creator shows when it sends a project)', 'error') return end
    if again or not sessions[name] then
        local s = load(name)
        if not s then tell(src, 'There is no project "' .. name .. '" in ' .. resource .. '/data. Send it from MLO Creator first.', 'error') return end
        if sessions[name] then TriggerClientEvent('mlolive:closed', -1, name) end
        sessions[name] = s
    end
    send(-1, name)
    TriggerClientEvent('mlolive:edit', src, name)
end)

-- changes: a list of entities (their id and the fields that changed; a new one has n, its model)
RegisterNetEvent('mlolive:change', function(name, list)
    local src = source; name = clean(name); local s = sessions[name]
    if not s or not allowed(src) or type(list) ~= 'table' then return end
    local ok = {}
    for _, u in ipairs(list) do
        if type(u) == 'table' and type(u.id) == 'string' and #u.id > 0 and #u.id <= 40 then
            local i = s.byId[u.id]
            if not i then
                if type(u.n) == 'string' and #u.n > 0 and #u.n <= 80 then
                    local model = u.n:lower():gsub('[^a-z0-9_]', '')
                    if model ~= '' then s.entities[#s.entities + 1] = { id = u.id, n = model, game = false }; i = #s.entities; s.byId[u.id] = i end
                end
            end
            if i then
                local e = s.entities[i]
                for _, k in ipairs({ 'x', 'y', 'z', 'qx', 'qy', 'qz', 'qw' }) do if type(u[k]) == 'number' then e[k] = u[k] end end
                if u.del ~= nil then e.del = u.del == true end
                e.live = true; ok[#ok + 1] = u
            end
        end
    end
    if #ok == 0 then return end
    s.dirty = true; saveLater(name)
    TriggerClientEvent('mlolive:changed', -1, name, ok, src)
end)

RegisterNetEvent('mlolive:close', function(name)
    local src = source; name = clean(name); if not allowed(src) or not sessions[name] then return end
    save(name); sessions[name] = nil
    TriggerClientEvent('mlolive:closed', -1, name)
    tell(src, 'Live project "' .. name .. '" closed; its changes are saved for MLO Creator.', 'success')
end)

-- a player who joins (or whose client restarts) sees the open sessions
RegisterNetEvent('mlolive:hello', function()
    local src = source
    for name in pairs(sessions) do send(src, name) end
    TriggerClientEvent('mlolive:allowed', src, allowed(src))
end)

AddEventHandler('onResourceStop', function(r) if r == resource then for name in pairs(sessions) do save(name) end end end)
