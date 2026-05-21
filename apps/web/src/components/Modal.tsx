import { useEffect, type ReactNode } from 'react';

type ModalProps = {
  title: string;
  onClose: () => void;
  children: ReactNode;
};

/**
 * Pop-up modal padrao da Vox: fundo escurecido, entrada animada (via CSS),
 * fecha no Esc, no clique fora ou no botao X. Usa as classes .modal-* do
 * main.css. Padrao para todos os formularios de cadastro.
 */
export function Modal({ title, onClose, children }: ModalProps) {
  useEffect(() => {
    function onKey(event: KeyboardEvent) {
      if (event.key === 'Escape') onClose();
    }
    document.addEventListener('keydown', onKey);
    document.body.style.overflow = 'hidden';
    return () => {
      document.removeEventListener('keydown', onKey);
      document.body.style.overflow = '';
    };
  }, [onClose]);

  return (
    <div className="modal-overlay" onClick={onClose}>
      <section
        className="form-card modal-card"
        onClick={(event) => event.stopPropagation()}
        role="dialog"
        aria-modal="true"
        aria-label={title}
      >
        <header className="modal-header">
          <h2>{title}</h2>
          <button type="button" className="modal-close" onClick={onClose} aria-label="Fechar">
            ✕
          </button>
        </header>
        {children}
      </section>
    </div>
  );
}
