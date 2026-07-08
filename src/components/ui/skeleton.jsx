import { cn } from '@/lib/utils';

const Skeleton = ({ className, ...props }) => (
  <div
    className={cn('animate-pulse rounded-md bg-slate-200 dark:bg-slate-700', className)}
    {...props}
  />
);

export { Skeleton };