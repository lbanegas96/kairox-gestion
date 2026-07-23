/**
 * Capa compartida de integraciones con canales de venta externos (ROADMAP.md
 * — "Capa de integración"). Reutiliza el mecanismo de secretos ya probado con
 * el certificado AFIP y el token de MercadoPago: los tokens viven en Vault,
 * nunca en una columna de tabla en texto plano (ver mp-save-config/mp-webhook).
 *
 * Agregar un canal nuevo (Shopify, MercadoLibre) no toca nada de este archivo
 * — solo se suma su URL de autorización en integraciones-oauth-iniciar y su
 * intercambio code→token en integraciones-oauth-callback.
 */
import { adminClient } from './auth.ts';

export type Canal = 'tiendanube' | 'shopify' | 'mercadolibre';

const STATE_TTL_MINUTOS = 10;

function vaultKeyAccessToken(canal: Canal, empresaId: string): string {
  return `${canal}_access_token_${empresaId}`;
}

function vaultKeyRefreshToken(canal: Canal, empresaId: string): string {
  return `${canal}_refresh_token_${empresaId}`;
}

/** Token opaco e impredecible para el flujo OAuth (anti-CSRF, viaja en la URL de autorización). */
export function generarState(): string {
  return crypto.randomUUID().replace(/-/g, '') + crypto.randomUUID().replace(/-/g, '');
}

/**
 * Registra una conexión pendiente antes de redirigir al merchant al proveedor.
 * Deja la fila en integraciones_canales con activo=false hasta que el callback
 * confirme el intercambio del code — el `state` viaja en la URL de autorización
 * y vuelve en el callback (que no tiene sesión de usuario) para poder resolver
 * a qué empresa/canal pertenece.
 */
export async function guardarStatePendiente(
  empresaId: string,
  canal: Canal,
  state: string,
): Promise<void> {
  const expira = new Date(Date.now() + STATE_TTL_MINUTOS * 60 * 1000).toISOString();
  const { error } = await adminClient
    .from('integraciones_canales')
    .upsert(
      {
        empresa_id: empresaId,
        canal,
        activo: false,
        config: { oauth_state: state, oauth_state_expira: expira },
      },
      { onConflict: 'empresa_id,canal' },
    );
  if (error) throw error;
}

/**
 * Resuelve un `state` recibido en el callback a su empresa_id/canal, y lo
 * consume en el mismo UPDATE — si dos requests llegan con el mismo state
 * (replay), solo la primera encuentra la fila todavía sin consumir.
 */
export async function resolverState(
  state: string,
): Promise<{ empresaId: string; canal: Canal } | null> {
  const { data, error } = await adminClient
    .from('integraciones_canales')
    .update({ config: {} })
    .eq('config->>oauth_state', state)
    .gt('config->>oauth_state_expira', new Date().toISOString())
    .select('empresa_id, canal')
    .maybeSingle();

  if (error || !data) return null;
  return { empresaId: data.empresa_id as string, canal: data.canal as Canal };
}

/**
 * Guarda el resultado de un intercambio OAuth exitoso: el/los tokens van a
 * Vault (nunca a la tabla), integraciones_canales queda activo=true con los
 * metadatos no sensibles (external_store_id, scope, etc.).
 */
export async function guardarTokenCanal(
  empresaId: string,
  canal: Canal,
  opts: {
    accessToken: string;
    refreshToken?: string;
    tokenExpiry?: string | null;
    externalStoreId?: string | null;
    extraConfig?: Record<string, unknown>;
  },
): Promise<void> {
  const { error: vaultErr } = await adminClient.rpc('vault_secret_upsert', {
    p_name: vaultKeyAccessToken(canal, empresaId),
    p_secret: opts.accessToken,
    p_description: `${canal} access token`,
  });
  if (vaultErr) throw vaultErr;

  if (opts.refreshToken) {
    const { error: refreshErr } = await adminClient.rpc('vault_secret_upsert', {
      p_name: vaultKeyRefreshToken(canal, empresaId),
      p_secret: opts.refreshToken,
      p_description: `${canal} refresh token`,
    });
    if (refreshErr) throw refreshErr;
  }

  const { error } = await adminClient
    .from('integraciones_canales')
    .upsert(
      {
        empresa_id: empresaId,
        canal,
        activo: true,
        external_store_id: opts.externalStoreId ?? null,
        token_expiry: opts.tokenExpiry ?? null,
        config: opts.extraConfig ?? {},
      },
      { onConflict: 'empresa_id,canal' },
    );
  if (error) throw error;
}

/** Lee el access token vigente de un canal desde Vault. Null si no hay conexión. */
export async function leerTokenCanal(empresaId: string, canal: Canal): Promise<string | null> {
  const { data, error } = await adminClient.rpc('vault_secret_read', {
    p_name: vaultKeyAccessToken(canal, empresaId),
  });
  if (error || !data) return null;
  return data as string;
}

/** Lee el refresh token de un canal desde Vault (si el canal usa refresh — Tiendanube no). */
export async function leerRefreshTokenCanal(empresaId: string, canal: Canal): Promise<string | null> {
  const { data, error } = await adminClient.rpc('vault_secret_read', {
    p_name: vaultKeyRefreshToken(canal, empresaId),
  });
  if (error || !data) return null;
  return data as string;
}

// ── Refresh de token (canales cuyo access token EXPIRA) ─────────────────────
// Tiendanube: token que no expira → token_expiry NULL, nunca entra acá.
// MercadoLibre: token de 6h + refresh_token de un solo uso (cada refresh
// devuelve uno nuevo que hay que guardar). Este es el mecanismo que la capa
// se diseñó para soportar pero que Tiendanube no ejercitaba.
//
// Config por canal: cómo pedir un token nuevo con el refresh_token. Agregar un
// canal que expira = sumar su entrada acá (client_id/secret salen de env vars).
const REFRESH_CONFIG: Partial<Record<Canal, {
  tokenUrl: string;
  clientIdEnv: string;
  clientSecretEnv: string;
}>> = {
  mercadolibre: {
    tokenUrl: 'https://api.mercadolibre.com/oauth/token',
    clientIdEnv: 'MELI_APP_ID',
    clientSecretEnv: 'MELI_CLIENT_SECRET',
  },
};

// Margen: si el token vence dentro de este lapso, lo renovamos antes de usarlo
// (evita la carrera de que expire justo en mitad de una llamada a la API).
const MARGEN_REFRESH_MS = 10 * 60 * 1000; // 10 min

/**
 * Devuelve un access token VÁLIDO del canal, renovándolo si está por vencer.
 * Para canales sin expiración (Tiendanube) es equivalente a leerTokenCanal.
 * Para MercadoLibre: si token_expiry está cerca/pasado, usa el refresh_token
 * para pedir uno nuevo, guarda el nuevo par access+refresh en Vault y actualiza
 * token_expiry. Devuelve null si no hay conexión o el refresh falla.
 *
 * Úsenla SIEMPRE en vez de leerTokenCanal antes de pegarle a la API de un canal
 * que expira — es el único punto donde se centraliza la renovación.
 */
export async function obtenerTokenValido(empresaId: string, canal: Canal): Promise<string | null> {
  const cfg = REFRESH_CONFIG[canal];

  // Canal sin refresh configurado (Tiendanube): el token no expira, lectura directa.
  if (!cfg) return leerTokenCanal(empresaId, canal);

  const { data: integ } = await adminClient
    .from('integraciones_canales')
    .select('token_expiry')
    .eq('empresa_id', empresaId)
    .eq('canal', canal)
    .eq('activo', true)
    .maybeSingle();

  if (!integ) return null;

  const venceEn = integ.token_expiry ? new Date(integ.token_expiry).getTime() : 0;
  const todaviaVale = venceEn - Date.now() > MARGEN_REFRESH_MS;
  if (todaviaVale) {
    return leerTokenCanal(empresaId, canal);
  }

  // Renovar
  const refreshToken = await leerRefreshTokenCanal(empresaId, canal);
  if (!refreshToken) {
    console.error(`[integraciones] Sin refresh_token para ${canal}/${empresaId} — hay que reconectar`);
    return null;
  }

  const clientId = Deno.env.get(cfg.clientIdEnv);
  const clientSecret = Deno.env.get(cfg.clientSecretEnv);
  if (!clientId || !clientSecret) {
    console.error(`[integraciones] Faltan ${cfg.clientIdEnv}/${cfg.clientSecretEnv} para refrescar ${canal}`);
    return null;
  }

  try {
    const res = await fetch(cfg.tokenUrl, {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded', 'Accept': 'application/json' },
      body: new URLSearchParams({
        grant_type: 'refresh_token',
        client_id: clientId,
        client_secret: clientSecret,
        refresh_token: refreshToken,
      }),
    });

    if (!res.ok) {
      console.error(`[integraciones] Refresh ${canal} falló (${res.status}):`, await res.text());
      return null;
    }

    const data = await res.json();
    const nuevoAccess = data.access_token as string;
    const nuevoRefresh = data.refresh_token as string | undefined; // MELI: uso único, viene uno nuevo
    const expiresIn = Number(data.expires_in) || 21600; // 6h default
    const nuevoExpiry = new Date(Date.now() + expiresIn * 1000).toISOString();

    // Guardar los tokens nuevos DIRECTO en Vault (no vía guardarTokenCanal: ese
    // hace un upsert de la fila completa y borraría external_store_id/config).
    // Ojo: el refresh_token es de un solo uso — si no guardamos el nuevo, el
    // próximo refresh falla. Por eso se persiste SIEMPRE que venga.
    await adminClient.rpc('vault_secret_upsert', {
      p_name: vaultKeyAccessToken(canal, empresaId),
      p_secret: nuevoAccess,
      p_description: `${canal} access token`,
    });
    if (nuevoRefresh) {
      await adminClient.rpc('vault_secret_upsert', {
        p_name: vaultKeyRefreshToken(canal, empresaId),
        p_secret: nuevoRefresh,
        p_description: `${canal} refresh token`,
      });
    }
    // Solo se toca token_expiry — external_store_id y config quedan intactos.
    await adminClient
      .from('integraciones_canales')
      .update({ token_expiry: nuevoExpiry })
      .eq('empresa_id', empresaId)
      .eq('canal', canal);

    console.log(`[integraciones] ✓ Token de ${canal} renovado, vence ${nuevoExpiry}`);
    return nuevoAccess;
  } catch (e) {
    console.error(`[integraciones] Error refrescando ${canal}:`, e);
    return null;
  }
}
