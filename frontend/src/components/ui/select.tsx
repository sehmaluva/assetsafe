import React from 'react';
import {
  formErrorClassName,
  formFieldWrapperClassName,
  formLabelClassName,
  formSelectChevronStyle,
  formSelectClassName,
} from '@/lib/formFieldStyles';

interface SelectProps extends React.SelectHTMLAttributes<HTMLSelectElement> {
  label?: string;
  error?: string;
  required?: boolean;
  children: React.ReactNode;
}

export const Select = React.forwardRef<HTMLSelectElement, SelectProps>(
  ({ label, error, required, className, id, children, ...props }, ref) => {
    const selectId = id ?? label?.toLowerCase().replace(/\s+/g, '-');
    return (
      <div className={formFieldWrapperClassName}>
        {label && (
          <label htmlFor={selectId} className={formLabelClassName}>
            {label}
            {required && <span className="text-red-500 ml-0.5">*</span>}
          </label>
        )}
        <select
          ref={ref}
          id={selectId}
          className={formSelectClassName({ error: Boolean(error), className })}
          style={formSelectChevronStyle}
          {...props}
        >
          {children}
        </select>
        {error && <p className={formErrorClassName}>{error}</p>}
      </div>
    );
  },
);
Select.displayName = 'Select';
