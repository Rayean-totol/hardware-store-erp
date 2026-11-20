import { cva, type VariantProps } from 'class-variance-authority';
import * as React from 'react';
import { cn } from './cn';

const alertVariants = cva('relative w-full rounded-lg border px-4 py-3 text-sm [&_p]:leading-relaxed', {
  variants: {
    variant: {
      default: 'bg-card text-card-foreground',
      info: 'border-primary/30 bg-primary/5',
      success: 'border-success/30 bg-success/10 text-success',
      warning: 'border-warning/40 bg-warning/10',
      destructive: 'border-destructive/40 bg-destructive/10 text-destructive',
    },
  },
  defaultVariants: { variant: 'default' },
});

export function Alert({
  className,
  variant,
  ...props
}: React.HTMLAttributes<HTMLDivElement> & VariantProps<typeof alertVariants>) {
  const role = variant === 'destructive' || variant === 'warning' ? 'alert' : 'status';
  return <div role={role} className={cn(alertVariants({ variant }), className)} {...props} />;
}

export function AlertTitle({ className, ...props }: React.HTMLAttributes<HTMLHeadingElement>) {
  return <h3 className={cn('mb-1 font-semibold leading-none', className)} {...props} />;
}
