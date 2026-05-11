import React, { useState } from 'react';
import { motion } from 'framer-motion';
import { Wallet, ArrowRight, Loader2 } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Card, CardContent, CardHeader, CardTitle, CardDescription, CardFooter } from '@/components/ui/card';
import { useCaja } from '@/contexts/CajaContext';

const CajaApertura = () => {
  const { openSession } = useCaja();
  const [montoInicial, setMontoInicial] = useState('');
  const [isSubmitting, setIsSubmitting] = useState(false);

  const handleSubmit = async (e) => {
    e.preventDefault();
    if (montoInicial === '' || parseFloat(montoInicial) < 0) return;

    setIsSubmitting(true);
    await openSession(montoInicial);
    setIsSubmitting(false);
  };

  return (
    <div className="flex items-center justify-center min-h-[60vh]">
      <motion.div 
        initial={{ opacity: 0, scale: 0.95 }}
        animate={{ opacity: 1, scale: 1 }}
        transition={{ duration: 0.3 }}
        className="w-full max-w-md"
      >
        <Card className="border-slate-200 dark:border-slate-800 shadow-xl">
          <CardHeader className="text-center pb-2">
            <div className="mx-auto w-12 h-12 bg-blue-100 dark:bg-blue-900/30 rounded-full flex items-center justify-center mb-4">
              <Wallet className="w-6 h-6 text-blue-600 dark:text-blue-400" />
            </div>
            <CardTitle className="text-2xl font-bold text-slate-900 dark:text-white">Apertura de Caja</CardTitle>
            <CardDescription>
              Inicia un nuevo turno ingresando el monto inicial en efectivo disponible en caja.
            </CardDescription>
          </CardHeader>
          <form onSubmit={handleSubmit}>
            <CardContent className="space-y-4 pt-6">
              <div className="space-y-2">
                <Label htmlFor="monto" className="text-base font-medium">Monto Inicial ($)</Label>
                <div className="relative">
                  <span className="absolute left-3 top-1/2 -translate-y-1/2 text-slate-500 font-bold">$</span>
                  <Input
                    id="monto"
                    type="number"
                    step="0.01"
                    min="0"
                    placeholder="0.00"
                    value={montoInicial}
                    onChange={(e) => setMontoInicial(e.target.value)}
                    className="pl-8 h-12 text-lg font-mono font-bold"
                    required
                    autoFocus
                  />
                </div>
                <p className="text-xs text-slate-500 dark:text-slate-400">
                  Este monto se usará como base para el balance de la sesión.
                </p>
              </div>
            </CardContent>
            <CardFooter>
              <Button 
                type="submit" 
                className="w-full h-12 text-lg font-bold bg-blue-600 hover:bg-blue-700 text-white transition-all shadow-lg shadow-blue-900/20"
                disabled={isSubmitting}
              >
                {isSubmitting ? (
                  <>
                    <Loader2 className="mr-2 h-5 w-5 animate-spin" /> Abriendo...
                  </>
                ) : (
                  <>
                    Abrir Caja <ArrowRight className="ml-2 h-5 w-5" />
                  </>
                )}
              </Button>
            </CardFooter>
          </form>
        </Card>
      </motion.div>
    </div>
  );
};

export default CajaApertura;