import { api } from './client';

export type MessageDirection = 'inbound' | 'outbound';
export type MessageStatus = 'queued' | 'sent' | 'delivered' | 'read' | 'failed' | 'received';

export type ChatMessage = {
  id: string;
  direction: MessageDirection;
  type: string;
  body: string | null;
  templateName: string | null;
  status: MessageStatus;
  sentByUserId: string | null;
  createdAt: string;
};

export type ChatConversation = {
  id: string;
  name: string | null;
  phone: string;
  leadId: string | null;
  studentId: string | null;
  unreadCount: number;
  windowOpen: boolean;
  lastMessageAt: string | null;
  lastMessagePreview: { direction: MessageDirection; body: string | null; type: string } | null;
};

export type ChatTemplate = { name: string; language: string; category?: string };

// Eventos do SSE (`GET /api/whatsapp/stream`).
export type ChatStreamEvent =
  | { type: 'message.created'; conversationId: string; message: ChatMessage }
  | { type: 'message.status'; conversationId: string; waMessageId: string; status: MessageStatus }
  | { type: 'conversation.updated'; conversationId: string; conversation: unknown };

export function listConversations(search?: string) {
  const qs = search ? `?search=${encodeURIComponent(search)}&pageSize=100` : '?pageSize=100';
  return api<{ data: ChatConversation[]; total: number }>(`/api/whatsapp/conversations${qs}`);
}

export function getMessages(conversationId: string) {
  return api<{ data: ChatMessage[]; windowOpen: boolean; total: number }>(
    `/api/whatsapp/conversations/${conversationId}/messages?pageSize=200`,
  );
}

export function sendChatMessage(
  conversationId: string,
  body: { text?: string; templateName?: string; languageCode?: string },
) {
  return api<{ data: ChatMessage }>(`/api/whatsapp/conversations/${conversationId}/messages`, {
    method: 'POST',
    body: JSON.stringify(body),
  });
}

export function markConversationRead(conversationId: string) {
  return api<{ data: { id: string; unreadCount: number } }>(
    `/api/whatsapp/conversations/${conversationId}/read`,
    { method: 'POST' },
  );
}

export function listTemplates() {
  return api<{ data: ChatTemplate[] }>('/api/whatsapp/templates');
}

// --- Embedded Signup (conexão do número oficial) ---
export type ConnectConfig = {
  appId: string | null;
  configId: string | null;
  featureType: string;
  graphVersion: string;
};
export type ConnectStatus = {
  connected: boolean;
  wabaId?: string;
  phoneNumberId?: string;
  displayPhone?: string | null;
};

export function getConnectConfig() {
  return api<{ data: ConnectConfig }>('/api/whatsapp/connect/config');
}

export function getConnectStatus() {
  return api<{ data: ConnectStatus }>('/api/whatsapp/connect/status');
}

export function connectWhatsApp(body: { code: string; wabaId: string; phoneNumberId: string }) {
  return api<{ data: ConnectStatus }>('/api/whatsapp/connect', {
    method: 'POST',
    body: JSON.stringify(body),
  });
}
