import { Component } from 'react';
import { AlertTriangle, RefreshCw } from 'lucide-react';
import { Button } from '@/components/ui/button';

/**
 * Error boundary para el área de contenido de secciones.
 *
 * Sin un boundary arriba del <Suspense>, cualquier error al cargar una sección
 * (típicamente un chunk lazy que quedó viejo tras un deploy) desmonta TODO el
 * árbol de React → pantalla en blanco. Con este boundary, ese fallo queda
 * contenido en el main y el usuario ve una tarjeta de recuperación en vez de la
 * app rota.
 *
 * `resetKey` (la sección activa) hace que al navegar a otra sección el boundary
 * se resetee solo y reintente renderizar.
 */
class SectionErrorBoundary extends Component {
  constructor(props) {
    super(props);
    this.state = { hasError: false };
  }

  static getDerivedStateFromError() {
    return { hasError: true };
  }

  componentDidUpdate(prevProps) {
    // Al cambiar de sección, limpiar el error para reintentar el render.
    if (this.state.hasError && prevProps.resetKey !== this.props.resetKey) {
      this.setState({ hasError: false });
    }
  }

  render() {
    if (this.state.hasError) {
      return (
        <div className="flex flex-col items-center justify-center py-24 px-6 text-center gap-4">
          <div className="w-14 h-14 rounded-2xl bg-amber-50 dark:bg-amber-900/20 border border-amber-200 dark:border-amber-800/40 flex items-center justify-center">
            <AlertTriangle className="w-7 h-7 text-amber-500" />
          </div>
          <div className="space-y-1">
            <h3 className="text-base font-semibold text-kx-text">No se pudo abrir esta sección</h3>
            <p className="text-sm text-kx-text-3 max-w-sm">
              Puede que haya una versión nueva del sistema. Recargá la página para actualizar.
            </p>
          </div>
          <Button onClick={() => window.location.reload()} className="gap-2">
            <RefreshCw className="w-4 h-4" /> Recargar
          </Button>
        </div>
      );
    }
    return this.props.children;
  }
}

export default SectionErrorBoundary;
