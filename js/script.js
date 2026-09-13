(function () {
  'use strict';

  var MOTION_KEY = 'lui-reduce-motion';
  var motionToggle = document.getElementById('motion-toggle');

  function applyMotionPref(reduced) {
    document.body.classList.toggle('reduce-motion', reduced);
    if (motionToggle) {
      motionToggle.setAttribute('aria-pressed', String(reduced));
    }
  }

  function initMotionToggle() {
    if (!motionToggle) return;

    var stored = null;
    try {
      stored = localStorage.getItem(MOTION_KEY);
    } catch (e) {
      stored = null;
    }

    var systemPrefersReduced = window.matchMedia('(prefers-reduced-motion: reduce)').matches;
    var initial = stored !== null ? stored === 'true' : systemPrefersReduced;
    applyMotionPref(initial);

    motionToggle.addEventListener('click', function () {
      var next = motionToggle.getAttribute('aria-pressed') !== 'true';
      applyMotionPref(next);
      try {
        localStorage.setItem(MOTION_KEY, String(next));
      } catch (e) {
        /* localStorage unavailable; preference just won't persist */
      }
    });
  }

  // Single shared <dialog> component; each folder (or in-modal jump link)
  // loads its content component (a <template>) into it, so the modal shell
  // and its open/close behavior exist once.
  function initFolderModals() {
    var dialog = document.getElementById('app-modal');
    var content = document.getElementById('modal-content');
    var panel = dialog ? dialog.querySelector('.modal-panel') : null;
    if (!dialog || !content || !panel || typeof dialog.showModal !== 'function') return;

    var lastTrigger = null;
    var tabs = dialog.querySelectorAll('.modal-tab');

    function resetModalScroll() {
      panel.scrollTop = 0;
      content.scrollTop = 0;
      dialog.scrollTop = 0;

      // Opening a previously scrolled <dialog> can restore its old position
      // after layout. Reset once more on the next painted frame.
      window.requestAnimationFrame(function () {
        panel.scrollTop = 0;
        content.scrollTop = 0;
        dialog.scrollTop = 0;
      });
    }

    function setActiveTab(key) {
      tabs.forEach(function (tab) {
        var isActive = tab.getAttribute('data-template') === key;
        tab.classList.toggle('active', isActive);
        tab.setAttribute('aria-current', isActive ? 'true' : 'false');
      });
    }

    function loadTemplate(key, focusHeading) {
      var tpl = document.getElementById('tpl-' + key);
      if (!tpl) return;

      content.innerHTML = '';
      content.appendChild(tpl.content.cloneNode(true));
      resetModalScroll();
      setActiveTab(key);

      if (focusHeading) {
        var heading = content.querySelector('#modal-title');
        if (heading) {
          heading.setAttribute('tabindex', '-1');
          heading.focus();
        }
      }
    }

    // Folder icons / hero strength shortcuts open the dialog fresh
    document.querySelectorAll('[data-template]:not(.modal-tab)').forEach(function (btn) {
      btn.addEventListener('click', function () {
        loadTemplate(btn.getAttribute('data-template'), false);
        lastTrigger = btn;
        dialog.showModal();
        resetModalScroll();
        document.body.classList.add('modal-open');
      });
    });

    // Tabs at the top of an open modal swap content without closing it
    tabs.forEach(function (tab) {
      tab.addEventListener('click', function () {
        loadTemplate(tab.getAttribute('data-template'), true);
      });
    });

    // In-modal "jump to related folder" buttons swap content without closing the dialog
    content.addEventListener('click', function (event) {
      var jumpBtn = event.target.closest('[data-jump-to]');
      if (jumpBtn) {
        loadTemplate(jumpBtn.getAttribute('data-jump-to'), true);
      }
    });

    var closeBtn = dialog.querySelector('[data-close]');
    if (closeBtn) {
      closeBtn.addEventListener('click', function () {
        dialog.close();
      });
    }

    // Click on the backdrop (the <dialog> element itself, outside .modal-panel) closes it
    dialog.addEventListener('click', function (event) {
      if (event.target === dialog) {
        dialog.close();
      }
    });

    dialog.addEventListener('close', function () {
      document.body.classList.remove('modal-open');
      if (lastTrigger) {
        lastTrigger.focus();
      }
    });
  }

  function initScopeDetails() {
    document.querySelectorAll('.scope-details > summary').forEach(function (summary) {
      summary.addEventListener('click', function (event) {
        event.preventDefault();
        var details = summary.parentElement;
        details.open = !details.open;
      });
    });
  }

  initMotionToggle();
  initFolderModals();
  initScopeDetails();
})();
