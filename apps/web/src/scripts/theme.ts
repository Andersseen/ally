import './design-system';

const storageKey = 'ally-theme-mode';
type ThemeMode = 'light' | 'dark';

function preferredMode(): ThemeMode {
  const stored = window.localStorage.getItem(storageKey);
  if (stored === 'light' || stored === 'dark') return stored;
  return window.matchMedia('(prefers-color-scheme: dark)').matches ? 'dark' : 'light';
}

function setMode(mode: ThemeMode): void {
  document.documentElement.dataset.themeMode = mode;
  document.documentElement.style.colorScheme = mode;
  for (const toggle of document.querySelectorAll<HTMLButtonElement>('[data-theme-toggle]')) {
    toggle.setAttribute(
      'aria-label',
      mode === 'dark' ? 'Switch to light theme' : 'Switch to dark theme',
    );
    toggle.dataset.state = mode;
  }
}

setMode(preferredMode());

document.addEventListener('click', (event) => {
  const toggle = event.target instanceof Element
    ? event.target.closest<HTMLButtonElement>('[data-theme-toggle]')
    : null;
  if (toggle === null) return;

  const nextMode = document.documentElement.dataset.themeMode === 'dark' ? 'light' : 'dark';
  window.localStorage.setItem(storageKey, nextMode);
  setMode(nextMode);
});
