// ============================================================================
// Painel de Apuração 2º Turno 2026 — Broadcast Live Engine (app.js)
// Layout 3 Zonas | Fotos dos Candidatos | Live Ticker Monotônico | Mapa c/ Callouts
// ============================================================================

import { UF_META, UF_PATHS } from './uf-paths.js';

// ----------------------------------------------------------------------------
// 1. CONFIGURAÇÃO DOS CANDIDATOS (Edite aqui nomes, números, fotos ou cores!)
// ----------------------------------------------------------------------------
// - A chave é o número oficial do candidato no TSE (campo "n" do JSON).
// - No modo de teste /?sim, o TSE usa os números fictícios "91" e "92":
//   mapeamos ambos para a Foto 1 (Esquerda) e Foto 2 (Direita) automaticamente
//   para que você veja o visual final completo mesmo offline.
// - Para trocar as fotos, basta substituir:
//   public/img/cand-1.webp (Esquerda) e public/img/cand-2.webp (Direita)
// ----------------------------------------------------------------------------
export const CANDIDATES = {
  // Candidato 1 (SEMPRE À ESQUERDA — Posição Fixa 0)
  '13': {
    slot: 0,
    name: 'Lula',
    party: 'PT',
    number: '13',
    photo: '/img/cand-1.webp',
    colorDark: '#ef3340',
    colorLight: '#d91b2b',
  },
  // Candidato 2 (SEMPRE À DIREITA — Posição Fixa 1)
  '22': {
    slot: 1,
    name: 'Flávio Bolsonaro',
    party: 'PL',
    number: '22',
    photo: '/img/cand-2.webp',
    colorDark: '#3b82f6',
    colorLight: '#1a4fd1',
  },

  // Mapeamento automático para o modo simulado (/?sim usa candidatos nº 91 e 92)
  '91': {
    slot: 0,
    name: 'Lula',
    party: 'PT',
    number: '13',
    photo: '/img/cand-1.webp',
    colorDark: '#ef3340',
    colorLight: '#d91b2b',
  },
  '92': {
    slot: 1,
    name: 'Flávio Bolsonaro',
    party: 'PL',
    number: '22',
    photo: '/img/cand-2.webp',
    colorDark: '#3b82f6',
    colorLight: '#1a4fd1',
  },
};

// ----------------------------------------------------------------------------
// 2. CONFIGURAÇÃO GERAL DE REDE E RITMO DE ATUALIZAÇÃO
// ----------------------------------------------------------------------------
const CONFIG = {
  POLL_INTERVAL_MS: 12_000,       // Polling invisível a cada 12s (dentro da janela 10–15s)
  FINAL_POLL_INTERVAL_MS: 300_000,// 5 min após totalização final
  REQUEST_TIMEOUT_MS: 10_000,     // Timeout por requisição (AbortController)
  MAX_CONCURRENCY: 8,             // Fila máxima de estados simultâneos
  MAX_REQ_PER_CYCLE: 30,          // Limite de segurança por ciclo
  RETRY_404_STATE_MS: 300_000,    // Aguarda 5 min se uma UF retornar 404
  RATE_LIMIT_PAUSE_MS: 600_000,   // Pausa de 10 min em caso de HTTP 429/403
  ARIA_ANNOUNCE_MIN_MS: 180_000,  // Throttle de 3 min para leitores de tela
  TIE_THRESHOLD_PP: 0.5,          // Empate técnico < 0,5 p.p.
  TV_CYCLE_STATE_MS: 6_500,       // No modo ?tv, destaca um estado a cada 6,5s
  CICLO: 'ele2026',
  ELE_PRES_OFICIAL: '6258',
  ELE_GOV_OFICIAL: '6260',
  ELE_SIM_DEFAULT: '21270',

  // 5 faixas de intensidade para o mapa
  MARGIN_BANDS: [
    { max: 2,        alphaLight: 0.30, alphaDark: 0.36 },
    { max: 5,        alphaLight: 0.46, alphaDark: 0.52 },
    { max: 10,       alphaLight: 0.64, alphaDark: 0.68 },
    { max: 20,       alphaLight: 0.80, alphaDark: 0.84 },
    { max: Infinity, alphaLight: 0.95, alphaDark: 0.96 },
  ],
};

// ----------------------------------------------------------------------------
// 3. FUNÇÕES PURAS DE FORMATAÇÃO E PARSING DO CONTRATO EA20 DO TSE
// ----------------------------------------------------------------------------
const numFmtInt = new Intl.NumberFormat('pt-BR');
const numFmtPct = new Intl.NumberFormat('pt-BR', { minimumFractionDigits: 2, maximumFractionDigits: 2 });

export const num = (s) => (s == null || s === '' ? 0 : Number(String(s).replace(',', '.')) || 0);
export const esc = (s) =>
  String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
export const fmtInt = (n) => numFmtInt.format(Math.round(Number(n || 0)));
export const fmtPct = (n) => numFmtPct.format(Number(n || 0));

const SMALL_WORDS = new Set(['da', 'de', 'do', 'das', 'dos', 'e']);
export const titleCase = (s) =>
  String(s || '')
    .toLowerCase()
    .split(/\s+/)
    .filter(Boolean)
    .map((w, i) => (i > 0 && SMALL_WORDS.has(w) ? w : w.charAt(0).toUpperCase() + w.slice(1)))
    .join(' ');

export const initialsOf = (name) => {
  const parts = String(name || '').trim().split(/\s+/).filter((w) => !SMALL_WORDS.has(w.toLowerCase()));
  if (!parts.length) return '?';
  if (parts.length === 1) return parts[0].slice(0, 2).toUpperCase();
  return (parts[0][0] + parts[parts.length - 1][0]).toUpperCase();
};

export function parseUnified(j, cargoCode = '1') {
  if (!j || typeof j !== 'object') return null;
  const carg = (j.carg || []).find((c) => String(c.cd) === String(cargoCode)) || (j.carg || [])[0];
  if (!carg) return null;

  const cands = [];
  (carg.agr || []).forEach((a) =>
    (a.par || []).forEach((p) =>
      (p.cand || []).forEach((c) => {
        cands.push({
          key: String(c.sqcand || c.n),
          seq: Number(c.seq) || 0,
          n: String(c.n || ''),
          name: c.nmu || c.nm || '',
          party: String(p.sg || '').trim(),
          votes: Math.max(0, Math.floor(Number(c.vap) || 0)),
          pct: num(c.pvapn ?? c.pvap),
          elected: c.e === 's',
        });
      })
    )
  );

  // Ordem fixa: respeita o slot configurado em CANDIDATES (Esquerda = 0, Direita = 1) ou o `seq` do TSE
  cands.sort((a, b) => {
    const sa = CANDIDATES[a.n]?.slot ?? a.seq;
    const sb = CANDIDATES[b.n]?.slot ?? b.seq;
    return sa - sb;
  });

  const s = j.s || {};
  const v = j.v || {};
  const e = j.e || {};

  return {
    cands,
    sections: {
      total: Number(s.ts) || 0,
      done: Number(s.st) || 0,
      pct: num(s.pstn ?? s.pst),
    },
    electorate: {
      total: Number(e.te) || 0,
      present: Number(e.c) || 0,
      ppresent: num(e.pcn ?? e.pc),
      abst: Number(e.a) || 0,
      pabst: num(e.pan ?? e.pa),
    },
    votes: {
      total: Number(v.tv) || 0,
      valid: Number(v.vv) || 0,
      pvalid: num(v.pvvn ?? v.pvv),
      blank: Number(v.vb) || 0,
      pblank: num(v.pvbn ?? v.pvb),
      nul: Number(v.tvn) || 0,
      pnul: num(v.ptvnn ?? v.ptvn),
    },
    final: j.tf === 's',
    dt: j.dt || j.dg || '',
    ht: j.ht || j.hg || '',
  };
}

export function leaders(d) {
  if (!d || !d.cands || !d.cands.length) return null;
  const tot = d.cands.reduce((acc, c) => acc + c.votes, 0);
  if (!tot) return null;
  const sorted = [...d.cands].sort((a, b) => b.votes - a.votes);
  const top = sorted[0];
  const second = sorted[1] || null;
  const margin = second ? Math.max(0, top.pct - second.pct) : top.pct;
  const voteDiff = second ? Math.max(0, top.votes - second.votes) : top.votes;
  return { top, second, margin, voteDiff, tot, isTie: second ? margin < CONFIG.TIE_THRESHOLD_PP : false };
}

export const stampOf = (a) => `${a.dt || ''} ${a.ht || ''} ${a.s && a.s.st}`;

// ----------------------------------------------------------------------------
// 4. MOTOR DO TICKER AO VIVO (LiveTicker — todas as regras obrigatórias)
// ----------------------------------------------------------------------------
// Regras garantidas:
// 1. TARGET = último valor oficial exato recebido do TSE. SHOWN = inteiro exibido na tela.
// 2. SHOWN <= TARGET sempre (a menos que o TSE publique uma correção para baixo; nesse caso,
//    faz ease suave até o novo TARGET oficial).
// 3. Entre lotes oficiais, SHOWN sobe com pequenos incrementos irregulares naturais no ritmo
//    observado dos últimos lotes, pousando exatamente em TARGET quando o próximo lote é esperado.
// 4. Se SHOWN ficar muito atrás (> 20s ou > 2 intervalos), aciona catch-up suave (ease-out de 2.5s)
//    pousando exatamente em TARGET.
// 5. Quando SHOWN === TARGET, fica em repouso exato.
// 6. Se uma requisição falhar ou os dados ficarem obsoletos (stale), congela imediatamente em TARGET.
// 7. Faz snap instantâneo (SHOWN = TARGET) em: totalização final (tf === "s"), retorno de aba oculta,
//    abertura de detalhe de estado ou prefers-reduced-motion ativo.
export class LiveTicker {
  constructor() {
    this.target = 0;
    this.shown = 0;
    this.floatShown = 0;
    this.initialized = false;
    this.frozen = false;

    // Controle de ritmo entre lotes
    this.lastBatchAt = 0;
    this.expectedIntervalMs = CONFIG.POLL_INTERVAL_MS;
    this.lastTickAt = 0;

    // Modo catch-up ou correção oficial do TSE
    this.easingMode = false;
    this.easeStartVal = 0;
    this.easeStartTime = 0;
    this.easeDurationMs = 2500;
  }

  receiveOfficialTarget(newTarget, nowMs = performance.now(), options = {}) {
    const exactTarget = Math.max(0, Math.floor(Number(newTarget) || 0));
    const { snap = false } = options;

    if (!this.initialized || snap) {
      this.target = exactTarget;
      this.shown = exactTarget;
      this.floatShown = exactTarget;
      this.initialized = true;
      this.frozen = false;
      this.easingMode = false;
      this.lastBatchAt = nowMs;
      this.lastTickAt = nowMs;
      return;
    }

    // Calcula o ritmo observado entre lotes reais
    if (exactTarget !== this.target && this.lastBatchAt > 0) {
      const elapsed = nowMs - this.lastBatchAt;
      if (elapsed >= 3000 && elapsed <= 60_000) {
        this.expectedIntervalMs = Math.round(0.65 * this.expectedIntervalMs + 0.35 * elapsed);
      }
      this.lastBatchAt = nowMs;
    }

    // Caso 1: Correção rara do TSE para baixo -> ease suave até o novo TARGET oficial
    if (exactTarget < this.shown) {
      this.target = exactTarget;
      this.easingMode = true;
      this.easeStartVal = this.shown;
      this.easeStartTime = nowMs;
      this.easeDurationMs = 1800;
      this.lastTickAt = nowMs;
      return;
    }

    const prevTarget = this.target;
    const prevGap = Math.max(0, prevTarget - this.shown);
    this.target = exactTarget;
    this.frozen = false;

    // Caso 2: Se no início de um novo lote o SHOWN anterior ainda não tinha alcançado o prevTarget,
    // ou se o atraso acumulado for grande (> 2 intervalos), faz catch-up suave em 2.4s
    const newGap = this.target - this.shown;
    if (prevGap > 0 && newGap > (this.target - prevTarget) * 1.8) {
      this.easingMode = true;
      this.easeStartVal = this.shown;
      this.easeStartTime = nowMs;
      this.easeDurationMs = 2400;
    } else if (!this.initialized) {
      // No primeiro lote da sessão, começa 99,985% perto do TARGET para já mostrar vida sutil sem atrasar
      this.shown = exactTarget;
      this.floatShown = exactTarget;
    }
    this.lastTickAt = nowMs;
  }

  // Permite iniciar uma subida sutil quando um novo lote chega com mais votos
   receiveBatchWithTrailing(newTarget, nowMs = performance.now(), options = {}) {
    const exactTarget = Math.max(0, Math.floor(Number(newTarget) || 0));
    const { snap = false } = options;

    if (snap) {
      this.receiveOfficialTarget(exactTarget, nowMs, { snap: true });
      return;
    }

    if (!this.initialized) {
      // Na abertura inicial, começa a uma fração minúscula abaixo do TARGET (ex.: 450 votos atrás)
      // para que o contador já pulse vivo até pousar em TARGET no fim do ciclo de 12s
      const initialLeadIn = Math.min(480, Math.floor(exactTarget * 0.00001));
      this.target = exactTarget;
      this.shown = Math.max(0, exactTarget - initialLeadIn);
      this.floatShown = this.shown;
      this.initialized = true;
      this.frozen = false;
      this.easingMode = false;
      this.lastBatchAt = nowMs;
      this.lastTickAt = nowMs;
      return;
    }

    this.receiveOfficialTarget(exactTarget, nowMs, { snap: false });
  }

  freezeAtTarget() {
    this.frozen = true;
    this.easingMode = false;
    this.shown = this.target;
    this.floatShown = this.target;
  }

  snapToTarget() {
    this.easingMode = false;
    this.shown = this.target;
    this.floatShown = this.target;
  }

  step(nowMs = performance.now()) {
    if (!this.initialized || this.frozen) return this.shown;
    if (this.shown === this.target) {
      this.easingMode = false;
      this.lastTickAt = nowMs;
      return this.shown;
    }

    const dt = Math.max(0, Math.min(250, nowMs - (this.lastTickAt || nowMs)));
    this.lastTickAt = nowMs;

    // Se estiver muito atrasado (> 20s desde o último lote), entra em catch-up suave (2.5s)
    if (!this.easingMode && this.lastBatchAt > 0 && nowMs - this.lastBatchAt > 20_000 && this.shown < this.target) {
      this.easingMode = true;
      this.easeStartVal = this.shown;
      this.easeStartTime = nowMs;
      this.easeDurationMs = 2400;
    }

    if (this.easingMode) {
      const t = Math.min(1, (nowMs - this.easeStartTime) / this.easeDurationMs);
      // Cubic ease-out: 1 - (1 - t)^3
      const eased = 1 - Math.pow(1 - t, 3);
      const val = Math.round(this.easeStartVal + (this.target - this.easeStartVal) * eased);
      if (this.target >= this.easeStartVal) {
        this.shown = Math.min(this.target, Math.max(this.shown, val));
      } else {
        // Correção oficial do TSE para baixo
        this.shown = Math.max(this.target, val);
      }
      this.floatShown = this.shown;
      if (t >= 1 || this.shown === this.target) {
        this.shown = this.target;
        this.floatShown = this.target;
        this.easingMode = false;
      }
      return this.shown;
    }

    // Subida orgânica irregular entre lotes: calcula o tempo restante até o próximo lote esperado
    const elapsedSinceBatch = Math.max(0, nowMs - this.lastBatchAt);
    const remainingMs = Math.max(600, this.expectedIntervalMs - elapsedSinceBatch);
    const remainingVotes = this.target - this.shown;

    if (remainingVotes <= 0) {
      this.shown = this.target;
      this.floatShown = this.target;
      return this.shown;
    }

    // Modulação orgânica determinística (combinação de senos não harmônicos para evitar passo robótico)
    const wave = 1 + 0.42 * Math.sin(nowMs * 0.0073) + 0.28 * Math.cos(nowMs * 0.0191);
    const baseRatePerMs = remainingVotes / remainingMs;
    const delta = baseRatePerMs * dt * Math.max(0.25, wave);

    this.floatShown = Math.min(this.target, this.floatShown + delta);
    const nextInt = Math.min(this.target, Math.floor(this.floatShown));

    // Monotônico: nunca diminui e nunca ultrapassa TARGET
    if (nextInt > this.shown) {
      this.shown = nextInt;
    }
    if (remainingMs <= 650 && this.shown < this.target) {
      this.shown = this.target;
      this.floatShown = this.target;
    }
    return this.shown;
  }
}

// Auto-verificação automatizada das 5 invariantes do LiveTicker (acessível via ?selftest ou console)
export function runTickerSelfCheck() {
  const results = [];

  // 1. Invariante: SHOWN <= TARGET sempre e monotônico
  const t1 = new LiveTicker();
  t1.receiveBatchWithTrailing(100_000, 1000);
  let prev = t1.shown;
  let monotonic = true;
  let neverExceeds = true;
  for (let ms = 1016; ms <= 15_000; ms += 50) {
    const cur = t1.step(ms);
    if (cur < prev) monotonic = false;
    if (cur > t1.target) neverExceeds = false;
    prev = cur;
  }
  results.push({ check: 'SHOWN <= TARGET sempre', pass: neverExceeds });
  results.push({ check: 'SHOWN é monotônico crescente', pass: monotonic });
  results.push({ check: 'Converge exatamente para TARGET no repouso', pass: t1.shown === 100_000 });

  // 2. Catch-up suave após atraso longo (> 20s)
  const t2 = new LiveTicker();
  t2.receiveOfficialTarget(50_000, 1000, { snap: true });
  t2.receiveOfficialTarget(80_000, 2000, { snap: false });
  t2.step(25_000); // Dispara catch-up após > 20s
  for (let ms = 25_100; ms <= 28_000; ms += 100) t2.step(ms);
  results.push({ check: 'Catch-up converge em 2.4s após atraso longo', pass: t2.shown === 80_000 });

  // 3. Falha de rede ou dado obsoleto congela SHOWN em TARGET
  const t3 = new LiveTicker();
  t3.receiveBatchWithTrailing(200_000, 1000);
  t3.step(3000);
  t3.freezeAtTarget();
  const afterFreeze = t3.shown;
  t3.step(9000);
  results.push({ check: 'Falha/stale congela imediatamente em TARGET', pass: afterFreeze === 200_000 && t3.shown === 200_000 });

  const allPass = results.every((r) => r.pass);
  return { allPass, results };
}
window.__runTickerSelfCheck = runTickerSelfCheck;

// ----------------------------------------------------------------------------
// 5. APLICAÇÃO PRINCIPAL (DOM, Mapa, Rede e Eventos)
// ----------------------------------------------------------------------------
(() => {
  const params = new URLSearchParams(location.search);
  const SIM = params.has('sim');
  const TV_MODE = params.has('tv');
  const FORCE_PRE17 = params.has('pre17');
  const SELFTEST = params.has('selftest');
  const IS_FILE = location.protocol === 'file:';

  let activeRole = 'pres';
  let activeGovUf = 'sp';
  let govDisputedUfs = ['sp', 'mg', 'rj', 'rs', 'ba', 'pe', 'ce', 'pa', 'sc', 'go', 'am', 'df'];

  const getEleCode = () => {
    if (SIM) {
      const s = params.get('sim');
      return s && /^\d+$/.test(s) ? s : CONFIG.ELE_SIM_DEFAULT;
    }
    const e = params.get('ele');
    if (e && /^\d+$/.test(e)) return e;
    return activeRole === 'gov' ? CONFIG.ELE_GOV_OFICIAL : CONFIG.ELE_PRES_OFICIAL;
  };

  const getCargoCode = () => (activeRole === 'gov' ? '0003' : '0001');
  const getBaseUrl = () => {
    if (SIM) return IS_FILE ? 'https://resultados-sim.tse.jus.br/simulado/simulado2026' : '/api/sim';
    return IS_FILE ? 'https://resultados.tse.jus.br/oficial' : '/api/tse';
  };

  const urlResult = (uf) => {
    const ele = getEleCode();
    const e6 = 'e' + String(ele).padStart(6, '0');
    return `${getBaseUrl()}/${CONFIG.CICLO}/${ele}/dados/${uf}/${uf}-c${getCargoCode()}-${e6}-u.json`;
  };

  const urlTrack = () => {
    const ele = getEleCode();
    const e6 = 'e' + String(ele).padStart(6, '0');
    return `${getBaseUrl()}/${CONFIG.CICLO}/${ele}/dados/br/br-${e6}-ab.json`;
  };

  const $ = (sel) => document.querySelector(sel);
  const dom = {
    srAnnouncer: $('#sr-announcer'),
    liveIndicator: $('#live-indicator'),
    liveLabel: $('#live-label'),
    officialTimeLabel: $('#official-time-label'),
    simMark: $('#sim-mark'),
    finalMark: $('#final-mark'),
    tabPres: $('#tab-pres'),
    tabGov: $('#tab-gov'),
    govBar: $('#gov-bar'),
    govChips: $('#gov-uf-chips'),
    calmLine: $('#calm-state-line'),
    calmText: $('#calm-state-text'),
    pre17Timer: $('#pre17-timer'),
    splitSeg0: $('#split-seg-0'),
    splitSeg1: $('#split-seg-1'),
    secPctLabel: $('#sec-pct-label'),
    secsCountText: $('#secs-count-text'),
    diffValues: $('#diff-values'),
    totalValidVotes: $('#total-valid-votes'),
    secProgressbar: $('#sec-progressbar'),
    secProgFill: $('#sec-prog-fill'),
    mapPaths: $('#map-paths'),
    mapCallouts: $('#map-callouts'),
    mapLabels: $('#map-labels'),
    tieRectA: $('#tie-rect-a'),
    tieRectB: $('#tie-rect-b'),
    extBtn: $('#ext-btn'),
    extDot: $('#ext-dot'),
    detailBackdrop: $('#detail-backdrop'),
    detailPanel: $('#detail-panel'),
    sheetHandle: $('#sheet-handle'),
    detailUfTitle: $('#detail-uf-title'),
    detailUfSub: $('#detail-uf-sub'),
    btnShareUf: $('#btn-share-uf'),
    shareBtnText: $('#share-btn-text'),
    btnCloseDetail: $('#btn-close-detail'),
    detailCandsList: $('#detail-cands-list'),
    detSec: $('#det-sec'),
    detDiff: $('#det-diff'),
    btnToggleDetails: $('#btn-toggle-details'),
    secondaryDrawer: $('#secondary-drawer'),
    mCompPct: $('#m-comp-pct'),
    mCompAbs: $('#m-comp-abs'),
    mAbstPct: $('#m-abst-pct'),
    mAbstAbs: $('#m-abst-abs'),
    mValPct: $('#m-val-pct'),
    mValAbs: $('#m-val-abs'),
    mBrPct: $('#m-br-pct'),
    mBrAbs: $('#m-br-abs'),
    mNulPct: $('#m-nul-pct'),
    mNulAbs: $('#m-nul-abs'),
    sparklineBody: $('#sparkline-body'),
    selftestBadge: $('#selftest-badge'),
    tip: $('#tip'),
    cands: [0, 1].map((i) => ({
      photo: $(`#photo-${i}`),
      avatar: $(`#avatar-${i}`),
      initials: $(`#initials-${i}`),
      elected: $(`#elected-${i}`),
      meta: $(`#meta-${i}`),
      name: $(`#name-${i}`),
      pct: $(`#pct-${i}`),
      tickerBtn: $(`#ticker-btn-${i}`),
      votesShown: $(`#votes-shown-${i}`),
      exactPop: $(`#exact-pop-${i}`),
      votesTarget: $(`#votes-target-${i}`),
      votesTime: $(`#votes-time-${i}`),
      lead: $(`#lead-${i}`),
    })),
  };

  if (SIM) dom.simMark.hidden = false;
  if (TV_MODE) document.body.classList.add('tv-mode');

  // Estado em memória
  let national = null;
  const states = {};
  const stamps = {};
  const stateTimes = {};
  const retryAt = {};
  const etags = new Map();
  const jsonCache = new Map();
  const sessionHistory = [];
  const tickers = [new LiveTicker(), new LiveTicker()];

  const svgPathEls = {};
  const calloutEls = {};
  const domTextCache = new WeakMap();

  let selectedUf = null;
  let busy = false;
  let errorStreak = 0;
  let rateLimitedUntil = 0;
  let lastAriaAnnounceAt = 0;
  let waitingFor17h = false;

  const prefersReducedMotion = () =>
    Boolean(window.matchMedia && window.matchMedia('(prefers-reduced-motion: reduce)').matches);

  const isLightMode = () =>
    !TV_MODE && Boolean(window.matchMedia && window.matchMedia('(prefers-color-scheme: light)').matches);

  function setTextDiff(el, text) {
    if (!el) return;
    const str = String(text ?? '');
    if (domTextCache.get(el) === str) return;
    domTextCache.set(el, str);
    el.textContent = str;
  }

  // Resolve metadados visuais (nome, foto, cor) a partir de CANDIDATES ou dados do TSE
  function getCandidateProfile(cand, slotIdx) {
    const cfg = (cand && CANDIDATES[String(cand.n)]) || (slotIdx === 0 ? CANDIDATES['13'] : CANDIDATES['22']);
    const light = isLightMode();
    if (cfg && activeRole === 'pres') {
      return {
        displayName: cfg.name || titleCase(cand?.name || ''),
        party: cfg.party || cand?.party || '',
        number: cfg.number || cand?.n || '',
        photo: cfg.photo || '',
        color: light ? cfg.colorLight : cfg.colorDark,
      };
    }
    const defaultCol = slotIdx === 0 ? (light ? '#d91b2b' : '#ef3340') : (light ? '#1a4fd1' : '#3b82f6');
    return {
      displayName: titleCase(cand?.name || `Candidato ${slotIdx + 1}`),
      party: cand?.party || '',
      number: cand?.n || '',
      photo: '',
      color: defaultCol,
    };
  }

  function syncThemeColors() {
    const cands = national?.cands || [];
    const p0 = getCandidateProfile(cands[0], 0);
    const p1 = getCandidateProfile(cands[1], 1);
    document.documentElement.style.setProperty('--cand-0', p0.color);
    document.documentElement.style.setProperty('--cand-1', p1.color);
    if (dom.tieRectA) dom.tieRectA.setAttribute('fill', p0.color);
    if (dom.tieRectB) dom.tieRectB.setAttribute('fill', p1.color);
    const metaTheme = $('#meta-theme-color');
    if (metaTheme) metaTheme.setAttribute('content', isLightMode() ? '#f6f7f9' : '#07080c');
  }

  if (window.matchMedia) {
    window.matchMedia('(prefers-color-scheme: light)').addEventListener('change', () => {
      syncThemeColors();
      if (national) {
        renderNational(national, { snap: true });
        Object.keys(UF_META).forEach(paintState);
      }
    });
  }

  // Fallback elegante de silhueta/iniciais caso a foto não exista
  dom.cands.forEach((slotDom, idx) => {
    slotDom.photo.addEventListener('error', () => {
      slotDom.photo.hidden = true;
      slotDom.avatar.hidden = false;
    });
    slotDom.photo.addEventListener('load', () => {
      slotDom.photo.hidden = false;
      slotDom.avatar.hidden = true;
    });

    // Affordance para exibir o valor oficial exato TARGET com o horário do TSE
    const showExact = () => {
      slotDom.exactPop.hidden = false;
    };
    const hideExact = () => {
      slotDom.exactPop.hidden = true;
    };
    slotDom.tickerBtn.addEventListener('mouseenter', showExact);
    slotDom.tickerBtn.addEventListener('mouseleave', hideExact);
    slotDom.tickerBtn.addEventListener('focus', showExact);
    slotDom.tickerBtn.addEventListener('blur', hideExact);
    slotDom.tickerBtn.addEventListener('click', (e) => {
      e.stopPropagation();
      slotDom.exactPop.hidden = !slotDom.exactPop.hidden;
    });
  });

  document.addEventListener('click', () => {
    dom.cands.forEach((s) => {
      s.exactPop.hidden = true;
    });
  });

  // Loop de animação de 60 fps do LiveTicker via requestAnimationFrame
  function tickerAnimationLoop(nowMs) {
    if (!document.hidden && national && !prefersReducedMotion()) {
      for (let i = 0; i < 2; i++) {
        const val = tickers[i].step(nowMs);
        setTextDiff(dom.cands[i].votesShown, fmtInt(val));
      }
    }
    requestAnimationFrame(tickerAnimationLoop);
  }
  requestAnimationFrame(tickerAnimationLoop);

  // --------------------------------------------------------------------------
  // 6. MAPA DO BRASIL COM CALLOUTS PARA NORDESTE DENSO E DF
  // --------------------------------------------------------------------------
  function initMap() {
    const ns = 'http://www.w3.org/2000/svg';
    dom.mapPaths.innerHTML = '';
    dom.mapCallouts.innerHTML = '';
    dom.mapLabels.innerHTML = '';

    Object.keys(UF_META).forEach((uf) => {
      if (uf === 'zz' || !UF_PATHS[uf]) return;
      const meta = UF_META[uf];

      const p = document.createElementNS(ns, 'path');
      p.setAttribute('d', UF_PATHS[uf]);
      p.setAttribute('class', 'uf-shape');
      p.setAttribute('tabindex', '0');
      p.setAttribute('role', 'button');
      p.setAttribute('aria-label', `${meta.name}: sem votos apurados`);
      p.dataset.uf = uf;
      dom.mapPaths.appendChild(p);
      svgPathEls[uf] = p;

      // Se o estado tiver coordenada de callout (RN, PB, PE, AL, SE, DF), desenha linha + pílula sem sobrepor
      if (meta.lx && meta.ly) {
        const line = document.createElementNS(ns, 'line');
        line.setAttribute('x1', String(meta.cx));
        line.setAttribute('y1', String(meta.cy));
        line.setAttribute('x2', String(meta.lx - 13));
        line.setAttribute('y2', String(meta.ly));
        line.setAttribute('class', 'uf-callout-line');
        dom.mapCallouts.appendChild(line);

        const g = document.createElementNS(ns, 'g');
        g.setAttribute('class', 'uf-callout-pill');
        g.dataset.uf = uf;
        const rect = document.createElementNS(ns, 'rect');
        rect.setAttribute('x', String(meta.lx - 13));
        rect.setAttribute('y', String(meta.ly - 9));
        rect.setAttribute('width', '26');
        rect.setAttribute('height', '18');
        const txt = document.createElementNS(ns, 'text');
        txt.setAttribute('x', String(meta.lx));
        txt.setAttribute('y', String(meta.ly));
        txt.textContent = uf.toUpperCase();
        g.appendChild(rect);
        g.appendChild(txt);
        dom.mapCallouts.appendChild(g);
        calloutEls[uf] = { group: g, rect };
      } else {
        const lbl = document.createElementNS(ns, 'text');
        lbl.setAttribute('x', String(meta.cx));
        lbl.setAttribute('y', String(meta.cy));
        lbl.setAttribute('class', 'uf-map-label');
        lbl.textContent = uf.toUpperCase();
        dom.mapLabels.appendChild(lbl);
      }
    });
  }

  function getBandForMargin(margin) {
    const m = Math.max(0, Number(margin) || 0);
    for (const b of CONFIG.MARGIN_BANDS) {
      if (m < b.max) return b;
    }
    return CONFIG.MARGIN_BANDS[CONFIG.MARGIN_BANDS.length - 1];
  }

  function paintState(uf) {
    const d = states[uf];
    const L = leaders(d);
    const meta = UF_META[uf];
    const pathEl = svgPathEls[uf];
    const callout = calloutEls[uf];
    const light = isLightMode();

    let ariaDesc = `${meta ? meta.name : uf.toUpperCase()}: sem votos apurados`;
    if (L && d) {
      const candsDesc = d.cands
        .slice(0, 2)
        .map((c, idx) => `${getCandidateProfile(c, idx).displayName} ${fmtPct(c.pct)}% (${fmtInt(c.votes)} votos)`)
        .join(', ');
      ariaDesc = `${meta.name}: ${candsDesc}${L.isTie ? ' (empate técnico)' : ''}, ${fmtPct(d.sections.pct)}% das seções apuradas`;
    }

    if (pathEl) pathEl.setAttribute('aria-label', ariaDesc);
    if (uf === 'zz') dom.extBtn.setAttribute('aria-label', ariaDesc);

    if (!L || !d) {
      if (pathEl) {
        pathEl.style.fill = '';
        pathEl.style.fillOpacity = '';
      }
      if (callout) callout.rect.style.fill = '';
      if (uf === 'zz') dom.extDot.style.background = 'var(--map-empty)';
      return;
    }

    // Determina qual dos dois slots lidera na UF
    const leaderSlot = d.cands.indexOf(L.top) === 1 ? 1 : 0;
    const baseColor = getCandidateProfile(L.top, leaderSlot).color;
    const band = getBandForMargin(L.margin);
    const alpha = light ? band.alphaLight : band.alphaDark;

    if (uf === 'zz') {
      dom.extDot.style.background = L.isTie ? 'var(--ink)' : baseColor;
      return;
    }

    if (pathEl) {
      if (L.isTie) {
        pathEl.style.fill = 'url(#tie-pattern)';
        pathEl.style.fillOpacity = '0.88';
      } else {
        pathEl.style.fill = baseColor;
        pathEl.style.fillOpacity = String(alpha);
      }
    }

    if (callout) {
      callout.rect.style.fill = L.isTie
        ? 'var(--map-empty)'
        : `color-mix(in srgb, ${baseColor} ${Math.round(alpha * 75)}%, var(--bg))`;
    }
  }

  // Interações no mapa (clique, teclado e hover no desktop)
  function onUfActivate(uf) {
    if (navigator.vibrate) {
      try { navigator.vibrate(8); } catch { /* ignora */ }
    }
    if (activeRole === 'gov' && uf !== 'zz') {
      activeGovUf = uf;
      renderGovChips();
      tick(true);
    }
    selectState(uf);
  }

  dom.mapPaths.addEventListener('click', (e) => {
    const p = e.target.closest('path[data-uf]');
    if (p) onUfActivate(p.dataset.uf);
  });

  dom.mapCallouts.addEventListener('click', (e) => {
    const g = e.target.closest('g[data-uf]');
    if (g) onUfActivate(g.dataset.uf);
  });

  dom.extBtn.addEventListener('click', () => onUfActivate('zz'));

  dom.mapPaths.addEventListener('keydown', (e) => {
    const p = e.target.closest('path[data-uf]');
    if (!p) return;
    if (e.key === 'Enter' || e.key === ' ') {
      e.preventDefault();
      onUfActivate(p.dataset.uf);
      return;
    }
    if (['ArrowRight', 'ArrowLeft', 'ArrowDown', 'ArrowUp'].includes(e.key)) {
      e.preventDefault();
      const items = Array.from(dom.mapPaths.querySelectorAll('path[data-uf]'));
      const idx = items.indexOf(p);
      const step = e.key === 'ArrowRight' || e.key === 'ArrowDown' ? 1 : -1;
      items[(idx + step + items.length) % items.length].focus();
    }
  });

  // Tooltip de mouse no desktop (usa sempre valores oficiais exatos TARGET)
  function showMapTip(uf, e) {
    if (e.pointerType !== 'mouse') return;
    const d = states[uf];
    const meta = UF_META[uf];
    const L = leaders(d);
    let html = `<div style="font-weight:600;margin-bottom:3px">${esc(meta ? meta.name : uf.toUpperCase())} · ${
      d ? fmtPct(d.sections.pct) + '%' : '0,00%'
    }</div>`;
    if (L && d) {
      html += d.cands
        .slice(0, 2)
        .map((c, idx) => {
          const prof = getCandidateProfile(c, idx);
          return `<div style="display:flex;justify-content:space-between;gap:14px"><span>${esc(
            prof.displayName
          )}</span><strong>${fmtPct(c.pct)}%</strong></div>`;
        })
        .join('');
    } else {
      html += `<div style="color:var(--muted)">Sem votos apurados</div>`;
    }
    dom.tip.innerHTML = html;
    dom.tip.classList.add('on');
    moveMapTip(e);
  }

  function moveMapTip(e) {
    const w = dom.tip.offsetWidth || 170;
    const h = dom.tip.offsetHeight || 68;
    dom.tip.style.left = Math.min(e.clientX + 14, window.innerWidth - w - 10) + 'px';
    dom.tip.style.top = Math.min(e.clientY + 14, window.innerHeight - h - 10) + 'px';
  }

  dom.mapPaths.addEventListener('pointerover', (e) => {
    const p = e.target.closest('path[data-uf]');
    if (!p || e.pointerType !== 'mouse') return;
    p.parentNode.appendChild(p);
    showMapTip(p.dataset.uf, e);
  });
  dom.mapPaths.addEventListener('pointermove', (e) => {
    if (e.pointerType === 'mouse' && dom.tip.classList.contains('on')) moveMapTip(e);
  });
  dom.mapPaths.addEventListener('pointerout', () => {
    dom.tip.classList.remove('on');
  });

  // --------------------------------------------------------------------------
  // 7. RENDERIZAÇÃO DOS DOIS CANDIDATOS E DO HUD CENTRAL
  // --------------------------------------------------------------------------
  function renderNational(d, options = {}) {
    if (!d || !d.cands || d.cands.length < 2) return;
    syncThemeColors();

    const shouldSnap = Boolean(options.snap || d.final || prefersReducedMotion());
    const nowMs = performance.now();

    dom.finalMark.hidden = !d.final;

    const c0 = d.cands[0];
    const c1 = d.cands[1];
    const L = leaders(d);

    [c0, c1].forEach((c, idx) => {
      const slotDom = dom.cands[idx];
      const prof = getCandidateProfile(c, idx);

      setTextDiff(slotDom.name, prof.displayName);
      setTextDiff(slotDom.meta, `${prof.party} · ${prof.number}`);
      setTextDiff(slotDom.initials, initialsOf(prof.displayName));
      slotDom.photo.alt = `Foto de ${prof.displayName} (${prof.party})`;

      if (prof.photo) {
        if (slotDom.photo.getAttribute('src') !== prof.photo) {
          slotDom.photo.setAttribute('src', prof.photo);
        }
      } else {
        slotDom.photo.hidden = true;
        slotDom.avatar.hidden = false;
      }

      // Nunca exibe "Eleito" antes da totalização oficial do TSE (c.elected && d.final)
      slotDom.elected.hidden = !(c.elected && d.final);

      // Percentual sempre mostra o valor oficial exato do lote
      setTextDiff(slotDom.pct, fmtPct(c.pct));

      // Popover de valor oficial exato (TARGET) + horário do TSE
      setTextDiff(slotDom.votesTarget, fmtInt(c.votes));
      setTextDiff(slotDom.votesTime, d.ht || 'oficial');

      // Atualiza o LiveTicker de votos
      tickers[idx].receiveBatchWithTrailing(c.votes, nowMs, { snap: shouldSnap });
      setTextDiff(slotDom.votesShown, fmtInt(tickers[idx].shown));

      // Indicador discreto de liderança (estilizado de forma idêntica em ambos os lados)
      if (L && L.top.key === c.key && !L.isTie) {
        setTextDiff(slotDom.lead, `à frente por ${fmtPct(L.margin)} p.p.`);
      } else if (L && L.isTie) {
        setTextDiff(slotDom.lead, 'empate técnico');
      } else {
        setTextDiff(slotDom.lead, '\u00A0');
      }
    });

    // Barra de proporção (sempre oficial exata)
    const totTwo = c0.votes + c1.votes;
    const w0 = totTwo > 0 ? ((c0.votes / totTwo) * 100).toFixed(3) : '50.000';
    const w1 = totTwo > 0 ? ((c1.votes / totTwo) * 100).toFixed(3) : '50.000';
    dom.splitSeg0.style.width = `${w0}%`;
    dom.splitSeg1.style.width = `${w1}%`;

    // Linha fina de progresso e totais
    setTextDiff(dom.secPctLabel, `${fmtPct(d.sections.pct)}%`);
    setTextDiff(dom.secsCountText, `(${fmtInt(d.sections.done)} de ${fmtInt(d.sections.total)})`);
    dom.secProgFill.style.width = `${Math.min(100, Math.max(0, d.sections.pct)).toFixed(2)}%`;
    dom.secProgressbar.setAttribute('aria-valuenow', String(d.sections.pct.toFixed(2)));
    setTextDiff(dom.totalValidVotes, fmtInt(d.votes.valid));

    if (L) {
      setTextDiff(dom.diffValues, `Diferença atual: ${fmtPct(L.margin)} p.p. (${fmtInt(L.voteDiff)} votos)`);
    } else {
      setTextDiff(dom.diffValues, 'Aguardando abertura dos votos');
    }

    // Métricas secundárias na linha expansível do rodapé
    setTextDiff(dom.mCompPct, `${fmtPct(d.electorate.ppresent)}%`);
    setTextDiff(dom.mCompAbs, `(${fmtInt(d.electorate.present)})`);
    setTextDiff(dom.mAbstPct, `${fmtPct(d.electorate.pabst)}%`);
    setTextDiff(dom.mAbstAbs, `(${fmtInt(d.electorate.abst)})`);
    setTextDiff(dom.mValPct, `${fmtPct(d.votes.pvalid)}%`);
    setTextDiff(dom.mValAbs, `(${fmtInt(d.votes.valid)})`);
    setTextDiff(dom.mBrPct, `${fmtPct(d.votes.pblank)}%`);
    setTextDiff(dom.mBrAbs, `(${fmtInt(d.votes.blank)})`);
    setTextDiff(dom.mNulPct, `${fmtPct(d.votes.pnul)}%`);
    setTextDiff(dom.mNulAbs, `(${fmtInt(d.votes.nul)})`);
  }

  // --------------------------------------------------------------------------
  // 8. DETALHE DO ESTADO (Popover no Desktop / Bottom Sheet no Celular)
  // --------------------------------------------------------------------------
  function selectState(uf, fromHash = false) {
    if (!uf || !UF_META[uf] || (selectedUf === uf && !fromHash)) {
      selectedUf = null;
      dom.detailPanel.hidden = true;
      dom.detailBackdrop.hidden = true;
      Object.entries(svgPathEls).forEach(([, el]) => el.classList.remove('sel'));
      Object.entries(calloutEls).forEach(([, c]) => c.group.classList.remove('sel'));
      dom.extBtn.classList.remove('sel');
      if (!fromHash) {
        try { history.replaceState(null, '', location.pathname + location.search); } catch { /* ignora */ }
      }
      return;
    }

    // Regra obrigatória do Ticker: abrir um detalhe de estado faz snap instantâneo SHOWN = TARGET
    tickers.forEach((t) => t.snapToTarget());
    if (national) {
      dom.cands.forEach((s, i) => setTextDiff(s.votesShown, fmtInt(tickers[i].shown)));
    }

    selectedUf = uf;
    Object.entries(svgPathEls).forEach(([k, el]) => el.classList.toggle('sel', k === uf));
    Object.entries(calloutEls).forEach(([k, c]) => c.group.classList.toggle('sel', k === uf));
    dom.extBtn.classList.toggle('sel', uf === 'zz');

    renderDetail();
    dom.detailPanel.hidden = false;
    dom.detailBackdrop.hidden = false;

    if (!fromHash && !TV_MODE) {
      try { history.replaceState(null, '', `${location.pathname}${location.search}#${uf}`); } catch { /* ignora */ }
    }
  }

  function renderDetail() {
    if (!selectedUf || !UF_META[selectedUf]) return;
    const uf = selectedUf;
    const meta = UF_META[uf];
    const d = states[uf];
    const L = leaders(d);

    setTextDiff(dom.detailUfTitle, `${meta.name} (${uf.toUpperCase()})`);
    setTextDiff(dom.detailUfSub, `Totalização oficial TSE: ${stateTimes[uf] || (d && d.ht ? d.ht : '—')}`);

    if (!d || !L) {
      dom.detailCandsList.innerHTML = `<div style="padding:10px 0;color:var(--muted);font-size:13px">Sem votos apurados neste local até o momento.</div>`;
      setTextDiff(dom.detSec, '0,00% apurado');
      setTextDiff(dom.detDiff, '—');
      return;
    }

    // Usa sempre os valores oficiais exatos TARGET no detalhe do estado
    dom.detailCandsList.innerHTML = d.cands
      .slice(0, 2)
      .map((c, idx) => {
        const prof = getCandidateProfile(c, idx);
        return `<div class="pop-cand-row">
          <span class="pop-cand-name">
            <i class="pop-cand-dot" style="background:${prof.color}"></i>
            <span>${esc(prof.displayName)}</span>
          </span>
          <div class="pop-cand-nums">
            <strong>${fmtPct(c.pct)}%</strong>
            <small>${fmtInt(c.votes)} votos</small>
          </div>
        </div>`;
      })
      .join('');

    setTextDiff(dom.detSec, `${fmtPct(d.sections.pct)}% das seções`);
    setTextDiff(dom.detDiff, L.isTie ? 'Empate técnico' : `Diferença: ${fmtPct(L.margin)} p.p.`);
  }

  dom.btnCloseDetail.addEventListener('click', () => selectState(null));
  dom.detailBackdrop.addEventListener('click', () => selectState(null));
  document.addEventListener('keydown', (e) => {
    if (e.key === 'Escape' && selectedUf) selectState(null);
  });

  // Compartilhamento com valores oficiais exatos TARGET
  dom.btnShareUf.addEventListener('click', async () => {
    if (!selectedUf) return;
    const d = states[selectedUf];
    const meta = UF_META[selectedUf];
    const shareUrl = `${location.origin}${location.pathname}${location.search}#${selectedUf}`;
    const summary =
      d && d.cands.length >= 2
        ? `${meta.name}: ${getCandidateProfile(d.cands[0], 0).displayName} ${fmtPct(d.cands[0].pct)}% (${fmtInt(
            d.cands[0].votes
          )}) × ${getCandidateProfile(d.cands[1], 1).displayName} ${fmtPct(d.cands[1].pct)}% (${fmtInt(
            d.cands[1].votes
          )}) — Oficial TSE`
        : `Apuração 2026 — ${meta.name}`;

    if (navigator.share) {
      try {
        await navigator.share({ title: summary, text: summary, url: shareUrl });
        return;
      } catch { /* fallback */ }
    }
    try {
      await navigator.clipboard.writeText(`${summary} ${shareUrl}`);
    } catch { /* ignora */ }
    setTextDiff(dom.shareBtnText, 'Copiado');
    setTimeout(() => setTextDiff(dom.shareBtnText, 'Compartilhar'), 1800);
  });

  // Linha expansível do rodapé e sparkline da sessão
  dom.btnToggleDetails.addEventListener('click', () => {
    const isOpen = !dom.secondaryDrawer.hidden;
    dom.secondaryDrawer.hidden = isOpen;
    dom.btnToggleDetails.setAttribute('aria-expanded', String(!isOpen));
  });

  function recordSparkline(d) {
    const L = leaders(d);
    if (!L) return;
    sessionHistory.push({ ht: d.ht, margin: L.margin, leaderSlot: d.cands.indexOf(L.top) === 1 ? 1 : 0 });
    if (sessionHistory.length > 60) sessionHistory.shift();

    const pts = sessionHistory.length === 1 ? [sessionHistory[0], sessionHistory[0]] : sessionHistory;
    const maxM = Math.max(4, ...pts.map((p) => p.margin * 1.2));
    const coords = pts.map((p, i) => {
      const x = 4 + (i / (pts.length - 1)) * 232;
      const y = 28 - (Math.min(p.margin, maxM) / maxM) * 22;
      return `${x.toFixed(1)},${y.toFixed(1)}`;
    });
    const last = pts[pts.length - 1];
    const strokeCol = last.leaderSlot === 1 ? 'var(--cand-1)' : 'var(--cand-0)';
    dom.sparklineBody.innerHTML = `<polyline fill="none" stroke="${strokeCol}" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" points="${coords.join(
      ' '
    )}"/>`;
  }

  // --------------------------------------------------------------------------
  // 9. REDE, POLLING INVISÍVEL (12s), ETAG/304 E FALLBACK SIMULADO PROGRESSIVO
  // --------------------------------------------------------------------------
  let localSimStep = 0;

  function buildLocalSimFallback(url) {
    localSimStep += 1;
    const now = new Date();
    const ht = now.toTimeString().slice(0, 8);
    const dt = '25/10/2026';
    if (url.endsWith('-ab.json')) {
      return {
        ele: getEleCode(),
        t: '2',
        hg: ht,
        abr: Object.keys(UF_META).map((uf, i) => ({
          and: 'p',
          tpabr: 'uf',
          cdabr: uf,
          dt,
          ht,
          s: { ts: String(4000 + i * 800), st: String(3800 + i * 760), pstn: '95,12' },
          e: { te: '2000000', c: '1700000', pcn: '85,00' },
        })),
      };
    }
    const m = url.match(/\/dados\/([a-z]{2})\//);
    const uf = m ? m[1] : 'br';
    const diffMap = {
      ac: -22.4, al: 16.8, ap: 4.2, am: 8.6, ba: 38.4, ce: 34.2, df: -15.4,
      es: 0.32, go: -18.6, ma: 36.1, mt: -26.8, ms: -14.2, mg: 1.84, pa: 9.4,
      pb: 28.6, pr: -24.2, pe: 31.8, pi: 46.2, rj: -11.4, rn: 25.4, rs: -12.6,
      ro: -28.4, rr: -32.0, sc: -34.8, sp: -9.6, se: 29.2, to: 3.4, zz: 1.4, br: 1.76,
    };
    const margin = diffMap[uf] ?? 2.0;
    const p1 = 50 + margin / 2;
    const p2 = 100 - p1;
    const baseTot = (uf === 'br' ? 114_820_400 : 2_450_000) + localSimStep * (uf === 'br' ? 1420 : 60);
    const v1 = Math.round(baseTot * (p1 / 100));
    const v2 = baseTot - v1;
    return {
      ele: getEleCode(),
      t: '2',
      tf: 'n',
      and: 'p',
      dt,
      ht,
      carg: [
        {
          cd: String(Number(getCargoCode())),
          nmn: activeRole === 'gov' ? 'Governador' : 'Presidente',
          agr: [
            {
              par: [
                {
                  n: '91',
                  sg: 'PT',
                  cand: [
                    {
                      n: '91',
                      sqcand: '250001000001',
                      nm: 'LULA',
                      nmu: 'LULA',
                      seq: '1',
                      e: 'n',
                      dvt: 'Válido',
                      vap: String(v1),
                      pvapn: p1.toFixed(6).replace('.', ','),
                    },
                  ],
                },
              ],
            },
            {
              par: [
                {
                  n: '92',
                  sg: 'PL',
                  cand: [
                    {
                      n: '92',
                      sqcand: '250001000002',
                      nm: 'FLÁVIO BOLSONARO',
                      nmu: 'FLÁVIO BOLSONARO',
                      seq: '2',
                      e: 'n',
                      dvt: 'Válido',
                      vap: String(v2),
                      pvapn: p2.toFixed(6).replace('.', ','),
                    },
                  ],
                },
              ],
            },
          ],
        },
      ],
      s: { ts: '528951', st: '503120', pstn: '95,12' },
      e: { te: '163079139', c: '138863131', pcn: '85,15', a: '24216008', pan: '14,85' },
      v: { tv: '138863131', vv: String(baseTot), pvvn: '95,50', vb: '2221810', pvbn: '1,60', tvn: '4027030', ptvnn: '2,90' },
    };
  }

  async function fetchTSEJson(url, isHighPriority = false) {
    const ctrl = new AbortController();
    const timer = setTimeout(() => ctrl.abort(), CONFIG.REQUEST_TIMEOUT_MS);
    const headers = {};
    const prevEtag = etags.get(url);
    if (prevEtag) headers['If-None-Match'] = prevEtag;

    try {
      const opts = { signal: ctrl.signal, headers, cache: 'no-cache' };
      if (isHighPriority) opts.priority = 'high';
      const r = await fetch(url, opts);
      clearTimeout(timer);

      if (r.status === 304 && jsonCache.has(url)) {
        return { ok: true, notModified: true, data: jsonCache.get(url) };
      }
      if (r.status === 404) return { missing: true };
      if (r.status === 429 || r.status === 403) return { rateLimited: true };
      if (!r.ok) throw new Error(`HTTP ${r.status}`);

      const newEtag = r.headers.get('etag');
      if (newEtag) etags.set(url, newEtag);

      const data = await r.json();
      jsonCache.set(url, data);
      return { ok: true, data };
    } catch (err) {
      clearTimeout(timer);
      if (SIM) {
        const fb = buildLocalSimFallback(url);
        jsonCache.set(url, fb);
        return { ok: true, data: fb };
      }
      throw err;
    }
  }

  async function runConcurrentQueue(items, workerFn, maxConc = CONFIG.MAX_CONCURRENCY) {
    const q = [...items];
    const workers = Array.from({ length: Math.min(maxConc, q.length) }, async () => {
      while (q.length > 0) {
        const it = q.shift();
        if (it !== undefined) await workerFn(it);
      }
    });
    await Promise.all(workers);
  }

  function getSecondsUntil17hBrasilia() {
    try {
      const fmt = new Intl.DateTimeFormat('pt-BR', {
        timeZone: 'America/Sao_Paulo',
        hour: '2-digit',
        minute: '2-digit',
        second: '2-digit',
        hour12: false,
      });
      const parts = Object.fromEntries(fmt.formatToParts(new Date()).map((p) => [p.type, p.value]));
      const nowSec = Number(parts.hour) * 3600 + Number(parts.minute) * 60 + Number(parts.second);
      const targetSec = 17 * 3600;
      if (targetSec > nowSec) return targetSec - nowSec;
      return FORCE_PRE17 ? 24 * 3600 - nowSec + targetSec : 0;
    } catch {
      return FORCE_PRE17 ? 3600 : 0;
    }
  }

  function setLiveStatus(mode, text) {
    dom.liveIndicator.className = `live-indicator ${mode}`;
    setTextDiff(dom.liveLabel, mode === 'stale' ? 'DESATUALIZADO' : mode === 'waiting' ? 'AGUARDANDO' : 'AO VIVO');
    setTextDiff(dom.officialTimeLabel, text);
  }

  async function fetchSingleState(abrEntry) {
    const uf = abrEntry.cdabr;
    const res = await fetchTSEJson(urlResult(uf), false);
    if (res.missing) {
      retryAt[uf] = Date.now() + CONFIG.RETRY_404_STATE_MS;
      return;
    }
    if (res.rateLimited) {
      rateLimitedUntil = Date.now() + CONFIG.RATE_LIMIT_PAUSE_MS;
      return;
    }
    const parsed = parseUnified(res.data, activeRole === 'gov' ? '3' : '1');
    if (!parsed) return;
    states[uf] = parsed;
    stamps[uf] = stampOf(abrEntry);
    stateTimes[uf] = `${abrEntry.ht || parsed.ht}`;
  }

  async function tick(snapTickers = false) {
    if (busy) return;
    if (Date.now() < rateLimitedUntil) {
      tickers.forEach((t) => t.freezeAtTarget());
      setLiveStatus('stale', 'acesso temporariamente limitado pelo TSE');
      return;
    }
    if (navigator.onLine === false) {
      tickers.forEach((t) => t.freezeAtTarget());
      setLiveStatus('stale', 'dados desatualizados · sem conexão');
      return;
    }

    if (FORCE_PRE17) {
      waitingFor17h = true;
      dom.calmLine.hidden = false;
      dom.pre17Timer.hidden = false;
      setLiveStatus('waiting', 'divulgação a partir das 17h (Brasília)');
      return;
    }

    busy = true;
    try {
      if (activeRole === 'gov') {
        const abRes = await fetchTSEJson(urlTrack(), true);
        if (abRes.missing) {
          setLiveStatus('waiting', 'aguardando dados de Governador (17h)');
          return;
        }
        const ufsInAb = (abRes.data.abr || []).filter((a) => a.tpabr === 'uf' && UF_META[a.cdabr]).map((a) => a.cdabr);
        if (ufsInAb.length) {
          govDisputedUfs = ufsInAb;
          if (!govDisputedUfs.includes(activeGovUf)) activeGovUf = govDisputedUfs[0];
          renderGovChips();
        }
        const ufRes = await fetchTSEJson(urlResult(activeGovUf), true);
        if (!ufRes.missing && ufRes.data) {
          const parsedGov = parseUnified(ufRes.data, '3');
          if (parsedGov) {
            national = parsedGov;
            states[activeGovUf] = parsedGov;
            dom.calmLine.hidden = true;
            setLiveStatus('live', `${UF_META[activeGovUf].name} · atualizado às ${parsedGov.ht || 'ao vivo'}`);
            renderNational(parsedGov, { snap: snapTickers });
            paintState(activeGovUf);
            renderDetail();
          }
        }
        return;
      }

      // 6.3 Primeira regra de ouro: busca primeiro o arquivo nacional `br`
      const natRes = await fetchTSEJson(urlResult('br'), true);
      if (natRes.rateLimited) {
        rateLimitedUntil = Date.now() + CONFIG.RATE_LIMIT_PAUSE_MS;
        tickers.forEach((t) => t.freezeAtTarget());
        setLiveStatus('stale', 'dados desatualizados · limite do TSE');
        return;
      }
      if (natRes.missing) {
        waitingFor17h = getSecondsUntil17hBrasilia() > 0;
        dom.calmLine.hidden = false;
        dom.pre17Timer.hidden = !waitingFor17h;
        setLiveStatus('waiting', 'aguardando abertura oficial às 17h');
        return;
      }

      const d = parseUnified(natRes.data, '1');
      if (!d || d.cands.length < 2) {
        setLiveStatus('waiting', 'aguardando primeiros boletins de urna');
        return;
      }

      errorStreak = 0;
      waitingFor17h = false;
      dom.calmLine.hidden = true;
      national = d;
      recordSparkline(d);

      const abRes = await fetchTSEJson(urlTrack(), false);
      if (abRes.ok && abRes.data && Array.isArray(abRes.data.abr)) {
        const now = Date.now();
        const todo = abRes.data.abr
          .filter(
            (a) =>
              a.tpabr === 'uf' &&
              UF_META[a.cdabr] &&
              stampOf(a) !== stamps[a.cdabr] &&
              (retryAt[a.cdabr] || 0) < now
          )
          .slice(0, CONFIG.MAX_REQ_PER_CYCLE - 2);

        if (todo.length > 0) {
          await runConcurrentQueue(todo, (a) => fetchSingleState(a).catch(() => {}), CONFIG.MAX_CONCURRENCY);
        }
      }

      setLiveStatus('live', `atualizado às ${d.ht || 'ao vivo'}`);
      renderNational(d, { snap: snapTickers });
      Object.keys(UF_META).forEach(paintState);
      renderDetail();

      // Anúncio acessível aria-live sempre com os valores oficiais exatos TARGET
      const now = Date.now();
      if (now - lastAriaAnnounceAt >= CONFIG.ARIA_ANNOUNCE_MIN_MS) {
        lastAriaAnnounceAt = now;
        const c0 = d.cands[0];
        const c1 = d.cands[1];
        setTextDiff(
          dom.srAnnouncer,
          `Oficial TSE às ${d.ht}: ${getCandidateProfile(c0, 0).displayName} ${fmtPct(c0.pct)}% (${fmtInt(
            c0.votes
          )} votos), ${getCandidateProfile(c1, 1).displayName} ${fmtPct(c1.pct)}% (${fmtInt(
            c1.votes
          )} votos). ${fmtPct(d.sections.pct)}% das seções apuradas.`
        );
      }
    } catch {
      errorStreak += 1;
      // Regra obrigatória do Ticker: se o fetch falhar, SHOWN para em TARGET e não continua subindo
      tickers.forEach((t) => t.freezeAtTarget());
      dom.cands.forEach((s, i) => setTextDiff(s.votesShown, fmtInt(tickers[i].shown)));
      setLiveStatus('stale', `dados desatualizados${national?.ht ? ' · último lote ' + national.ht : ''}`);
    } finally {
      busy = false;
    }
  }

  // Loop invisível de polling (12s padrão, ou backoff exponencial em erro)
  function scheduleNextPoll() {
    const base = national?.final ? CONFIG.FINAL_POLL_INTERVAL_MS : CONFIG.POLL_INTERVAL_MS;
    const delay = errorStreak > 0 ? Math.min(180_000, base * Math.pow(2, errorStreak - 1)) : base;
    setTimeout(async () => {
      if (!document.hidden && navigator.onLine !== false) {
        await tick(false);
      }
      scheduleNextPoll();
    }, delay);
  }

  // Relógio para contagem regressiva antes das 17h
  setInterval(() => {
    if (!waitingFor17h || document.hidden) return;
    const rem = getSecondsUntil17hBrasilia();
    if (rem > 0) {
      const hh = String(Math.floor(rem / 3600)).padStart(2, '0');
      const mm = String(Math.floor((rem % 3600) / 60)).padStart(2, '0');
      const ss = String(rem % 60).padStart(2, '0');
      setTextDiff(dom.pre17Timer, `${hh}:${mm}:${ss}`);
    } else {
      waitingFor17h = false;
      dom.calmLine.hidden = true;
      tick(true);
    }
  }, 1000);

  // Regra obrigatória do Ticker: ao retornar de aba oculta, faz snap instantâneo SHOWN = TARGET e atualiza
  document.addEventListener('visibilitychange', () => {
    if (!document.hidden) {
      tickers.forEach((t) => t.snapToTarget());
      if (national) {
        dom.cands.forEach((s, i) => setTextDiff(s.votesShown, fmtInt(tickers[i].shown)));
      }
      tick(true);
    }
  });

  window.addEventListener('offline', () => {
    tickers.forEach((t) => t.freezeAtTarget());
    setLiveStatus('stale', 'dados desatualizados · sem conexão');
  });

  window.addEventListener('online', () => {
    errorStreak = 0;
    tick(true);
  });

  // Switch Presidente / Governadores
  function renderGovChips() {
    dom.govChips.innerHTML = govDisputedUfs
      .map(
        (uf) =>
          `<button type="button" class="gov-chip${uf === activeGovUf ? ' active' : ''}" data-gov-uf="${esc(
            uf
          )}">${esc(uf.toUpperCase())}</button>`
      )
      .join('');
  }

  dom.govChips.addEventListener('click', (e) => {
    const btn = e.target.closest('button[data-gov-uf]');
    if (!btn) return;
    activeGovUf = btn.dataset.govUf;
    renderGovChips();
    selectState(activeGovUf);
    tick(true);
  });

  function switchRole(role) {
    if (activeRole === role) return;
    activeRole = role;
    const isPres = role === 'pres';
    dom.tabPres.setAttribute('aria-selected', String(isPres));
    dom.tabGov.setAttribute('aria-selected', String(!isPres));
    dom.govBar.hidden = isPres;
    if (!isPres) renderGovChips();
    tick(true);
  }

  dom.tabPres.addEventListener('click', () => switchRole('pres'));
  dom.tabGov.addEventListener('click', () => switchRole('gov'));

  // Modo TV (?tv): destaca estados automaticamente em ciclo lento e elegante
  if (TV_MODE) {
    const tvUfs = Object.keys(UF_META).filter((u) => u !== 'zz');
    let tvIdx = 0;
    setInterval(() => {
      if (document.hidden || !national) return;
      selectState(tvUfs[tvIdx % tvUfs.length], true);
      tvIdx += 1;
    }, CONFIG.TV_CYCLE_STATE_MS);
  }

  // Auto-teste do Ticker se ?selftest estiver na URL
  if (SELFTEST) {
    const report = runTickerSelfCheck();
    dom.secondaryDrawer.hidden = false;
    dom.selftestBadge.hidden = false;
    setTextDiff(
      dom.selftestBadge,
      `Self-check Ticker: ${report.allPass ? '5/5 PASS' : 'FAIL'}`
    );
  }

  if ('serviceWorker' in navigator && !IS_FILE) {
    window.addEventListener('load', () => {
      navigator.serviceWorker.register('/sw.js').catch(() => {});
    });
  }

  initMap();
  syncThemeColors();

  const initialHash = location.hash.replace('#', '').toLowerCase();
  if (UF_META[initialHash]) {
    selectState(initialHash, true);
  }

  tick(false);
  scheduleNextPoll();
})();
