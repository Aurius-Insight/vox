import { Fragment, useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { LayoutTemplate, MessageCircle, Search, Send } from 'lucide-react';
import { useToast } from '../components/ToastProvider';
import { useAuth } from '../auth/AuthProvider';
import { WhatsAppConnect } from '../components/chat/WhatsAppConnect';
import { ApiClientError } from '../api/client';
import {
  getMessages,
  listConversations,
  listTemplates,
  markConversationRead,
  sendChatMessage,
  type ChatConversation,
  type ChatMessage,
  type ChatStreamEvent,
  type ChatTemplate,
} from '../api/whatsapp';

function formatTime(iso: string | null): string {
  if (!iso) return '';
  return new Date(iso).toLocaleTimeString('pt-BR', { hour: '2-digit', minute: '2-digit' });
}

/** Iniciais para o avatar (nome > 2 letras; senao os ultimos digitos). */
function initialsOf(name: string | null, phone: string): string {
  if (name && name.trim()) {
    const parts = name.trim().split(/\s+/);
    return (parts[0][0] + (parts[1]?.[0] ?? '')).toUpperCase();
  }
  return phone.replace(/\D/g, '').slice(-2) || '#';
}

/** Rotulo do separador de data na thread. */
function dayLabel(iso: string): string {
  const d = new Date(iso);
  const today = new Date();
  const yesterday = new Date(today);
  yesterday.setDate(today.getDate() - 1);
  if (d.toDateString() === today.toDateString()) return 'Hoje';
  if (d.toDateString() === yesterday.toDateString()) return 'Ontem';
  return d.toLocaleDateString('pt-BR', { day: '2-digit', month: 'long' });
}

const STATUS_LABEL: Record<string, string> = {
  queued: 'enviando', sent: 'enviada', delivered: 'entregue', read: 'lida', failed: 'falhou', received: '',
};

export function AtendimentoPage() {
  const toast = useToast();
  const auth = useAuth();
  // Diretor conecta o numero; o revisor (App Review) tambem ve o botao p/
  // demonstrar o Facebook Login do Embedded Signup.
  const roles = auth.user?.roles ?? [];
  const canConnect = roles.includes('diretor') || roles.includes('revisor');
  const [conversations, setConversations] = useState<ChatConversation[]>([]);
  const [search, setSearch] = useState('');
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [messages, setMessages] = useState<ChatMessage[]>([]);
  const [windowOpen, setWindowOpen] = useState(false);
  const [templates, setTemplates] = useState<ChatTemplate[]>([]);
  const [draft, setDraft] = useState('');
  const [templateName, setTemplateName] = useState('');
  // Permite enviar template mesmo com a janela aberta (botão "Templates").
  const [templateMode, setTemplateMode] = useState(false);
  const [sending, setSending] = useState(false);
  const threadEndRef = useRef<HTMLDivElement>(null);
  const selectedIdRef = useRef<string | null>(null);
  selectedIdRef.current = selectedId;

  const loadConversations = useCallback(async (term?: string) => {
    const res = await listConversations(term);
    setConversations(res.data);
  }, []);

  // Carga inicial + lista de templates.
  useEffect(() => {
    void loadConversations();
    void listTemplates().then((r) => setTemplates(r.data)).catch(() => undefined);
  }, [loadConversations]);

  // Busca com debounce.
  useEffect(() => {
    const handle = setTimeout(() => void loadConversations(search || undefined), 300);
    return () => clearTimeout(handle);
  }, [search, loadConversations]);

  // Tempo real via SSE.
  useEffect(() => {
    const source = new EventSource('/api/whatsapp/stream');
    source.onmessage = (ev) => {
      let event: ChatStreamEvent;
      try {
        event = JSON.parse(ev.data) as ChatStreamEvent;
      } catch {
        return;
      }
      if (event.type === 'message.created') {
        void loadConversations();
        if (event.conversationId === selectedIdRef.current) {
          setMessages((cur) => (cur.some((m) => m.id === event.message.id) ? cur : [...cur, event.message]));
        }
      } else if (event.type === 'message.status') {
        // O cliente nao guarda o waMessageId; relê a thread aberta para refletir
        // o novo status (sent/delivered/read).
        if (event.conversationId === selectedIdRef.current) {
          void getMessages(event.conversationId).then((r) => setMessages(r.data)).catch(() => undefined);
        }
      } else if (event.type === 'conversation.updated') {
        void loadConversations();
      }
    };
    return () => source.close();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [loadConversations]);

  // Abre uma conversa: carrega a thread e marca como lida.
  const openConversation = useCallback(
    async (id: string) => {
      setSelectedId(id);
      setDraft('');
      setTemplateName('');
      setTemplateMode(false);
      try {
        const res = await getMessages(id);
        setMessages(res.data);
        setWindowOpen(res.windowOpen);
        await markConversationRead(id);
        setConversations((cur) => cur.map((c) => (c.id === id ? { ...c, unreadCount: 0 } : c)));
      } catch (err) {
        toast.error(err instanceof ApiClientError ? err.message : 'Falha ao abrir a conversa.');
      }
    },
    [toast],
  );

  useEffect(() => {
    threadEndRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [messages]);

  const selected = useMemo(
    () => conversations.find((c) => c.id === selectedId) ?? null,
    [conversations, selectedId],
  );

  async function handleSend() {
    if (!selectedId || sending) return;
    const usingTemplate = !windowOpen || templateMode;
    if (usingTemplate && !templateName) return;
    if (!usingTemplate && !draft.trim()) return;

    setSending(true);
    try {
      const tpl = templates.find((t) => t.name === templateName);
      const res = await sendChatMessage(
        selectedId,
        usingTemplate
          ? { templateName, languageCode: tpl?.language ?? 'pt_BR' }
          : { text: draft.trim() },
      );
      setMessages((cur) => [...cur, res.data]);
      setDraft('');
      void loadConversations();
    } catch (err) {
      toast.error(err instanceof ApiClientError ? err.message : 'Falha ao enviar.');
    } finally {
      setSending(false);
    }
  }

  return (
    <div className="app-page chat-page">
      <div className="page-header">
        <h1>Atendimento</h1>
        {canConnect && <WhatsAppConnect />}
      </div>

      <div className="chat-layout">
        {/* Lista de conversas */}
        <aside className="chat-list">
          <div className="chat-search">
            <Search size={16} />
            <input
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              placeholder="Buscar por nome ou telefone"
              aria-label="Buscar conversas"
            />
          </div>
          <div className="chat-list-body">
            {conversations.length === 0 ? (
              <p className="empty-state chat-empty">Nenhuma conversa ainda.</p>
            ) : (
              conversations.map((c) => (
                <button
                  key={c.id}
                  className={`chat-list-item${c.id === selectedId ? ' is-active' : ''}`}
                  onClick={() => void openConversation(c.id)}
                >
                  <span className="chat-avatar" aria-hidden>{initialsOf(c.name, c.phone)}</span>
                  <span className="chat-list-content">
                    <span className="chat-list-top">
                      <span className="chat-list-name">{c.name || c.phone}</span>
                      <span className="chat-list-time">{formatTime(c.lastMessageAt)}</span>
                    </span>
                    <span className="chat-list-bottom">
                      <span className="chat-list-preview">
                        {c.lastMessagePreview?.direction === 'outbound' ? 'Você: ' : ''}
                        {c.lastMessagePreview?.body ?? (c.lastMessagePreview ? `[${c.lastMessagePreview.type}]` : '—')}
                      </span>
                      {c.unreadCount > 0 && <span className="chat-unread">{c.unreadCount}</span>}
                    </span>
                  </span>
                </button>
              ))
            )}
          </div>
        </aside>

        {/* Thread + composer */}
        <section className="chat-thread">
          {!selected ? (
            <div className="chat-thread-empty">
              <MessageCircle size={40} />
              <p>Selecione uma conversa para começar.</p>
            </div>
          ) : (
            <>
              <header className="chat-thread-header">
                <span className="chat-avatar chat-avatar-lg" aria-hidden>
                  {initialsOf(selected.name, selected.phone)}
                </span>
                <div className="chat-thread-id">
                  <strong>{selected.name || selected.phone}</strong>
                  <span className="chat-thread-phone">{selected.phone}</span>
                </div>
                <span className={`chat-window-tag${windowOpen ? ' is-open' : ''}`}>
                  <span className="chat-window-dot" aria-hidden />
                  {windowOpen ? 'Janela aberta · 24h' : 'Janela fechada'}
                </span>
              </header>

              <div className="chat-messages">
                {messages.map((m, i) => {
                  const prev = messages[i - 1];
                  const showDay =
                    !prev || new Date(prev.createdAt).toDateString() !== new Date(m.createdAt).toDateString();
                  return (
                    <Fragment key={m.id}>
                      {showDay && (
                        <div className="chat-day">
                          <span>{dayLabel(m.createdAt)}</span>
                        </div>
                      )}
                      <div className={`chat-bubble chat-${m.direction}${m.status === 'failed' ? ' is-failed' : ''}`}>
                        <span className="chat-bubble-body">
                          {m.body ?? (m.templateName ? `Template: ${m.templateName}` : `[${m.type}]`)}
                        </span>
                        <span className="chat-bubble-meta">
                          {formatTime(m.createdAt)}
                          {m.direction === 'outbound' && STATUS_LABEL[m.status] ? ` · ${STATUS_LABEL[m.status]}` : ''}
                        </span>
                      </div>
                    </Fragment>
                  );
                })}
                <div ref={threadEndRef} />
              </div>

              <footer className="chat-composer">
                {!windowOpen || templateMode ? (
                  <>
                    <span className="chat-composer-note">
                      {windowOpen
                        ? 'Modelos aprovados da conta do WhatsApp Business:'
                        : 'Fora da janela de 24h — envie um template aprovado:'}
                    </span>
                    <select value={templateName} onChange={(e) => setTemplateName(e.target.value)}>
                      <option value="">Selecione um template…</option>
                      {templates.map((t) => (
                        <option key={`${t.name}:${t.language}`} value={t.name}>
                          {t.name} ({t.language})
                        </option>
                      ))}
                    </select>
                    {windowOpen && (
                      <button
                        type="button"
                        className="chat-tpl-toggle"
                        onClick={() => setTemplateMode(false)}
                        title="Voltar para texto"
                      >
                        Texto
                      </button>
                    )}
                    <button className="chat-send" onClick={() => void handleSend()} disabled={sending || !templateName}>
                      Enviar
                    </button>
                  </>
                ) : (
                  <>
                    <textarea
                      value={draft}
                      onChange={(e) => setDraft(e.target.value)}
                      onKeyDown={(e) => {
                        if (e.key === 'Enter' && !e.shiftKey) {
                          e.preventDefault();
                          void handleSend();
                        }
                      }}
                      placeholder="Escreva uma mensagem…"
                      rows={2}
                    />
                    <button
                      type="button"
                      className="chat-tpl-toggle"
                      onClick={() => setTemplateMode(true)}
                      title="Enviar um template aprovado"
                    >
                      <LayoutTemplate size={16} />
                      Templates
                    </button>
                    <button className="chat-send" onClick={() => void handleSend()} disabled={sending || !draft.trim()}>
                      <Send size={16} />
                    </button>
                  </>
                )}
              </footer>
            </>
          )}
        </section>
      </div>
    </div>
  );
}
