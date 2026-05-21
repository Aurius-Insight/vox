import { useEffect, useState } from 'react';

type Theme = 'light' | 'dark';

function currentTheme(): Theme {
  return document.documentElement.getAttribute('data-theme') === 'dark' ? 'dark' : 'light';
}

/**
 * Alterna entre tema claro e escuro. O tema inicial e aplicado pelo script
 * inline no index.html (antes do React montar) para evitar flash de tema.
 */
export function ThemeToggle() {
  const [theme, setTheme] = useState<Theme>(currentTheme);

  useEffect(() => {
    document.documentElement.setAttribute('data-theme', theme);
    try {
      localStorage.setItem('vox-theme', theme);
    } catch {
      // localStorage indisponivel (ex.: navegacao privada) — segue sem persistir.
    }
  }, [theme]);

  const isDark = theme === 'dark';

  return (
    <button
      type="button"
      className="secondary-button"
      onClick={() => setTheme(isDark ? 'light' : 'dark')}
      aria-label={isDark ? 'Mudar para tema claro' : 'Mudar para tema escuro'}
    >
      {isDark ? '☀ Tema claro' : '☾ Tema escuro'}
    </button>
  );
}
