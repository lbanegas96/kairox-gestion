import { describe, it, expect } from 'vitest';
import config from '../../../vercel.json';

// Cabeceras de seguridad de vercel.json (auditoría 24/09, SEG-6). Esta prueba no valida que el sitio funcione con la
// política (eso se mira en el navegador con la consola abierta): solo evita que un cambio de vercel.json borre en
// silencio una cabecera, o que una política nueva rompa algo que la app usa de verdad (la cámara del escáner, Supabase).
const cabeceras = Object.fromEntries(
  config.headers.find((h) => h.source === '/(.*)').headers.map((h) => [h.key, h.value])
);
const directivas = (valor) => Object.fromEntries(
  valor.split(';').map((d) => d.trim()).filter(Boolean).map((d) => {
    const [nombre, ...fuentes] = d.split(/\s+/);
    return [nombre, fuentes];
  })
);

describe('vercel.json — cabeceras de seguridad', () => {
  it('trae las cabeceras básicas', () => {
    expect(cabeceras['X-Content-Type-Options']).toBe('nosniff');
    expect(cabeceras['X-Frame-Options']).toBe('DENY');
    expect(cabeceras['Referrer-Policy']).toBe('strict-origin-when-cross-origin');
    expect(cabeceras['Strict-Transport-Security']).toMatch(/max-age=\d{7,}/);
  });

  it('X-XSS-Protection queda apagada (la protección de los navegadores viejos es obsoleta y tenía fallas)', () => {
    expect(cabeceras['X-XSS-Protection']).toBe('0');
  });

  it('Permissions-Policy deja la cámara para el escáner de códigos de barras del POS y cierra lo que no se usa', () => {
    const pp = cabeceras['Permissions-Policy'];
    expect(pp).toMatch(/camera=\(self\)/);
    expect(pp).toMatch(/microphone=\(\)/);
    expect(pp).toMatch(/geolocation=\(\)/);
  });

  it('la política de contenido va en modo solo-reporte (no bloquea nada todavía) y cubre lo que la app usa', () => {
    expect(cabeceras['Content-Security-Policy']).toBeUndefined(); // se activa a propósito después de revisarla en uso real
    const csp = directivas(cabeceras['Content-Security-Policy-Report-Only']);
    expect(csp['default-src']).toEqual(["'self'"]);
    expect(csp['script-src']).toEqual(["'self'"]);
    expect(csp['connect-src']).toEqual(expect.arrayContaining(["'self'", 'https://*.supabase.co', 'wss://*.supabase.co']));
    expect(csp['img-src']).toEqual(expect.arrayContaining(['data:', 'blob:'])); // logos en base64, QR y PDF
    expect(csp['worker-src']).toContain('blob:');
    expect(csp['frame-ancestors']).toEqual(["'none'"]);
    expect(csp['object-src']).toEqual(["'none'"]);
    expect(csp['base-uri']).toEqual(["'self'"]);
  });

  it('la política de scripts no admite código en línea ni eval', () => {
    const csp = directivas(cabeceras['Content-Security-Policy-Report-Only']);
    expect(csp['script-src'].join(' ')).not.toMatch(/unsafe-inline|unsafe-eval/);
  });

  it('los assets con hash siguen con caché larga', () => {
    const assets = config.headers.find((h) => h.source === '/assets/(.*)');
    expect(assets.headers[0].value).toMatch(/immutable/);
  });
});
