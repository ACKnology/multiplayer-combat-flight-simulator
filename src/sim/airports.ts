// Aeroportos REAIS — dados de cabeceiras/frequências extraídos da base aberta OurAirports.
// Sem dependência de three.js: usado tanto no cliente quanto no servidor (ATC).

export interface RunwayEnd { ident: string; lat: number; lon: number }
export interface Runway { le: RunwayEnd; he: RunwayEnd; lengthM: number; widthM: number }

export interface Airport {
  icao: string;
  iata: string;
  name: string;
  city: string;
  country: string;
  flag: string;
  lat: number;
  lon: number;
  elevFt: number;
  elevM: number;
  runways: Runway[];
  active: string; // cabeceira em uso (decolagens e pousos)
  atcName: string; // "Torre <atcName>"
  appName: string; // órgão de aproximação
  freqs: { twr: string; gnd: string; app: string; atis: string };
  military: boolean;
  terminalSide: 1 | -1; // lado do pátio em relação ao sentido de pouso (+1 direita)
  traffic: [string, string][]; // [aeronave, indicativo] tráfego IA
  blurb: string;
}

const FT = 0.3048;

function rw(le: string, he: string, lenFt: number, widFt: number, a: number, b: number, c: number, d: number): Runway {
  return { le: { ident: le, lat: a, lon: b }, he: { ident: he, lat: c, lon: d }, lengthM: lenFt * FT, widthM: widFt * FT };
}

function ap(o: Omit<Airport, "elevM">): Airport {
  return { ...o, elevM: o.elevFt * FT };
}

const BR_CIVIL: [string, string][] = [["b737", "GOL 1712"], ["c172", "PT-SOL"], ["a10", "HAWG 21"]];

export const AIRPORTS: Airport[] = [
  ap({
    icao: "SBGR", iata: "GRU", name: "Guarulhos – Gov. André Franco Montoro", city: "São Paulo", country: "Brasil", flag: "🇧🇷",
    lat: -23.431274, lon: -46.469954, elevFt: 2461,
    runways: [
      rw("10L", "28R", 12139, 148, -23.434059, -46.482548, -23.425043, -46.449203),
      rw("10R", "28L", 9843, 148, -23.438801, -46.487, -23.4312, -46.4589),
    ],
    active: "10L", atcName: "Guarulhos", appName: "Controle São Paulo",
    freqs: { twr: "132.75", gnd: "121.70", app: "119.80", atis: "127.75" },
    military: false, terminalSide: 1, traffic: [["b737", "LATAM 3302"], ["c172", "PT-SOL"], ["a10", "HAWG 21"]],
    blurb: "Maior aeroporto da América do Sul. Pistas paralelas 10L/28R e 10R/28L e tráfego intenso de linhas aéreas.",
  }),
  ap({
    icao: "SBSP", iata: "CGH", name: "Congonhas – Dep. Freitas Nobre", city: "São Paulo", country: "Brasil", flag: "🇧🇷",
    lat: -23.627657, lon: -46.654601, elevFt: 2631,
    runways: [
      rw("17L", "35R", 4905, 148, -23.6208, -46.658001, -23.631701, -46.650501),
      rw("17R", "35L", 6365, 148, -23.621, -46.6604, -23.6343, -46.651199),
    ],
    active: "17R", atcName: "Congonhas", appName: "Controle São Paulo",
    freqs: { twr: "127.15", gnd: "121.90", app: "119.80", atis: "127.65" },
    military: false, terminalSide: 1, traffic: BR_CIVIL,
    blurb: "Pista curta encravada na metrópole paulistana — aproximação rente aos prédios, sem margem para erro.",
  }),
  ap({
    icao: "SBRJ", iata: "SDU", name: "Santos Dumont", city: "Rio de Janeiro", country: "Brasil", flag: "🇧🇷",
    lat: -22.910397, lon: -43.16282, elevFt: 11,
    runways: [
      rw("02L", "20R", 4134, 98, -22.915833, -43.163333, -22.904722, -43.163889),
      rw("02R", "20L", 4341, 138, -22.916389, -43.1625, -22.904722, -43.163333),
    ],
    active: "20L", atcName: "Santos Dumont", appName: "Controle Rio",
    freqs: { twr: "118.70", gnd: "121.70", app: "119.35", atis: "132.65" },
    military: false, terminalSide: 1, traffic: [["b737", "AZUL 4321"], ["c172", "PT-RIO"], ["a10", "HAWG 21"]],
    blurb: "1.300 m de pista na Baía de Guanabara, colada ao Pão de Açúcar. Uma das aproximações mais bonitas do mundo.",
  }),
  ap({
    icao: "SBGL", iata: "GIG", name: "Galeão – Tom Jobim", city: "Rio de Janeiro", country: "Brasil", flag: "🇧🇷",
    lat: -22.809999, lon: -43.250557, elevFt: 28,
    runways: [
      rw("10", "28", 13123, 148, -22.8018, -43.255199, -22.7922, -43.217701),
      rw("15", "33", 10433, 154, -22.812401, -43.263699, -22.8291, -43.238499),
    ],
    active: "10", atcName: "Galeão", appName: "Controle Rio",
    freqs: { twr: "118.00", gnd: "121.65", app: "119.35", atis: "127.60" },
    military: false, terminalSide: 1, traffic: BR_CIVIL,
    blurb: "Pista de 4.000 m — a mais longa do Brasil. Baía de Guanabara, Ilha do Governador e o Cristo ao fundo.",
  }),
  ap({
    icao: "SBBR", iata: "BSB", name: "Presidente Juscelino Kubitschek", city: "Brasília", country: "Brasil", flag: "🇧🇷",
    lat: -15.869167, lon: -47.920834, elevFt: 3497,
    runways: [
      rw("11L", "29R", 10499, 148, -15.8636, -47.9235, -15.8617, -47.8977),
      rw("11R", "29L", 10827, 148, -15.8807, -47.94, -15.8787, -47.909199),
    ],
    active: "11L", atcName: "Brasília", appName: "Controle Brasília",
    freqs: { twr: "118.45", gnd: "121.80", app: "119.20", atis: "127.80" },
    military: false, terminalSide: 1, traffic: BR_CIVIL,
    blurb: "Pistas paralelas independentes no Planalto Central, a 1.066 m de altitude, ao lado do Lago Paranoá.",
  }),
  ap({
    icao: "SBYS", iata: "", name: "Academia da Força Aérea (Campo Fontenelle)", city: "Pirassununga", country: "Brasil", flag: "🇧🇷",
    lat: -21.984692, lon: -47.341207, elevFt: 1968,
    runways: [
      rw("02C", "20C", 6923, 148, -21.99379, -47.341168, -21.97535, -47.34124),
      rw("02L", "20R", 6916, 148, -21.99379, -47.342673, -21.97535, -47.342737),
      rw("02R", "20L", 6916, 148, -21.99297, -47.326843, -21.976392, -47.326926),
    ],
    active: "02C", atcName: "Pirassununga", appName: "Controle Pirassununga",
    freqs: { twr: "118.30", gnd: "121.90", app: "120.10", atis: "—" },
    military: true, terminalSide: 1, traffic: [["f16", "JAGUAR 11"], ["c172", "FUMAÇA 01"], ["a10", "HAWG 21"]],
    blurb: "Base militar: casa da Esquadrilha da Fumaça e berço dos pilotos da FAB. Três pistas paralelas no interior paulista.",
  }),
  ap({
    icao: "SBFL", iata: "FLN", name: "Hercílio Luz", city: "Florianópolis", country: "Brasil", flag: "🇧🇷",
    lat: -27.670279, lon: -48.552502, elevFt: 16,
    runways: [
      rw("03", "21", 4331, 148, -27.675278, -48.554167, -27.664722, -48.551667),
      rw("14", "32", 7874, 148, -27.66572, -48.551208, -27.676939, -48.530399),
    ],
    active: "14", atcName: "Florianópolis", appName: "Controle Florianópolis",
    freqs: { twr: "118.70", gnd: "121.70", app: "119.65", atis: "127.45" },
    military: false, terminalSide: 1, traffic: BR_CIVIL,
    blurb: "Ilha de Santa Catarina: mar, morros e a pista 14/32 entre a baía sul e as montanhas.",
  }),
  ap({
    icao: "SBKP", iata: "VCP", name: "Viracopos", city: "Campinas", country: "Brasil", flag: "🇧🇷",
    lat: -23.007404, lon: -47.134502, elevFt: 2170,
    runways: [rw("15", "33", 10630, 148, -22.9985, -47.147, -23.0164, -47.122)],
    active: "15", atcName: "Viracopos", appName: "Controle São Paulo",
    freqs: { twr: "118.25", gnd: "121.90", app: "121.40", atis: "—" },
    military: false, terminalSide: 1, traffic: [["b737", "AZUL 2204"], ["c172", "PT-VCP"], ["a10", "HAWG 21"]],
    blurb: "Campinas: pista de 3.240 m, grande hub de carga do país e base da Azul.",
  }),
  ap({
    icao: "SBEG", iata: "MAO", name: "Eduardo Gomes", city: "Manaus", country: "Brasil", flag: "🇧🇷",
    lat: -3.03861, lon: -60.049702, elevFt: 264,
    runways: [rw("11", "29", 8858, 148, -3.038564, -60.061852, -3.038617, -60.037552)],
    active: "11", atcName: "Manaus", appName: "Controle Manaus",
    freqs: { twr: "118.30", gnd: "121.90", app: "119.70", atis: "127.65" },
    military: false, terminalSide: 1, traffic: BR_CIVIL,
    blurb: "Coração da Amazônia: floresta até o horizonte e o Rio Negro ao sul da pista.",
  }),
  ap({
    icao: "KLSV", iata: "LSV", name: "Nellis Air Force Base", city: "Las Vegas", country: "EUA", flag: "🇺🇸",
    lat: 36.2362, lon: -115.034, elevFt: 1870,
    runways: [
      rw("03L", "21R", 10120, 200, 36.2267, -115.047, 36.2476, -115.024),
      rw("03R", "21L", 10051, 150, 36.2249, -115.044, 36.2456, -115.022),
    ],
    active: "03L", atcName: "Nellis", appName: "Controle Nellis",
    freqs: { twr: "132.55", gnd: "121.80", app: "118.125", atis: "—" },
    military: true, terminalSide: -1, traffic: [["f16", "VIPER 11"], ["fa18", "RHINO 41"], ["a10", "HAWG 21"]],
    blurb: "Lar do Red Flag e dos Thunderbirds. Deserto de Nevada, montanhas e áreas de tiro a perder de vista.",
  }),
  ap({
    icao: "KSFO", iata: "SFO", name: "San Francisco International", city: "San Francisco", country: "EUA", flag: "🇺🇸",
    lat: 37.619806, lon: -122.374821, elevFt: 13,
    runways: [
      rw("10L", "28R", 11870, 200, 37.628742, -122.39341, 37.613538, -122.35716),
      rw("10R", "28L", 11381, 200, 37.626298, -122.393124, 37.61172, -122.358367),
      rw("01L", "19R", 7650, 200, 37.607898, -122.38295, 37.626476, -122.37063),
      rw("01R", "19L", 8660, 200, 37.606333, -122.381061, 37.627346, -122.367124),
    ],
    active: "28L", atcName: "San Francisco", appName: "Aproximação NorCal",
    freqs: { twr: "120.50", gnd: "121.80", app: "128.325", atis: "113.70" },
    military: false, terminalSide: -1, traffic: [["b737", "SOUTHWEST 2210"], ["c172", "N172SP"], ["a10", "HAWG 21"]],
    blurb: "Baía de San Francisco: pistas cruzadas 28/01 sobre a água, Golden Gate e a cidade ao norte.",
  }),
  ap({
    icao: "LOWI", iata: "INN", name: "Innsbruck Kranebitten", city: "Innsbruck", country: "Áustria", flag: "🇦🇹",
    lat: 47.260201, lon: 11.344, elevFt: 1907,
    runways: [rw("08", "26", 6562, 148, 47.2588005, 11.3309002, 47.2616005, 11.3570004)],
    active: "26", atcName: "Innsbruck", appName: "Aproximação Innsbruck",
    freqs: { twr: "120.10", gnd: "121.80", app: "119.275", atis: "126.025" },
    military: false, terminalSide: 1, traffic: [["b737", "AUSTRIAN 902"], ["c172", "OE-DLS"], ["a10", "HAWG 21"]],
    blurb: "Alpes austríacos: vale estreito, picos de 2.600 m dos dois lados e uma das aproximações mais exigentes da Europa.",
  }),
  ap({
    icao: "LPMA", iata: "FNC", name: "Madeira – Cristiano Ronaldo", city: "Funchal", country: "Portugal", flag: "🇵🇹",
    lat: 32.697812, lon: -16.774613, elevFt: 192,
    runways: [rw("05", "23", 9110, 148, 32.689, -16.7848, 32.7068, -16.764)],
    active: "05", atcName: "Madeira", appName: "Aproximação Madeira",
    freqs: { twr: "118.35", gnd: "118.35", app: "119.20", atis: "—" },
    military: false, terminalSide: -1, traffic: [["b737", "TAP 1102"], ["c172", "CS-AVM"], ["a10", "HAWG 21"]],
    blurb: "Pista sobre 180 pilares à beira do Atlântico, penhascos e ventos cruzados traiçoeiros.",
  }),
  ap({
    icao: "TNCM", iata: "SXM", name: "Princess Juliana", city: "Sint Maarten", country: "Caribe", flag: "🇸🇽",
    lat: 18.041, lon: -63.108898, elevFt: 13,
    runways: [rw("10", "28", 7546, 148, 18.039389, -63.1197, 18.042464, -63.098216)],
    active: "10", atcName: "Juliana", appName: "Aproximação Juliana",
    freqs: { twr: "118.70", gnd: "118.70", app: "128.95", atis: "—" },
    military: false, terminalSide: -1, traffic: [["b737", "KLM 785"], ["c172", "PJ-SXM"], ["a10", "HAWG 21"]],
    blurb: "O pouso rasante mais famoso do planeta: poucos metros acima dos banhistas da Maho Beach.",
  }),
  ap({
    icao: "NZQN", iata: "ZQN", name: "Queenstown", city: "Queenstown", country: "Nova Zelândia", flag: "🇳🇿",
    lat: -45.019205, lon: 168.746379, elevFt: 1171,
    runways: [
      rw("05", "23", 6204, 148, -45.020123, 168.734924, -45.016441, 168.758362),
      rw("14", "32", 2920, 33, -45.017185, 168.740906, -45.024769, 168.744568),
    ],
    active: "23", atcName: "Queenstown", appName: "Aproximação Queenstown",
    freqs: { twr: "118.10", gnd: "121.90", app: "125.75", atis: "126.40" },
    military: false, terminalSide: 1, traffic: [["b737", "AIR NZ 615"], ["c172", "ZK-QTN"], ["a10", "HAWG 21"]],
    blurb: "Alpes do Sul, Lago Wakatipu e o cenário de O Senhor dos Anéis. Curvas em vales cercados por montanhas.",
  }),
];

export const TZ: Record<string, string> = {
  SBGR: "America/Sao_Paulo", SBSP: "America/Sao_Paulo", SBRJ: "America/Sao_Paulo", SBGL: "America/Sao_Paulo",
  SBBR: "America/Sao_Paulo", SBYS: "America/Sao_Paulo", SBFL: "America/Sao_Paulo", SBKP: "America/Sao_Paulo",
  SBEG: "America/Manaus", KLSV: "America/Los_Angeles", KSFO: "America/Los_Angeles", LOWI: "Europe/Vienna",
  LPMA: "Atlantic/Madeira", TNCM: "America/Lower_Princes", NZQN: "Pacific/Auckland",
};
export const tzOf = (a: Airport) => TZ[a.icao] ?? "UTC";

/** vento coerente com a pista em uso, igual no cliente e no servidor (muda a cada 10 min) */
export function windFor(runway: string, t = Date.now()): string {
  const num = parseInt(runway, 10) || 9;
  const bucket = Math.floor(t / 600000);
  const wd = ((num * 10 + [-20, -10, 0, 10, 20, 5][bucket % 6] + 360) % 360) || 360;
  return `${String(wd).padStart(3, "0")}°/${String(4 + (bucket % 9)).padStart(2, "0")}kt`;
}

export function qnhNow(t = Date.now()): number {
  return 1010 + (Math.floor(t / 600000) % 7);
}

export const airportByIcao = (icao: string | null | undefined): Airport =>
  AIRPORTS.find((a) => a.icao === icao) ?? AIRPORTS[0];

export const runwayEnds = (a: Airport): string[] => a.runways.flatMap((r) => [r.le.ident, r.he.ident]);

export function runwayOf(a: Airport, ident: string): Runway | undefined {
  return a.runways.find((r) => r.le.ident === ident || r.he.ident === ident);
}