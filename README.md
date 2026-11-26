# ✈️ SBVS Flight Ops — Simulador de Voo de Combate Multiplayer

Simulador de voo 3D **no navegador**, multiplayer, com aeroportos reais, **tráfego aéreo real (ADS-B)**, **meteorologia ao vivo**, ATC com voz em pt-BR e combate aéreo/ar-solo. Feito com **Next.js 16, React 19, Three.js e PostgreSQL**.

![Hangar e plano de voo](docs/screenshots/hangar.jpg)

## Destaques

- **6 aeronaves pilotáveis** com dinâmica própria: F-16C, A-10C, Su-35S, F/A-18E, Cessna 172 e Boeing 737-800.
- **15 aeroportos reais** (SBGR, SBSP, SBRJ, SBGL, SBBR, SBKP, SBFL, KSFO, LOWI, NZQN, TNCM…) com pistas, táxi e pátio.
- **Tráfego real ADS-B** (adsb.fi / OpenSky) desenhado em 3D, no radar e no mapa — clique num voo para acompanhá-lo em 3D ou ouvir o ATC dele.
- **Clima ao vivo** (Open-Meteo): vento, nuvens, visibilidade, QNH e ATIS gerado automaticamente; relógio astronômico com dia, crepúsculo e noite.
- **Rádio e ATC em pt-BR**: torre e solo com voz sintetizada, efeitos de rádio VHF (filtros, estática, PTT) e chat entre pilotos.
- **Combate**: canhão, bombas, mísseis IR e radar, flares e chaff, alvos hostis (drones, bunkers, tanques) e sistema de dano.
- **Multiplayer** por aeroporto, com vagas de nascimento seguras no pátio ou na pista.
- **Terreno** procedural, satélite (Esri), OpenStreetMap ou Google, com relevo 3D.
- **HUD e cockpit completos**: horizonte artificial, velocímetro, altímetro, variômetro, bússola, radar com camada meteorológica WX e mapa real.
- **Inspector de aeronaves**: importa modelos GLB/GLTF, detecta superfícies móveis e liveries.

## Screenshots

| Na pista, câmera de perseguição | Câmera de cabine |
|---|---|
| ![HUD na pista](docs/screenshots/pista-hud.jpg) | ![Cabine](docs/screenshots/cabine.jpg) |

**Radar com tráfego real ADS-B e alvos hostis**

![Radar e ADS-B](docs/screenshots/radar-adsb.jpg)

## Stack

| Camada | Tecnologia |
|---|---|
| Front-end | Next.js 16 (App Router), React 19, Tailwind CSS 4 |
| 3D | Three.js (cena, terreno, nuvens, efeitos, GLB) |
| Back-end | Rotas de API do Next.js (ADS-B, clima, tiles, TTS, ATC, sync multiplayer) |
| Banco | PostgreSQL + Drizzle ORM (jogadores, eventos, mensagens) |
| Áudio | Web Audio API + Speech Synthesis |

## Como rodar

Requisitos: Node.js 20+ e PostgreSQL.

```bash
git clone https://github.com/ACKnology/multiplayer-combat-flight-simulator.git
cd multiplayer-combat-flight-simulator
npm install

# .env
echo 'DATABASE_URL=postgresql://postgres:postgres@127.0.0.1:5432/app_db' > .env

npx drizzle-kit push   # cria as tabelas
npm run dev            # http://localhost:3000
```

Variáveis opcionais: `GOOGLE_MAPS_API_KEY` (terreno Google Satélite) e `BROADCASTIFY_API_KEY` (áudio ATC real). Sem elas o simulador funciona normalmente com as outras fontes.

## Controles principais

| Tecla | Ação |
|---|---|
| `W/S` ou `↑/↓` | Profundor |
| `A/D` ou `←/→` | Rolagem |
| `Q/E` | Leme |
| `Shift / Ctrl` | Potência + / − |
| `G` · `F` · `B` | Trem · Flaps · Freio |
| `1`–`4` · `Espaço` | Escolher arma · Disparar |
| `Z` / `N` | Flares / Chaff |
| `C` | Trocar câmera |
| `R` · `M` | Radar · Mapa real |
| `V` (segurar) / `T` | Falar no rádio / Chat |
| `H` | Cartão completo de controles |

## Estrutura

```
src/
  app/          páginas e rotas de API (adsb, weather, atc, tts, sync, tiles)
  components/   cockpit, radar, mapa, painéis de rádio, ATC e tráfego
  sim/          motor de voo, mundo, terreno, clima, armas, dano, tráfego
  lib/          aeronaves (registry, GLB, liveries), ATC e efeitos de rádio
  db/           schema Drizzle (PostgreSQL)
public/aircraft modelos 3D (CC BY 4.0)
```

Documentação técnica detalhada (Live ATC, efeitos de rádio, sistema de aeronaves, correção de flickering, importação GLB): [docs/DETALHES-TECNICOS.md](docs/DETALHES-TECNICOS.md).

## Créditos

Modelos 3D de terceiros sob licença CC BY 4.0 — atribuições em [`public/aircraft/LICENSE-modelos-CC-BY.md`](public/aircraft/LICENSE-modelos-CC-BY.md). Dados de tráfego: adsb.fi e OpenSky Network. Clima: Open-Meteo.

---

Desenvolvido por **Christiano D'Avila Medeiros**.
