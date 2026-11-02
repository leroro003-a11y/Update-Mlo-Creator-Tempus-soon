// French build language picker, retained from the FR package's locale engine.
window.MLO = window.MLO || {};
(function (M) {
    'use strict';
    function init() {
        const select = document.getElementById('language-select');
        const I = M.I18n;
        if (!select || !I) return;
        select.replaceChildren();
        I.LANGS.forEach((L) => {
            const option = document.createElement('option');
            option.value = L.code; option.textContent = L.native; option.setAttribute('data-noi18n', '');
            select.appendChild(option);
        });
        select.value = I.lang;
        select.addEventListener('change', () => { I.set(select.value); });
    }
    if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', init); else init();
})(window.MLO);
