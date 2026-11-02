# MLO Studio : CodeWalker (et tes autres logiciels) dans MLO Creator

MLO Studio est une fenêtre à part (`MloStudio.exe`, à côté de `MloCreator.exe`) qui affiche **MLO Creator, CodeWalker et n'importe quel autre programme dans une seule fenêtre**, en onglets ou côte à côte. Les programmes tournent normalement : MLO Studio prend juste leur fenêtre et la met dans la sienne.

## Installer (une seule fois)

1. Double-clique **`Construire MLO Studio.bat`** dans le dossier du logiciel. Il compile `MloStudio.exe` avec le compilateur C# fourni avec Windows (rien à installer).
2. Ensuite, lance **`MloStudio.exe`** au lieu de `MloCreator.exe`.

## Utiliser

- **Premier onglet : MLO Creator**, ouvert automatiquement dedans (s'il était déjà ouvert, MLO Studio le reprend au lieu d'en ouvrir un deuxième).
- **Carte CodeWalker** (barre du haut) : ouvre le World View de CodeWalker dans un onglet. MLO Studio cherche `CodeWalker.exe` tout seul (dossier du logiciel, Bureau, Téléchargements, Documents, Program Files, `C:\`, `D:\`, variable `CODEWALKER_DIR`) ; sinon il te demande où il est, une seule fois.
- **+ Ajouter une application** : 
  - *Carte du monde* : CodeWalker World View ;
  - *RPF Explorer* : CodeWalker lancé avec `explorer` ;
  - *Autre programme (.exe)* : OpenIV, Blender, un éditeur… n'importe quel logiciel ;
  - *Fenêtre déjà ouverte* : choisis-la dans la liste, elle passe dans MLO Studio.
- **Côte à côte** : MLO Creator à gauche, l'application choisie à droite. Tire la barre du milieu pour changer la taille ; elle est retenue.
- **Clic droit sur un onglet** : côte à côte, détacher dans sa propre fenêtre / remettre dans MLO Studio, fermer, relancer, renommer, arguments de lancement, retirer de la liste.
- **Dans MLO Creator**, le bouton **Applications** (barre du haut, à côté de *Partager*) fait la même chose sans quitter l'éditeur : carte, RPF Explorer, ajouter une application, côte à côte, et la liste des applications avec leur état.

## Modification live

La carte **Modification live** (barre du haut de MLO Studio, fenêtre *+ Ajouter une application*, ou bouton *Applications* de l'éditeur) sert à éditer un bâtiment choisi dans CodeWalker, avec un aperçu en direct :

1. Ouvre CodeWalker (la carte l'ouvre toute seule s'il est connu). La première fois, ouvre son panneau d'outils (bouton `>>` en haut à droite) puis l'onglet **Selection** : c'est là que MLO Studio lit ce qui est sélectionné.
2. Clique un bâtiment, un intérieur ou un objet dans la vue de CodeWalker. La petite fenêtre *Modification live* affiche son nom et la position de la caméra, en suivant chaque nouvelle sélection.
3. **Éditer ce bâtiment** : MLO Creator passe à gauche, CodeWalker reste à droite (côte à côte), et l'éditeur ouvre le bâtiment comme un projet *Building of the game*. Si le nom est celui d'un intérieur, il s'ouvre tout de suite ; sinon (un objet, une partie du bâtiment) les intérieurs autour de la position sont listés, un clic sur *Open in the editor* l'ouvre. L'objet cliqué dans CodeWalker est ensuite sélectionné et cadré dans l'éditeur.
4. Chaque modification (déplacer, tourner, supprimer, ajouter des objets, murs, ouvertures…) s'affiche **en direct dans la vue 3D de MLO Creator**, à côté de CodeWalker sur le même endroit. *Export* ou *Live in FiveM* comme d'habitude pour le jeu.

Options de la fenêtre : *Suivre la sélection de CodeWalker* (décoche pour taper un nom ou une position `x y` à la main), *Ouvrir tout seul chaque nouveau bâtiment sélectionné* (après une seconde sans changement), *Presse-papiers* (un nom ou une position copiés, par exemple la *Position* d'une entité dans CodeWalker).

Comment ça marche : CodeWalker n'est pas modifié. MLO Studio retrouve ses champs par leur nom WinForms (`SelectionNameTextBox`, `CameraPositionTextBox`) et lit leur texte ; les noms trouvés sont écrits dans `logs/studio.log`. Le bâtiment est transmis à l'éditeur par le même canal local que *Share your project*. CodeWalker lui-même ne redessine pas les changements : il lit les fichiers du jeu, l'aperçu en direct est celui de MLO Creator. Si Windows refuse la lecture, lance MLO Studio et CodeWalker avec les mêmes droits.

Les applications ajoutées sont gardées dans `studio.json` ; celles qui étaient ouvertes à la fermeture se rouvrent au prochain lancement.

## Fermer

Fermer MLO Studio ferme MLO Creator proprement (il enregistre le projet, comme d'habitude). Pour les autres applications, MLO Studio demande : **Oui** les ferme aussi, **Non** les laisse ouvertes dans leur propre fenêtre.

## Comment ça marche

- Chaque onglet est un panneau de MLO Studio ; la fenêtre du programme y est mise avec `SetParent` (sans bordure ni barre de titre), redimensionnée avec le panneau, et rendue telle qu'elle était quand tu la détaches.
- Si le programme ouvre d'abord une autre fenêtre (choix du dossier de GTA V au premier lancement de CodeWalker, écran de chargement), MLO Studio prend celle-là puis passe à la fenêtre principale dès qu'elle apparaît.
- Le bouton *Applications* de l'éditeur parle à MLO Studio sur `127.0.0.1` (port 17345 à 17364). MLO Studio écrit `ui/js/studio-config.js` (son port et une clé tirée au hasard à chaque lancement) et ne répond qu'aux requêtes qui ont cette clé et qui viennent de cet ordinateur. À la fermeture, le fichier est remis à `null`.
- Journal : `logs/studio.log`.

Options : `MloStudio.exe --no-mlo` (sans MLO Creator dedans), `--codewalker` (ouvre la carte au démarrage). Dans `studio.json` : `"EmbedMlo": false`, `"MloArgs": "--devtools"`, `"CodeWalkerPath": "D:\\CodeWalker\\CodeWalker.exe"`.

## Limites

- Un programme lancé **en administrateur** ne peut pas être mis dans une fenêtre qui ne l'est pas (Windows le refuse) : lance MLO Studio en administrateur aussi, ou laisse ce programme dans sa propre fenêtre.
- Sur un écran à plus de 100 %, un programme qui ne gère pas la mise à l'échelle (souvent les vieux logiciels WinForms) peut paraître plus petit dans MLO Studio que seul.
- Quelques programmes (applis du Microsoft Store, certains jeux en plein écran) refusent d'être intégrés ; ils restent dans leur fenêtre.
- Les raccourcis clavier vont à l'onglet affiché : clique dedans avant de taper.

## Fichiers

| Fichier | Rôle |
|---|---|
| `studio\src\*.cs` | Le programme (WinForms, C# 5, .NET Framework 4.8) |
| `studio\MloStudio.manifest`, `studio\MloStudio.ico` | DPI (PerMonitorV2, comme MLO Creator) et icône |
| `build-studio.ps1`, `Construire MLO Studio.bat` | La compilation |
| `ui\js\studio.js`, `ui\js\studio-config.js` | Le bouton *Applications* de l'éditeur, et l'ouverture des bâtiments de *Modification live* |
| `studio\src\LiveForm.cs`, `studio\src\CodeWalkerLink.cs` | La fenêtre *Modification live* et la lecture de la sélection de CodeWalker |
