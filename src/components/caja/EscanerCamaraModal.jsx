import { useEffect, useRef, useState, useCallback } from 'react';
// Lector de códigos 1D (lineales) únicamente — cubre EAN-13/EAN-8/UPC/Code128/
// Code39/ITF, que son los que llevan los productos de retail. Antes se usaba
// BrowserMultiFormatReader, que además prueba QR, DataMatrix, PDF417 y Aztec en
// CADA cuadro de video: trabajo de más que hacía la lectura notoriamente más
// lenta ("no lo toma", 12/08). Si algún día hiciera falta escanear un QR acá,
// volver a MultiFormat es cambiar solo esta línea.
import { BrowserMultiFormatOneDReader } from '@zxing/browser';
import { Camera, AlertTriangle, Loader2, Check, Ban } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription } from '@/components/ui/dialog';

// Arranque en dos etapas, para no tener que elegir entre "abre rápido" y "lee
// bien" (12/08 — Nadia reportó desde producción que abría lento y quedaba en
// negro un buen rato, en PC y celular):
//
//   Etapa 1 (CONSTRAINTS_INICIALES): se le pide a la cámara lo mínimo. Pedirle
//   de entrada alta resolución obliga al hardware a inicializarse directamente
//   en ese modo, que es justamente lo que hace lenta la apertura. Así el video
//   aparece cuanto antes.
//
//   Etapa 2 (CALIDAD_ALTA): con la cámara ya andando, se sube la calidad sobre
//   el track existente con applyConstraints — ajusta sin reiniciar el
//   dispositivo. Acá va la resolución alta (a 640x480 un código de barras solo
//   se lee casi pegado al lente, causa del "hay que acercar mucho") y el
//   enfoque continuo. Si la cámara no soporta algo de esto, falla solo esta
//   parte y se sigue escaneando con lo que haya — nunca rompe el escaneo.
const CONSTRAINTS_INICIALES = { facingMode: { ideal: 'environment' } };

const CALIDAD_ALTA = {
  width:  { ideal: 1280 },
  height: { ideal: 720 },
  // `advanced` porque no todos los navegadores soportan focusMode: el que no lo
  // entiende lo ignora, en vez de rechazar el ajuste entero.
  advanced: [{ focusMode: 'continuous' }],
};

// Cuánto ignorar una relectura del MISMO código. La cámara decodifica varias
// veces por segundo, así que sin esto un solo producto apoyado frente al lente
// se cargaría decenas de veces. 2s es el tiempo típico que tarda una persona en
// cambiar de producto.
const MS_MISMO_CODIGO = 2000;

function mensajeError(err) {
  if (err?.name === 'NotAllowedError' || err?.name === 'PermissionDeniedError') {
    return 'Permiso de cámara denegado — habilitalo en la configuración del navegador para escanear.';
  }
  if (err?.name === 'NotFoundError' || err?.name === 'DevicesNotFoundError') {
    return 'No se encontró ninguna cámara en este dispositivo.';
  }
  if (err?.name === 'NotReadableError') {
    return 'La cámara está siendo usada por otra aplicación. Cerrá otras pestañas o programas que puedan tenerla abierta (Zoom, Teams, otra pestaña de KAIROX, la app Cámara de Windows) e intentá de nuevo.';
  }
  if (err?.name === 'AbortError' || err?.message === 'timeout') {
    return 'El navegador no respondió al pedir la cámara. Puede estar tomada por otra app — cerrá otras pestañas/programas que la usen e intentá de nuevo.';
  }
  return `No se pudo iniciar la cámara${err?.name ? ` (${err.name})` : ''}.`;
}

// Se usó `decodeFromConstraints` (que le pide la cámara a `getUserMedia` por
// dentro, como caja negra) hasta el 12/08 — cuando falla no hay forma de saber
// SI el problema es el pedido a la cámara o algo posterior en la librería. Acá
// se pide la cámara directo con la API del navegador, con un timeout propio
// (`Promise.race`) que si se cumple, dispara un `AbortError` — así un cuelgue
// real de `getUserMedia` (síntoma reportado en producción el 12/08: permiso ya
// concedido, pantalla negra, nunca conecta) se distingue de cualquier otro
// error, y el mensaje se lo puede decir explícitamente al usuario en vez de un
// genérico "tardó demasiado".
function getUserMediaConTimeout(constraints, ms) {
  return Promise.race([
    navigator.mediaDevices.getUserMedia(constraints),
    new Promise((_, reject) => setTimeout(() => reject(Object.assign(new Error('timeout'), { name: 'AbortError' })), ms)),
  ]);
}

/**
 * Escaneo de código de barras con la cámara del dispositivo — complemento del
 * lector físico (keyboard wedge), útil para un mostrador secundario sin lector
 * o venta ambulante desde un celular. Usa ZXing (decodificación en JS puro) en
 * vez de la BarcodeDetector nativa del navegador porque esa API no existe en
 * Safari/iOS — con ZXing el escaneo funciona igual en iPhone que en Android.
 *
 * Escanea EN TANDA: la cámara no se cierra al leer un código (pedido de Nadia,
 * 12/08 — antes había que reabrirla producto por producto). Cada lectura se va
 * apilando en la lista lateral y suena un beep, como un lector de supermercado.
 *
 * `onDetectado(codigo)` debe devolver `{ ok, nombre }` para poder mostrar en la
 * lista si el código correspondía a un producto real o no.
 */
export default function EscanerCamaraModal({ open, onClose, onDetectado }) {
  const videoRef = useRef(null);
  const controlsRef = useRef(null);
  const [error, setError] = useState(null);
  const [cargando, setCargando] = useState(true);
  // Resolución real que terminó entregando la cámara. Se muestra en pantalla
  // porque "pedir" 1280x720 no garantiza recibirlo — si un dispositivo devuelve
  // 640x480 igual, saberlo de un vistazo explica al toque por qué cuesta leer
  // el código, en vez de quedar adivinando.
  const [resolucion, setResolucion] = useState(null);
  // Se enciende si la cámara tarda en abrir, para avisar en pantalla en vez de
  // dejar un rectángulo negro que parece colgado.
  const [demorado, setDemorado] = useState(false);
  const [historial, setHistorial] = useState([]); // [{ id, ok, texto, codigo }]
  const [ultimo, setUltimo] = useState(null);     // para el flash verde/rojo sobre el video

  // El callback vive en un ref para que cambiar de identidad NO reinicie la
  // cámara: en modo continuo, un re-render del padre cortaría el escaneo a la
  // mitad. El efecto de abajo depende solo de `open`.
  const onDetectadoRef = useRef(onDetectado);
  useEffect(() => { onDetectadoRef.current = onDetectado; }, [onDetectado]);

  // Estado del anti-repetición, en refs: se leen dentro del callback de ZXing,
  // que no se re-crea en cada render.
  const ultimoCodigoRef = useRef({ codigo: null, t: 0 });
  const procesandoRef = useRef(false);
  const audioRef = useRef(null);

  // Beep sintetizado con Web Audio en vez de un archivo de audio: no agrega un
  // asset al bundle, no puede fallar por 404 ni por caché, y suena igual en
  // todos los dispositivos. Agudo y corto = leído; grave y doble = no encontrado.
  const beep = useCallback((ok) => {
    const ctx = audioRef.current;
    if (!ctx) return;
    try {
      const t0 = ctx.currentTime;
      const tono = (freq, desde, dur) => {
        const osc = ctx.createOscillator();
        const vol = ctx.createGain();
        osc.type = 'square'; // más parecido al chirp de un lector real que una sinusoide
        osc.frequency.value = freq;
        // Envolvente rápida: sin esto se escucha un "click" al cortar la onda.
        vol.gain.setValueAtTime(0.0001, t0 + desde);
        vol.gain.exponentialRampToValueAtTime(0.22, t0 + desde + 0.008);
        vol.gain.exponentialRampToValueAtTime(0.0001, t0 + desde + dur);
        osc.connect(vol);
        vol.connect(ctx.destination);
        osc.start(t0 + desde);
        osc.stop(t0 + desde + dur + 0.02);
      };
      if (ok) tono(2000, 0, 0.09);
      else { tono(300, 0, 0.13); tono(300, 0.17, 0.13); }
    } catch {
      // Sin sonido no pasa nada: el feedback visual ya alcanza.
    }
  }, []);

  useEffect(() => {
    if (!open) return undefined;
    setError(null);
    setCargando(true);
    setResolucion(null);
    setDemorado(false);
    setHistorial([]);
    setUltimo(null);
    ultimoCodigoRef.current = { codigo: null, t: 0 };
    procesandoRef.current = false;

    // El AudioContext se crea acá porque abrir el modal viene de un click del
    // usuario, que es el gesto que los navegadores exigen para permitir audio.
    try {
      const AC = window.AudioContext || window.webkitAudioContext;
      if (AC) {
        audioRef.current = new AC();
        if (audioRef.current.state === 'suspended') audioRef.current.resume();
      }
    } catch {
      audioRef.current = null;
    }

    const reader = new BrowserMultiFormatOneDReader();
    let activo = true; // false al desmontar/cerrar, o apenas se resuelve/falla/agota el timeout

    const onResultado = async (result) => {
      if (!activo || !result) return;
      const codigo = result.getText();
      const ahora = Date.now();

      // Anti-repetición: mismo código leído hace nada, o una búsqueda todavía
      // en curso → ignorar. Sin esto un producto quieto frente al lente se
      // cargaría decenas de veces por segundo.
      const previo = ultimoCodigoRef.current;
      if (procesandoRef.current) return;
      if (previo.codigo === codigo && ahora - previo.t < MS_MISMO_CODIGO) return;

      ultimoCodigoRef.current = { codigo, t: ahora };
      procesandoRef.current = true;
      try {
        const res = await onDetectadoRef.current?.(codigo);
        if (!activo) return;
        const ok = !!res?.ok;
        beep(ok);
        setUltimo({ ok, t: ahora });
        setHistorial((h) => [
          { id: `${codigo}-${ahora}`, ok, codigo, texto: res?.nombre || 'Código no encontrado' },
          ...h,
        ].slice(0, 50));
      } finally {
        procesandoRef.current = false;
      }
    };

    // Se cerró en falso un caso real (12/08): en notebooks sin cámara trasera,
    // pedirla como restricción ESTRICTA (bare 'environment') hacía que el
    // navegador tardara mucho negociando antes de fallar, o rechazara
    // directo — se sentía como que "se traba" o "queda en negro". Con
    // { ideal: 'environment' } el navegador prefiere la trasera si existe
    // (celular) pero cae de forma prolija a la única disponible si no
    // (notebook), sin demora. Detalle en PLAN_PRUEBAS_MAESTRO_2026-08-11.md,
    // sección C.1.
    //
    // Otro caso real (12/08, producción): con el permiso YA concedido, la
    // pantalla quedaba en negro sin pedir permiso de nuevo y sin error — es
    // decir, `getUserMedia` en sí nunca resolvía ni rechazaba. Por eso el
    // timeout ahora envuelve el pedido a la cámara directamente (ver
    // `getUserMediaConTimeout` arriba), no la librería de escaneo entera —
    // así se sabe con certeza que el problema es el pedido a la cámara del
    // navegador/sistema operativo, no algo de ZXing.
    const demoraId = setTimeout(() => { if (activo) setDemorado(true); }, 2500);

    const leerResolucion = () => {
      const v = videoRef.current;
      if (!v) return;
      const leer = () => { if (activo) setResolucion(v.videoWidth ? `${v.videoWidth}×${v.videoHeight}` : null); };
      if (v.videoWidth) leer();
      else v.addEventListener('loadedmetadata', leer, { once: true });
    };

    // Etapa 2: con la cámara ya abierta, subir calidad sobre el track existente.
    const subirCalidad = async () => {
      const track = videoRef.current?.srcObject?.getVideoTracks?.()[0];
      if (!track) return;
      try {
        await track.applyConstraints(CALIDAD_ALTA);
      } catch {
        // La cámara no soporta esta calidad/enfoque: se sigue escaneando con lo
        // que haya. No es un error que valga la pena mostrarle a nadie.
      }
      leerResolucion();
    };

    getUserMediaConTimeout({ video: CONSTRAINTS_INICIALES }, 10000)
      // Fallback: si ni la restricción "ideal" funcionó (cámara/navegador poco
      // común), reintenta sin pedir ninguna cámara en particular. Solo ante
      // errores de RESTRICCIÓN — si el usuario denegó el permiso, no hay
      // cámara, o se agotó el timeout, reintentar no arregla nada y encima le
      // dispara un segundo cartel de permiso al pedo.
      .catch((err) => {
        const esDeRestriccion = err?.name === 'OverconstrainedError' || err?.name === 'ConstraintNotSatisfiedError';
        if (!esDeRestriccion) throw err;
        return getUserMediaConTimeout({ video: true }, 10000);
      })
      .then((stream) => reader.decodeFromStream(stream, videoRef.current, onResultado))
      .then((controls) => {
        clearTimeout(demoraId);
        if (!activo) {
          controls.stop();
          return;
        }
        controlsRef.current = controls;
        setCargando(false);
        setDemorado(false);
        leerResolucion();  // lo que entregó al abrir
        subirCalidad();    // y en cuanto se pueda, mejor
      })
      .catch((err) => {
        clearTimeout(demoraId);
        if (!activo) return;
        activo = false;
        setCargando(false);
        setError(mensajeError(err));
      });

    return () => {
      activo = false;
      clearTimeout(demoraId);
      controlsRef.current?.stop();
      controlsRef.current = null;
      audioRef.current?.close?.();
      audioRef.current = null;
    };
  }, [open, beep]);

  // Borra el flash de color sobre el video ~600ms después de cada lectura.
  useEffect(() => {
    if (!ultimo) return undefined;
    const id = setTimeout(() => setUltimo(null), 600);
    return () => clearTimeout(id);
  }, [ultimo]);

  const leidos = historial.filter(h => h.ok).length;

  return (
    <Dialog open={open} onOpenChange={(o) => { if (!o) onClose(); }}>
      <DialogContent className="sm:max-w-[760px]">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <Camera className="w-5 h-5 text-kx-text-2" />
            Escanear con la cámara
          </DialogTitle>
          <DialogDescription>
            Escaneá un producto atrás de otro — la cámara queda abierta y se van
            sumando al carrito. Si no lo toma, alejalo un poco (unos 15-20 cm) y
            buscá buena luz: pegado al lente la cámara no llega a enfocar.
          </DialogDescription>
        </DialogHeader>

        <div className="grid gap-3 sm:grid-cols-[1fr_240px]">
          <div className="relative rounded-xl overflow-hidden bg-black aspect-video">
            <video ref={videoRef} className="w-full h-full object-cover" muted playsInline />

            {cargando && !error && (
              <div className="absolute inset-0 flex flex-col items-center justify-center gap-2 bg-black/60 px-4 text-center">
                <Loader2 className="w-8 h-8 animate-spin text-white" />
                <p className="text-xs text-white/90">Encendiendo la cámara…</p>
                {demorado && (
                  <p className="text-[11px] text-white/60">
                    Algunas cámaras tardan unos segundos en arrancar.
                  </p>
                )}
              </div>
            )}

            {error && (
              <div className="absolute inset-0 flex flex-col items-center justify-center gap-2 bg-black/85 p-4 text-center">
                <AlertTriangle className="w-8 h-8 text-kx-amber" />
                <p className="text-sm text-white">{error}</p>
              </div>
            )}

            {!cargando && !error && (
              <>
                <div className="absolute inset-x-8 top-1/2 -translate-y-1/2 h-16 border-2 border-white/70 rounded-lg pointer-events-none" />
                {/* Flash de color en cada lectura: verde = cargado, rojo = no está en el catálogo */}
                {ultimo && (
                  <div
                    className={`absolute inset-0 pointer-events-none ${ultimo.ok ? 'bg-kx-green/30' : 'bg-kx-red/30'}`}
                  />
                )}
                {resolucion && (
                  <span className="absolute bottom-1.5 right-2 text-[10px] font-mono text-white/70 bg-black/40 px-1.5 py-0.5 rounded pointer-events-none">
                    {resolucion}
                  </span>
                )}
              </>
            )}
          </div>

          {/* Lista de lo escaneado en esta tanda */}
          <div className="flex flex-col border border-kx-border rounded-xl overflow-hidden min-h-[140px] sm:min-h-0">
            <div className="px-3 py-2 border-b border-kx-border bg-kx-surface-2 flex-shrink-0">
              <p className="text-2xs font-semibold uppercase tracking-wider text-kx-text-3">
                Escaneados
              </p>
              <p className="text-sm font-bold text-kx-text tabular-nums">
                {leidos} {leidos === 1 ? 'producto' : 'productos'}
              </p>
            </div>

            <div className="flex-1 overflow-y-auto max-h-[200px] sm:max-h-[260px]">
              {historial.length === 0 ? (
                <p className="text-2xs text-kx-text-3 text-center px-3 py-6">
                  Todavía no escaneaste nada.
                </p>
              ) : (
                <ul className="divide-y divide-kx-border">
                  {historial.map((h) => (
                    <li key={h.id} className="flex items-start gap-2 px-2.5 py-2">
                      {h.ok
                        ? <Check className="w-3.5 h-3.5 text-kx-green flex-shrink-0 mt-0.5" />
                        : <Ban className="w-3.5 h-3.5 text-kx-red flex-shrink-0 mt-0.5" />}
                      <div className="min-w-0">
                        <p className={`text-xs leading-tight ${h.ok ? 'text-kx-text' : 'text-kx-red'}`}>
                          {h.texto}
                        </p>
                        <p className="text-[10px] font-mono text-kx-text-3 truncate">{h.codigo}</p>
                      </div>
                    </li>
                  ))}
                </ul>
              )}
            </div>
          </div>
        </div>

        <div className="flex justify-end pt-2">
          {/* Sin ícono a propósito (pedido de Nadia, 12/08): la X de cerrar ya
              está arriba a la derecha del modal (la de Radix Dialog) — tener
              otra acá abajo era redundante. */}
          <Button variant="outline" onClick={onClose}>
            Listo
          </Button>
        </div>
      </DialogContent>
    </Dialog>
  );
}
