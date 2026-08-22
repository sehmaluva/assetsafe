import React from 'react';
import { cn } from '@/lib/utils';
import {
  formControlClassName,
  formErrorClassName,
  formFieldWrapperClassName,
  formLabelClassName,
} from '@/lib/formFieldStyles';

interface InputProps extends React.InputHTMLAttributes<HTMLInputElement> {
  label?: string;
  error?: string;
  required?: boolean;
}

export const Input = React.forwardRef<HTMLInputElement, InputProps>(
  ({ label, error, required, className, id, ...props }, ref) => {
    const inputId = id ?? label?.toLowerCase().replace(/\s+/g, '-');
    return (
      <div className={formFieldWrapperClassName}>
        {label && (
          <label htmlFor={inputId} className={formLabelClassName}>
            {label}
            {required && <span className="text-red-500 ml-0.5">*</span>}
          </label>
        )}
        <input
          ref={ref}
          id={inputId}
          className={formControlClassName({ error: Boolean(error), className })}
          {...props}
        />
        {error && <p className={formErrorClassName}>{error}</p>}
      </div>
    );
  },
);
Input.displayName = 'Input';
