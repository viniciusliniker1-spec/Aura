import React, { useLayoutEffect, useRef } from 'react';

interface Props extends Omit<React.TextareaHTMLAttributes<HTMLTextAreaElement>, 'onChange' | 'value'> {
  value: string;
  onValueChange: (v: string) => void;
  maxRows?: number;
}

/** Textarea que cresce com o texto. O Enter insere quebra de linha (o envio é só pelo botão). */
export const AutoTextarea: React.FC<Props> = ({ value, onValueChange, maxRows = 6, className = '', ...rest }) => {
  const ref = useRef<HTMLTextAreaElement>(null);
  useLayoutEffect(() => {
    const el = ref.current;
    if (!el) return;
    el.style.height = 'auto';
    const line = parseFloat(getComputedStyle(el).lineHeight) || 20;
    el.style.height = `${Math.min(el.scrollHeight, line * maxRows)}px`;
  }, [value, maxRows]);
  return (
    <textarea
      ref={ref}
      rows={1}
      value={value}
      onChange={(e) => onValueChange(e.target.value)}
      enterKeyHint="enter"
      className={`resize-none ${className}`}
      {...rest}
    />
  );
};
