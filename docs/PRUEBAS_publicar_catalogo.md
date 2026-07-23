# Ruta de pruebas — Publicar catálogo KAIROX → Tiendanube + maestro SAP

> Checklist para validar de punta a punta el feature construido el 2026-07-22.
> Cada paso tiene **Acción** (lo hacés vos en la UI) y **Verificación** (qué chequea
> Claude del lado del servidor / qué tenés que ver). Marcá con [x] a medida que pasan.
>
> **Empresa de prueba:** Nalux (es donde está conectada la integración de Tiendanube).
> **Tienda demo TN:** kairoxdemo.mitiendanube.com (panel admin) — ahí verificás que
> los productos aparezcan del otro lado.
> **App KAIROX:** https://kairox-gestion-chi.vercel.app (Inventario).

---

## 0. Pre-requisitos (Claude los verifica antes de arrancar)
- [ ] Front deployado con la Fase 3 (bundle nuevo servido).
- [ ] Integración Tiendanube **activa** en Nalux (Configuración → Integraciones → "✓ Conectado").
- [ ] Cron `tiendanube-catalogo-worker-every-5-min` activo.
- [ ] Cola `integraciones_producto_pendiente` vacía al empezar (línea base limpia).

> 💡 Para no esperar los 5 min del cron en cada paso, **avisame y disparo el worker
> a mano** (invoco `tiendanube-catalogo-publicar`) apenas hagas la acción.

---

## 1. Maestro de artículos estilo SAP (flags OITM)

### 1.1 — Alta de un producto físico normal
- [ ] **Acción:** Inventario → "Nuevo producto". Cargá nombre + SKU + precio. Dejá los
      toggles por defecto (Inventariable ✓, Venta ✓, Compra ✓, Servicio ✗). Guardá.
- [ ] **Verificación:** el producto se crea. Claude confirma en DB que
      `es_inventariable/es_articulo_venta/es_articulo_compra=true`, `es_servicio=false`.

### 1.2 — Servicio fuerza no-inventariable (regla SAP + CHECK)
- [ ] **Acción:** Nuevo producto → activá **"Es un servicio"**. Observá que el toggle
      **"Inventariable" se apaga y se deshabilita solo**.
- [ ] **Verificación:** no te deja tener servicio + inventariable a la vez (lo bloquea la
      UI y, por las dudas, el CHECK `chk_servicio_no_inventariable` en la base). Guardá un
      servicio y Claude confirma `es_servicio=true, es_inventariable=false`.

### 1.3 — Artículo solo de compra (insumo interno)
- [ ] **Acción:** Editá un producto → apagá "Artículo de venta", dejá "Compra" ✓. Guardá.
- [ ] **Verificación:** persiste `es_articulo_venta=false, es_articulo_compra=true`.
      *(Nota: hoy los flags se guardan pero todavía NO filtran los buscadores de
      venta/compra — eso es una mejora futura, ver "Pendiente" al final.)*

---

## 2. Imágenes de producto

### 2.1 — Subir imagen
- [ ] **Acción:** Editá un producto (tiene que estar guardado) → sección **Imágenes** →
      "Agregar imagen" → elegí un PNG/JPG (< 5MB).
- [ ] **Verificación:** la miniatura aparece, marcada **"Principal"** (la primera lo es por
      defecto). Claude confirma la fila en `producto_imagenes` + el archivo en el bucket.

### 2.2 — Varias imágenes + cambiar principal
- [ ] **Acción:** subí una 2da imagen. Pasá el mouse sobre ella → estrella para marcarla
      principal.
- [ ] **Verificación:** solo una queda como principal (lo garantiza el índice único
      `uq_producto_imagen_principal`).

### 2.3 — Borrar imagen
- [ ] **Acción:** hover sobre una imagen → tacho (borrar).
- [ ] **Verificación:** desaparece de la grilla y del bucket.

---

## 3. Publicar a Tiendanube (el flujo principal)

### 3.1 — Publicar un producto nuevo (CREAR en TN)
- [ ] **Acción:** editá un producto con imagen → tildá **"Publicar en ecommerce"** → Guardá.
- [ ] **Verificación inmediata:** debajo del toggle aparece 🟡 **"Publicando en Tiendanube…"**
      (se auto-refresca cada 8s).
- [ ] **Verificación worker (Claude dispara o espera cron):** pasa a 🟢 **"Publicado en
      Tiendanube"**. Claude confirma que se completó `external_product_id` en
      `integraciones_producto_mapeo` y que la cola quedó `publicado`.
- [ ] **Verificación en TN:** entrás al panel de la tienda demo → Productos → **el producto
      aparece** con nombre, precio, imagen y stock.

### 3.2 — Actualizar un producto ya publicado (ACTUALIZAR en TN)
- [ ] **Acción:** al mismo producto, cambiá el **precio** (o el nombre) → Guardá.
- [ ] **Verificación:** 🟡 "Actualizando…" → 🟢 "Publicado". En el panel de TN el **precio
      nuevo** se refleja. (Ojo: en actualizar NO se re-suben imágenes — es a propósito, V1.)

### 3.3 — Destildar "Publicar"
- [ ] **Acción:** destildá "Publicar en ecommerce" → Guardá.
- [ ] **Verificación:** NO se borra de Tiendanube (destildar solo deja de sincronizar, no
      despublica — decisión de diseño). El estado deja de mostrar acciones.

---

## 4. Errores y reintento

### 4.1 — Ver un error real + reintentar
- [ ] **Acción:** *(si aparece un error natural en 3.x)* mirá el recuadro 🔴 con el mensaje
      real que devolvió Tiendanube.
- [ ] **Acción:** tocá **"Reintentar"**.
- [ ] **Verificación:** el estado vuelve a 🟡 "Publicando…" y Claude confirma que la fila de
      la cola volvió a `pendiente`. Si no hay error natural, no hace falta forzar uno.

---

## 5. Regresión — que lo que ya andaba siga andando

### 5.1 — Sync de stock (mig.233, ya existía)
- [ ] **Acción:** a un producto **publicado y mapeado**, cambiá el stock (venta en Caja o
      ajuste manual).
- [ ] **Verificación:** Claude confirma que se encoló en `integraciones_stock_pendiente` y
      que el stock se actualizó en TN. (Este circuito es independiente del de catálogo.)

### 5.2 — Pedidos TN → KAIROX (ya validado antes)
- [ ] Sin acción nueva. Ya quedó probado: un pedido en la tienda demo llega como
      `borrador` a KAIROX (Ventas → Pedidos).

---

## 6. Casos borde (opcionales)
- [ ] **Producto sin imagen** publicado → se crea en TN sin foto (no rompe).
- [ ] **Servicio** publicado → se crea en TN sin stock (variante sin `stock`).
- [ ] **Producto sin integración TN** con "publicar" tildado → NO se encola (el trigger lo
      ignora si no hay canal activo). No genera ruido.

---

## Pendiente / mejoras futuras (NO son bugs, quedan anotadas)
- Los flags `es_articulo_venta/compra` se guardan pero todavía **no filtran** los
  buscadores de productos en documentos de venta/compra (SAP sí lo hace). Mejora futura.
- **Actualización de imágenes** en TN: el worker sube imágenes solo al CREAR; editar no
  las reconcilia (para no duplicarlas). V2.
- **Despublicar** (borrar de TN al destildar) no está — hoy destildar solo frena el sync.

---

## Aparte — CAEA / PdV de ARCA
Luciano avisó que ARCA podría haberle dado el **PdV para el CAEA**. Cuando confirme el
**número de punto de venta**, actualizar `empresas.afip_pv_numero` en la empresa
**"CAEA Test"** (id `aa1aa886-636b-487a-a777-fe6ec3eeba4a`) — el valor `1` actual es un
placeholder. Con el PdV real ya se puede reintentar "Solicitar CAEA" desde Configuración →
Facturación y el error `602 [No existen datos]` debería desaparecer.
