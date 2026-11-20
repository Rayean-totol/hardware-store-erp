import * as React from 'react';
import { cn } from './cn';
import { Label } from './input';

export interface FieldProps {
  label: React.ReactNode;
  /** Explicit id for the control; generated when omitted. */
  id?: string;
  hint?: React.ReactNode;
  error?: React.ReactNode;
  warning?: React.ReactNode;
  required?: boolean;
  optionalLabel?: string;
  className?: string;
  /** Render prop receiving the a11y props to spread on the control. */
  children: (control: {
    id: string;
    'aria-invalid': boolean;
    'aria-describedby': string | undefined;
    'aria-required': boolean | undefined;
  }) => React.ReactNode;
}

/** Label + control + hint/error, with ids wired for screen readers. */
export function Field({ label, id, hint, error, warning, required, optionalLabel, className, children }: FieldProps) {
  const autoId = React.useId();
  const controlId = id ?? autoId;
  const hintId = hint ? `${controlId}-hint` : undefined;
  const msgId = error || warning ? `${controlId}-msg` : undefined;
  const describedBy = [hintId, msgId].filter(Boolean).join(' ') || undefined;
  return (
    <div className={cn('flex flex-col gap-1.5', className)}>
      <Label htmlFor={controlId}>
        {label}
        {required ? <span className="text-destructive ms-0.5" aria-hidden="true">*</span> : null}
        {!required && optionalLabel ? (
          <span className="ms-1 text-xs font-normal text-muted-foreground">({optionalLabel})</span>
        ) : null}
      </Label>
      {children({
        id: controlId,
        'aria-invalid': Boolean(error),
        'aria-describedby': describedBy,
        'aria-required': required || undefined,
      })}
      {hint ? <p id={hintId} className="text-xs text-muted-foreground">{hint}</p> : null}
      {error ? (
        <p id={msgId} role="alert" className="text-xs font-medium text-destructive">{error}</p>
      ) : warning ? (
        <p id={msgId} className="text-xs font-medium text-warning">{warning}</p>
      ) : null}
    </div>
  );
}
