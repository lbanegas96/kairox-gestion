
export function AuroraBackground() {
  return (
    <div className="fixed inset-0 overflow-hidden pointer-events-none -z-10">
      <div
        className="absolute rounded-full blur-[60px] dark:blur-[80px] opacity-[0.22] dark:opacity-[0.35]
                   w-[480px] h-[480px] -top-[180px] -right-[120px]
                   animate-kx-float1"
        style={{ background: 'radial-gradient(circle, rgb(var(--kx-violet)), transparent 70%)' }}
      />
      <div
        className="absolute rounded-full blur-[60px] dark:blur-[80px] opacity-[0.22] dark:opacity-[0.35]
                   w-[420px] h-[420px] -bottom-[160px] left-[120px]
                   animate-kx-float2"
        style={{ background: 'radial-gradient(circle, rgb(var(--kx-blue)), transparent 70%)' }}
      />
      <div
        className="absolute rounded-full blur-[60px] dark:blur-[80px] opacity-[0.12] dark:opacity-[0.15]
                   w-[320px] h-[320px] bottom-20 right-[200px]
                   animate-kx-float3"
        style={{ background: 'radial-gradient(circle, rgb(var(--kx-green)), transparent 70%)' }}
      />
    </div>
  );
}
