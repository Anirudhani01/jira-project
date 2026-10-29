// Applies the saved theme before first paint (no flash). External file: the CSP forbids inline scripts.
try {
  var saved = localStorage.getItem('theme');
  // Keep in sync with DEFAULT_PREFERENCE in src/theme/ThemeProvider.tsx (dark is opt-in for now).
  var dark =
    saved === 'dark' || (saved === 'system' && matchMedia('(prefers-color-scheme: dark)').matches);
  document.documentElement.dataset.theme = dark ? 'dark' : 'light';
} catch (e) {
  document.documentElement.dataset.theme = 'light';
}
