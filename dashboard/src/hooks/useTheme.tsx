import { createContext, useContext } from 'react';

/**
 * TARS — tema "Asiimov": branco técnico + cinza-aço sobre vazio espacial.
 *
 * Os NOMES dos tokens são herdados do template (sharingan/rift/void...) para
 * manter compatibilidade com as páginas; só os VALORES mudaram — do vermelho
 * Sharingan para o branco/aço tecnológico do TARS.
 *
 * - accent (ex-"sharingan") = branco-aço Asiimov, a marca do HUD;
 * - rift = cinza-azulado frio, profundidade técnica;
 * - void = vazio espacial quase-preto com leve tom frio.
 */
export interface KamuiTheme {
  void: string;
  void2: string;
  surface: string;
  surfaceHi: string;
  input: string;

  sharingan: string;
  sharinganDeep: string;
  sharinganSoft: string;
  sharinganGlow: string;
  sharinganHaze: string;

  rift: string;
  riftSoft: string;
  riftGlow: string;

  text: string;
  textSoft: string;
  textMute: string;
  textGhost: string;

  border: string;
  borderHover: string;
  borderActive: string;

  tethered: string;
  tetheredBg: string;
  severed: string;
  severedBg: string;
  warning: string;
  warningBg: string;
}

export const KAMUI_THEME: KamuiTheme = {
  // Vazio espacial — quase-preto com leve tom azul-aço frio
  void: '#080a0e',
  void2: '#0e1116',
  surface: 'rgba(30, 36, 44, 0.55)',
  surfaceHi: 'rgba(40, 48, 58, 0.72)',
  input: 'rgba(16, 20, 26, 0.85)',

  // Accent "Asiimov" — branco-aço técnico (era o vermelho Sharingan)
  sharingan: '#dfe6ee',
  sharinganDeep: '#9aa6b4',
  sharinganSoft: 'rgba(223, 230, 238, 0.07)',
  sharinganGlow: 'rgba(223, 230, 238, 0.20)',
  sharinganHaze: 'rgba(223, 230, 238, 0.03)',

  // Cinza-azulado frio — profundidade técnica (era o violeta dimensional)
  rift: '#8893a5',
  riftSoft: 'rgba(136, 147, 165, 0.07)',
  riftGlow: 'rgba(136, 147, 165, 0.18)',

  // Textos — leituras de HUD
  text: '#eef2f7',
  textSoft: '#aab3c0',
  textMute: '#6c7682',
  textGhost: '#3b424c',

  // Bordas — linhas de instrumento, frias e sutis
  border: 'rgba(223, 230, 238, 0.06)',
  borderHover: 'rgba(223, 230, 238, 0.16)',
  borderActive: 'rgba(223, 230, 238, 0.34)',

  // Estados — semântica preservada, tons calibrados pro frio
  tethered: '#54d6a4',
  tetheredBg: 'rgba(84, 214, 164, 0.10)',
  severed: '#e8746b',
  severedBg: 'rgba(232, 116, 107, 0.10)',
  warning: '#e0a846',
  warningBg: 'rgba(224, 168, 70, 0.10)',
};

const ThemeContext = createContext<KamuiTheme>(KAMUI_THEME);

export function ThemeProvider({ children }: { children: React.ReactNode }) {
  return (
    <ThemeContext.Provider value={KAMUI_THEME}>
      {children}
    </ThemeContext.Provider>
  );
}

export function useTheme(): KamuiTheme {
  return useContext(ThemeContext);
}
