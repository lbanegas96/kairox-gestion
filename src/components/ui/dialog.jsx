import React from 'react';
import * as DialogPrimitive from '@radix-ui/react-dialog';
import { X } from 'lucide-react';
import { cn } from '@/lib/utils';

const Dialog = DialogPrimitive.Root;
const DialogTrigger = DialogPrimitive.Trigger;
const DialogPortal = DialogPrimitive.Portal;
const DialogClose = DialogPrimitive.Close;

const DialogOverlay = React.forwardRef(({ className, ...props }, ref) => (
  <DialogPrimitive.Overlay
    ref={ref}
    className={cn(
      'fixed inset-0 z-50 bg-black/80 data-[state=open]:animate-in data-[state=closed]:animate-out data-[state=closed]:fade-out-0 data-[state=open]:fade-in-0',
      className
    )}
    {...props}
  />
));
DialogOverlay.displayName = DialogPrimitive.Overlay.displayName;

// size="wide" — shell compartido para documentos con grilla de ítems (OC,
// Factura de Compra, Devoluciones, Recuento, Revalorización, Entrega,
// Cotización, Pedido, Ventas/Facturas...). Reemplaza el max-w-4xl/3xl/2xl/
// 800px que cada uno traía por su cuenta (hallazgo Luciano 22/08 — 6
// convenciones de ancho distintas en 11 modales).
//
// md:left-[252px] + md:w-[calc(...)] en vez del centrado normal (left-[50%]
// -translate-x-1/2) a propósito: el sidebar (236px, Sidebar.jsx) quedó con
// z-[60] por encima de estos modales (mismo hallazgo, fix de navegación) —
// sin este offset, el modal se centra en el viewport COMPLETO y su franja
// izquierda queda tapada por el sidebar aunque siga siendo clickeable.
//
// OJO al tocar esto — 2 bugs reales encontrados armándolo (verificado con
// getComputedStyle en vivo, no a ojo):
//  1. calc() exige espacios alrededor de + y - en CSS real. Tailwind
//     representa ese espacio con "_" en el nombre de la clase arbitraria
//     (`calc(100vw_-_268px)`) — sin los "_", el navegador descarta la regla
//     entera por sintaxis inválida.
//  2. Un "/" dentro de un calc() en una clase arbitraria (ej. para dividir el
//     ancho del sidebar /2) rompe el parser de valores arbitrarios de
//     Tailwind — la clase ni siquiera se genera. Por eso el offset va
//     pre-calculado a mano (252px = 236 sidebar + 16 de margen), no dividido
//     en runtime.
//  3. left-[…] por sí solo NO alcanza: la transformación -translate-x-1/2
//     de la variante base (que centra respecto al punto `left`) sigue
//     aplicada si no se cancela con md:translate-x-0 — sin esto, el offset
//     se corría de nuevo hacia el centro en vez de quedar pegado al punto
//     `left` real.
const wideDialogClass =
  'left-[50%] top-[50%] w-[96vw] max-w-[96vw] h-[92vh] -translate-x-1/2 -translate-y-1/2 ' +
  'md:left-[252px] md:translate-x-0 md:w-[calc(100vw_-_268px)] md:max-w-[calc(100vw_-_268px)] ' +
  'flex flex-col overflow-hidden p-0';

const DialogContent = React.forwardRef(({ className, children, hideCloseButton, size = 'default', ...props }, ref) => (
  <DialogPortal>
    <DialogOverlay />
    <DialogPrimitive.Content
      ref={ref}
      className={cn(
        'fixed z-50 grid gap-4 border bg-background shadow-lg duration-200 data-[state=open]:animate-in data-[state=closed]:animate-out data-[state=closed]:fade-out-0 data-[state=open]:fade-in-0 data-[state=closed]:zoom-out-95 data-[state=open]:zoom-in-95 data-[state=closed]:slide-out-to-left-1/2 data-[state=closed]:slide-out-to-top-[48%] data-[state=open]:slide-in-from-left-1/2 data-[state=open]:slide-in-from-top-[48%] sm:rounded-lg dark:bg-slate-950 dark:border-slate-800',
        size === 'wide' ? wideDialogClass : 'left-[50%] top-[50%] w-full max-w-lg -translate-x-1/2 -translate-y-1/2 p-6',
        className
      )}
      {...props}
    >
      {children}
      {!hideCloseButton && (
        <DialogPrimitive.Close className="absolute right-4 top-4 rounded-sm opacity-70 ring-offset-background transition-opacity hover:opacity-100 focus:outline-none focus:ring-2 focus:ring-ring focus:ring-offset-2 disabled:pointer-events-none data-[state=open]:bg-accent data-[state=open]:text-muted-foreground dark:text-slate-400 dark:hover:text-slate-100">
          <X className="h-4 w-4" />
          <span className="sr-only">Close</span>
        </DialogPrimitive.Close>
      )}
    </DialogPrimitive.Content>
  </DialogPortal>
));
DialogContent.displayName = DialogPrimitive.Content.displayName;

const DialogHeader = ({ className, ...props }) => (
  <div className={cn('flex flex-col space-y-1.5 text-center sm:text-left', className)} {...props} />
);
DialogHeader.displayName = 'DialogHeader';

const DialogFooter = ({ className, ...props }) => (
  <div className={cn('flex flex-col-reverse sm:flex-row sm:justify-end sm:space-x-2', className)} {...props} />
);
DialogFooter.displayName = 'DialogFooter';

const DialogTitle = React.forwardRef(({ className, ...props }, ref) => (
  <DialogPrimitive.Title
    ref={ref}
    className={cn('text-lg font-semibold leading-none tracking-tight dark:text-slate-50', className)}
    {...props}
  />
));
DialogTitle.displayName = DialogPrimitive.Title.displayName;

const DialogDescription = React.forwardRef(({ className, ...props }, ref) => (
  <DialogPrimitive.Description ref={ref} className={cn('text-sm text-muted-foreground dark:text-slate-400', className)} {...props} />
));
DialogDescription.displayName = DialogPrimitive.Description.displayName;

export {
  Dialog,
  DialogPortal,
  DialogOverlay,
  DialogClose,
  DialogTrigger,
  DialogContent,
  DialogHeader,
  DialogFooter,
  DialogTitle,
  DialogDescription,
};