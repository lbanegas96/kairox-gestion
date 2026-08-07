import { useEffect, useRef, useState } from 'react';
import { BrowserMultiFormatReader } from '@zxing/browser';
import { Camera, X, AlertTriangle, Loader2 } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription } from '@/components/ui/dialog';

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

  useEffect(() => {
    if (!open) return undefined;
    setError(null);
    setCargando(true);

    const reader = new BrowserMultiFormatReader();
    let cancelado = false;

    reader
      .decodeFromConstraints(
        { video: { facingMode: 'environment' } },
        videoRef.current,
        (result) => {
          if (cancelado || !result) return;
          controlsRef.current?.stop();
          onDetectado(result.getText());
        },
      )
      .then((controls) => {
        if (cancelado) {
          controls.stop();
          return;
        }
        controlsRef.current = controls;
        setCargando(false);
      })
      .catch((err) => {
        if (cancelado) return;
        setCargando(false);
        setError(mensajeError(err));
      });

    return () => {
      cancelado = true;
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
            Apuntá la cámara al código de barras del producto.
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
            <div className="absolute inset-x-8 top-1/2 -translate-y-1/2 h-16 border-2 border-white/70 rounded-lg pointer-events-none" />
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
