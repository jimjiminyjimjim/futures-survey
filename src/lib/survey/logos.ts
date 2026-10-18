/**
 * Organisation logos shown beside a question's source line (Session 1,
 * question B: 2a–2d). Keyed by statement key, which `admin_create_survey`
 * copies unchanged, so new surveys keep their logos. Files live in
 * public/logos/ (Wikimedia Commons; Shell supplied by the client).
 */
export type StatementLogo = {
  src: string;
  alt: string;
  width: number;
  height: number;
};

const STATEMENT_LOGOS: Record<string, StatementLogo> = {
  sb_2a: { src: "/logos/shein.svg", alt: "Shein", width: 106, height: 22 },
  sb_2b: { src: "/logos/shell.png", alt: "Shell", width: 412, height: 502 },
  sb_2c: {
    src: "/logos/hm-government.png",
    alt: "UK Government",
    width: 390,
    height: 320,
  },
  sb_2d: {
    src: "/logos/tonys-chocolonely.svg",
    alt: "Tony’s Chocolonely",
    width: 1000,
    height: 508,
  },
};

export function statementLogo(key: string): StatementLogo | null {
  return STATEMENT_LOGOS[key] ?? null;
}
