// Setup global de Vitest — corre antes de cada archivo de test.
//
// jsdom (el entorno de test configurado en vitest.config.js) no implementa
// IndexedDB (issue abierto hace años en jsdom/jsdom). Cualquier test que
// importe algo que use Dexie (offlineDb.js, Modo Offline Fase 2) rompería al
// intentar abrir la base sin este shim. `fake-indexeddb/auto` define
// `indexedDB`/`IDBKeyRange` globales en memoria — no toca nada más.
import 'fake-indexeddb/auto';
