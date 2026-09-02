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

      /*
       * Modal compartilhado por várias fotos (mover foto para outro animal).
       * Quem diz de qual foto se trata é o botão que abriu — assim a galeria
       * não precisa de um <dialog> repetido por imagem.
       */
      if (trigger.dataset.photoId) {
        var idField = dialog.querySelector('[data-photo-id-field]');
        if (idField) idField.value = trigger.dataset.photoId;

        var preview = dialog.querySelector('[data-photo-preview]');
        if (preview) preview.src = '/media/photo/' + encodeURIComponent(trigger.dataset.photoId);

        var label = dialog.querySelector('[data-photo-label]');
        if (label) label.textContent = trigger.dataset.photoLabel || '';
      }

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

  // ── Compressão de imagem antes do upload ─────────────────────────────────
  /*
   * Foto de celular chega com 3–5 MB. Subir crua estoura duas coisas: a cota de
   * 5 GB do Turso (imagem e documento vivem como BLOB no banco, ver db/schema.js)
   * e o teto de 4,5 MB que a Vercel impõe ao corpo de request e response de
   * função — acima disso o upload morre antes de chegar no multer, e o usuário
   * vê erro cru da plataforma em vez da nossa tela.
   *
   * Reduzir aqui resolve os dois. E não custa qualidade visível: o app só
   * desenha foto como background-image em .animal-photo / .profile-photo, que
   * não passam de ~400 CSS px, então 1600px continua sendo mais resolução do
   * que a tela chega a usar.
   *
   * Isto é conveniência de cliente, não controle de segurança — quem quiser
   * posta o arquivo cru direto na rota. O limite que vale é o do multer.
   */
  var PERFIS_COMPRESSAO = {
    photo: { maxLado: 1600, qualidade: 0.82 },
    // Papel fotografado (exame, receita): texto precisa de mais pixel e sofre
    // mais com artefato, então sobe a resolução e a qualidade.
    doc: { maxLado: 2000, qualidade: 0.88 }
  };

  // GIF fica de fora de propósito: desenhar no canvas achata a animação num
  // quadro só. PDF/DOC/XLS também passam intactos — PDF já é comprimido por
  // dentro (FlateDecode), e reescrever um no navegador não é viável.
  var TIPOS_COMPRIMIVEIS = ['image/jpeg', 'image/png', 'image/webp'];

  // Abaixo disto o ganho não paga o retrabalho.
  var MINIMO_PARA_COMPRIMIR = 300 * 1024;

  var compressoesPendentes = new WeakMap();

  function podeTrocarArquivo() {
    return typeof DataTransfer === 'function' && typeof Promise === 'function';
  }

  /*
   * createImageBitmap com imageOrientation respeita o EXIF. Sem isso, foto
   * tirada em pé no celular é gravada deitada — o canvas ignora a rotação que
   * o navegador aplicaria sozinho ao exibir a imagem.
   */
  function carregarImagem(file) {
    function viaTagImg() {
      return new Promise(function (resolver, rejeitar) {
        var url = URL.createObjectURL(file);
        var img = new Image();
        img.onload = function () {
          URL.revokeObjectURL(url);
          resolver(img);
        };
        img.onerror = function () {
          URL.revokeObjectURL(url);
          rejeitar();
        };
        img.src = url;
      });
    }

    if (typeof createImageBitmap !== 'function') return viaTagImg();
    try {
      return createImageBitmap(file, { imageOrientation: 'from-image' }).catch(viaTagImg);
    } catch (e) {
      return viaTagImg();
    }
  }

  function canvasParaBlob(canvas, tipo, qualidade) {
    return new Promise(function (resolver) {
      canvas.toBlob(resolver, tipo, qualidade);
    });
  }

  function comprimirImagem(file, perfil) {
    return carregarImagem(file).then(function (fonte) {
      var largura = fonte.width;
      var altura = fonte.height;
      var escala = Math.min(1, perfil.maxLado / Math.max(largura, altura));

      var canvas = document.createElement('canvas');
      canvas.width = Math.round(largura * escala);
      canvas.height = Math.round(altura * escala);

      var ctx = canvas.getContext('2d');
      // PNG com transparência vira fundo preto ao cair no JPEG; o branco evita
      // a surpresa e é inofensivo em foto, que não tem alfa.
      ctx.fillStyle = '#fff';
      ctx.fillRect(0, 0, canvas.width, canvas.height);
      ctx.drawImage(fonte, 0, 0, canvas.width, canvas.height);
      if (fonte.close) fonte.close();

      return canvasParaBlob(canvas, 'image/webp', perfil.qualidade).then(function (blob) {
        // Navegador sem encoder WebP devolve PNG silenciosamente, e aí o arquivo
        // incha em vez de encolher. O tipo de volta denuncia; cai no JPEG.
        if (blob && blob.type === 'image/webp') return blob;
        return canvasParaBlob(canvas, 'image/jpeg', perfil.qualidade);
      });
    });
  }

  // O nome é o que aparece na lista de documentos, então a extensão precisa
  // acompanhar o formato novo.
  function renomearPara(nome, tipo) {
    var base = String(nome || 'arquivo').replace(/\.[^.]+$/, '');
    return base + (tipo === 'image/webp' ? '.webp' : '.jpg');
  }

  document.querySelectorAll('input[type=file][data-compress]').forEach(function (input) {
    var perfil = PERFIS_COMPRESSAO[input.dataset.compress] || PERFIS_COMPRESSAO.photo;

    input.addEventListener('change', function () {
      compressoesPendentes.delete(input);

      var file = input.files && input.files[0];
      if (!file) return;
      if (TIPOS_COMPRIMIVEIS.indexOf(file.type) === -1) return;
      if (file.size < MINIMO_PARA_COMPRIMIR) return;
      if (!podeTrocarArquivo()) return;

      var trabalho = comprimirImagem(file, perfil)
        .then(function (blob) {
          // Imagem já pequena ou já otimizada às vezes cresce ao ser reencodada.
          if (!blob || blob.size >= file.size) return;

          var reduzido = new File([blob], renomearPara(file.name, blob.type), {
            type: blob.type
          });
          var dt = new DataTransfer();
          dt.items.add(reduzido);
          input.files = dt.files;
        })
        .catch(function () {
          /* Qualquer falha: segue com o original e deixa o multer decidir. */
        })
        .then(function () {
          compressoesPendentes.delete(input);
        });

      compressoesPendentes.set(input, trabalho);
    });
  });

  /*
   * A compressão é assíncrona. Se o usuário escolhe o arquivo e envia no mesmo
   * segundo, o submit sairia com o original — justamente o caso que estoura o
   * limite. Aqui o envio espera terminar e só então segue.
   */
  document.querySelectorAll('form').forEach(function (form) {
    if (!form.querySelector('input[type=file][data-compress]')) return;

    form.addEventListener('submit', function (e) {
      // Um data-confirm recusado já cancelou o envio; não ressuscitar.
      if (e.defaultPrevented) return;

      var esperar = [];
      form.querySelectorAll('input[type=file][data-compress]').forEach(function (input) {
        var pendente = compressoesPendentes.get(input);
        if (pendente) esperar.push(pendente);
      });
      if (!esperar.length) return;

      e.preventDefault();
      Promise.all(esperar).then(function () {
        form.submit();
      });
    });
  });
})();
