import { useSyncExternalStore } from 'react';

/**
 * Store de notificaciones "vistas / descartadas".
 *
 * Las notificaciones de KAIROX son DERIVADAS (se calculan en vivo de los datos,
 * no hay una tabla con flag `leida`). Para que una alerta "vuele" cuando el
 * usuario la abre, guardamos su `id` en un set de descartadas persistido en
 * localStorage. `useNotifications` filtra ese set antes de mostrar.
 *
 * Semántica de reaparición: mientras la condición sigue vigente (el id sigue en
 * la lista viva) la alerta queda oculta. Si la condición se resuelve (el id
 * desaparece de la lista viva), `pruneDismissed` la saca del set — así, si más
 * adelante vuelve a cumplirse, se notifica de nuevo como un evento nuevo.
 *
 * Es un store a nivel módulo (singleton) para que todas las instancias del hook
 * —Header, banners— compartan el mismo estado y se re-rendericen juntas.
 */
const STORAGE_KEY = 'kx_notif_dismissed';

let dismissed = load();
const listeners = new Set();

function load() {
  try {
    const raw = window.localStorage.getItem(STORAGE_KEY);
    return new Set(raw ? JSON.parse(raw) : []);
  } catch {
    return new Set();
  }
}

function persist() {
  try {
    window.localStorage.setItem(STORAGE_KEY, JSON.stringify([...dismissed]));
  } catch { /* localStorage lleno o no disponible — el set en memoria alcanza */ }
}

function emit() {
  listeners.forEach((l) => l());
}

export function dismissNotification(id) {
  if (!id || dismissed.has(id)) return;
  dismissed = new Set(dismissed).add(id); // nueva referencia → useSyncExternalStore detecta el cambio
  persist();
  emit();
}

/**
 * Saca del set las descartadas que ya no están en `validIds` (condiciones
 * resueltas), para que no se acumulen y para permitir re-notificar si vuelven.
 */
export function pruneDismissed(validIds) {
  if (dismissed.size === 0) return;
  const valid = validIds instanceof Set ? validIds : new Set(validIds);
  let cambió = false;
  const next = new Set();
  for (const id of dismissed) {
    if (valid.has(id)) next.add(id);
    else cambió = true;
  }
  if (cambió) {
    dismissed = next;
    persist();
    emit();
  }
}

function subscribe(cb) {
  listeners.add(cb);
  return () => listeners.delete(cb);
}

function getSnapshot() {
  return dismissed;
}

export function useDismissedNotifications() {
  return useSyncExternalStore(subscribe, getSnapshot, getSnapshot);
}
