const ONES_MASC = ['', 'один', 'два', 'три', 'четыре', 'пять', 'шесть', 'семь', 'восемь', 'девять'];
const ONES_FEM = ['', 'одна', 'две', 'три', 'четыре', 'пять', 'шесть', 'семь', 'восемь', 'девять'];
const TEENS = [
  'десять', 'одиннадцать', 'двенадцать', 'тринадцать', 'четырнадцать',
  'пятнадцать', 'шестнадцать', 'семнадцать', 'восемнадцать', 'девятнадцать',
];
const TENS = ['', '', 'двадцать', 'тридцать', 'сорок', 'пятьдесят', 'шестьдесят', 'семьдесят', 'восемьдесят', 'девяносто'];
const HUNDREDS = ['', 'сто', 'двести', 'триста', 'четыреста', 'пятьсот', 'шестьсот', 'семьсот', 'восемьсот', 'девятьсот'];

type Forms = [string, string, string]; // [1, 2-4, 5-0/11-14]

function pluralize(n: number, forms: Forms): string {
  const mod100 = n % 100;
  if (mod100 >= 11 && mod100 <= 14) return forms[2];
  const mod10 = n % 10;
  if (mod10 === 1) return forms[0];
  if (mod10 >= 2 && mod10 <= 4) return forms[1];
  return forms[2];
}

function convertGroup(n: number, feminine: boolean): string[] {
  const words: string[] = [];
  const hundreds = Math.floor(n / 100);
  const rest = n % 100;
  if (hundreds) words.push(HUNDREDS[hundreds]);
  if (rest >= 10 && rest <= 19) {
    words.push(TEENS[rest - 10]);
  } else {
    const tens = Math.floor(rest / 10);
    const ones = rest % 10;
    if (tens) words.push(TENS[tens]);
    if (ones) words.push((feminine ? ONES_FEM : ONES_MASC)[ones]);
  }
  return words;
}

const THOUSAND_FORMS: Forms = ['тысяча', 'тысячи', 'тысяч'];
const MILLION_FORMS: Forms = ['миллион', 'миллиона', 'миллионов'];
const BILLION_FORMS: Forms = ['миллиард', 'миллиарда', 'миллиардов'];

/**
 * Spells out an integer amount in Russian words, e.g. 240534 -> "двести сорок тысяч пятьсот тридцать четыре".
 * The trailing units group uses masculine forms (matching "рубль", which callers append separately).
 */
export function numberToWordsRu(amount: number): string {
  const value = Math.trunc(Math.abs(amount));
  if (value === 0) return 'ноль';

  const billions = Math.floor(value / 1_000_000_000);
  const millions = Math.floor((value % 1_000_000_000) / 1_000_000);
  const thousands = Math.floor((value % 1_000_000) / 1_000);
  const units = value % 1_000;

  const parts: string[] = [];
  if (billions) parts.push(...convertGroup(billions, false), pluralize(billions, BILLION_FORMS));
  if (millions) parts.push(...convertGroup(millions, false), pluralize(millions, MILLION_FORMS));
  if (thousands) parts.push(...convertGroup(thousands, true), pluralize(thousands, THOUSAND_FORMS));
  if (units || parts.length === 0) parts.push(...convertGroup(units, false));

  return parts.join(' ');
}
