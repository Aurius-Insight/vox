# Design System Vox RJ MVP

## Direcao visual

Linguagem inspirada no macOS: interface clara e calma, fundo cinza claro,
superficies brancas, profundidade sutil (sombras leves, raios generosos),
azul Apple como acento interativo. O dourado VOX e mantido em uso minimo,
apenas como toque de marca.

## Tokens principais

| Token | Valor | Uso |
|---|---|---|
| `--background` | `#f5f5f7` | Fundo das paginas (cinza claro macOS). |
| `--surface` | `#ffffff` | Cards, paineis e tabelas. |
| `--surface-2` | `#fbfbfd` | Hover de linhas e superficies alternativas. |
| `--surface-sunken` | `#ececed` | Tiles, tracks e blocos rebaixados. |
| `--sidebar-bg` | `rgba(255,255,255,0.72)` | Sidebar translucida com `backdrop-filter`. |
| `--primary` / `--text` | `#1d1d1f` | Texto forte (quase-preto Apple). |
| `--text-muted` | `#6e6e73` | Texto secundario. |
| `--text-soft` | `#8e8e93` | Labels, eyebrows e cabecalhos de tabela. |
| `--accent` | `#0071e3` | Azul Apple: botoes, links, foco, item ativo. |
| `--accent-soft` | `rgba(0,113,227,0.1)` | Fundo de item ativo e selecao. |
| `--secondary` | `#c79a2e` | Dourado VOX, uso minimo (selo da marca, saldo). |
| `--error` | `#ff3b30` | Vermelho Apple para erros. |
| `--border` | `rgba(0,0,0,0.08)` | Bordas hairline. |

## Componentes

- Cards: raio de 14px (`--radius`), borda hairline e sombra baixa (`--shadow-sm`).
- Botoes primarios: fundo azul `--accent`, texto branco, raio 9px.
- Botoes secundarios: cinza translucido (`rgba(0,0,0,0.05)`), texto escuro.
- Botoes desabilitados: superficie rebaixada, texto suave.
- Inputs/selects: branco, borda hairline, foco com anel azul (`box-shadow` 4px).
- Chips/status: pill cinza neutro, texto muted.
- Sidebar: translucida com `backdrop-filter: blur`, item ativo com fundo azul suave.
- Painel de saldo: card branco com o numero grande em dourado (`--secondary`).
- Tabelas: cabecalhos pequenos, uppercase, peso 600, cor suave.

## Tipografia

- Headings: `Hanken Grotesk` (variavel, 400-900), com `letter-spacing` negativo
  (~ -0.02em) nos titulos grandes, no estilo dos titulos do macOS.
- Corpo: `Inter` (variavel, 100-900) — substituta proxima da San Francisco.
- Suavizacao: `-webkit-font-smoothing: antialiased`.
- Todos os `.woff2` ficam em `apps/web/public/fonts` e sao declarados em
  `apps/web/src/styles/fonts.css`, servidos localmente (sem Google Fonts em runtime).
  - `Inter` veio do export do Design System (`Design System/assets`).
  - `Hanken Grotesk` nao estava no export; foi baixada do Google Fonts (subsets
    latin e latin-ext) e adicionada ao mesmo diretorio.
- Fallback: `ui-sans-serif, system-ui, -apple-system, ...`.

## Layout

- Max width: `1180px`.
- Gutter desktop: `2.25rem`.
- Gutter mobile: `1.1rem`.
- Sidebar fixa (`position: sticky`) de 250px no desktop; vira barra superior no mobile.
- Mobile first para portal, chamada e agenda.
- Evitar cards dentro de cards. Secoes devem ser areas abertas; cards ficam para itens
  repetidos, metricas e paineis pontuais.

## Aplicacao atual

O arquivo base do MVP e `apps/web/src/styles/main.css`, que importa
`fonts.css` (Inter + Hanken Grotesk locais).

Assets vindos do Design System:

- Fontes Inter em `apps/web/public/fonts`.
- `apps/web/public/images/portal-hero.jpg` usado no hero do portal.

A pagina do portal ja usa:

- Hero visual com imagem local servida pelo proprio app.
- Painel de saldo branco com numeral dourado.
- Lista de aulas como cards repetidos.
- Status chip neutro para aula confirmada/disponivel.

Observacao: as imagens do export do Design System sao demonstrativas (modelos,
gradientes). Substituir por fotografia real da Vox RJ quando disponivel.
