import { useEffect, useRef, useState } from 'react';
// Lector de códigos 1D (lineales) únicamente — cubre EAN-13/EAN-8/UPC/Code128/
// Code39/ITF, que son los que llevan los productos de retail. Antes se usaba
// BrowserMultiFormatReader, que además prueba QR, DataMatrix, PDF417 y Aztec en
// CADA cuadro de video: trabajo de más que hacía la lectura notoriamente más
// lenta ("no lo toma", 12/08). Si algún día hiciera falta escanear un QR acá,
// volver a MultiFormat es cambiar solo esta línea.
import { BrowserMultiFormatOneDReader } from '@zxing/browser';
import { Camera, X, AlertTriangle, Loader2 } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription } from '@/components/ui/dialog';

// Calidad de video pedida a la cámara. Sin esto el navegador entrega su default
// (típicamente 640x480), resolución con la que un código de barras solo se lee
// casi pegado al lente — era la causa real de "hay que acercar mucho el
// producto" (12/08). 1280x720 cuadruplica el área en píxeles sin volver lenta
// la decodificación en JS, que es el punto de equilibrio recomendado para
// escaneo con ZXing.
//
// `focusMode: continuous` va dentro de `advanced` a propósito: no todos los
// navegadores lo soportan, y en `advanced` el que no lo entiende simplemente lo
// ignora, en vez de hacer fallar el pedido de cámara entero.
const CALIDAD_VIDEO = {
  width:  { ideal: 1280 },
  height: { ideal: 720 },
  advanced: [{ focusMode: 'continuous' }],
};

function mensajeError(err) {
  if (err?.name === 'NotAllowedError' || err?.name === 'PermissionDeniedError') {
    return 'Permiso de cámara denegado — habilitalo en la configuración del navegador para escanear.';
  }
  if (err?.name === 'NotFoundError' || err?.name === 'DevicesNotFoundError') {
    return 'No se encontró ninguna cámara en este dispositivo.';
  }
  if (err?.name === 'NotReadableError') {
    return 'La cámara está siendo usada por otra aplicación.';
  }
  return 'No se pudo iniciar la cámara.';
}

/**
 * Escaneo de código de barras con la cámara del dispositivo — complemento del
 * lector físico (keyboard wedge), útil para un mostrador secundario sin lector
 * o venta ambulante desde un celular. Usa ZXing (decodificación en JS puro) en
 * vez de la BarcodeDetector nativa del navegador porque esa API no existe en
 * Safari/iOS — con ZXing el escaneo funciona igual en iPhone que en Android.
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

  useEffect(() => {
    if (!open) return undefined;
    setError(null);
    setCargando(true);
    setResolucion(null);

    const reader = new BrowserMultiFormatOneDReader();
    let activo = true; // false al desmontar/cerrar, o apenas se resuelve/falla/agota el timeout

    const onResultado = (result) => {
      if (!activo || !result) return;
      controlsRef.current?.stop();
      onDetectado(result.getText());
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
    // Timeout de seguridad (nuevo, 12/08): si ni así responde en 10s —
    // cámara rara, permiso colgado en el navegador, lo que sea — se corta
    // solo y muestra un error en vez de dejar el modal trabado para
    // siempre con el spinner girando.
    const timeoutId = setTimeout(() => {
      if (!activo || controlsRef.current) return; // ya conectó bien, no hacer nada
      activo = false;
      setCargando(false);
      setError('La cámara tardó demasiado en responder. Cerrá y volvé a intentar.');
    }, 10000);

    reader
      .decodeFromConstraints(
        { video: { ...CALIDAD_VIDEO, facingMode: { ideal: 'environment' } } },
        videoRef.current,
        onResultado,
      )
      // Fallback: si ni la restricción "ideal" funcionó (cámara/navegador poco
      // común), reintenta sin pedir ninguna cámara en particular. Solo ante
      // errores de RESTRICCIÓN — si el usuario denegó el permiso o no hay
      // cámara, reintentar no arregla nada y encima le dispara un segundo
      // cartel de permiso al pedo.
      .catch((err) => {
        const esDeRestriccion = err?.name === 'OverconstrainedError' || err?.name === 'ConstraintNotSatisfiedError';
        if (!esDeRestriccion) throw err;
        return reader.decodeFromConstraints({ video: CALIDAD_VIDEO }, videoRef.current, onResultado);
      })
      .then((controls) => {
        clearTimeout(timeoutId);
        if (!activo) {
          controls.stop();
          return;
        }
        controlsRef.current = controls;
        setCargando(false);
        // El <video> ya tiene el stream: leer qué resolución entregó de verdad.
        const v = videoRef.current;
        if (v) {
          const leer = () => setResolucion(v.videoWidth ? `${v.videoWidth}×${v.videoHeight}` : null);
          if (v.videoWidth) leer();
          else v.addEventListener('loadedmetadata', leer, { once: true });
        }
      })
      .catch((err) => {
        clearTimeout(timeoutId);
        if (!activo) return;
        activo = false;
        setCargando(false);
        setError(mensajeError(err));
      });

    return () => {
      activo = false;
      clearTimeout(timeoutId);
      controlsRef.current?.stop();
      controlsRef.current = null;
    };
  }, [open, onDetectado]);

  return (
    <Dialog open={open} onOpenChange={(o) => { if (!o) onClose(); }}>
      <DialogContent className="sm:max-w-[420px]">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <Camera className="w-5 h-5 text-kx-text-2" />
            Escanear con la cámara
          </DialogTitle>
          <DialogDescription>
            Apuntá la cámara al código de barras del producto, dentro del recuadro.
            Si no lo toma, alejalo un poco (unos 15-20 cm) y buscá buena luz —
            pegado al lente la cámara no llega a enfocar.
          </DialogDescription>
        </DialogHeader>

        <div className="relative rounded-xl overflow-hidden bg-black aspect-video">
          <video ref={videoRef} className="w-full h-full object-cover" muted playsInline />

          {cargando && !error && (
            <div className="absolute inset-0 flex items-center justify-center bg-black/60">
              <Loader2 className="w-8 h-8 animate-spin text-white" />
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
              {resolucion && (
                <span className="absolute bottom-1.5 right-2 text-[10px] font-mono text-white/70 bg-black/40 px-1.5 py-0.5 rounded pointer-events-none">
                  {resolucion}
                </span>
              )}
            </>
          )}
        </div>

        <div className="flex justify-end pt-2">
          <Button variant="outline" onClick={onClose}>
            <X className="w-4 h-4 mr-2" />
            Cerrar
          </Button>
        </div>
      </DialogContent>
    </Dialog>
  );
}
