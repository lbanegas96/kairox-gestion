-- Migration 389 -- Listas de Precio, Fases C y D: la lista elegida se guarda
-- en el documento y se arrastra por toda la cadena.
--
-- Pedido de Luciano (02/09): "si seleccionamos una lista de precios en la
-- cotización, esa misma debe arrastrarse al pedido, entrega, factura, con
-- la posibilidad de seleccionar otra pero que se arrastre la seleccionada
-- inicialmente".
--
-- Investigado antes de tocar código (agente de exploración): hoy NINGÚN
-- documento del circuito O2C guarda qué lista se usó -- ni cotizaciones, ni
-- pedidos, ni comprobantes. La creación directa de cada uno (Cotización,
-- Pedido, Factura standalone) siempre usa productos.precio_venta, ignorando
-- clientes.lista_precio_id por completo. Las conversiones (Cotización→
-- Pedido, Pedido→Factura vía NuevaFacturaModal) copian el precio_unitario
-- tal cual quedó tipeado -- eso ya "arrastra" el NÚMERO, pero no la
-- REFERENCIA a qué lista lo originó, así que hoy no hay forma de saber (ni
-- de recalcular) qué lista corresponde a un documento ya creado.
--
-- Hallazgo aparte (bug real, se corrige en el frontend de esta misma
-- entrega): NuevaVentaModal.jsx (el "Convertir en Venta" estilo POS) hoy
-- SOBRESCRIBE el precio ya copiado de la cotización con el precio de la
-- lista ACTUAL del cliente -- si el cliente cambió de lista después de
-- cotizar, el precio de la venta final no es el que el cliente vio
-- cotizado. Con lista_precio_id guardado en el documento, se puede usar ESE
-- valor (el de cuando se cotizó) en vez de re-derivar del cliente en vivo.
--
-- Entregas queda AFUERA a propósito: no tiene ningún campo de precio (Regla
-- 8, el stock se mueve en el evento físico) -- no hay nada ahí que
-- "arrastrar". La trazabilidad de qué lista se usó sigue disponible
-- igual, vía entregas.pedido_id → pedidos.lista_precio_id.
--
-- ROLLBACK:
--   ALTER TABLE public.cotizaciones DROP COLUMN IF EXISTS lista_precio_id;
--   ALTER TABLE public.pedidos DROP COLUMN IF EXISTS lista_precio_id;
--   ALTER TABLE public.comprobantes DROP COLUMN IF EXISTS lista_precio_id;

ALTER TABLE public.cotizaciones
  ADD COLUMN IF NOT EXISTS lista_precio_id UUID REFERENCES public.listas_precio(id) ON DELETE SET NULL;

ALTER TABLE public.pedidos
  ADD COLUMN IF NOT EXISTS lista_precio_id UUID REFERENCES public.listas_precio(id) ON DELETE SET NULL;

ALTER TABLE public.comprobantes
  ADD COLUMN IF NOT EXISTS lista_precio_id UUID REFERENCES public.listas_precio(id) ON DELETE SET NULL;

COMMENT ON COLUMN public.cotizaciones.lista_precio_id IS
  'Lista de precios usada para cotizar (NULL = precio estándar de catálogo). '
  'Por defecto la del cliente, editable al armar la cotización.';
COMMENT ON COLUMN public.pedidos.lista_precio_id IS
  'Lista de precios del pedido -- se arrastra de la cotización de origen si '
  'vino de "Copiar a Pedido", o de la lista del cliente si se crea directo.';
COMMENT ON COLUMN public.comprobantes.lista_precio_id IS
  'Lista de precios de la factura -- se arrastra del pedido de origen, o de '
  'la lista del cliente si se factura directo.';
