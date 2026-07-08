import {
  BarChart, Bar, XAxis, YAxis,
  CartesianGrid, Tooltip, ResponsiveContainer, Legend,
} from 'recharts';
import { ChartTooltip } from './shared';

function Graficos({ ventasLoading, ventasDia, flujoLoading, flujoCaja }) {
  return (
    <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
      <div className="bg-kx-surface border border-kx-border rounded-2xl p-5 shadow-sm dark:shadow-none transition-all duration-200 ease-out hover:shadow-lg dark:hover:shadow-[0_4px_20px_rgba(0,0,0,0.4)] hover:-translate-y-0.5 hover:border-kx-border-hover">
        <div className="text-[13px] font-semibold text-kx-text mb-4">Ventas — Últimos 7 días</div>
        <div className="h-[240px]">
          {ventasLoading ? (
            <div className="h-full flex items-center justify-center">
              <div className="w-5 h-5 border-2 border-kx-blue border-t-transparent rounded-full animate-spin" />
            </div>
          ) : (
            <ResponsiveContainer width="100%" height="100%">
              <BarChart data={ventasDia} barSize={24}>
                <CartesianGrid strokeDasharray="3 3" stroke="var(--kx-border)" />
                <XAxis dataKey="fecha" tick={{ fontSize: 11, fill: 'rgb(var(--kx-text-2))' }} axisLine={false} tickLine={false} />
                <YAxis tick={{ fontSize: 11, fill: 'rgb(var(--kx-text-2))' }} axisLine={false} tickLine={false} tickFormatter={v => `$${v >= 1000 ? `${(v/1000).toFixed(0)}k` : v}`} />
                <Tooltip content={<ChartTooltip />} />
                <Bar dataKey="total" name="Ventas" fill="rgb(var(--kx-blue))" radius={[4,4,0,0]} />
              </BarChart>
            </ResponsiveContainer>
          )}
        </div>
      </div>

      <div className="bg-kx-surface border border-kx-border rounded-2xl p-5 shadow-sm dark:shadow-none transition-all duration-200 ease-out hover:shadow-lg dark:hover:shadow-[0_4px_20px_rgba(0,0,0,0.4)] hover:-translate-y-0.5 hover:border-kx-border-hover">
        <div className="text-[13px] font-semibold text-kx-text mb-4">Flujo de Caja — 6 meses</div>
        <div className="h-[240px]">
          {flujoLoading ? (
            <div className="h-full flex items-center justify-center">
              <div className="w-5 h-5 border-2 border-kx-green border-t-transparent rounded-full animate-spin" />
            </div>
          ) : (
            <ResponsiveContainer width="100%" height="100%">
              <BarChart data={flujoCaja} barGap={2} barSize={14}>
                <CartesianGrid strokeDasharray="3 3" stroke="var(--kx-border)" />
                <XAxis dataKey="label" tick={{ fontSize: 11, fill: 'rgb(var(--kx-text-2))' }} axisLine={false} tickLine={false} />
                <YAxis tick={{ fontSize: 11, fill: 'rgb(var(--kx-text-2))' }} axisLine={false} tickLine={false} tickFormatter={v => `$${v >= 1000 ? `${(v/1000).toFixed(0)}k` : v}`} />
                <Tooltip content={<ChartTooltip />} />
                <Legend wrapperStyle={{ fontSize: 12, color: 'rgb(var(--kx-text-2))' }} />
                <Bar dataKey="ingresos" name="Ingresos" fill="rgb(var(--kx-green))" radius={[3,3,0,0]} />
                <Bar dataKey="egresos"  name="Egresos"  fill="rgb(var(--kx-red))"   radius={[3,3,0,0]} />
              </BarChart>
            </ResponsiveContainer>
          )}
        </div>
      </div>
    </div>
  );
}

export default Graficos;
