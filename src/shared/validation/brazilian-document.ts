/** Strips punctuation and spaces: "123.456.789-09" -> "12345678909". */
export function normalizeDocument(value: string): string {
  return value.replace(/[^0-9A-Za-z]/g, "").toUpperCase();
}

function allSameCharacter(value: string): boolean {
  return value.split("").every((char) => char === value[0]);
}

/** CPF: 11 digits, two check digits (mod 11). */
export function isValidCpf(value: string): boolean {
  const cpf = normalizeDocument(value);
  if (!/^\d{11}$/.test(cpf) || allSameCharacter(cpf)) return false;

  const digits = cpf.split("").map(Number);
  const checkDigit = (length: number) => {
    const sum = digits.slice(0, length).reduce((acc, digit, index) => acc + digit * (length + 1 - index), 0);
    const remainder = (sum * 10) % 11;
    return remainder === 10 ? 0 : remainder;
  };
  return checkDigit(9) === digits[9] && checkDigit(10) === digits[10];
}

const CNPJ_WEIGHTS = [6, 5, 4, 3, 2, 9, 8, 7, 6, 5, 4, 3, 2];

/**
 * CNPJ: 14 characters. Since July 2026 the first 12 may be letters or digits (alphanumeric CNPJ);
 * the last two are always digits. Each character is valued as `charCode - 48`, which equals the
 * digit for numeric CNPJs, so the same mod 11 algorithm covers both formats.
 */
export function isValidCnpj(value: string): boolean {
  const cnpj = normalizeDocument(value);
  if (!/^[0-9A-Z]{12}\d{2}$/.test(cnpj) || allSameCharacter(cnpj)) return false;

  const values = cnpj.split("").map((char) => char.charCodeAt(0) - 48);
  const checkDigit = (length: number) => {
    const weights = CNPJ_WEIGHTS.slice(CNPJ_WEIGHTS.length - length);
    const sum = values.slice(0, length).reduce((acc, current, index) => acc + current * weights[index]!, 0);
    const remainder = sum % 11;
    return remainder < 2 ? 0 : 11 - remainder;
  };
  return checkDigit(12) === values[12] && checkDigit(13) === values[13];
}
