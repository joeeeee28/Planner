import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import '@fontsource-variable/inter';
import '@fontsource/instrument-serif';
import './styles.css';
import App from './App';
import { STORAGE_KEY } from './lib/defaults';

// Set the theme before first paint to avoid a flash of the wrong theme.
try {
  const stored = JSON.parse(localStorage.getItem(STORAGE_KEY) ?? 'null');
  const theme = stored?.settings?.theme ?? 'light';
  const dark = theme === 'dark' || (theme === 'system' && window.matchMedia('(prefers-color-scheme: dark)').matches);
  document.documentElement.setAttribute('data-theme', dark ? 'dark' : 'light');
} catch {
  document.documentElement.setAttribute('data-theme', 'light');
}

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <App />
  </StrictMode>,
);
