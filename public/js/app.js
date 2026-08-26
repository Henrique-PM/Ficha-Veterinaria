/*
 * Comportamento da interface.
 *
 * Todo o JS vive neste arquivo, e não em <script> dentro dos templates: a CSP
 * do app bloqueia script inline (script-src 'self'), que é justamente o que
 * torna um XSS explorável. Tudo aqui é ligado por atributos data-*.
 */
(function () {
  'use strict';

  // ── Abas ──────────────────────────────────────────────────────────────────
  document.querySelectorAll('[data-tabs]').forEach(function (group) {
    var tabs = Array.prototype.slice.call(group.querySelectorAll('[data-tab]'));
    var panels = Array.prototype.slice.call(
      document.querySelectorAll('[data-panel][data-tabs-for="' + group.dataset.tabs + '"]')
    );

    function activate(name, updateHash) {
      var found = false;
      tabs.forEach(function (tab) {
        var on = tab.dataset.tab === name;
        if (on) found = true;
        tab.setAttribute('aria-selected', on ? 'true' : 'false');
        tab.setAttribute('tabindex', on ? '0' : '-1');
      });
      if (!found) return false;

      panels.forEach(function (panel) {
        panel.hidden = panel.dataset.panel !== name;
      });
      if (updateHash) history.replaceState(null, '', '#' + name);
      return true;
    }

    tabs.forEach(function (tab) {
      tab.addEventListener('click', function () {
        activate(tab.dataset.tab, true);
      });
      // Setas navegam entre abas, como esperado num tablist.
      tab.addEventListener('keydown', function (e) {
        var i = tabs.indexOf(tab);
        var next = e.key === 'ArrowRight' ? i + 1 : e.key === 'ArrowLeft' ? i - 1 : null;
        if (next === null) return;
        e.preventDefault();
        var target = tabs[(next + tabs.length) % tabs.length];
        target.focus();
        activate(target.dataset.tab, true);
      });
    });

    // Permite cair direto numa aba via /vet/animal/3#vacinas
    var fromHash = location.hash.replace('#', '');
    if (!fromHash || !activate(fromHash, false)) {
      if (tabs[0]) activate(tabs[0].dataset.tab, false);
    }
  });

  // ── Modais ────────────────────────────────────────────────────────────────
  document.querySelectorAll('[data-modal-open]').forEach(function (trigger) {
    trigger.addEventListener('click', function () {
      var dialog = document.getElementById('modal-' + trigger.dataset.modalOpen);
      if (!dialog) return;

      // Campos data pré-preenchidos com hoje poupam digitação no uso real.
      dialog.querySelectorAll('input[data-default-today]').forEach(function (input) {
        if (!input.value) input.value = new Date().toISOString().slice(0, 10);
      });

      if (typeof dialog.showModal === 'function') dialog.showModal();
      else dialog.setAttribute('open', '');

      var first = dialog.querySelector('input:not([type=hidden]), select, textarea');
      if (first) first.focus();
    });
  });

  document.querySelectorAll('[data-modal-close]').forEach(function (btn) {
    btn.addEventListener('click', function () {
      var dialog = btn.closest('dialog');
      if (dialog) dialog.close();
    });
  });

  // Clique no backdrop fecha o modal
  document.querySelectorAll('dialog').forEach(function (dialog) {
    dialog.addEventListener('click', function (e) {
      if (e.target !== dialog) return;
      var box = dialog.getBoundingClientRect();
      var outside =
        e.clientX < box.left || e.clientX > box.right || e.clientY < box.top || e.clientY > box.bottom;
      if (outside) dialog.close();
    });
  });

  // ── Confirmação em ações destrutivas ──────────────────────────────────────
  document.querySelectorAll('form[data-confirm]').forEach(function (form) {
    form.addEventListener('submit', function (e) {
      if (!window.confirm(form.dataset.confirm)) e.preventDefault();
    });
  });

  // ── Menu no celular ───────────────────────────────────────────────────────
  var toggle = document.querySelector('[data-menu-toggle]');
  var sidebar = document.querySelector('.sidebar');

  if (toggle && sidebar) {
    var scrim = null;

    function closeMenu() {
      sidebar.classList.remove('open');
      toggle.setAttribute('aria-expanded', 'false');
      if (scrim) {
        scrim.remove();
        scrim = null;
      }
    }

    toggle.addEventListener('click', function () {
      var open = sidebar.classList.toggle('open');
      toggle.setAttribute('aria-expanded', open ? 'true' : 'false');
      if (open) {
        scrim = document.createElement('div');
        scrim.className = 'scrim';
        scrim.addEventListener('click', closeMenu);
        document.body.appendChild(scrim);
      } else {
        closeMenu();
      }
    });

    document.addEventListener('keydown', function (e) {
      if (e.key === 'Escape') closeMenu();
    });
  }

  // ── Filtros que submetem sozinhos ────────────────────────────────────────
  document.querySelectorAll('[data-autosubmit]').forEach(function (el) {
    el.addEventListener('change', function () {
      if (el.form) el.form.submit();
    });
  });

  // ── Prévia da foto antes de enviar ───────────────────────────────────────
  document.querySelectorAll('input[type=file][data-preview]').forEach(function (input) {
    input.addEventListener('change', function () {
      var target = document.getElementById(input.dataset.preview);
      var file = input.files && input.files[0];
      if (!target || !file) return;
      var url = URL.createObjectURL(file);
      target.style.backgroundImage = 'url("' + url + '")';
      target.textContent = '';
    });
  });
})();
