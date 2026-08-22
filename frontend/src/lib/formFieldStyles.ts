import { cn } from '@/lib/utils';

export const formFieldWrapperClassName = 'flex flex-col gap-1';

export const formLabelClassName = 'text-xs font-medium text-slate-700';

export const formErrorClassName = 'text-xs text-red-500';

export function formControlClassName(options?: {
  error?: boolean;
  className?: string;
}) {
  return cn(
    'h-8 w-full rounded-sm border border-slate-500 bg-white px-2.5 text-sm text-slate-900',
    'placeholder:text-slate-400 focus:border-black focus:outline-none focus:ring-0',
    'disabled:cursor-not-allowed disabled:bg-slate-100',
    options?.error && 'border-red-500 focus:border-red-500',
    options?.className,
  );
}

const selectChevronSvg =
  "url(\"data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' width='16' height='16' viewBox='0 0 24 24' fill='none' stroke='%2364748b' stroke-width='2' stroke-linecap='round' stroke-linejoin='round'%3E%3Cpath d='m6 9 6 6 6-6'/%3E%3C/svg%3E\")";

export function formSelectClassName(options?: {
  error?: boolean;
  className?: string;
}) {
  return cn(
    formControlClassName(options),
    'appearance-none bg-[length:16px] bg-[right_0.5rem_center] bg-no-repeat pr-8 leading-8 py-0',
    options?.className,
  );
}

export const formSelectChevronStyle = {
  backgroundImage: selectChevronSvg,
} as const;
