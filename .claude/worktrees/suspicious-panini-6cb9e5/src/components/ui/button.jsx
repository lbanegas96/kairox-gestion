import { cn } from '@/lib/utils';
import { Slot } from '@radix-ui/react-slot';
import { cva } from 'class-variance-authority';
import React from 'react';

const buttonVariants = cva(
	'inline-flex items-center justify-center rounded-md text-sm font-medium ring-offset-background transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 disabled:pointer-events-none disabled:opacity-50',
	{
		variants: {
			variant: {
				default: 'bg-primary text-primary-foreground hover:bg-primary/90 dark:bg-slate-50 dark:text-slate-900 dark:hover:bg-slate-200',
				destructive:
          'bg-destructive text-destructive-foreground hover:bg-destructive/90 dark:bg-red-900 dark:text-red-50 dark:hover:bg-red-900/90',
				outline:
          'border border-input bg-background hover:bg-accent hover:text-accent-foreground dark:border-slate-700 dark:bg-slate-950 dark:hover:bg-slate-800 dark:text-slate-100',
				secondary:
          'bg-secondary text-secondary-foreground hover:bg-secondary/80 dark:bg-slate-800 dark:text-slate-50 dark:hover:bg-slate-800/80',
				ghost: 'hover:bg-accent hover:text-accent-foreground dark:hover:bg-slate-800 dark:hover:text-slate-50',
				link: 'text-primary underline-offset-4 hover:underline dark:text-slate-50',
			},
			size: {
				default: 'h-10 px-4 py-2',
				sm: 'h-9 rounded-md px-3',
				lg: 'h-11 rounded-md px-8',
				icon: 'h-10 w-10',
			},
		},
		defaultVariants: {
			variant: 'default',
			size: 'default',
		},
	},
);

const Button = React.forwardRef(({ className, variant, size, asChild = false, ...props }, ref) => {
	const Comp = asChild ? Slot : 'button';
	return (
		<Comp
			className={cn(buttonVariants({ variant, size, className }))}
			ref={ref}
			{...props}
		/>
	);
});
Button.displayName = 'Button';

export { Button, buttonVariants };