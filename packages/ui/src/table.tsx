import * as React from 'react';
import { cn } from './cn';

export function Table({ className, ...props }: React.TableHTMLAttributes<HTMLTableElement>) {
  return (
    <div className="relative w-full overflow-x-auto">
      <table className={cn('w-full caption-bottom text-sm', className)} {...props} />
    </div>
  );
}
export function TableHeader(props: React.HTMLAttributes<HTMLTableSectionElement>) {
  return <thead {...props} className={cn('[&_tr]:border-b', props.className)} />;
}
export function TableBody(props: React.HTMLAttributes<HTMLTableSectionElement>) {
  return <tbody {...props} className={cn('[&_tr:last-child]:border-0', props.className)} />;
}
export function TableRow(props: React.HTMLAttributes<HTMLTableRowElement>) {
  return <tr {...props} className={cn('border-b transition-colors hover:bg-muted/50', props.className)} />;
}
export function TableHead(props: React.ThHTMLAttributes<HTMLTableCellElement>) {
  return (
    <th
      {...props}
      className={cn('h-10 px-3 text-start align-middle font-medium text-muted-foreground', props.className)}
    />
  );
}
export function TableCell(props: React.TdHTMLAttributes<HTMLTableCellElement>) {
  return <td {...props} className={cn('px-3 py-2.5 align-middle', props.className)} />;
}
