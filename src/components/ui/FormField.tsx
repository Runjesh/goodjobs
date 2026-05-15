import React from 'react';

type FormFieldProps = {
  id: string;
  label: React.ReactNode;
  required?: boolean;
  hint?: string;
  children: React.ReactNode;
  className?: string;
};

/** Label + control + optional hint — consistent spacing and a11y across modals. */
export function FormField({ id, label, required, hint, children, className }: FormFieldProps) {
  return (
    <div className={['form-field', className].filter(Boolean).join(' ')}>
      <label className="input-label" htmlFor={id}>
        {label}
        {required ? <span className="req" aria-hidden> *</span> : null}
      </label>
      {children}
      {hint ? (
        <p className="form-hint" id={`${id}-hint`}>
          {hint}
        </p>
      ) : null}
    </div>
  );
}

type FormGridProps = {
  children: React.ReactNode;
  columns?: 1 | 2;
  className?: string;
};

export function FormGrid({ children, columns = 2, className }: FormGridProps) {
  return (
    <div
      className={[
        'form-grid',
        columns === 2 ? 'form-grid--2' : 'form-grid--1',
        className,
      ].filter(Boolean).join(' ')}
    >
      {children}
    </div>
  );
}
