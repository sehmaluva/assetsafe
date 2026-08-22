import React from 'react';
import {
  formControlClassName,
  formErrorClassName,
  formFieldWrapperClassName,
  formLabelClassName,
} from '@/lib/formFieldStyles';

interface DateInputProps {
  label?: string;
  error?: string;
  required?: boolean;
  value?: string;
  onChange?: (value: string) => void;
  onBlur?: () => void;
  name?: string;
  disabled?: boolean;
  id?: string;
  min?: string;
  max?: string;
}

const MAX_DATE_YEAR = new Date().getFullYear() + 10;

export const DateInput = React.forwardRef<HTMLInputElement, DateInputProps>(
  (
    {
      label,
      error,
      required,
      value,
      onChange,
      onBlur,
      name,
      disabled,
      id,
      min = '1990-01-01',
      max = `${MAX_DATE_YEAR}-12-31`,
    },
    ref,
  ) => {
    const inputId = id ?? label?.toLowerCase().replace(/\s+/g, '-');
    const isoValue =
      value && /^\d{4}-\d{2}-\d{2}$/.test(value) ? value : '';

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
          name={name}
          type="date"
          value={isoValue}
          min={min}
          max={max}
          onChange={(e) => onChange?.(e.target.value)}
          onBlur={onBlur}
          disabled={disabled}
          className={formControlClassName({
            error: Boolean(error),
            className:
              '[&::-webkit-calendar-picker-indicator]:cursor-pointer [&::-webkit-calendar-picker-indicator]:opacity-60 [&::-webkit-calendar-picker-indicator]:hover:opacity-100',
          })}
        />
        {error && <p className={formErrorClassName}>{error}</p>}
      </div>
    );
  },
);
DateInput.displayName = 'DateInput';
