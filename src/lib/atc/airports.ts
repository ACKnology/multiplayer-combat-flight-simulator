// Detecção de aeroporto próximo — reutiliza a base de aeroportos do simulador
// (src/sim/airports.ts, dados OurAirports) e a complementa com hubs mundiais
// para que a detecção funcione perto de qualquer voo ADS-B.
import { AIRPORTS } from "@/sim/airports";
import type { AtcAirport, NearestResult } from "./types";

// [icao, iata, nome, cidade, país, lat, lon, elevFt]
type Row = [string, string, string, string, string, number, number, number];

const EXTRA: Row[] = [
  ["KLAS", "LAS", "Harry Reid International", "Las Vegas", "EUA", 36.0801, -115.1523, 2181],
  ["KJFK", "JFK", "John F. Kennedy International", "Nova York", "EUA", 40.6398, -73.7789, 13],
  ["KLAX", "LAX", "Los Angeles International", "Los Angeles", "EUA", 33.9425, -118.408, 125],
  ["KORD", "ORD", "Chicago O'Hare International", "Chicago", "EUA", 41.9786, -87.9048, 672],
  ["KATL", "ATL", "Hartsfield–Jackson Atlanta", "Atlanta", "EUA", 33.6367, -84.4281, 1026],
  ["KDFW", "DFW", "Dallas/Fort Worth International", "Dallas", "EUA", 32.8968, -97.038, 607],
  ["KDEN", "DEN", "Denver International", "Denver", "EUA", 39.8617, -104.673, 5431],
  ["KMIA", "MIA", "Miami International", "Miami", "EUA", 25.7932, -80.2906, 8],
  ["KBOS", "BOS", "Boston Logan International", "Boston", "EUA", 42.3643, -71.0052, 20],
  ["KIAD", "IAD", "Washington Dulles International", "Washington", "EUA", 38.9445, -77.4558, 312],
  ["KEWR", "EWR", "Newark Liberty International", "Newark", "EUA", 40.6925, -74.1687, 18],
  ["KLGA", "LGA", "LaGuardia", "Nova York", "EUA", 40.7772, -73.8726, 21],
  ["KPHX", "PHX", "Phoenix Sky Harbor", "Phoenix", "EUA", 33.4343, -112.0116, 1135],
  ["KSEA", "SEA", "Seattle–Tacoma International", "Seattle", "EUA", 47.449, -122.3093, 433],
  ["KSAN", "SAN", "San Diego International", "San Diego", "EUA", 32.7336, -117.1897, 17],
  ["KIAH", "IAH", "George Bush Intercontinental", "Houston", "EUA", 29.9844, -95.3414, 97],
  ["KHOU", "HOU", "William P. Hobby", "Houston", "EUA", 29.6454, -95.2789, 46],
  ["KMCO", "MCO", "Orlando International", "Orlando", "EUA", 28.4294, -81.3089, 96],
  ["KFLL", "FLL", "Fort Lauderdale–Hollywood", "Fort Lauderdale", "EUA", 26.0726, -80.1527, 9],
  ["KPHL", "PHL", "Philadelphia International", "Filadélfia", "EUA", 39.8719, -75.2411, 36],
  ["KDCA", "DCA", "Ronald Reagan Washington National", "Washington", "EUA", 38.8521, -77.0377, 15],
  ["KMSP", "MSP", "Minneapolis–Saint Paul", "Minneapolis", "EUA", 44.882, -93.2218, 841],
  ["KDTW", "DTW", "Detroit Metropolitan", "Detroit", "EUA", 42.2124, -83.3534, 645],
  ["KCLT", "CLT", "Charlotte Douglas", "Charlotte", "EUA", 35.214, -80.9431, 748],
  ["KBNA", "BNA", "Nashville International", "Nashville", "EUA", 36.1245, -86.6782, 599],
  ["KAUS", "AUS", "Austin–Bergstrom", "Austin", "EUA", 30.1945, -97.6699, 542],
  ["KSLC", "SLC", "Salt Lake City International", "Salt Lake City", "EUA", 40.7884, -111.9778, 4227],
  ["KPDX", "PDX", "Portland International", "Portland", "EUA", 45.5887, -122.5975, 31],
  ["PHNL", "HNL", "Daniel K. Inouye International", "Honolulu", "EUA", 21.3187, -157.9225, 13],
  ["PANC", "ANC", "Ted Stevens Anchorage", "Anchorage", "EUA", 61.1744, -149.9961, 152],
  ["CYYZ", "YYZ", "Toronto Pearson", "Toronto", "Canadá", 43.6772, -79.6306, 569],
  ["CYVR", "YVR", "Vancouver International", "Vancouver", "Canadá", 49.1939, -123.184, 14],
  ["CYUL", "YUL", "Montréal–Trudeau", "Montréal", "Canadá", 45.4706, -73.7408, 118],
  ["MMMX", "MEX", "Cidade do México International", "Cidade do México", "México", 19.4363, -99.0721, 7316],
  ["MPTO", "PTY", "Tocumen International", "Cidade do Panamá", "Panamá", 9.0714, -79.3835, 135],
  ["SKBO", "BOG", "El Dorado International", "Bogotá", "Colômbia", 4.7016, -74.1469, 8361],
  ["SCEL", "SCL", "Arturo Merino Benítez", "Santiago", "Chile", -33.393, -70.7858, 1555],
  ["SAEZ", "EZE", "Ministro Pistarini (Ezeiza)", "Buenos Aires", "Argentina", -34.8222, -58.5358, 67],
  ["SABE", "AEP", "Aeroparque Jorge Newbery", "Buenos Aires", "Argentina", -34.5592, -58.4156, 18],
  ["SBPA", "POA", "Salgado Filho", "Porto Alegre", "Brasil", -29.9944, -51.1714, 11],
  ["SBRF", "REC", "Guararapes", "Recife", "Brasil", -8.1265, -34.9236, 33],
  ["SBSV", "SSA", "Deputado Luís Eduardo Magalhães", "Salvador", "Brasil", -12.9086, -38.3225, 64],
  ["SBCT", "CWB", "Afonso Pena", "Curitiba", "Brasil", -25.5285, -49.1758, 2988],
  ["SBCF", "CNF", "Tancredo Neves (Confins)", "Belo Horizonte", "Brasil", -19.6244, -43.9719, 2715],
  ["SBFZ", "FOR", "Pinto Martins", "Fortaleza", "Brasil", -3.7763, -38.5326, 82],
  ["SBBE", "BEL", "Val de Cans", "Belém", "Brasil", -1.3792, -48.4763, 54],
  ["EDDF", "FRA", "Frankfurt am Main", "Frankfurt", "Alemanha", 50.0333, 8.5706, 364],
  ["EDDM", "MUC", "Munich Franz Josef Strauss", "Munique", "Alemanha", 48.3538, 11.7861, 1487],
  ["EDDB", "BER", "Berlin Brandenburg", "Berlim", "Alemanha", 52.3667, 13.5033, 157],
  ["EGLL", "LHR", "London Heathrow", "Londres", "Reino Unido", 51.4775, -0.4614, 83],
  ["EGKK", "LGW", "London Gatwick", "Londres", "Reino Unido", 51.1481, -0.1903, 202],
  ["EGCC", "MAN", "Manchester", "Manchester", "Reino Unido", 53.3537, -2.275, 257],
  ["EIDW", "DUB", "Dublin", "Dublin", "Irlanda", 53.4213, -6.2701, 242],
  ["LEMD", "MAD", "Adolfo Suárez Madrid–Barajas", "Madri", "Espanha", 40.4719, -3.5626, 1998],
  ["LEBL", "BCN", "Josep Tarradellas Barcelona–El Prat", "Barcelona", "Espanha", 41.2971, 2.0785, 12],
  ["LPPT", "LIS", "Humberto Delgado", "Lisboa", "Portugal", 38.7813, -9.1359, 374],
  ["LIRF", "FCO", "Leonardo da Vinci–Fiumicino", "Roma", "Itália", 41.8045, 12.2508, 15],
  ["LIMC", "MXP", "Milano Malpensa", "Milão", "Itália", 45.6306, 8.7281, 768],
  ["LSZH", "ZRH", "Zurich", "Zurique", "Suíça", 47.4647, 8.5492, 1416],
  ["EHAM", "AMS", "Amsterdam Schiphol", "Amsterdã", "Países Baixos", 52.3086, 4.7639, -11],
  ["EBBR", "BRU", "Brussels", "Bruxelas", "Bélgica", 50.9014, 4.4844, 184],
  ["LFPO", "ORY", "Paris Orly", "Paris", "França", 48.7233, 2.3794, 291],
  ["LFPG", "CDG", "Paris Charles de Gaulle", "Paris", "França", 49.0097, 2.5479, 392],
  ["LTFM", "IST", "Istanbul", "Istambul", "Turquia", 41.2753, 28.7519, 325],
  ["UUEE", "SVO", "Sheremetyevo", "Moscou", "Rússia", 55.9726, 37.4146, 622],
  ["OMDB", "DXB", "Dubai International", "Dubai", "EAU", 25.2528, 55.3644, 62],
  ["OTHH", "DOH", "Hamad International", "Doha", "Catar", 25.2731, 51.6081, 13],
  ["OEJN", "JED", "King Abdulaziz International", "Jeddah", "Arábia Saudita", 21.6796, 39.1565, 48],
  ["HECA", "CAI", "Cairo International", "Cairo", "Egito", 30.1219, 31.4056, 382],
  ["FAOR", "JNB", "O. R. Tambo International", "Joanesburgo", "África do Sul", -26.1392, 28.246, 5558],
  ["FACT", "CPT", "Cape Town International", "Cidade do Cabo", "África do Sul", -33.9648, 18.6017, 151],
  ["VIDP", "DEL", "Indira Gandhi International", "Délhi", "Índia", 28.5665, 77.1031, 777],
  ["VABB", "BOM", "Chhatrapati Shivaji Maharaj", "Mumbai", "Índia", 19.0887, 72.8679, 39],
  ["VOBL", "BLR", "Kempegowda International", "Bengaluru", "Índia", 13.1986, 77.7066, 3000],
  ["VTBS", "BKK", "Suvarnabhumi", "Bangkok", "Tailândia", 13.6811, 100.7473, 5],
  ["WSSS", "SIN", "Singapore Changi", "Singapura", "Singapura", 1.3502, 103.9943, 22],
  ["WMKK", "KUL", "Kuala Lumpur International", "Kuala Lumpur", "Malásia", 2.7456, 101.7099, 69],
  ["RPLL", "MNL", "Ninoy Aquino International", "Manila", "Filipinas", 14.5086, 121.0197, 75],
  ["VHHH", "HKG", "Hong Kong International", "Hong Kong", "China", 22.3089, 113.9146, 28],
  ["ZBAA", "PEK", "Beijing Capital", "Pequim", "China", 40.0801, 116.5846, 116],
  ["ZSPD", "PVG", "Shanghai Pudong", "Xangai", "China", 31.1434, 121.8052, 13],
  ["ZGGG", "CAN", "Guangzhou Baiyun", "Cantão", "China", 23.3924, 113.2988, 50],
  ["RJTT", "HND", "Tokyo Haneda", "Tóquio", "Japão", 35.5523, 139.7798, 35],
  ["RJAA", "NRT", "Narita International", "Tóquio", "Japão", 35.7647, 140.3864, 141],
  ["RKSI", "ICN", "Incheon International", "Seul", "Coreia do Sul", 37.4691, 126.4505, 23],
  ["RCTP", "TPE", "Taiwan Taoyuan", "Taipé", "Taiwan", 25.0777, 121.2328, 106],
  ["YSSY", "SYD", "Sydney Kingsford Smith", "Sydney", "Austrália", -33.9461, 151.1772, 21],
  ["YMML", "MEL", "Melbourne", "Melbourne", "Austrália", -37.6733, 144.8433, 434],
  ["YBBN", "BNE", "Brisbane", "Brisbane", "Austrália", -27.3842, 153.1175, 13],
  ["NZAA", "AKL", "Auckland", "Auckland", "Nova Zelândia", -37.0081, 174.7917, 23],
];

let TABLE: AtcAirport[] | null = null;

/** Base completa: aeroportos jogáveis do simulador + hubs mundiais (sem duplicar ICAO). */
export function allAtcAirports(): AtcAirport[] {
  if (TABLE) return TABLE;
  const seen = new Set<string>();
  const out: AtcAirport[] = [];
  for (const a of AIRPORTS) {
    if (a.icao.length !== 4 || seen.has(a.icao)) continue;
    seen.add(a.icao);
    out.push({ icao: a.icao, iata: a.iata, name: a.name, city: a.city, country: a.country, lat: a.lat, lon: a.lon, elevFt: a.elevFt });
  }
  for (const [icao, iata, name, city, country, lat, lon, elevFt] of EXTRA) {
    if (seen.has(icao)) continue;
    seen.add(icao);
    out.push({ icao, iata, name, city, country, lat, lon, elevFt });
  }
  TABLE = out;
  return out;
}

export function airportByIcao(icao: string): AtcAirport | null {
  const k = icao.trim().toUpperCase();
  return allAtcAirports().find((a) => a.icao === k || a.iata === k) ?? null;
}

const NM_PER_M = 1 / 1852;

/** Distância em milhas náuticas (haversine). */
export function distanceNm(lat1: number, lon1: number, lat2: number, lon2: number): number {
  const R = 6371000;
  const dLat = ((lat2 - lat1) * Math.PI) / 180;
  const dLon = ((lon2 - lon1) * Math.PI) / 180;
  const a =
    Math.sin(dLat / 2) ** 2 +
    Math.cos((lat1 * Math.PI) / 180) * Math.cos((lat2 * Math.PI) / 180) * Math.sin(dLon / 2) ** 2;
  return 2 * R * Math.asin(Math.min(1, Math.sqrt(a))) * NM_PER_M;
}

export interface NearestPrefs {
  destination?: string;
  origin?: string;
}

/**
 * Aeroporto mais próximo dentro do raio. Prioridade: destino do voo → origem → mais próximo.
 * `table` é injetável para testes.
 */
export function findNearestAirport(
  lat: number,
  lon: number,
  radiusNm = 100,
  prefs: NearestPrefs = {},
  table: AtcAirport[] = allAtcAirports()
): NearestResult | null {
  if (!Number.isFinite(lat) || !Number.isFinite(lon)) return null;
  const candidates: NearestResult[] = [];
  for (const a of table) {
    const d = distanceNm(lat, lon, a.lat, a.lon);
    if (d <= radiusNm) candidates.push({ airport: a, distanceNm: d });
  }
  if (candidates.length === 0) return null;
  candidates.sort((x, y) => x.distanceNm - y.distanceNm);
  const norm = (s?: string) => (s ?? "").trim().toUpperCase();
  const dest = norm(prefs.destination);
  const orig = norm(prefs.origin);
  if (dest) {
    const hit = candidates.find((c) => c.airport.icao === dest || c.airport.iata === dest);
    if (hit) return hit;
  }
  if (orig) {
    const hit = candidates.find((c) => c.airport.icao === orig || c.airport.iata === orig);
    if (hit) return hit;
  }
  return candidates[0];
}