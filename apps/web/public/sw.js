// Service worker minimo: habilita a instalacao do app ("adicionar a tela inicial"
// / iconezinho no navegador). Ainda nao faz cache offline -- so passa as
// requisicoes adiante. Cache offline pode ser adicionado depois.
self.addEventListener('install', () => {
  self.skipWaiting();
});

self.addEventListener('activate', (event) => {
  event.waitUntil(self.clients.claim());
});

self.addEventListener('fetch', () => {
  // Sem intercepcao: o navegador trata a requisicao normalmente.
});
