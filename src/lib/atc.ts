// Controle de tráfego aéreo — respostas em pt-BR com dados reais do aeródromo.
import { qnhNow, windFor, type Airport } from "@/sim/airports";
import { icaoCallsign } from "@/lib/atc/phonetic";

type Clearance = { taxi: boolean; takeoff: boolean; landing: boolean; airspace: boolean };
const state = new Map<string, Clearance>();

function clearanceOf(id: string): Clearance {
  let c = state.get(id);
  if (!c) {
    c = { taxi: false, takeoff: false, landing: false, airspace: false };
    state.set(id, c);
    if (state.size > 5000) state.delete(state.keys().next().value as string);
  }
  return c;
}

const norm = (s: string) => s.toLowerCase().normalize("NFD").replace(/[\u0300-\u036f]/g, "");

function squawk(id: string) {
  let h = 0;
  for (const ch of id) h = (h * 31 + ch.charCodeAt(0)) >>> 0;
  return `4${(h % 8)}${((h >> 3) % 8)}${((h >> 6) % 8)}`;
}

export function atcName(channel: string, ap: Airport) {
  if (channel === "ground") return `SOLO ${ap.atcName.toUpperCase()}`;
  if (channel === "approach") return ap.appName.toUpperCase();
  return `TORRE ${ap.atcName.toUpperCase()}`;
}

export function atcReply(
  playerId: string, callsign: string, channel: string, raw: string, ap: Airport, runway: string,
  wx?: { wind?: string; qnh?: number }
): { text: string } | null {
  const t = norm(raw);
  const c = clearanceOf(playerId);
  const cs = callsign.toUpperCase();
  // o controlador fala o indicativo no dialeto aeronáutico (ICAO)
  const spoken = icaoCallsign(callsign);
  const w = wx?.wind ?? windFor(runway);
  const q = wx?.qnh ?? qnhNow();
  const sq = squawk(playerId);
  const twr = `Torre ${ap.atcName}`;
  const gnd = `Solo ${ap.atcName}`;

  if (channel === "ground") {
    if (/(taxi|tax[ie]ar|taxiamento|rolar|pronto para decolagem)/.test(t)) {
      c.taxi = true;
      return { text: `${spoken}, ${gnd}, autorizado táxi para o ponto de espera da pista ${runway} via taxiway paralela. QNH ${q}, vento ${w}. Chame a ${twr} em ${ap.freqs.twr} quando pronto.` };
    }
    if (/(acion|partida|ligar|motor|startup|push)/.test(t)) {
      return { text: `${spoken}, ${gnd}, acionamento autorizado, transponder ${sq}. Informe pronto para o táxi.` };
    }
    if (/(rearm|reabastec|combustivel|munic)/.test(t)) {
      return { text: `${spoken}, ${gnd}, taxie para o pátio e aplique o freio de estacionamento; a equipe de solo fará reabastecimento e rearme.` };
    }
    return { text: `${spoken}, ${gnd}, prossiga. Para sair, solicite "táxi pista ${runway}". QNH ${q}, vento ${w}.` };
  }

  if (channel === "tower") {
    if (/(mayday|emergencia|pan pan|fogo a bordo|pane|falha)/.test(t)) {
      c.landing = true;
      return { text: `MAYDAY recebido, ${cs}. ${twr}: todas as pistas livres para você, pista ${runway} preferencial, vento ${w}. Bombeiros e resgate em prontidão. Informe combustível e pessoas a bordo.` };
    }
    if (/(toque e arremetida|touch|toque)/.test(t)) {
      c.landing = true;
      return { text: `${spoken}, ${twr}, pista ${runway}, vento ${w}, autorizado toque e arremetida. Mantenha o circuito pela esquerda.` };
    }
    if (/(passagem baixa|rasante|low pass|fly ?by)/.test(t)) {
      c.airspace = true;
      return { text: `${spoken}, ${twr}, autorizado passagem baixa sobre a pista ${runway}, mínimo 300 pés, após a passagem curva à esquerda. Show liberado!` };
    }
    if (/(decol|decolar|takeoff|alinhar|pronto)/.test(t)) {
      if (!c.taxi) return { text: `${spoken}, ${twr}, negativo. Solicite primeiro o táxi com o ${gnd} em ${ap.freqs.gnd}.` };
      c.takeoff = true;
      c.airspace = true;
      return { text: `${spoken}, ${twr}, vento ${w}, pista ${runway}, AUTORIZADO DECOLAR. Após a decolagem, contate ${ap.appName} em ${ap.freqs.app}.` };
    }
    if (/(pouso|pousar|final|aterr|landing)/.test(t)) {
      c.landing = true;
      return { text: `${spoken}, ${twr}, pista ${runway}, vento ${w}, AUTORIZADO POUSO. Reporte trem baixado e travado. QNH ${q}.` };
    }
    if (/(zona|entrada|ingresso|espaco|transito|cruz)/.test(t)) {
      c.airspace = true;
      return { text: `${spoken}, ${twr}, autorizado ingresso na zona de controle, mantenha 2.500 pés ou abaixo até avistar o aeródromo, transponder ${sq}.` };
    }
    if (/(area de tiro|tiro|armas|bomba|missil|alvo|engaj)/.test(t)) {
      return { text: `${spoken}, ${twr}, área de tiro ATIVA a 7 km à direita do eixo da pista ${runway}. Armamento livre somente além de 5 km do aeródromo — cuidado com o tráfego civil no circuito.` };
    }
    if (/(radio|checagem|check|copia|escuta|qsl)/.test(t)) return { text: `${spoken}, ${twr}, copiando 5 por 5.` };
    return { text: `${spoken}, ${twr}, prossiga. Disponível: decolagem, pouso, toque e arremetida, passagem baixa, ingresso na zona, área de tiro. Vento ${w}, QNH ${q}.` };
  }

  if (channel === "approach") {
    if (/(vetor|ils|aproxima|descida|descer|radar|rnav)/.test(t)) {
      c.landing = true;
      c.airspace = true;
      return { text: `${spoken}, ${ap.appName}, contato radar. Vetores para ILS pista ${runway}: desça e mantenha 3.000 pés, reduza 180 nós, curso de aproximação final. Chame a ${twr} em ${ap.freqs.twr} estabelecido no localizador.` };
    }
    c.airspace = true;
    return { text: `${spoken}, ${ap.appName}, identificado radar, transponder ${sq}, QNH ${q}. Informe intenções ou solicite vetores ILS.` };
  }

  return null;
}