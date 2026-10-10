import { describe, expect, it } from 'vitest';
import {
  evaluateCalculatorExpression,
  formatCalculatorValue,
  normalizeCalculatorExpression,
} from './calculator';

describe('standard calculator', () => {
  it('evaluates standard operator precedence', () => {
    expect(evaluateCalculatorExpression('2+3×4')).toBe(14);
    expect(evaluateCalculatorExpression('(2+3)×4')).toBe(20);
  });

  it('supports percentages and unary signs', () => {
    expect(evaluateCalculatorExpression('200×10%')).toBe(20);
    expect(evaluateCalculatorExpression('−(2+3)')).toBe(-5);
  });

  it('normalizes Persian and Arabic digits and keyboard operators', () => {
    expect(normalizeCalculatorExpression('۱۲۳*۴٫۵')).toBe('123×4.5');
    expect(evaluateCalculatorExpression('١٠÷٢')).toBe(5);
  });

  it('formats floating-point output for display', () => {
    expect(formatCalculatorValue(0.1 + 0.2)).toBe('0.3');
  });

  it('rejects incomplete expressions and division by zero', () => {
    expect(() => evaluateCalculatorExpression('3+')).toThrow();
    expect(() => evaluateCalculatorExpression('5÷0')).toThrow();
  });
});
