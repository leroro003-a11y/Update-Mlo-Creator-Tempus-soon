# How MLO Creator works

This is the reference for what each part of the program does and how it is built. The README covers installing and running it.

## Contents

1. [Architecture](#architecture)
2. [The window](#the-window), [Project types](#project-types), [Buildings of the game](#buildings-of-the-game)
3. [Workflow for an interior in an imported model](#workflow-for-an-interior-in-an-imported-model)
4. [Coordinates](#coordinates)
5. [Cutting the model and its collision](#cutting-the-model-and-its-collision)
6. [Doors and windows](#doors-and-windows)
7. [Props and plants](#props-and-plants)
8. [Several buildings in one project](#several-buildings-in-one-project)
9. [Export](#export)
10. [Limits](#limits)
11. [Whole new building](#whole-new-building)
12. [Controls](#controls)
13. [Code map](#code-map)

## Architecture

- `MloCreator.exe` is a C# 5 program (.NET Framework, built with the `csc.exe` that ships with Windows). It starts a small HTTP server on `127.0.0.1` with a random token and serves the editor from `ui\` on disk.
- The editor is a WebGL page. It is shown in a native window (`AppWindow.cs`, WinForms with Microsoft's WebView2). If WebView2 is missing it falls back to an Edge or Chrome `--app` window; `logs\window.log` says why.
- The page keeps the project (a JSON file in `projects\`), runs all the editing tools, builds the interior's meshes and collision, and sends a description of the result to the host on Export.
- The host does everything that needs game files: reading `.ydr`, `.yft`, `.ybn`, `.ytd`, `.ytyp`, `.ymap` and the game's archives through CodeWalker's library, cutting models and collision, and writing the resource.
- The window closes the program; unsaved work is saved first. Projects also autosave.

Because the UI is served from disk, a change in `ui\` only needs a reload of the page; a change in `src\` needs a rebuild.

## The window

Every kind of project uses the same layout round the 3D view:

- **Top:** the workflow as numbered steps (for example *Import → Build → Paint → Export*). A green tick means the must-dos of that step are done. On the right: undo and redo, save, new project, *Projects* and *Export*.
- **Tool rail (far left):** one button per job, with its name under the icon. For an imported model: *Select*, *Building* (select building, grid, raise / lower), *Rooms* (add room, cut out, partition, fill gaps, stairs), *Openings* (door, window, archway, models), *Clean up* (faces, parts, holes, props and plants, collision), *Furnish* (furniture, lights, floor paint) and *Check* (walk check, scale figure). Hovering a button lists its tools and their keys; the keys work as before.
- **Tool panel (next to the rail):** only the chosen job. Its tools are chips at the top, then what the tool does, *How to use it*, *More about it*, the tool's own options and, at the bottom, the *Next step* card with *All steps*.
- **View bar (over the 3D view):** how the model is drawn (Off / Ghost / Solid), cutaway, grid, collision, top-down and frame. *…* opens all view options in the inspector.
- **Inspector (right):** *Selected* shows what is selected and opens by itself when you select something; *Scene* lists the buildings, floors, openings and rooms (in a game interior: the rooms, all objects, the deleted ones and the entity sets); *Project* has the view options, collision, clearing the model, show / hide, walls and ceiling and the numbers (in a game interior: export, the live editor and where it is in the game).
- **Status bar (bottom):** the floor you work on (a list to switch it) and what is in it on the left; the triangle count and *Help* on the right. The key hints for the active tool stay just above it.

## Project types

- **Interior in an imported model.** Import the files of a building, cut openings, draw rooms, finish, export. This is the main workflow and is described below.
- **Whole new building.** Build a house on a grid with walls, rooms, doors, windows, stairs, levels and a roof.
- **Interior for an existing house (older).** Projects made with the early automatic mode still open and export as they did.

## Buildings of the game

*New project → Building of the game* finds a building of GTA V and shows what the game has there; *Open in the editor* on an interior makes it a project of its own (see [A game interior in the editor](#a-game-interior-in-the-editor)).

- **Search** by a place's name in English or German (`lspd`, `pillbox`, `city hall`, `government`, `krankenhaus`, `feuerwehr`...), by an interior's name or its rooms (`v_hospital`, `police`), or by a point (`441 -982`, everything within 100 m).
- **Index.** The first search reads every map file of the game and lists every interior (MLO) it places, with the map types file that defines it, its rooms, objects, portals and entity sets. It is kept in `cache\mlo_index.txt` and built again when the game changes (about a minute).
- **Places.** `Buildings.Places` in `src\Buildings.cs` is the list of well-known places: a name, the words that find it, the middle of the building and how far round it to look. An interior belongs to the nearest place, so the sheriff next to Sandy Shores' medical center is not shown as the hospital. Words match by their start, so `polic` finds every police station.
- **Results.** A place's own interiors come first, nearest first. Tunnels (metro, road tunnels, underpasses) and interiors far under the map (the game's scripted ones, such as the mugshot room) are folded away under *Show more*. Two interiors at the same spot (the game's and a DLC's version, such as `v_policehub` and `hei_heist_police_dlc` at Mission Row) are pointed out; the game shows one of them.
- **No interior.** Where the game has none of its own (both city halls, most hospitals), the result says so and lists the building's models (the big models whose box covers the place, biggest file first, without lights, decals and ground). An interior can be built into such a building with *Interior in an imported model*.
- **Probe.** `MloCreator.exe --buildings <words>` prints what a search finds.

### A game interior in the editor

A project of the kind *Building of the game* holds an interior as the game defines it (`project.game`), read from its map types file (`Buildings.Interior`): its rooms, portals, objects (model, position, turn, size, room, entity set, flags, LOD distance) and entity sets, all in the interior's own frame, and where the interior stands in the world. A room object's rotation is stored in the file as the inverse of its turn; the project keeps the real turn.

- **Models.** When the project opens, the models of its objects are read from the game, twelve at a time (`buildings/models`), with their textures at 128 px at most and each texture sent once. Fragments (`.yft`: monitors, fire extinguishers, other props that break or move) are read like plain models. The first opening of an interior takes about 20 seconds; the program keeps the models while it runs. A model the program cannot read (cloth, a destruction model) is listed on the right as not shown.
- **View.** Every object is a part of its own, turned and moved to where it stands. Glass is see-through; decals and cut-out textures use their alpha; dirt and shadow decals (masks, not pictures) are left out. The view starts cut away 2.3 m over the floor of the room with the most objects, since the ceilings hide everything from above; *Cutaway* on the right sets the height. Portals are drawn in blue.
- **Rooms.** The list on the left shows each room and its objects; a room chosen there is outlined, and *Show only the chosen room's objects* hides the rest. The room boxes are made from the boxes of each room's objects, because the boxes in the game's files often do not match where the objects stand (Mission Row's).
- **Objects.** Click one in the view or in the list (inspector, *Scene*): the inspector's *Selected* tab shows its model, room, entity set, position in the interior and in the world, heading, size, model size, LOD distance and flags. F looks at it, H hides it from the view (only the view), Alt+H shows all again.
- **Entity sets** (groups the game switches on with a script, such as Pillbox's open or shut doors) are off until ticked.
- **Changing objects.** Drag the selected object to move it on the level where you grabbed it (5 cm steps, Shift: free); PageUp / PageDown raise and lower it 5 cm (Shift: 1 cm); R turns it 90°, Shift+R 15° (about the vertical, a tilted object keeps its tilt); Shift+D copies it half a metre aside; X deletes it. The right panel has X, Y, Z, heading and the room it belongs to (an object is drawn in the game only when its room is). Every change is one step of Ctrl+Z. Deleted objects are listed under *Deleted* with *Restore*. The list marks objects as *changed* or *added*.
- **Adding objects.** *Add an object* searches the game's props like the furniture search (English and German words); choose one and click where it goes: it stands on the face you click, turned by R, in the room whose box holds the point.
- **Export.** *Export resource* (inspector, *Project* tab) writes a resource into the output folder of the settings, or the folder given there: `stream/<the interior's .ytyp>` replaces the game's file of that name, `fxmanifest.lua`, and a README with the changes and the test spot. The game's file is read as CodeWalker's XML and only the interior's objects, the objects of its rooms and portals and its entity sets are written again: an object from the game keeps its own entry (lights and other extensions stay), a copy gets a new guid, an added prop is a new entry with the model's own draw distance. The written file is read back before it is kept: when the interior's object count does not match, nothing is exported. Props of the game's own interiors among the added ones bring their map types file along (`DLC_ITYP_REQUEST`).
- **New walls.** *Walls* in the tool rail → *Draw walls*: press on the floor where a wall starts and drag to where it ends. It stands on what you pressed on, in 15° and 5 cm steps (Shift: free), and an end near the end of another new wall joins it. Height, thickness and texture (the program's own textures) are set before drawing and for each wall afterwards; the room it belongs to is the one whose box holds its middle. Click a new wall to select it: drag it to move it, X deletes it, the right panel has its height, thickness, foot, length, texture, room and *Flip*.
- **Doors, windows and passages in new walls.** *+ Door*, *+ Window*, *+ Passage* cut an opening in the middle of the selected wall; the panel sets where it is along the wall, its width, sill and top. A door opening takes a door model of the game (*Choose a door*: every model whose name says door or gate, the interior doors `v_ilev_...` first; search `ph` for the police doors): the opening takes the door's size, the door is hung at one side of it (*Hang it the other way* turns it round), and it is exported as an object of the interior, a real door of the game that swings when pushed. A window gets a glass pane.
- **How new walls are exported.** The walls of one room become one model (`<prefix>walls<room>.ydr`) with their textures (`<prefix>tex.ytd`) and their collision built into the model as boxes, one for each piece of wall (beside, over and under each opening, and each window pane). The model is defined in the replaced map types file like the game's own fixed furniture with built-in collision (archetype flags `0x20000000`, a physics dictionary of its own name) and placed in its room at the interior's origin, so the interior's own collision files stay as they are.
- **The building round the interior.** *The building → Load the building* reads the objects the game's map files place round the interior (its box and 6 m round it; a big model that stands up to 80 m away counts when its box reaches in): the building's own models, its parts and decals, the ground, the props round it, full detail only. They are listed as the room *The building (outside)*, can be hidden (*Show the building*), and are moved, turned, copied and deleted like the interior's objects (added props go into the interior). The export writes every map file that places a changed one again (`stream/<map file>.ymap`, a DLC's copy of the file too): moved ones get their new place back in the world, deleted ones are taken out, copies are added at the end; everything else in the file stays. Only full detail map files are read, so the game's lower detail copies of the building (seen from afar) are not changed. *Remove unchanged* takes the objects you did not change out of the project again.
- **Changing the game's own models.** A selected object (of the interior or of the building) has *Its model* in the inspector's *Selected* tab:
  - *Cut a door / a window / a passage*, then click the object's wall: an opening of the usual size there, standing on the floor under the spot (looking down past furniture: the first face turned up of a model 6 m or more across), from 10 cm in front of the wall to 10 cm behind its back (the first face of the model behind it, up to 2 m). With *Cut through every model at the spot* the same opening goes through every other model with a face turned like the wall within that depth (the wall's decals and dirt, the building's outside), not through the furniture in front of it. Width, height, bottom and depth are in the panel; the openings made together change together. *Make a portal here* puts a portal into it.
  - *Pick faces*: a click takes the flat patch round the face (connected faces turned the same way), Shift adds or takes away, X takes them out.
  - *Parts*: one per texture of the model; *Remove* takes a whole part out, the list next to it gives it a texture of the program (its faces get texture coordinates in metres from their place).
  - The changes act on every object of the project that shows the model. The view shows the model as the host cuts it (`buildings/model-edit`). Models that break or move (`.yft`) can only be moved, turned and deleted.
  - The export writes each changed model under a name of its own (`<prefix><model>.ydr`; a new texture is put into the model), defines it in `stream/<prefix>models.ytyp` (the original's entry, renamed; loaded with `DLC_ITYP_REQUEST`), and points only the project's objects at it, in the interior's file and in the building's map files: the same model elsewhere in the world stays as it was.
  - The openings also cut the collision: the interior's own files (`<interior>.ybn`, `hi@<interior>.ybn`, and those of the interior at the same spot) in the interior's frame, and the map's collision files of the area round it (`dt1_19_0.ybn`, `hi@`, `ma@`, the DLC's `hei_` copies) whose box the openings reach, in the world. Each changed collision file replaces the game's.
- **Collision of removed objects.** Many props carry their collision in their model (a chair, a door, a fragment): it goes with them. The fixed pieces of an interior or a building (a counter, shelves, the building's parts) have theirs in the collision files of the interior or of the map, which stays where they stood. So the export cuts that collision away where an object without its own collision stood when it was deleted, moved or turned: in the interior's files for the interior's objects, in the map's files for the building's. The box is the model's, 2 cm smaller on the sides and 3 cm higher at the bottom so the floor and the walls next to it stay; models bigger than 15 m are left (cutting that much would leave holes). At its new place (and for an added or copied object without collision of its own) the export makes collision from the model's shape (see Furniture, *Collision*) into `stream/<prefix>propcol.ybn`, a collision file of the resource in the world.
- **Live in FiveM.** The live editor (`fivem\mlo_creator_live`, a FiveM resource) changes the objects in the game on your server, together with the project (Export panel, *Live in FiveM*):
  - *Install the live editor* copies the resource into the output folder (the server's `resources`; its sessions in `data\` stay). In `server.cfg`: `ensure mlo_creator_live` and `add_ace group.admin mlocreator.live allow` (only players with that ace edit; everyone sees the changes).
  - *Send to FiveM* gives every object an id (`lid`) and writes the project into `data\<name>.json`: every object with its place in the world and, for the game's own, where the game has it. A session the game changed and the project has not taken is not overwritten (*Take them* or *Send anyway*).
  - In the game: `/mlolive <name>` opens it and starts the editor (F7 stops and starts it; `/mlolive <name> reload` after sending again; `/mlolive close`). A free camera (mouse, WASD, Space / C, Shift / Ctrl); the crosshair picks an object (pieces bigger than 8 m are the building's and are left to MLO Creator); arrows move it along the view, PageUp / PageDown up and down, Q / E turn, G holds it at the crosshair until a click, F copies, X / Del deletes or brings back, B adds a prop of the game, Z undoes, 1 / 2 and 3 / 4 change the steps, H shows the keys.
  - It is a preview: a game object moved or deleted is hidden where it stands (a model hide), the moved, copied and added ones stand as objects of their own; every change is saved into the session file at once and sent to every player.
  - *Take the changes from FiveM* puts them into the project: moved and turned objects, deleted ones (and back), copies and added props (in the room whose box holds them). Export as usual for the finished interior. Model changes, walls, rooms, portals and collision are made here.
- **New rooms and portals.** *+ Draw new room* (*Rooms* in the tool rail): drag a rectangle on the floor; the room is 3 m high (its height can be typed), named NEW_ROOM_1 and so on, and is the box it was drawn as. Objects and new walls go into it with their *Room* field. A portal comes from an opening (*Make a portal here* on a cut in a model or on an opening of a new wall), between the rooms on its two sides (change them in the list). The export adds the rooms (a copy of a room of the game for the time cycle and settings) and the portals to the interior and counts every room's portals again. A new room can only be removed when nothing is in it and no portal leads to it, the newest first.
- **Not yet:** filling a hole (only openings and taking faces out), and changing the building's lower detail copies seen from afar.
- **Two interiors at one spot.** At Mission Row the game places `v_policehub` and the heist DLC's `hei_heist_police_dlc`; only one of them shows in the game (usually the DLC one). The project remembers the other one and the export and its README say so: make the changes in the one the game shows.
- **One resource per file.** Only one resource can replace a given `.ytyp`; another interior mod that ships the same file conflicts with the export.
- **Probes.** `MloCreator.exe --interior <ytyp> <hash>` reads an interior and all its models and says which fail. `MloCreator.exe --export-probe <ytyp> <hash> <folder>` moves the first object 1 m, deletes the second, adds a chair, exports into the folder and checks the written file.

### An MLO resource opened again

*Open an MLO resource...* (in the window *Building of the game*) opens a finished MLO to change it: a FiveM resource folder whose `stream` folder holds the interior's `.ytyp`, the `.ymap` that places it, its models, textures and collision (`src\ResourceMlo.cs`).

- **Opening.** Pick the resource's folder (its `stream` folder works too: the folder above with `fxmanifest.lua` is taken). Every interior (MLO archetype) its `.ytyp` files define is listed with where its `.ymap` files place it; one that changes an interior of the game (a `v_int_66.ytyp` of its own) stands where the game places it. *Open in the editor* makes it a project of the kind *Building of the game*, and everything above works on it: objects, the building round it, new walls, openings, faces, parts, textures, rooms, portals, live in FiveM.
- **Its files first.** While such a project is open, the resource's files (`.ydr`, `.yft`, `.ytd`, `.ytyp`, `.ymap`, `.ybn`, in any folder under it) come before the game's of the same name (`Vanilla.UseResource`): its own models and textures are shown, its own archetypes are found, and what it does not have (props of the game) comes from the game. Models whose vertices CodeWalker keeps as `Data2` (some exporters write them so) are read too.
- **Encrypted resources** (FiveM's asset escrow, a `.fxap` file) cannot be opened: only the server can read their files. A file that is not a readable game file is named in the error.
- **The snapshot.** When the project opens the interior, the resource's `.ytyp`, `.ymap` and `.ybn` files are copied into `cache\resource_snapshots\<resource>_<time>` (the project keeps the folder as `game.snap`). Every export of the project starts from that copy, so saving twice does not move, delete or cut anything twice. Do not delete the folder while the project is in use; open the resource again for a new project that starts from its saved state.
- **Saving.** *Save into the resource* (inspector, *Project* tab) first zips the whole resource folder next to it (`<resource>_backup_<date>_<time>.zip`; unzip it to go back), then writes the changes into the resource: the interior's `.ytyp`, the map files and collision files it changes, each where it is in the resource (a file of the game it changes goes into `stream/`). Changed models, new walls and their textures are written into `stream/` under the resource's prefix as above; `fxmanifest.lua` gets the `data_file` lines they need at its end (only the missing ones), and its own lines and README stay. The files a save adds are listed in the snapshot's `made.txt`; the project's next save takes them out first and makes them again. A later project that adds new walls gets a prefix of its own (`<prefix>2_`), and a later `<prefix>models.ytyp` keeps the models of the earlier ones.
- **Licences.** The resource's author's licence applies: changing a bought MLO for your own server is usually allowed, passing it on often is not.
- **Not read:** props in another resource (open that one, or copy its files into this one), and props the resource's own map files place outside the interior.

## Workflow for an interior in an imported model

The Build tab shows a route of nine stages that open like dropdowns; a card above it says how far along you are and what to do next.

1. **Import the model.** Add `.ydr`, `.ytd`, `.ybn` and `.ymap` files, or look them up in the game files. The biggest `.ydr` is the model. Say where the model stands in the game (take it from an imported `.ymap`, look it up, or type x, y, z and heading).
2. **Set up the building.** A model is often a whole block. *Select building* finds the separate objects of the model (vertices that coincide belong together), hides the rest, squares the grid to its walls and moves the camera to it. *Frame* squares the grid to a wall you click; Shift+click sets the floor height, Alt+click moves the corner.
3. **Draw the rooms.** *Add room* drags a rectangle (floor, walls, ceiling); *Cut out* removes a rectangle; *Partition* draws an inner wall; *Select* edits any of them with handles. Edges snap to the model's walls and to 5 cm. *Fit rooms to the walls* snaps every room edge to the building's wall faces. *Create the rooms automatically* (Add room panel, or the Rooms list) does it in one click, see [Rooms in one click](#rooms-in-one-click).
4. **Doors and windows.** Door, Window and Archway tools cut through the model; the Models tool places door and window models from your own `.glb` files.
5. **Clean up the model.** Delete faces, model parts, edges (fill holes), collision pieces, and your own collision boxes. The model's parts that stick into the rooms are cleared automatically.
6. **Props and small removals.** Bushes, trees and other props the map places around the building, and small pieces of the model.
7. **Finish the inside.** Floor and wall paint, ceiling lights, furniture of the game and your own props. *+ Add an image* (Paint tab, in every kind of project) makes a picture of yours (png, jpg) a texture under *Mine*: its middle square, 512 x 512 when the picture is that big (else 256), repeating every metre (set it next to the picture); it is kept with the project (`<name>.ref.json`) and exported like the program's textures. In a game interior *+ Image* next to a new wall's texture or a model part's does the same.
8. **Check it.** The checklist and the walk check.
9. **Export.**

### Rooms in one click

*Create the rooms automatically* makes ONE room of the inside of the selected building (the whole model when it is one building; with several, select one first), with one floor throughout. The grid is put on the building first when it was never set.

- **Floor.** The grid is moved to the building's floor first, wherever it was. An exterior model has no floor inside, so the heights from the building's bottom up are tried in 10 cm steps: a slice of its walls 15 cm above each one, flooded from outside, gives the area they close in under the roof. When the model has a floor slab (faces looking up under at least 40 % of the biggest such area, where the walls close in at least half of it), the lowest slab is the floor; else the floor is the lowest height at which the walls close in at least 60 % of the biggest area (a terrace or retaining wall below the building closes in less; a ground floor that is narrower than the floors above it still counts), at the height where most of the walls there start (not the model's lowest point, which is often a bit of facade reaching into the ground).
- **Parts of their own.** With a building selected, its windows, glass doors and door leaves can be parts of the model that do not touch its walls, and its roof as well: the slices below take every part of the model within the building's extent, and "under the roof" (here and for walls that follow the roof) looks at the whole model, so a building does not count as open where its glass or its roof is a separate part.
- **Inside.** The building's triangles are sliced at 0.3, 0.8, 1.3, 1.8 and 2.3 m above the floor (below the ceiling height) and drawn into a 5 cm raster (coarser for very big models). The outside is flooded in from the edges; a gap in the walls (a door that is open in the model) is closed first by thickening the walls by 12, 30 or 60 cm, the first that leaves at least 3 m² inside. Low parts in front of the walls under the eaves (a box under a window, a plinth, a porch's parapet) and awnings over doors would close in a strip outside the walls, so only what the walls between 1.25 and 2 m close in as well (gaps up to a double door's width closed) is inside; when those walls leak (a shop window without glass), this check is skipped. Only what the building's roof covers is inside (a piece of the inside that is less than half under faces higher than the ceiling is dropped: a yard, the space between retaining walls). The model's own inner walls (up to 70 cm thick) are closed over, and columns and other closed-in pieces under 2.5 m² belong to the room.
- **Outline.** Only the building's outer walls that are square to the grid count: a wall face with the inside on one side and, within 80 cm on the other, something that is not the room: the outside, or a space closed in only low or not under the roof (a porch behind its parapet), so such a porch is cut out at the house's own wall. The room is the rectangle round the whole inside; the parts of it where the building is not (the missing corner of an L, a notch of the outline) are cut out of it (*Cut out* rectangles, made as big as possible). Faces closer than 8 cm are one line.
- *Fit rooms to the walls* then puts the room's edges exactly on the walls.

The rooms and cut-outs there are are replaced (after a question); Ctrl+Z gives them back. Drawing rooms by hand works as before, also afterwards.

### Floors, stairs and garages

A building can have several floors (Build tab, *Floor* at the top). Each floor has its own rooms, partitions, lights, furniture, stairs and ceiling height, and a height above the lowest floor. The tools work on the green floor: switching (click a floor, or PageUp / PageDown) moves the grid to that floor's height, and the openings, window / door models and collision boxes, which are stored above the grid's floor, keep their place. The other floors are drawn see-through.

- **+ Floor above** adds a floor over the highest one (its height is the floor below's ceiling plus 30 cm); its rooms start as a copy of the active floor's. **+ Garage** adds a floor 40 cm under the active one with a 3 m ceiling; **+ Basement** one under the lowest. The heights can be typed.
- **Stairs** (tool in *Draw the rooms*): drag a rectangle on the floor; the stairs go up along its long side towards where you let go, in steps of about 18 cm up to the floor above, with collision. The selected stairs' panel sets:
  - *Shape*: **Straight**; **L** (a flight, a landing in the far corner, a flight across); **U** (up one side, a landing across the far end, back up the other side); **Spiral** (wedges round a post, its rectangle made square). *Turns* left or right for L, U and spiral.
  - *Width x*, *Depth y* (the rectangle, from its first corner), *Step height* (15 to 22 cm), *Flight width* for L and U.
  - *Open steps*: treads on two stringers instead of solid steps; *Handrails*: posts and a rail 90 cm over the treads.
  - The collision the game gets is a ramp through the middle of every tread (from half a step over the floor, flat over the last half tread; a ramp winding round the post for a spiral), with the landings solid: people catch on the edges of step boxes. The editor's walk test still uses a box for each step. The ceiling is open over them and the floor above has a hole where they come up, with a 1 m railing on its other sides. The well between the two floors is lined with walls (from this ceiling to the floor above), and the building's own collision and parts are cleared out of it (they would be an invisible floor between the floors).
- **Garages:** cut the door with the Archway tool and press *Garage size* (2.80 x 2.40 m) or *Double garage* (5.20 m); a garage door model (Window / door models, *Garage* tab) takes the size of the opening. Garage doors are exported as door objects like the other doors.
- **Under the roof:** with *Walls and ceiling follow the roof* (on for a floor made with *+ Floor above*) a floor's walls and ceiling follow the building's roof: the room is as high as its ceiling, or as the underside of the roof less 5 cm where that is lower, so the walls under a slope get lower towards the eaves and the ceiling slopes with the roof. The roof is read from the model (the lowest face that is not a wall, 40 cm or more above the floor, in a 20 cm raster); a wall stays under the roof on both of its sides (a step down in the roof next to it). *Fit to the roof* (done by itself for a new floor above) cuts the floor's rooms to where there is at least 1 m under the roof, 30 cm round each point. Clearing the model out of the rooms stops under the roof there, so the roof is not cut. The ceiling is one grid (the room's edges, the walls' inner faces and every 40 cm) with each corner shared, and the walls are cut at the same lines, so walls and ceiling meet without a crack; under the slopes the building's roof is the collision.
- **Export:** all the floors of a building go into one interior (one room, one set of portals); the automatic rooms find the floor height only on the lowest floor.

### Room settings

- **Ceiling height** and **wall depth** are in the inspector's *Project* tab (*Walls and ceiling*). *Match the building* picks the ceiling top that most of the building's own wall area has.
- **Wall thickness** moves the inner face of every wall into the room, so parts of the building that stick through the wall by less than that are covered. Corners meet at the moved faces and openings get reveals.
- **Interior walls** can be built from the room edges (default) or from the building's own wall faces turned round to look into the rooms (experimental).

### Tools at a glance

| Tool | Does |
|---|---|
| Select building | Pick the objects of one building out of the model |
| Frame | Square the grid to a wall; set floor height and corner |
| Raise / lower rooms | Move all rooms up or down against the model |
| Add room, Cut out, Partition | Draw the interior |
| Fill gaps | Fill empty floor between rooms |
| Door, Window, Archway | Cut an opening through the model, collision and interior walls |
| Window / door models | Place `.glb` models by hand |
| Delete faces | Select and delete faces of the model, like edit mode in Blender |
| Model parts | List the model's parts (one per texture) and remove or select a whole part |
| Edges | Show open edges and fill holes |
| Collision | Select and delete the building's invisible collision pieces |
| Collision box | Draw your own collision boxes |
| Props and plants | Pick and remove map props, plants and small pieces |
| Floor paint, Light | Finish the inside |
| Furniture | Put props of the game (sofas, tables, lamps, beds...) in the rooms |
| Stairs | Stairs up to the floor above |
| Walk check | Walk a player-sized capsule through the result |
| Scale figure | A 1.8 m figure to judge heights against |
| Cutaway | Hide the model above a height to see inside |

## Coordinates

There are three frames and the program converts between them:

- **Grid (shell) frame:** the grid the rooms are drawn on, with the floor at z = 0.
- **Model frame:** the building model's own coordinates. Every model file of a map (the building and each detail file) is centred on its own entity, so each file has its own origin.
- **World frame:** the position and heading of the model's entity in the game.

A project with detail files (grilles, vents, bushes and props of the block) stores where each one stands (`import.detailPlace`); the editor moves every detail file into the building's coordinates and gives the host the rooms in each file's own frame.

## Cutting the model and its collision

- **Openings.** A cutter is a box. The triangles of the model inside it are removed and the triangles it crosses are split along its faces. The same box opens the interior walls and cuts the model's collision files: boxes that line up are split around the opening, other shapes are removed when their centre is inside.
- **Openings in thick walls.** An opening made from the model's faces sits on the building's outside and is 80 cm deep about it, which does not reach a room behind a thick wall (an old stone building, a city hall). So it reaches across to the nearest wall of a room behind it (up to 1.6 m away, of the rooms whose side overlaps the opening) and 15 cm past it: the room's wall and the building's collision are opened there too, and the model's faces in between (its inside surface) are cut out, from 5 cm behind the clicked faces, 2 cm inside the opening's sides so its reveals stay.
- **Overlapping openings.** Openings that overlap along a room's wall (a frame placed in an opening cut from the faces, a door cut a little wider than its frame) are one hole in that wall, as wide and as high as both together.
- **Clearing the model out of the rooms.** Everything of the model that lies inside a room is cut at the room's walls: window boxes and frames, vegetation cards, vents, anything else. The three kinds (windows, vegetation, everything else) have ticks and counts. The outside surface of the building is kept: a face that looks out of the room through one of its walls and lies within 15 cm of it is not cut. Windows get a further depth (default 10 cm) so their frames stay.
- **Clearing the collision.** The building's collision often fills its rooms with invisible slabs and blocks. With *Clear the building's collision inside the rooms* (on by default) every room volume is cut out of the collision files. The count of what is left is shown all the time, and the Collision overlay draws it in red.
- **Detail models.** Faces deleted from detail files are stored per file (`import.mdeletes`) and the export writes those files again with the faces taken out. A geometry left with no faces is removed.
- **Fills.** Holes filled with the Edges tool are added to the model when it is cut and are written into the exported model.

## Doors and windows

### Cut openings (Door, Window, Archway)

Click the faces of a door or window of the model (the flat patch lights up) and click. The faces are deleted, the interior wall behind it and the collision are opened, and a window gets glass at the plane of the faces. A plain frame is built around cut-out windows and doors, or you can keep the model's own frame, or have none. Gaps in the model's wall beside a cut-out are measured and closed with trim. The windows the game lights at night are often a model of their own next to the building (`..._emissive_...`, shown by the time of day): the export looks in the building's map file for such models near it, cuts them with the same openings and ships them with the resource (like the building), so a cut-out window no longer lights up at night while the others still do. Windows taken out with the Delete faces tool, without a cutter, count too: the deleted upright faces are grouped into patches (faces in one plane that touch), and each patch cuts it like an opening of its size.

An opening on a slanted wall of the building (more than a few degrees off the grid, a cut corner) opens every piece of the rooms' wall inside its box seen from above: the room edge there is a staircase of short walls along and across the grid, and the cut reaches 40 cm past the opening's front and back to take its steps too. Those pieces get no trim, and one portal stands across the opening in its own plane.

### Doors, windows, garage doors and gates of the game

*Doors and windows → From the game* (in the Models tool) lists the game's own models that work: *Doors*, *Gates* and *Garage* are only the models the game moves as doors (archetype flags `0x04000000` with `0x00020000`, the same as the police station's and the banks' doors), *Windows* the models named as windows (no frames, sills, signs or shop displays). Each has a picture of its shape and its size; 30 at a time (*Show more*), a filter by words of the name.

A click chooses it; click a wall and it stands in the wall like a `.glb` model: the opening is cut to its size through the rooms' walls (with a portal) and, unlike a `.glb` model, through the building's model and its collision too (40 cm in front of it and behind it). It comes in its own size; size it with the gizmo or the panel (*Own size* goes back): the game does not scale a prop, so the export writes a copy of the model at that size (`<prefix>s<n>_<model>.ydr`, its faces, its built-in collision and its box scaled, the original's archetype with its door flags, renamed). The export places it as an object of the room (the model's origin where its box stands) and brings the game's map types file it is defined in (`DLC_ITYP_REQUEST`): a door or a gate swings when pushed, as in the game's interiors (or your door script moves it); a garage door is moved up by `client/doors.lua` when someone comes near.

### Door and window models from `.glb` files

Every project has the models that come with the program (`models\`): the three of other people listed in `models\CREDITS.txt`, and the program's own (CC0), all listed in `models\CREDITS.txt`: windows in `mlo_windows_*.glb` (basic, modern, special, classic and more: from casements, sashes and Georgian twelve-pane to arches, a fanlight, leaded diamonds, glass blocks, ribbon and shop windows), doors (`mlo_door_*.glb`: panel, flush, glazed, French, front doors with a fanlight, a stable door, office and bathroom doors with a narrow window, a fire exit, a security door, a clear glass door and more; sliding doors `mlo_door_sliding_*` in glass, black glass, oak, white, barn and shop style; swing doors `mlo_door_swing_*` for a kitchen and a café), garage doors, door frames (plain in five colours, classic with plinth blocks and a cap, with a transom, with side lights) and window frames (`mlo_window_frame_*.glb`: white, oak, walnut, anthracite, classic, stone). `tools\make_models.py` makes them. Models you bring (for example from Sketchfab) go into the project like other files. The host reads each mesh with its node transform; a file with several windows is split into one model per window. Animations are not used.

- **The list** has a tab each for windows, doors and frames with all the models of that kind from every file, and a filter; *Files* below it sets the kind of a file that was guessed wrong and shows its licence.
- **Placing:** choose a model, click a wall.
- **Fitting to an opening:** a model put on an opening you cut with the Door, Window or Archway tool takes its size by itself (the preview says "fits the opening"): a window the opening's size, height and middle; a door's wall cut the opening, the leaf the opening less room to swing; a frame's outside the opening. A door goes into a frame it is put in first, and without a cut opening a door or frame takes the building's door-shaped faces. *Fit to the opening* in the panel does it again for a placed one; the gizmo still sizes it by hand. Nothing is cut for you: *Select the wall faces behind it* and *Select the building's collision there* select what you probably want to delete.
- **Gizmo:** arrows move along width, depth and height; cubes resize; a ring turns in 15 degree steps. Positions snap to 1 cm.
- **A window's hole** in the room wall is the model's size minus 1 cm all round. **A door's hole** can match the size of the building's own door-shaped opening; the door is centred in it.
- **How a door opens** (panel, *How it opens*): *Swings* is the game's door (it swings about its hinge when pushed, or a door script moves it). *Swings both ways* and *Slides* are moved by `client/doors.lua` in the export: when a player comes within 2 m a swing door turns 90 degrees about its hinge away from them (to whichever side of the wall they are not on) and a sliding door slides by its own width into the wall, towards the side set as *Slides to* (a double door opens both leaves, each to its own side); they close when nobody is near. *Opens up (garage)* is for garage doors (new garage doors start with it): when someone comes within 4 m, on foot or in a car, the door folds up about its top edge into the garage (towards the side the rooms are on) in 2.5 seconds and lies flat under the ceiling, and comes down again when nobody is near. The script finds each leaf by its model at its hinge, freezes it so the game's door physics leaves it alone, and moves it on every client; no server part and no door script are needed. New doors whose name says *sliding* (not the patio unit) start as sliding doors, those that say *swing* as swing doors.
- **Frames** are a third kind, placed in an opening to hold a door. A frame whose opening is shut at the bottom (a sill) is a window frame: it hangs where you click instead of standing on the floor, fits to an opening cut with the Window tool, and a window put into it takes the size of its opening (*Fit the windows in it* does it again). With a window in it the window's hole (with its glass) is the cut in the room's wall and the frame covers the wall round it; an empty window frame cuts its own hole, without glass.
- **Setting a model up:** a model can come out of its file lying down or facing the wrong way, so each model has a stored turn; doors and frames are stood up automatically when none is stored.
- **Double doors:** a door placement can be two leaves hinged on the outer edges and meeting in the middle. The leaf whose knob would sit on its hinge side is the model mirrored left to right.

### How a door is exported

Each door is a prop of its own made like the game's own doors: archetype flags `0x24020000` with special attribute 7, a composite collision bound with one box child (kept inside the door's clear opening, where the cut in the building and the hole in the interior's wall overlap: 1.5 cm from its sides and 1 cm off the floor and the head, because a leaf whose box reaches into the wall or stands on the floor is stuck in the game; the hinge moves in with it, the leaf looks the same), the hinge at mid height as the origin, and a physics dictionary entry of its own name. The README of the export lists each door's model name, hash, hinge position and heading, which is what a door script such as ox_doorlock asks for. The game ignores the scale of an entity, so the size you give a model is baked into its vertices.

Windows are merged by material into extra parts of the interior; their glass uses the interior's glass shader.

## Props and plants

Bushes, hedges, trees and props that stand around a building are not in the model's files: the game's map files (`.ymap`) place them. The Props and plants tool finds them and lets you hide the ones you choose.

- **Lookup.** The host reads every map file that covers the model's extent plus 8 m (`Vanilla.PropsInBox`) and lists the props. A prop counts as a plant by its name, by the archive that holds its model (`bush`, `veg`, `tree`...), by its foliage shader or by leaf and branch textures. Fragment props (`.yft`) are read too. Copies of the same prop in several map files are merged. Results depend only on the model, not on one building.
- **Rules.** A plant is hidden by the rule when at least 3 of its triangles and at least a set percentage (5 by default) lie inside a room, or when it stands right in front of a window or door and is bush-sized. Anything else is only hidden if you pick it. Other props are never hidden by a rule.
- **In the view.** *Show the models* draws the game's own meshes where the map places them: orange = will be removed, green = stays, blue-grey = other props, cyan = bushes made of cards inside the model files, lilac = small pieces of the model.
- **Picking.** Click a model to select it, Shift adds, **A** all, **Alt+A** none, **Ctrl+I** invert, **X** or Delete removes, **R** keeps, Esc deselects, Ctrl+Z undoes.
- **Model-file bushes and small pieces.** Their triangles are deleted from the file they are in (the same way as the Delete faces tool).
- **Export.** `client/plants.lua` calls `CreateModelHide(x, y, z, 0.6, GetHashKey(model), true)` once for each hidden prop (the exact spot of that one prop) and `RemoveModelHide` when the resource stops. No map file is replaced.

Not covered: procedural grass (drawn by the game on the ground) and props wider than 16 m (road pieces).

## Furniture

The Furniture tool (Z) puts props of the game in the rooms, and your own props.

- **Game build.** A prop of a DLC needs the game build of that DLC on the server (FiveM's `sv_enforceGameBuild`): on a lower one it does not show. The program reads the build from the `server.cfg` above the output folder; a selected piece of furniture or object that needs a newer build says so (its DLC, the build it needs), and the export warns for each one.
- **Your props.** *Your props → + Add props (.ydr)* (under the furniture search, and under *Add an object* in a game interior) copies `.ydr` models into the `props` folder next to the program; a `.ytd` of the same name next to a model comes along (*Folder* opens it, put more files in by hand if you like). They are found by the search too and shown like the game's props. An export that places one copies its `.ydr` and its texture dictionary (the one of its own name, else the first in the folder that holds one of its textures; none when the textures are inside the model) into `stream/` and defines it: in the interior's map types file, or in `stream/<prefix>myprops.ytyp` (with a `data_file` line) for a game interior. Collision built into the model goes with it (defined like the game's fixed furniture). A prop with the name of a prop of the game replaces the game's one while the resource runs: the export warns. Only `.ydr` models (no `.yft`).

- **Search.** The host looks through the names of every `.ydr` of the game that is a prop (`prop_`, `v_`, `apa_`, `hei_`... and names with `_prop_`), without LODs. Every word of the search has to be in the name; common words stand for the words the game uses, in English and German (`sofa` also finds `couch` and `settee`, `tisch` finds `table` and `desk`, `lampe` finds `lamp` and `light`). The buttons search for one kind each. At most 400 names are listed.
- **The model.** A prop's most detailed geometries are read like an imported model, with the textures inside it and the game's texture dictionaries for it (the same lookup as the model's textures).
- **Placing.** Choose a model in the list and click the floor: what it stands on is put on the floor where you click: its lowest point for most props, whose origin is where they stand; for a prop that reaches well under its origin, its lowest faces looking down between there and its origin (the feet of a chest of drawers or a coffee table modelled around its middle), so the hidden parts some game props have under the floor (a toilet's drain, an apartment bed's) do not lift it into the air. *On the floor* and *All on the floor* do it again, and pieces placed before this that floated are put down when the project opens. Click a piece to select it, drag to move it (5 cm steps, Shift: free), R turns it 90°, Shift+R 15°, Shift+D duplicates, X deletes; the panel has the exact numbers.
- **Stored** with the building's rooms (`shell.furniture`), in the grid's frame.
- **Lights of a prop.** A lamp's lights are built into its model. The selected piece of furniture (and in a game interior the selected object) lists them under *Its lights*: each one on or off, its colour, *Brightness*, *Range* (m) and *Softness*, *Reset* back to the model's own. *Night preview (lit by the lamps)* (there, and under View in a game interior) darkens the view and lights it with the 16 lights nearest to where the camera looks: the props' (point lights and spots with their cone) and the lamps of the Light tool. The changes act on the model, so on every object that shows it: the export writes it under a name of its own with the changed lights (a switched-off light shines with 0), defines it (the original's archetype, renamed) and points the project's objects at it; the same model elsewhere in the world stays as it was. Kept in a game interior with the model's other changes (`game.mods[model].lights`), in the other projects in `propLights`. Models that break or move (`.yft`) show their lights but cannot be changed.
- **Collision.** A prop whose model carries its collision (a chair, a door, a wardrobe, a breakable prop) keeps it. One that carries none (kitchens, counters, shelves, beds: their collision is in the files of the game's interior they come from) gets boxes made from its shape (`PropCollision.cs`): up to 1.5 m across its box; bigger ones are looked at from above in 25 cm cells, and what does not reach higher than 1.3 m stands solid on the floor (a counter, a table), what is higher hangs where it is (a wall cupboard, a shelf), the floor and ceiling of a model of a whole room are left out, and the gaps between stay free. The boxes go into the interior's collision (`<prefix>_mlo.ybn`) and show in the collision view and the walk test. A flat prop (a picture on the wall) gets none.
- **Export.** Each piece, on every floor, becomes an entity of the interior's room (the same entity fields as the doors). The resource carries no model: the game has it. A prop that only a DLC has needs that DLC on the server. Props of the game's own interiors (an apartment's furniture `apa_mp_h_...`, the interiors' `v_res_...`) are only known to the game while that interior is loaded: the export looks up the map types file that defines each one (an index of every .ytyp of the game, made once and kept in `cacherchetype_index.txt`), copies those of the game's interiors into stream/ unchanged and loads them with `data_file 'DLC_ITYP_REQUEST'`; the README lists them. Many apartment props are whole groups placed where they stand in the apartment (their origin is the apartment's), so they can be big and off to one side of where you click.

## Several buildings in one project

A block holds many buildings but only one resource can replace the model's files, so all of them are made in one project. Each building has its own grid, rooms, partitions, lights, openings, collision boxes, ceiling height, wall settings and textures. The model, deleted faces, removed parts, deleted collision and the model's placement are shared. The model is cut by the openings of all buildings. On export each building becomes its own interior (`<prefix>int.ydr`, `<prefix>mlo.ybn`, ...) with the building's number added to the prefix for the second and later ones.

## Export

Press Export on the Export tab; the folder goes to `output\<folder>` (or the folder you set). Upload it to the server's resources, `refresh`, `ensure <folder>`.

**Room light** (Export options; for a game interior under its export when it has new walls): how much of the game's own light the new walls, floors and ceilings take. The game reads it from their vertex colour: red is the daylight through the windows, green the interior's ambient light, which also shines at night. *Full* (255, 255) is what earlier versions wrote and makes rooms glow at night; *Normal* (150, 110) is the default; *Bright*, *Dim* and *Dark* (70, 20: lit by your lamps only) go either way. The game's own models keep their own colours. The log and the README in the folder give a test spot inside the interior.

| File | Content |
|---|---|
| `<prefix>_int.ydr` | The interior: floors, walls, ceiling, trim, lights |
| `<prefix>_glass.ydr` | Window glass |
| `<prefix>_mlo.ybn` | Collision for floors, walls and your boxes |
| `<prefix>_tex.ytd` | Only the textures you used |
| `<prefix>_types.ytyp` | The MLO: limbo room + interior room, one portal for each door or window that reaches the outside, and the door props |
| `<prefix>_milo_.ymap`, `_manifest_<prefix>.ymf` | Where it stands, and the interior marker |
| the model's `.ydr` | The building model with your cuts, written under its original name so it replaces the game's one while the resource runs |
| the imported `.ybn` files | The collision with the same cuts |
| the occlusion `.ymap` files | The same files without the boxes inside your interior (only when some were inside) |
| `_fm*.ydr`, `_fd*.ydr` | Window parts and door props from `.glb` models |
| (in `<prefix>_types.ytyp`) | The furniture: entities of the game's props in the interior's room |
| `client/plants.lua` | Hides the props you removed |
| `fxmanifest.lua`, `client/ipl.lua`, `README.md` | The resource itself and a list of the game files it replaces |

## Limits

- Never assume it works in game without testing. Streaming, lighting, portals, collision and door behaviour have to be seen in the game.
- Only one resource can replace a given game file.
- Rooms are axis-aligned rectangles in the grid, on one or more floors, one interior room for the whole interior.
- A cutter opens the interior walls only when it is square to the grid (within 1.5 degrees); the model and the collision are cut at any angle.
- Spheres, capsules and cylinders of the collision are not clipped.
- Collision boxes you draw are boxes only and are not checked against anything.
- The walk check tests the files' collision with a flat capsule on one level, not the game's character controller.
- Door props are static: wire them to your door script by model and coordinates.

Garage doors placed with the Models tool can use **GTA / sectional** to fold up into the garage, or **Roller shutter** to rise vertically into the lintel. The built-in library includes Sectional, Roller Shutter, Modern, Wood, Glass, Ribbed, Red and Industrial garage doors. Search or filter the door library, fit a model to the opening, and choose the matching opening mode. The exporter includes the required `client/doors.lua` animation and proximity trigger.
- Textures that are not in the files you import are shown in plain colours in the editor; the game uses its own. **Load the textures from the game** (Import tab, Model files) looks them up in your GTA V install through CodeWalker's library: the texture dictionary of the model's archetype, the dictionaries in the archive that holds the model, and their parents (`gtxd`). They are kept in the project (`<project>.files\gametex\`) for the editor only and are not exported.
- The model's tilt is ignored (only the turn about the vertical is used); the model's scale must be 1.

### Additional floors in a game MLO

To build another floor manually, open **Game MLO → Rooms**, enter the absolute **Floor Z** and **Room height**, then click **Draw new room** and drag its rectangle in the XY view. No shell or object is copied. After the room is created it becomes the active room for the wall tool; choose its floor Z and draw the walls yourself. Add a door opening and portal to connect the new room to the stairwell (or another room).

After drawing a new wall, click the wall in the 3D view. The wall controls then show **+ Door in selected wall** and **+ Window in selected wall**. Add the opening, set its position, width and height, and choose a game door model for a door opening. The wall is cut around the opening automatically; use **Make a portal here** when the opening connects two rooms.

## Whole new building

| Tool | Does |
|---|---|
| Wall | Drag grid corner to grid corner |
| Room | Drag a rectangle: four walls and the floor |
| Floor | Drag cells: floor without walls |
| Door, Window, Archway | Click a wall; click again to remove |
| Stairs | Click a cell; steps, run, width, direction, railings |
| Roof | Drag cells: flat roof slab |
| Light | Click a cell for a ceiling light |
| Entrance | The door whose in-game position places the house |
| Eraser | Remove walls and cells |

Stand in the entrance doorway in the game and paste `vec4(x, y, z, heading)` to place the house.

## Controls

**Camera:** middle-drag orbits (Shift pans, Ctrl zooms), right-drag also orbits, wheel zooms, keypad 1 / 3 / 7 for front / right / top (Ctrl for the opposite side), Home frames everything, WASD moves, Q / E turn 90 degrees, T is top-down.

**General:** Ctrl+Z / Ctrl+Y undo and redo, Esc or right-click cancels a drag, Ctrl+S saves. Ctrl+C copies what is selected (a window / door model, a piece of furniture, collision boxes, a room) and Ctrl+V puts the copy where the pointer is: a window or door on the wall under it with the same size, height and settings, furniture and boxes on the floor under it, a room with its middle there; with the pointer on nothing it goes next to the original. The hint bar above the status line shows the active tool's keys.

**Tool keys:** Add room 1, Cut out 2, Partition 3, Door 4, Window 5, Archway 6, Floor paint 7, Light L, Furniture Z, Select V, Eraser X, Select building B, Frame O, Raise / lower G, Fill gaps J, Delete faces F, Model parts P, Edges K, Collision M, Collision box N, Window / door models I, Props and plants Y, Walk check U, Scale figure H, Cutaway C.

## Code map

| Path | Content |
|---|---|
| `src\Program.cs` | Local server, routes, settings, window start |
| `src\AppWindow.cs` | The native window (WebView2) |
| `src\ImportHost.cs` | Import, lookups, placement, props routes |
| `src\ModelCut.cs`, `src\CollisionCut.cs` | Cutting the model and its collision |
| `src\Vanilla.cs` | Reading the game's archives and map files |
| `src\Buildings.cs`, `ui\js\buildings.js` | Buildings of the game: the interior index, the list of places, the search window, reading one interior |
| `ui\js\gamemlo.js` | A game interior in the editor: its objects in the view, picking, rooms, entity sets |
| `ui\js\gamewalls.js`, `src\GameWalls.cs` | New walls in a game interior: drawing, openings and doors; their models, textures and collision |
| `src\BuildingOutside.cs` | The building round a game interior: reading the map's objects there, writing the changed map files |
| `fivem\mlo_creator_live\`, `src\LiveBridge.cs` | The live editor in FiveM (client, server, panel) and the program's side of it (install, send, take) |
| `ui\js\gameedit.js`, `src\GameModels.cs` | Changing the game's own models (openings, faces, parts, textures) and their collision; new rooms and portals |
| `src\Exporter.cs`, `src\FitExport.cs` | Writing the resource, door and window props |
| `src\GlbModels.cs` | Reading `.glb` models |
| `ui\js\layout.js` | The frame round the 3D view: tool rail, tool panel head, inspector tabs, view bar, status bar and workflow steps |
| `ui\js\importmodel.js`, `importtools.js`, `importui.js` | The import workflow: model, tools, tool panel and inspector |
| `ui\js\plants.js` | Props and plants |
| `ui\jsurniture.js` | Furniture of the game |
| `ui\js\shell.js`, `mesher.js` | Building the interior's meshes and collision |
| `ui\js\fitmodels.js` | Placing `.glb` models |
| `ui\js\walk.js` | The walk check |


### Découpe automatique et portes automatiques

Dans un projet de bâtiment importé, ouvre l’outil **Door** ou **Window** dans l’onglet Build. Le bouton **Découper portes et fenêtres automatiquement** analyse uniquement les textures reconnues par leur nom ou classées manuellement, puis propose une liste de candidats à vérifier avant la découpe. Les faces prises sont annulables avec Ctrl+Z.

Pour les animations de porte, place un modèle depuis **Window / door models**, sélectionne-le, puis règle **How it opens** : battante automatique dans les deux sens, coulissante, porte sectionnelle de garage ou rideau. Les portes automatiques sont animées par le script inclus dans l’export à proximité du joueur.


### Auto-room clearance and diagonal buildings

The automatic room tool can align its frame to the building’s dominant wall direction, including a building rotated diagonally. After fitting the room to the measured wall planes, it applies an adjustable interior clearance (default 0.05 m, or 5 cm) so the room does not overlap the building walls. Reduce the clearance if the interior is very narrow. Existing partitions/openings are preserved, so automatic frame rotation is skipped when those are present.
