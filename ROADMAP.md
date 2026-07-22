# KAIROX — Roadmap de Producto

> **Norte estratégico:** no competir con Odoo/SAP por superficie. KAIROX gana siendo
> **lo mejor en una cosa — el ERP fiscal argentino para PyMEs — y el hub al que todo lo demás
> se conecta.** El núcleo fiscal (AFIP/ARCA, partida doble, multimoneda) es el moat: lo que Odoo/SAP
> cobran fortunas y meses de consultoría por "localizar", KAIROX ya lo hace nativo.
>
> Mapa visual de esta estrategia (privado, se puede compartir):
> https://claude.ai/code/artifact/6ba0d7d2-811a-46dd-99bb-b153f15eac29
>
> Señal de mercado (Luciano, como consultor SAP): los clientes piden integrar con **MercadoLibre,
> bancos y ecommerce**. La demanda es real y observada desde adentro, no adivinada. Ese es el
> posicionamiento: "el ERP argentino que se enchufa con lo que la PyME ya usa".

---

## 🎯 OBJETIVO: PRIMER CLIENTE EN AGOSTO 2026

Todo lo de abajo se subordina a esto. **La prioridad inmediata NO son features nuevas — es pulir
lo que ya existe** para que el primer cliente tenga una experiencia impecable.

### 🔴 AHORA (hoy + mañana) — Pulido visual / UX
- Luciano navega el sistema y pasa **correcciones parte por parte** (ajustes visuales, UX, detalles).
- Objetivo: dejar el core (que ya está funcionalmente completo) prolijo y sin asperezas para el
  primer cliente.
- **Regla:** nada de superficie nueva hasta que esto esté pulido. El core es lo que sostiene todo.

---

## 🔌 Capa de integración (el habilitador) — próximos días

La jugada NO es construir cada integración como un one-off, sino **formalizar una vez** el patrón
que MP y ARCA ya probaron:

> Edge Function → API externa → webhook → Vault de secretos → tabla en Supabase

Piezas de la capa reutilizable (construir una vez, después cada canal es un "adapter"):
- **OAuth + refresh de token por vendedor** (cada cuenta conectada tiene su token que rota).
- **Receptor genérico de webhooks** (un endpoint que rutea notificaciones al adapter correcto).
- **Jobs de sync con idempotencia** (dedup por id externo — la lección ya aprendida con MP/ARCA).
- **Tablas de mapeo SKU ↔ producto** (el corazón del problema: relacionar catálogos externos con
  `productos` de KAIROX).

---

## 📈 Gradiente de adapters (orden de implementación)

Se implementan **en este orden** — de menor a mayor dificultad, para estrenar la capa con el caso
fácil y llegar al difícil con el patrón ya rodado:

| # | Canal | Dificultad | Por qué / qué lo hace difícil |
|---|-------|-----------|-------------------------------|
| 1 | **Tiendanube / Shopify** | 🟢 Fácil | OAuth estándar, bien documentado. **Primer adapter** — estrena la capa sin pelear con stock bidireccional. |
| 2 | **MercadoLibre** | 🟡 Medio | La apuesta grande del mercado AR (órdenes + stock + factura AFIP auto). Plomería resuelta; lo difícil es el **stock bidireccional** (¿quién es la fuente de verdad?) + idempotencia. |
| 3 | **Bancos** | 🔴 Difícil | Argentina no tiene open-banking estándar (no hay PSD2). MP / Ualá que ya se sincroniza es el **atajo práctico** por ahora. |

---

## 🟪 Construí (expande el moat, alto valor AR)
- Los 3 adapters del gradiente de arriba (Tiendanube → MELI → Bancos).
- **WhatsApp**: enviar comprobantes (PDF) + links de cobro. Bajo esfuerzo, alto valor — las PyMEs
  viven en WhatsApp.

## 🟩 Integrá, no construyas (sé el hub)
- Pagos extra (Stripe, PayU) — **solo si un cliente lo pide**.
- 1 carrier de envíos (Andreani / OCA / Correo Argentino).
- BI: exportar a Looker / Power BI, no reconstruir un motor de reportes.

## 🟥 No toques (trampas de scope — cada una es un producto entero)
- **RRHH / Nómina** — campo minado legal AR (ART, F.931, sindicatos). Es otro producto.
- **Fabricación / MRP** — nicho, complejo.
- CRM completo · Marketing automation · Sitio web · Helpdesk · Firma electrónica · Proyectos.

---

## ✅ Ya construido (el núcleo — no re-investigar ni reconstruir)
Facturación AFIP/ARCA nativa + CAEA · Ventas/POS (Modo Caja) · Compras · Inventario multi-unidad ·
Contabilidad (plan de cuentas + asientos automáticos, partida doble) · Cuentas corrientes (Open
Item) · Bancos · Cheques · Multimoneda · MercadoPago (sync) · Maestros de Formas de Pago y Unidades
de Medida (con ABM) · Centros de costo.

_Última actualización: 2026-07-22 (Luciano + análisis de estrategia)._
