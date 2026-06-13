import React, { useState } from 'react';

import { Mail, ArrowLeft, Loader2 } from 'lucide-react';
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription, DialogFooter } from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { useToast } from '@/components/ui/use-toast';

function PasswordRecoveryModal({ isOpen, onClose, onRecover }) {
  const [email, setEmail] = useState('');
  const [isLoading, setIsLoading] = useState(false);
  const { toast } = useToast();

  const handleRecoverClick = async () => {
    if (!email || !email.includes('@')) {
      toast({
        title: "Email inválido",
        description: "Por favor, ingresa un correo electrónico válido.",
        variant: "destructive",
      });
      return;
    }

    setIsLoading(true);
    await onRecover(email);
    setIsLoading(false);
  };

  const handleClose = () => {
    if (isLoading) return;
    setEmail('');
    onClose();
  };

  return (
    <Dialog open={isOpen} onOpenChange={handleClose}>
      <DialogContent className="bg-slate-900/80 backdrop-blur-xl border-slate-800 text-white sm:max-w-[425px]">
        <DialogHeader>
          <DialogTitle className="text-2xl font-bold">Recuperar Contraseña</DialogTitle>
          <DialogDescription className="text-kx-text-3">
            Ingresa tu email y te enviaremos un enlace para restablecer tu contraseña.
          </DialogDescription>
        </DialogHeader>
        <div className="py-4 space-y-4">
          <div className="space-y-2">
            <Label htmlFor="recovery-email" className="text-slate-300">
              Email
            </Label>
            <div className="relative group">
              <Mail className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-slate-500 group-focus-within:text-[#00D4FF] transition-colors" />
              <Input
                id="recovery-email"
                type="email"
                value={email}
                onChange={(e) => setEmail(e.target.value)}
                className="pl-10 bg-slate-950/50 border-slate-800 focus:border-[#00D4FF] transition-all"
                placeholder="tu.email@ejemplo.com"
                disabled={isLoading}
              />
            </div>
          </div>
        </div>
        <DialogFooter className="flex-col-reverse sm:flex-row sm:justify-between gap-2">
          <Button variant="outline" onClick={handleClose} disabled={isLoading} className="border-slate-700 text-slate-300 hover:text-white hover:bg-slate-800 w-full sm:w-auto">
             <ArrowLeft className="h-4 w-4 mr-2" />
             Volver
          </Button>
          <Button 
            onClick={handleRecoverClick} 
            disabled={isLoading} 
            className="w-full sm:w-auto bg-gradient-to-r from-[#00D4FF] to-[#A855F7] hover:opacity-90 text-white font-bold transition-all"
          >
            {isLoading ? (
              <Loader2 className="mr-2 h-4 w-4 animate-spin" />
            ) : (
              'Enviar Enlace'
            )}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

export default PasswordRecoveryModal;