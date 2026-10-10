const PERSIAN_DIGITS = '۰۱۲۳۴۵۶۷۸۹';
const ARABIC_DIGITS = '٠١٢٣٤٥٦٧٨٩';

export function normalizeCalculatorExpression(value: string): string {
  return value
    .replace(/[۰-۹٠-٩]/g, (digit) => {
      const index = PERSIAN_DIGITS.indexOf(digit);
      return String(index >= 0 ? index : ARABIC_DIGITS.indexOf(digit));
    })
    .replace(/٬/g, '')
    .replace(/[،٫,]/g, '.')
    .replace(/[xX*]/g, '×')
    .replace(/\//g, '÷')
    .replace(/[\-–—]/g, '−')
    .replace(/[^0-9.+−×÷%()]/g, '');
}

export function evaluateCalculatorExpression(value: string): number {
  const source = normalizeCalculatorExpression(value)
    .replace(/×/g, '*')
    .replace(/÷/g, '/')
    .replace(/−/g, '-');

  if (!source) throw new Error('Empty expression');

  let index = 0;

  const parsePrimary = (): number => {
    if (source[index] === '(') {
      index += 1;
      const valueInside = parseExpression();
      if (source[index] !== ')') throw new Error('Missing closing parenthesis');
      index += 1;
      return valueInside;
    }

    const start = index;
    while (index < source.length && /[0-9.]/.test(source[index])) index += 1;
    const token = source.slice(start, index);
    if (!/^(?:\d+(?:\.\d*)?|\.\d+)$/.test(token)) throw new Error('Expected a number');

    const number = Number(token);
    if (!Number.isFinite(number)) throw new Error('Invalid number');
    return number;
  };

  const parsePercent = (): number => {
    let result = parsePrimary();
    while (source[index] === '%') {
      result /= 100;
      index += 1;
    }
    return result;
  };

  const parseUnary = (): number => {
    if (source[index] === '+') {
      index += 1;
      return parseUnary();
    }
    if (source[index] === '-') {
      index += 1;
      return -parseUnary();
    }
    return parsePercent();
  };

  const parseTerm = (): number => {
    let result = parseUnary();
    while (source[index] === '*' || source[index] === '/') {
      const operator = source[index];
      index += 1;
      const right = parseUnary();
      if (operator === '/') {
        if (right === 0) throw new Error('Division by zero');
        result /= right;
      } else {
        result *= right;
      }
    }
    return result;
  };

  const parseExpression = (): number => {
    let result = parseTerm();
    while (source[index] === '+' || source[index] === '-') {
      const operator = source[index];
      index += 1;
      const right = parseTerm();
      result = operator === '+' ? result + right : result - right;
    }
    return result;
  };

  const result = parseExpression();
  if (index !== source.length) throw new Error('Invalid expression');
  if (!Number.isFinite(result)) throw new Error('Result is not finite');
  return Object.is(result, -0) ? 0 : result;
}

export function formatCalculatorValue(value: number): string {
  if (!Number.isFinite(value)) throw new Error('Result is not finite');
  const rounded = Number(value.toPrecision(12));
  return Object.is(rounded, -0) ? '0' : String(rounded);
}
