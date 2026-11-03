import { useState, type InputHTMLAttributes } from 'react';
import { isValidEmail } from '../../lib/utils';

type Props = Omit<InputHTMLAttributes<HTMLInputElement>, 'type'>;

export function EmailInput({ className, value, onBlur, ...rest }: Props) {
  const [touched, setTouched] = useState(false);
  const strValue = typeof value === 'string' ? value : '';
  const showError = touched && strValue.length > 0 && !isValidEmail(strValue);

  return (
    <div className="w-full">
      <input
        {...rest}
        type="email"
        className={`${className || ''}${showError ? ' !border-danger !ring-danger/30' : ''}`}
        value={value}
        onBlur={(e) => {
          setTouched(true);
          onBlur?.(e);
        }}
      />
      {showError && (
        <p className="text-xs text-danger mt-1">Please enter a valid email address</p>
      )}
    </div>
  );
}
