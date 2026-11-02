// Écran de chargement : le logo au centre pendant 5 secondes, puis les cards de l'accueil apparaissent une par une.
(function () {
    'use strict';
    var DUREE = 5000, SORTIE = 650;
    var body = document.body, splash = document.getElementById('splash');
    if (!splash) return;
    body.classList.add('splashing');
    setTimeout(function () {
        splash.classList.add('out');
        body.classList.remove('splashing');          // les cards démarrent leur animation d'agrandissement
        body.classList.add('splash-done');
        setTimeout(function () { if (splash.parentNode) splash.parentNode.removeChild(splash); }, SORTIE);
    }, DUREE);
})();
