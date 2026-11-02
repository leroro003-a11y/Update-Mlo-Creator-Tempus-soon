fx_version 'cerulean'
game 'gta5'
lua54 'yes'

author 'MLO Creator'
description 'MLO Creator live editor: change a game interior in the game (objects and walls), together with MLO Creator'
version '1.1.0'

shared_script 'config.lua'
client_scripts { 'client.lua', 'client_walls.lua' }
server_scripts { 'server.lua', 'server_walls.lua' }

ui_page 'html/index.html'
files {
    'html/index.html',
    'html/style.css',
    'html/app.js',
    'html/walls.js'
}
