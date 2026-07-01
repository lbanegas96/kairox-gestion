import React, { useState, useEffect } from 'react';
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription } from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Loader2, CheckCircle2, AlertCircle, ExternalLink, Shield, Copy } from 'lucide-react';
import { useToast } from '@/components/ui/use-toast';
import { useAuth } from '@/contexts/SupabaseAuthContext';
import { supabase } from '@/lib/customSupabaseClient';

const STEPS = [
  'Ir a developers.mercadopago.com/panel',
  'Crear una aplicación (o usar una existente)',
  'En "Credenciales de producción" → copiar el Access Token (APP_USR-...)',
  'En "Webhooks" → agregar la URL del webhook que aparece abajo',
  'Seleccionar evento: "Pagos" (payment)',
  'Pegar el Access Token y el Webhook Secret (opcional) en este formulario y guardar',
];

function ConfigMercadoPagoModal({ open, onOpenChange, integracion, onSuccess }) {
  const { user } = useAuth();
  const { toast } = useToast();

  const [accessToken,      setAccessToken]      = useState('');
  const [cuentaBancariaId, setCuentaBancariaId] = useState('');
  const [webhookSecret,    setWebhookSecret]    = useState('');
  const [cuentas,          setCuentas]          = useState([]);
  const [verificando,      setVerificando]      = useState(false);
  const [guardando,        setGuardando]        = useState(false);
  const [tokenValido,      setTokenValido]      = useState(null); // null | true | false
  const [mpUserId,         setMpUserId]         = useState(null); // id numérico de la cuenta MP (para distinguir ingreso/egreso)

  const supabaseUrl  = import.meta.env.VITE_SUPABASE_URL;
  const webhookUrl   = `${supabaseUrl}/functions/v1/mp-webhook?empresa_id=${user?.empresa_id}`;

  useEffect(() => {
    if (!open || !user?.empresa_id) return;
    setAccessToken(''); // SECURITY-SENSITIVE-DATA — nunca precargar el token real
    setCuentaBancariaId(integracion?.cuenta_bancaria_id ?? '');
    setWebhookSecret(integracion?.config?.webhook_secret ?? '');
    setMpUserId(integracion?.config?.mp_user_id ?? null);
    setTokenValido(null);

    supabase
      .from('cuentas_bancarias')
      .select('id, nombre, banco')
      .eq('empresa_id', user.empresa_id)
      .eq('activo', true)
      .order('nombre')
      .then(({ data }) => setCuentas(data ?? []));
  }, [open, user?.empresa_id, integracion]);

  const verificarToken = async () => {
    if (!accessToken.startsWith('APP_USR-')) {
      toast({ title: 'Token inválido', description: 'El Access Token debe empezar con APP_USR-', variant: 'destructive' });
      return;
    }
    setVerificando(true);
    setTokenValido(null);
    try {
      const { data, error } = await supabase.functions.invoke('mp-verify-token', {
        body: { access_token: accessToken },
      });
      if (!error && data?.valid) {
        setTokenValido(true);
        setMpUserId(data.mp_user_id ?? null);
        toast({
          title: `✓ Token válido — ${data.nickname ?? data.email ?? 'cuenta verificada'}`,
          className: 'bg-green-600 text-white border-green-700',
        });
      } else {
        setTokenValido(false);
        toast({ title: 'Token inválido o expirado', description: data?.error ?? 'Verificá que copiaste el token de producción correctamente.', variant: 'destructive' });
      }
    } catch {
      setTokenValido(false);
      toast({ title: 'Error al verificar el token', variant: 'destructive' });
    } finally {
      setVerificando(false);
    }
  };

  const handleGuardar = async () => {
    // SECURITY-SENSITIVE-DATA — token obligatorio solo en nueva integración
    if (!accessToken && !integracion) {
      toast({ title: 'Completá el Access Token', variant: 'destructive' });
      return;
    }
    if (!cuentaBancariaId) {
      toast({ title: 'Seleccioná una cuenta bancaria destino', variant: 'destructive' });
      return;
    }
    if (accessToken && !accessToken.startsWith('APP_USR-')) {
      toast({ title: 'Token inválido', description: 'El Access Token debe empezar con APP_USR-', variant: 'destructive' });
      return;
    }
    setGuardando(true);
    try {
      // SECURITY-SENSITIVE-DATA — solo verificar/enviar token si el usuario escribió uno nuevo
      let mpUserIdFinal = mpUserId;
      if (accessToken) {
        if (tokenValido !== true) {
          const { data: vData, error: vError } = await supabase.functions.invoke('mp-verify-token', {
            body: { access_token: accessToken },
          });
          if (vError || !vData?.valid) {
            toast({ title: 'Access Token inválido o expirado', description: vData?.error, variant: 'destructive' });
            return;
          }
          mpUserIdFinal = vData.mp_user_id ?? null;
        }
      }

      const config = { ...(webhookSecret ? { webhook_secret: webhookSecret } : {}) };
      if (mpUserIdFinal != null) config.mp_user_id = mpUserIdFinal;

      const upsertPayload = {
        empresa_id:         user.empresa_id,
        proveedor:          'mercadopago',
        cuenta_bancaria_id: cuentaBancariaId,
        activo:             true,
        config,
      };
      if (accessToken) upsertPayload.access_token = accessToken; // SECURITY-SENSITIVE-DATA

      const { error } = await supabase
        .from('integraciones_bancarias')
        .upsert(upsertPayload, { onConflict: 'empresa_id,proveedor' });

      if (error) throw error;

      toast({ title: '✓ Mercado Pago conectado correctamente', className: 'bg-green-600 text-white border-green-700' });
      onSuccess?.();
      onOpenChange(false);
    } catch (e) {
      toast({ title: 'Error al guardar', description: e.message, variant: 'destructive' });
    } finally {
      setGuardando(false);
    }
  };

  const copiarWebhookUrl = () => {
    navigator.clipboard.writeText(webhookUrl);
    toast({ title: '✓ URL copiada al portapapeles' });
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-[560px] bg-kx-surface border-kx-border max-h-[90vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2 text-kx-text">
            <div className="w-7 h-7 rounded-lg bg-[#009EE3] flex items-center justify-center text-white font-bold text-xs shrink-0">
              MP
            </div>
            Conectar Mercado Pago
          </DialogTitle>
          <DialogDescription>
            Los pagos aprobados se registrarán automáticamente en el módulo Bancos de KAIROX.
          </DialogDescription>
        </DialogHeader>

        {/* Instrucciones paso a paso */}
        <div className="bg-kx-surface-2 rounded-xl p-4 border border-kx-border">
          <p className="text-xs font-semibold text-kx-text-2 uppercase tracking-wide mb-3 flex items-center gap-1.5">
            <ExternalLink className="w-3.5 h-3.5" /> Pasos en MP Developers
          </p>
          <ol className="space-y-2">
            {STEPS.map((step, i) => (
              <li key={i} className="flex items-start gap-2 text-xs text-kx-text-2">
                <span className="w-4 h-4 rounded-full bg-[#009EE3]/20 text-[#009EE3] flex items-center justify-center text-[9px] font-bold shrink-0 mt-0.5">
                  {i + 1}
                </span>
                {step}
              </li>
            ))}
          </ol>
        </div>

        <div className="space-y-4">
          {/* URL del Webhook */}
          <div className="p-3 bg-kx-surface-2 rounded-lg border border-kx-border space-y-1.5">
            <p className="text-xs font-medium text-kx-text-2">URL del Webhook (pegar en MP Developers → Webhooks)</p>
            <div className="flex items-center gap-2">
              <code className="text-xs text-kx-text flex-1 break-all leading-relaxed">{webhookUrl}</code>
              <Button type="button" size="sm" variant="ghost" className="h-7 w-7 p-0 shrink-0" onClick={copiarWebhookUrl}>
                <Copy className="w-3.5 h-3.5" />
              </Button>
            </div>
          </div>

          {/* Access Token */}
          <div className="space-y-2">
            <Label className="text-kx-text text-sm">
              Access Token de Producción <span className="text-red-400">*</span>
            </Label>
            <div className="flex gap-2">
              <div className="relative flex-1">
                <Input
                  value={accessToken}
                  onChange={e => { setAccessToken(e.target.value); setTokenValido(null); setMpUserId(null); }}
                  placeholder={integracion ? '••••••••••••••••' : 'APP_USR-...'} // SECURITY-SENSITIVE-DATA
                  className="kairox-input font-mono text-xs pr-9"
                  type="password"
                />
                {tokenValido === true && (
                  <CheckCircle2 className="absolute right-2.5 top-2.5 w-4 h-4 text-emerald-500" />
                )}
                {tokenValido === false && (
                  <AlertCircle className="absolute right-2.5 top-2.5 w-4 h-4 text-red-400" />
                )}
              </div>
              <Button
                type="button"
                variant="outline"
                onClick={verificarToken}
                disabled={!accessToken || verificando}
                className="shrink-0 text-xs h-9"
              >
                {verificando ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : 'Verificar'}
              </Button>
            </div>
            <p className="text-xs text-kx-text-3">Solo tokens de producción (APP_USR-...). Nunca uses el token de prueba.</p>
          </div>

          {/* Cuenta bancaria destino */}
          <div className="space-y-2">
            <Label className="text-kx-text text-sm">
              Cuenta bancaria destino <span className="text-red-400">*</span>
            </Label>
            {cuentas.length === 0 ? (
              <div className="p-3 bg-amber-50 dark:bg-amber-900/20 border border-amber-200 dark:border-amber-800 rounded-lg text-xs text-amber-700 dark:text-amber-400">
                Primero creá una cuenta bancaria en el módulo Bancos y asignala a Mercado Pago.
              </div>
            ) : (
              <Select value={cuentaBancariaId} onValueChange={setCuentaBancariaId}>
                <SelectTrigger className="dark:bg-kx-surface dark:border-kx-border dark:text-kx-text">
                  <SelectValue placeholder="Seleccionar cuenta..." />
                </SelectTrigger>
                <SelectContent>
                  {cuentas.map(c => (
                    <SelectItem key={c.id} value={c.id}>
                      {c.nombre}{c.banco ? ` — ${c.banco}` : ''}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            )}
            <p className="text-xs text-kx-text-3">Los cobros de MP se acreditarán en esta cuenta automáticamente.</p>
          </div>

          {/* Webhook Secret (opcional) */}
          <div className="space-y-2">
            <Label className="text-kx-text text-sm flex items-center gap-1.5">
              <Shield className="w-3.5 h-3.5 text-kx-text-3" />
              Webhook Secret
              <span className="text-xs font-normal text-kx-text-3">(opcional, recomendado)</span>
            </Label>
            <Input
              value={webhookSecret}
              onChange={e => setWebhookSecret(e.target.value)}
              placeholder="tu-clave-secreta-de-mp..."
              className="kairox-input font-mono text-xs"
              type="password"
            />
            <p className="text-xs text-kx-text-3">
              Si configurás un secret en MP Developers → Webhooks, pegalo acá para validar la firma de cada notificación y evitar requests falsos.
            </p>
          </div>
        </div>

        <div className="flex gap-2 justify-end pt-2 border-t border-kx-border">
          <Button variant="outline" onClick={() => onOpenChange(false)}>Cancelar</Button>
          <Button
            onClick={handleGuardar}
            disabled={guardando || !cuentaBancariaId || (!accessToken && !integracion)}
            className="bg-[#009EE3] hover:bg-[#0082c1] text-white"
          >
            {guardando
              ? <><Loader2 className="w-4 h-4 mr-2 animate-spin" /> Guardando...</>
              : '✓ Guardar configuración'}
          </Button>
        </div>
      </DialogContent>
    </Dialog>
  );
}

export default ConfigMercadoPagoModal;
