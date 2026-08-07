import { useState, useEffect, useRef, useCallback } from 'react';

// Modo Offline del POS — Fase 1 + mejora post-Fase 3. Detección de conectividad
// en dos capas:
//   1. navigator.onLine + eventos 'online'/'offline' del browser — reacción
//      inmediata a nivel de interfaz de red (síncrona, sin esperar nada).
//   2. Ping liviano a Supabase — navigator.onLine sólo dice si hay una
//      interfaz de red activa, no si hay salida real a internet ni si
//      Supabase específicamente es alcanzable (wifi conectado a un router sin
//      internet reporta `true`). Sin esto, el POS intentaría la RPC online,
//      esperaría el timeout de red completo, y recién ahí encolaría la venta
//      offline — con el ping, se detecta antes.
//
// isOnline final = navOnline && pingOk. Cualquiera de las dos señales puede
// bajarlo a false; ambas tienen que decir "sí" para considerar que hay
// conexión real.

const PING_INTERVAL_MS = 20000;
const PING_TIMEOUT_MS = 4000;

async function pingSupabase() {
  const url = import.meta.env.VITE_SUPABASE_URL;
  const anonKey = import.meta.env.VITE_SUPABASE_ANON_KEY;
  if (!url) return true; // sin URL configurada (entorno raro) — no bloquear por esto

  const controller = new AbortController();
  const timeoutId = setTimeout(() => controller.abort(), PING_TIMEOUT_MS);
  try {
    // GET a /auth/v1/health — a propósito, no /rest/v1/. Verificado a mano:
    // /rest/v1/ siempre devuelve 401 para el rol `anon` (RLS le niega
    // EXECUTE sobre get_my_empresa_id(), por diseño — no es un problema de
    // falta de apikey), incluso mandando el apikey correcto. El propio
    // supabase-js parchea `fetch` globalmente y loguea cada 401 como error
    // de consola, generando ruido cada 20s que tapa errores reales — por
    // eso el ping antes parecía "funcionar" (isOnline quedaba bien) pero
    // ensuciaba la consola. /auth/v1/health SÍ es público (sólo necesita el
    // apikey, ninguna sesión) y devuelve 200 real — sin HEAD (405, no
    // soportado ahí), por eso GET.
    await fetch(`${url}/auth/v1/health`, {
      method: 'GET',
      headers: anonKey ? { apikey: anonKey } : undefined,
      signal: controller.signal,
    });
    return true;
  } catch {
    return false;
  } finally {
    clearTimeout(timeoutId);
  }
}

export function useOnlineStatus() {
  const [navOnline, setNavOnline] = useState(
    typeof navigator !== 'undefined' ? navigator.onLine : true,
  );
  const [pingOk, setPingOk] = useState(true);
  const pingingRef = useRef(false);
  const mountedRef = useRef(true);

  const runPing = useCallback(async () => {
    if (pingingRef.current) return;
    pingingRef.current = true;
    const ok = await pingSupabase();
    pingingRef.current = false;
    if (mountedRef.current) setPingOk(ok);
  }, []);

  useEffect(() => {
    mountedRef.current = true;
    return () => {
      mountedRef.current = false;
    };
  }, []);

  useEffect(() => {
    const handleOnline = () => {
      setNavOnline(true);
      runPing();
    };
    const handleOffline = () => setNavOnline(false);

    window.addEventListener('online', handleOnline);
    window.addEventListener('offline', handleOffline);

    return () => {
      window.removeEventListener('online', handleOnline);
      window.removeEventListener('offline', handleOffline);
    };
  }, [runPing]);

  // Ping periódico mientras el navegador cree que hay conexión — agarra el
  // caso "wifi conectado sin salida real a internet" que navigator.onLine no
  // puede detectar por sí solo. Se detiene por completo si navOnline es
  // false (no tiene sentido pinguear sin interfaz de red).
  useEffect(() => {
    if (!navOnline) return undefined;
    runPing();
    const intervalId = setInterval(runPing, PING_INTERVAL_MS);
    return () => clearInterval(intervalId);
  }, [navOnline, runPing]);

  return navOnline && pingOk;
}
