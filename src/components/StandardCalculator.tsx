import React, { useEffect, useMemo, useRef, useState } from 'react';
import { X } from 'lucide-react';
import {
  evaluateCalculatorExpression,
  formatCalculatorValue,
  normalizeCalculatorExpression,
} from '../lib/calculator';

type KeyAction = 'clear' | 'sign' | 'decimal' | 'equals';
type CalculatorKey = {
  label: string;
  token?: string;
  action?: KeyAction;
  kind?: 'utility' | 'operator' | 'equals' | 'number';
  span?: number;
};

const KEY_ROWS: CalculatorKey[][] = [
  [
    { label: 'AC', action: 'clear', kind: 'utility' },
    { label: '±', action: 'sign', kind: 'utility' },
    { label: '%', token: '%', kind: 'utility' },
    { label: '÷', token: '÷', kind: 'operator' },
  ],
  [
    { label: '7', token: '7', kind: 'number' },
    { label: '8', token: '8', kind: 'number' },
    { label: '9', token: '9', kind: 'number' },
    { label: '×', token: '×', kind: 'operator' },
  ],
  [
    { label: '4', token: '4', kind: 'number' },
    { label: '5', token: '5', kind: 'number' },
    { label: '6', token: '6', kind: 'number' },
    { label: '−', token: '−', kind: 'operator' },
  ],
  [
    { label: '1', token: '1', kind: 'number' },
    { label: '2', token: '2', kind: 'number' },
    { label: '3', token: '3', kind: 'number' },
    { label: '+', token: '+', kind: 'operator' },
  ],
  [
    { label: '0', token: '0', kind: 'number', span: 2 },
    { label: '.', action: 'decimal', kind: 'number' },
    { label: '=', action: 'equals', kind: 'equals' },
  ],
];

type StandardCalculatorProps = {
  open: boolean;
  onClose: () => void;
};

export const StandardCalculator: React.FC<StandardCalculatorProps> = ({ open, onClose }) => {
  const [expression, setExpression] = useState('');
  const [justEvaluated, setJustEvaluated] = useState(false);
  const [error, setError] = useState('');
  const [copyMessage, setCopyMessage] = useState('');
  const inputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    if (open) inputRef.current?.focus();
  }, [open]);

  const preview = useMemo(() => {
    if (!expression.trim()) return null;
    try {
      return formatCalculatorValue(evaluateCalculatorExpression(expression));
    } catch {
      return null;
    }
  }, [expression]);

  const clear = () => {
    setExpression('');
    setJustEvaluated(false);
    setError('');
    setCopyMessage('');
  };

  const deleteLast = () => {
    setExpression((current) => current.slice(0, -1));
    setJustEvaluated(false);
    setError('');
    setCopyMessage('');
  };

  const appendToken = (token: string) => {
    setExpression((current) => {
      const base = justEvaluated && /^[0-9]$/.test(token) ? '' : current;
      return base + token;
    });
    setJustEvaluated(false);
    setError('');
    setCopyMessage('');
  };

  const appendDecimal = () => {
    setExpression((current) => {
      const base = justEvaluated ? '' : current;
      const currentNumber = base.match(/[0-9.]+$/)?.[0] || '';
      if (currentNumber.includes('.')) return base;
      if (!base || /[+−×÷(]$/.test(base)) return base + '0.';
      if (base.endsWith(')') || base.endsWith('%')) return base + '×0.';
      return base + '.';
    });
    setJustEvaluated(false);
    setError('');
    setCopyMessage('');
  };

  const toggleSign = () => {
    setExpression((current) => {
      const match = current.match(/(−?)(\d+(?:\.\d*)?|\.\d+)(%?)$/);
      if (!match) return current ? current + '−' : '−';
      const start = current.length - match[0].length;
      const replacement = match[1] ? match[0].slice(1) : '−' + match[0];
      return current.slice(0, start) + replacement;
    });
    setJustEvaluated(false);
    setError('');
    setCopyMessage('');
  };

  const calculate = () => {
    try {
      const result = formatCalculatorValue(evaluateCalculatorExpression(expression));
      setExpression(result);
      setJustEvaluated(true);
      setError('');
      setCopyMessage('');
      return result;
    } catch {
      setError('Error');
      setJustEvaluated(false);
      setCopyMessage('');
      return null;
    }
  };

  const handleKeyDown = (event: React.KeyboardEvent<HTMLElement>) => {
    const { key } = event;

    if (key === 'Enter' || key === '=') {
      event.preventDefault();
      calculate();
      return;
    }
    if (key === 'Escape') {
      event.preventDefault();
      clear();
      return;
    }

    const target = event.target;
    if (target === inputRef.current) {
      if (justEvaluated && /^[0-9]$/.test(key)) {
        event.preventDefault();
        appendToken(key);
        return;
      }
      if (justEvaluated && (key === '.' || key === ',')) {
        event.preventDefault();
        appendDecimal();
        return;
      }
      return;
    }

    if (/^[0-9]$/.test(key)) {
      event.preventDefault();
      appendToken(key);
    } else if (key === '.' || key === ',') {
      event.preventDefault();
      appendDecimal();
    } else if (['+', '-', '*', '/', '%', '(', ')'].includes(key)) {
      event.preventDefault();
      appendToken(normalizeCalculatorExpression(key));
    } else if (key === 'Backspace') {
      event.preventDefault();
      deleteLast();
    } else if (key === 'Delete') {
      event.preventDefault();
      clear();
    }
  };

  const activateKey = (calculatorKey: CalculatorKey) => {
    if (calculatorKey.action === 'clear') clear();
    else if (calculatorKey.action === 'sign') toggleSign();
    else if (calculatorKey.action === 'decimal') appendDecimal();
    else if (calculatorKey.action === 'equals') calculate();
    else if (calculatorKey.token) appendToken(calculatorKey.token);
  };

  const copyResult = async () => {
    const value = justEvaluated ? expression : preview;
    if (!value) return;
    try {
      if (!navigator.clipboard?.writeText) throw new Error('Clipboard unavailable');
      await navigator.clipboard.writeText(value);
      setCopyMessage('Copied');
    } catch {
      setCopyMessage('Select the result and press Ctrl+C');
      inputRef.current?.select();
    }
  };

  if (!open) return null;

  return (
    <div
      className="fixed inset-0 z-[1000] grid place-items-center bg-black/50 p-4"
      role="presentation"
      onMouseDown={(event) => {
        if (event.target === event.currentTarget) onClose();
      }}
    >
      <section
        role="dialog"
        aria-modal="true"
        aria-labelledby="standard-calculator-title"
        dir="ltr"
        onKeyDown={handleKeyDown}
        className="w-full max-w-sm rounded-3xl border app-border bg-[var(--surface)] p-4 shadow-2xl"
      >
        <header className="mb-4 flex items-center justify-between gap-3">
          <div>
            <p className="text-[10px] font-bold tracking-[0.16em] app-muted">STANDARD CALCULATOR</p>
            <h2 id="standard-calculator-title" className="mt-1 text-lg font-black">Calculator</h2>
          </div>
          <button
            type="button"
            onClick={onClose}
            aria-label="Close calculator"
            title="Close"
            className="grid h-9 w-9 place-items-center rounded-xl border app-border hover:bg-[var(--surface-2)]"
          >
            <X size={17} />
          </button>
        </header>

        <div className="mb-3 rounded-2xl border app-border bg-[var(--surface-2)] p-3">
          <div className="mb-1 flex items-center justify-between gap-2 text-[10px] app-muted">
            <span>EXPRESSION</span>
            <button
              type="button"
              onClick={deleteLast}
              aria-label="Delete last character"
              title="Backspace"
              className="rounded-md border app-border px-2 py-1 font-bold hover:bg-[var(--surface)]"
            >
              DEL
            </button>
          </div>
          <input
            ref={inputRef}
            value={expression}
            onChange={(event) => {
              setExpression(normalizeCalculatorExpression(event.target.value));
              setJustEvaluated(false);
              setError('');
              setCopyMessage('');
            }}
            autoComplete="off"
            autoCapitalize="off"
            spellCheck={false}
            inputMode="decimal"
            aria-label="Calculator expression"
            placeholder="0"
            className="w-full border-0 bg-transparent py-2 text-right text-3xl font-semibold tabular-nums outline-none"
          />
          <div className="min-h-5 text-right text-sm tabular-nums" aria-live="polite">
            {error ? <span className="font-bold text-red-500">{error}</span> : preview && !justEvaluated ? <span className="app-muted">= {preview}</span> : <span className="app-muted">Enter an expression</span>}
          </div>
        </div>

        <div className="grid grid-cols-4 gap-2">
          {KEY_ROWS.flat().map((calculatorKey) => {
            const utility = calculatorKey.kind === 'utility';
            const operator = calculatorKey.kind === 'operator';
            const equals = calculatorKey.kind === 'equals';
            return (
              <button
                key={calculatorKey.label}
                type="button"
                onClick={() => activateKey(calculatorKey)}
                aria-label={calculatorKey.label}
                className={[
                  'min-h-12 rounded-xl border app-border text-lg font-semibold transition active:scale-[0.98] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--primary)]',
                  calculatorKey.span === 2 ? 'col-span-2' : '',
                  utility ? 'bg-[var(--surface-2)] text-[var(--text)]' : '',
                  operator ? 'bg-[var(--primary)]/10 text-[var(--primary)]' : '',
                  equals ? 'border-transparent bg-[var(--primary)] text-white' : '',
                  calculatorKey.kind === 'number' ? 'bg-[var(--surface)] hover:bg-[var(--surface-2)]' : '',
                ].join(' ')}
              >
                {calculatorKey.label}
              </button>
            );
          })}
        </div>

        <footer className="mt-4 flex items-center justify-between gap-3">
          <button
            type="button"
            onClick={() => void copyResult()}
            disabled={!(justEvaluated ? expression : preview)}
            className="rounded-xl border app-border px-3 py-2 text-xs font-bold disabled:opacity-40 hover:bg-[var(--surface-2)]"
          >
            Copy Result
          </button>
          <span className="text-right text-[10px] app-muted" aria-live="polite">
            {copyMessage || 'Enter = · Esc = AC · Backspace = DEL'}
          </span>
        </footer>
      </section>
    </div>
  );
};
