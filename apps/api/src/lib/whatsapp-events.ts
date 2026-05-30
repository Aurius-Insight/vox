import { EventEmitter } from 'node:events';

// Barramento de eventos do chat em memoria. A ingestao do webhook e o envio
// pela UI publicam aqui; o endpoint SSE (`GET /api/whatsapp/stream`) consome.
//
// Assuncao: a API roda em UMA instancia (1 container em prod). Se um dia
// escalar horizontalmente, trocar por Redis pub/sub (ioredis ja disponivel no
// deploy atual; o adaptador Upstash HTTP nao expoe pub/sub).

export type ChatEvent =
  | { type: 'message.created'; conversationId: string; message: unknown }
  | { type: 'message.status'; conversationId: string; waMessageId: string; status: string }
  | { type: 'conversation.updated'; conversationId: string; conversation: unknown };

const emitter = new EventEmitter();
// Muitas conexoes SSE simultaneas (uma por aba/atendente) sao normais.
emitter.setMaxListeners(0);

const CHANNEL = 'chat';

export function publishChatEvent(event: ChatEvent): void {
  emitter.emit(CHANNEL, event);
}

export function subscribeChatEvents(listener: (event: ChatEvent) => void): () => void {
  emitter.on(CHANNEL, listener);
  return () => emitter.off(CHANNEL, listener);
}
