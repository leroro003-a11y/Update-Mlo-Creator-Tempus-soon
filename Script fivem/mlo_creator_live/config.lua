Config = {}

-- Language for the in-game editor: set to 'en' or 'fr'.
Config.Locale = 'en'

-- Language for the in-game editor: set to 'en' or 'fr'.
Config.Locale = 'fr'

-- who may edit: players with this ace (server.cfg: add_ace group.admin mlocreator.live allow)
Config.Ace = 'mlocreator.live'

-- the key that starts and stops the editor once a session is open (each player can change it in the game's key settings)
Config.Key = 'F7'

-- steps: moving (metres) and turning (degrees); 1 / 2 change the move step, 3 / 4 the turn step in the game
Config.MoveSteps = { 0.01, 0.05, 0.1, 0.25, 0.5, 1.0 }
Config.TurnSteps = { 1, 5, 15, 45, 90 }

-- the free camera: metres per second, Shift faster, Ctrl slower
Config.CamSpeed = 6.0

-- objects bigger than this (metres across) are pieces of the building and cannot be picked in the game (change them in MLO Creator)
Config.MaxPick = 8.0

-- the wall editor (/mlomurs <projet>): the key that stops and starts it, and what a new wall gets (the inspector, Enter, changes them)
Config.WallKey = 'F6'
Config.Wall = { Height = 2.6, Thickness = 0.12, Texture = 'plaster_white', DrawDistance = 120.0 }
