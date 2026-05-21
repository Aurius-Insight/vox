import { useEffect, useState } from 'react';
import { Moon, Sun } from 'lucide-react';

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
  const label = isDark ? 'Tema claro' : 'Tema escuro';

  return (
    <button
      type="button"
      className="secondary-button sidebar-action"
      onClick={() => setTheme(isDark ? 'light' : 'dark')}
      title={label}
      aria-label={label}
    >
      {isDark ? <Sun size={16} /> : <Moon size={16} />}
      <span className="sidebar-label">{label}</span>
    </button>
  );
}
