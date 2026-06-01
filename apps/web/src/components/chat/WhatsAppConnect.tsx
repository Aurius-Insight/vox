import { useCallback, useEffect, useRef, useState } from 'react';
import { CheckCircle2, Link2 } from 'lucide-react';
import { ApiClientError } from '../../api/client';
import { useToast } from '../ToastProvider';
import {
  connectWhatsApp,
  getConnectConfig,
  getConnectStatus,
  type ConnectConfig,
  type ConnectStatus,
} from '../../api/whatsapp';

// Embedded Signup (Coexistência): conecta o número oficial da VOX. Só roda de
// verdade após o Advanced Access aprovado (App Review). Ver docs/APP_REVIEW_COEX.md.

// eslint-disable-next-line @typescript-eslint/no-explicit-any
declare global {
  interface Window {
    FB?: any; // eslint-disable-line @typescript-eslint/no-explicit-any
    fbAsyncInit?: () => void;
  }
}

const SDK_SRC = 'https://connect.facebook.net/en_US/sdk.js';

function loadSdk(appId: string, version: string): Promise<void> {
  return new Promise((resolve) => {
    if (window.FB) {
      resolve();
      return;
    }
    window.fbAsyncInit = () => {
      window.FB.init({ appId, autoLogAppEvents: true, xfbml: false, version });
      resolve();
    };
    const script = document.createElement('script');
    script.src = SDK_SRC;
    script.async = true;
    script.defer = true;
    script.crossOrigin = 'anonymous';
    document.body.appendChild(script);
  });
}

export function WhatsAppConnect() {
  const toast = useToast();
  const [config, setConfig] = useState<ConnectConfig | null>(null);
  const [status, setStatus] = useState<ConnectStatus | null>(null);
  const [busy, setBusy] = useState(false);
  // phone_number_id + waba_id chegam pelo evento `message` do popup da Meta.
  const sessionRef = useRef<{ wabaId?: string; phoneNumberId?: string }>({});

  useEffect(() => {
    void getConnectConfig().then((r) => setConfig(r.data)).catch(() => undefined);
    void getConnectStatus().then((r) => setStatus(r.data)).catch(() => undefined);
  }, []);

  useEffect(() => {
    const handler = (event: MessageEvent) => {
      if (!event.origin.endsWith('facebook.com')) return;
      try {
        const data = typeof event.data === 'string' ? JSON.parse(event.data) : event.data;
        if (data?.type === 'WA_EMBEDDED_SIGNUP' && typeof data.event === 'string' && data.event.startsWith('FINISH')) {
          sessionRef.current = { wabaId: data.data?.waba_id, phoneNumberId: data.data?.phone_number_id };
        }
      } catch {
        // mensagens nao-JSON do SDK — ignora
      }
    };
    window.addEventListener('message', handler);
    return () => window.removeEventListener('message', handler);
  }, []);

  const handleConnect = useCallback(async () => {
    if (!config?.appId || !config?.configId) {
      toast.error('Configuração do Embedded Signup ausente.');
      return;
    }
    await loadSdk(config.appId, config.graphVersion);
    setBusy(true);
    window.FB.login(
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      (response: any) => {
        const code = response?.authResponse?.code;
        if (!code) {
          setBusy(false);
          toast.error('Conexão cancelada.');
          return;
        }
        const sess = sessionRef.current;
        connectWhatsApp({ code, wabaId: sess.wabaId ?? '', phoneNumberId: sess.phoneNumberId ?? '' })
          .then((r) => {
            setStatus(r.data);
            toast.success('WhatsApp oficial conectado!');
          })
          .catch((err) => toast.error(err instanceof ApiClientError ? err.message : 'Falha ao conectar.'))
          .finally(() => setBusy(false));
      },
      {
        config_id: config.configId,
        response_type: 'code',
        override_default_response_type: true,
        extras: { setup: {}, featureType: config.featureType, sessionInfoVersion: 3 },
      },
    );
  }, [config, toast]);

  if (status?.connected) {
    return (
      <span className="wa-connect wa-connect-ok" title={`WABA ${status.wabaId}`}>
        <CheckCircle2 size={15} />
        Número oficial conectado
      </span>
    );
  }

  return (
    <button className="wa-connect" onClick={() => void handleConnect()} disabled={busy || !config?.configId}>
      <Link2 size={15} />
      {busy ? 'Conectando…' : 'Conectar WhatsApp oficial'}
    </button>
  );
}
