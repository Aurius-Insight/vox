import { SubjectsConfigPanel } from '../components/SubjectsConfigPanel';

// Cadastro de materias (disciplinas) — antes vivia dentro de Configuracoes,
// agora tem pagina propria no menu lateral.
export function MateriasPage() {
  return (
    <main className="app-page">
      <header className="page-header">
        <div>
          <p className="eyebrow">Cadastro</p>
          <h1>Materias</h1>
        </div>
      </header>

      <SubjectsConfigPanel />
    </main>
  );
}
