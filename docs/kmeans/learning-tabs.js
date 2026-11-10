(function () {
  'use strict';
  const modes = ['kmeans', 'knn', 'logit'];
  const buttons = modes.map(mode => document.getElementById(`tab-${mode}`));
  ['knn', 'logit'].forEach(mode => window.SupervisedLab.mount({ mode, container: document.getElementById(`${mode}-panel`) }));

  function activate(mode, focus = false, updateHash = true) {
    if (!modes.includes(mode)) mode = 'kmeans';
    modes.forEach((name, index) => {
      const selected = name === mode;
      buttons[index].setAttribute('aria-selected', String(selected));
      buttons[index].tabIndex = selected ? 0 : -1;
      document.getElementById(`${name}-panel`).hidden = !selected;
    });
    if (focus) document.getElementById(`tab-${mode}`).focus();
    if (updateHash) history.replaceState(null, '', `#${mode}`);
    document.dispatchEvent(new CustomEvent('learning-tab-changed', { detail: { mode } }));
  }

  buttons.forEach((button, index) => {
    button.addEventListener('click', () => activate(modes[index]));
    button.addEventListener('keydown', event => {
      let next = null;
      if (event.key === 'ArrowRight') next = (index + 1) % modes.length;
      if (event.key === 'ArrowLeft') next = (index + modes.length - 1) % modes.length;
      if (event.key === 'Home') next = 0;
      if (event.key === 'End') next = modes.length - 1;
      if (next !== null) { event.preventDefault(); activate(modes[next], true); }
    });
  });
  window.addEventListener('hashchange', () => {
    const mode = location.hash.slice(1);
    if (modes.includes(mode)) activate(mode, false, false);
  });
  activate(location.hash.slice(1), false, false);
})();
