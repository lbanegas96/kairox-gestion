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
