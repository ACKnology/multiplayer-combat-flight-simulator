# SBVS — Simulador de Voo Tático (Next.js + Three.js + PostgreSQL)

Simulador de voo 3D multiplayer com tráfego real ADS-B, meteorologia ao vivo, relógio
astronômico, rádio/TTS em pt-BR e **ATC ao vivo por aeroporto** (Broadcastify).

## ATC ao vivo por aeroporto (Live ATC)

O painel **Live ATC** (tecla `Y`) permite ouvir a comunicação ATC real do aeroporto
**em paralelo** com o ATC do jogo (TTS), que nunca é interrompido.

### Fluxo de uso

1. **Automático** — a cada 5 s o simulador converte a posição do jogador para
   lat/lon e consulta `GET /api/atc/airports/nearest`. Dentro do raio configurado
   (padrão **100 nm**), o painel abre com o aeroporto detectado
   (ex.: “Las Vegas — KLAS”) e a distância.
2. **Por voo ADS-B** — clique em qualquer voo da lista **TRÁFEGO REAL · ADS-B**.
   O backend (`GET /api/atc/recommend`) identifica callsign, aeroporto mais
   próximo (priorizando destino → origem → proximidade), a **fase do voo**
   (táxi, decolagem, subida, cruzeiro, descida, aproximação, pouso) e o **feed
   recomendado**, que começa a tocar automaticamente. Clique de novo no voo
   (ou “SEGUIR MEU VOO”) para voltar ao modo automático.
3. **Manual** — a lista de feeds do aeroporto mostra nome, frequência, tipo
   (Solo/Torre/Aproximação/Saídas/Centro/ATIS) e play/stop por feed; o recomendado
   aparece com o selo ★ RECOMENDADO.

Regra de recomendação por fase: táxi→Ground · decolagem/subida→Tower/Departure ·
descida/aproximação→Approach · pouso→Tower/Ground · rota→Center (com fallbacks;
ATIS nunca é recomendado).

### Mixagem de áudio

Web Audio API com dois canais de ganho independentes — `liveAtcGain` (feed real,
via proxy same-origin) e `simAtcGain` (canal do ATC do jogo). O painel tem
volumes separados, mudo por canal e o modo **Prioridade ATC real** (ducking:
reduz o TTS a 25% enquanto o feed real transmite, detectado por um AnalyserNode).

> **Limitação do navegador:** a `speechSynthesis` API não permite rotear a fala
> sintetizada para dentro do Web Audio. O canal `simAtcGain` é a autoridade de
> volume do TTS: cada fala recebe o volume efetivo do canal (mudo/ducking
> incluídos), aplicado no início da utterance. Áudios do simulador baseados em
> buffer podem ser conectados diretamente ao nó `simAtcGain`.

O player tem play/pause/stop, indicador **AO VIVO** (atividade real do stream),
reconexão automática com backoff exponencial (1 s → 30 s, limite configurável) e
encerramento correto do stream ao trocar de voo/aeroporto ou fechar o painel.
Falha de áudio **nunca bloqueia** o simulador — o TTS continua sozinho.

### Fonte de áudio e credenciais

Fonte: **Broadcastify Live Audio Feed Catalog API** (`https://api.broadcastify.com/audio/`,
configurável). O acesso ao catálogo é uma assinatura do Broadcastify Developer
Program — **sem `BROADCASTIFY_API_KEY` o painel mostra “ATC ao vivo indisponível
para este aeroporto”** e o simulador segue apenas com o TTS. LiveATC **não** é
usado (os termos proíbem consumo automatizado dos streams).

O backend consulta o catálogo (busca geográfica → ICAO → cidade), aplica cache
`ICAO → feeds` com TTL configurável (6–24 h) e **não chama a API a cada clique**
com cache válido. O stream chega ao navegador por `GET /api/atc/stream?id=…`
(proxy same-origin: sem CORS, sem expor chave, URL assinada ou credenciais
premium ao front-end). Logs nunca imprimem a chave.

### Variáveis de ambiente (`.env`)

| Variável | Padrão | Descrição |
|---|---|---|
| `BROADCASTIFY_API_KEY` | — | Chave do catálogo Broadcastify (obrigatória para áudio real) |
| `BROADCASTIFY_API_BASE` | `https://api.broadcastify.com/audio/` | Base da API |
| `BROADCASTIFY_STREAM_BASE` | `https://broadcastify.cdnstream1.com` | Base dos streams |
| `BROADCASTIFY_GEO_ACTION` | `geo` | Ação de busca geográfica do catálogo (ajuste conforme sua licença) |
| `BROADCASTIFY_USERNAME` / `BROADCASTIFY_PASSWORD` | — | Conta Premium p/ streams autenticados (opcional, só servidor) |
| `ATC_SEARCH_RADIUS_NM` | `100` | Raio de detecção de aeroporto |
| `ATC_FEED_CACHE_TTL_HOURS` | `12` | TTL do cache de feeds |
| `ATC_MAX_RECONNECT_ATTEMPTS` | `5` | Limite de reconexões do stream |
| `LIVE_ATC_DEFAULT_VOLUME` | `0.9` | Volume inicial do ATC real (0–1) |
| `SIM_ATC_DEFAULT_VOLUME` | `1` | Volume inicial do ATC do jogo/TTS (0–1) |

### Endpoints

- `GET /api/atc/airports/nearest?lat&lon[&radiusNm&origin&destination]`
- `GET /api/atc/feeds?icao=KLAS[&refresh=1]`
- `GET /api/atc/recommend?callsign&lat&lon[&altFt&gsKt&vsFpm&onGround&origin&destination]`
- `GET /api/atc/stream?id=<feedId>` — proxy do áudio ao vivo

### Controles de luzes, spoiler e vídeo

| Tecla | Função |
|---|---|
| `5` | Luzes de navegação (vermelho/verde/branco) |
| `6` | Beacon — anti-colisão vermelho |
| `7` | Strobes — flash branco duplo |
| `8` | Luzes de pouso/táxi (lente + halo + holofote) |
| `/` ou `9` | Spoiler / freio aerodinâmico (painéis 3D na asa, mata sustentação, aumenta arrasto) |
| `R` | Janela do Radar (+ camada de radar meteorológico WX + destaque ADS-B) |
| `M` | Nova Janela de Mapa Real (visão de cima: Satélite / Ruas, zoom, pan, ADS-B) |
| `Q`/`E` ou `<`/`.` | Leme independente (guinada) |
| `Tab` | Alternar leme + ailerons: separados vs. acoplados |
| `-` / `=` / `0` | Relógio −1 h / +1 h / sincronizar com horário real |
| Mouse (ext.) | Arrastar movimenta câmera 360°, roda dá zoom, duplo clique centraliza |
| `Enter` | Renascer após queda |

O brilho do sol (**glare**) é ajustável no hangar, em *Qualidade gráfica →
“Brilho do sol (glare)”*, de 0 % (suave, ideal para céu encoberto) a 100 %
(forte). A preferência é salva e aplicada na cena em tempo real.

Todas as janelas do HUD (rádio, ADS-B, Live ATC, relógio, luzes, radar) são
movidas **apenas pelo handler de 6 pontos** no canto superior esquerdo — botões,
sliders e o botão de recolher funcionam normalmente — e a posição/estado
aberto-recolhido é persistida por janela.

### Testes

```bash
node scripts/test-atc.mjs
```

## Efeitos de áudio de rádio (Radio Communication Effects)

Camada **opcional** de processamento que faz o ATC do jogo soar como uma transmissão
VHF aeronáutica real. Não substitui o TTS: quando desligada, o comportamento
anterior é preservado byte a byte.

**Onde fica:** configurações do rádio (ícone de engrenagem na janela RÁDIO/CHAT) →
`RADIO COMMUNICATION EFFECTS` (ON/OFF) + perfis + `ADVANCED RADIO AUDIO SETTINGS`.
A preferência é persistida em `localStorage` (`sbvs-voice.radioFx`) e aplicada na hora.
**Vem habilitada por padrão** (`DEFAULT_RADIO_FX.enabled = true`); o jogador pode desligar.

### Módulos

| Arquivo | Papel |
|---|---|
| `src/lib/radio/RadioAudioProcessor.ts` | Cadeia Web Audio: HP 300 Hz → LP 3 kHz → `DynamicsCompressor` (4:1, −24 dB, 5 ms/120 ms) → `WaveShaper` (saturação) → gain → saída; estática, interferências, PTT/squelch, beeps |
| `src/lib/radio/RadioCommunicationManager.ts` | Integração TTS ↔ configurações ↔ processador: fila serial, fallback único, status, contadores |
| `src/lib/radio/profiles.ts` | Perfis `TOWER` (limpo), `AIRCRAFT` (moderado) e `WEAK SIGNAL` (degradado) |
| `src/lib/radio/settings.ts` | Defaults e normalização retrocompatível das preferências |
| `src/lib/radio/text.ts` | Limpeza do texto, fatiamento para o provedor e estimativa de cadência |
| `src/app/api/tts/route.ts` | Proxy que **obtém** o áudio TTS (MP3) para o navegador — sem processamento no servidor |

### Fluxo

1. O ATC (ou um piloto) gera o texto; a limpeza é a mesma para os dois caminhos.
2. **Efeitos OFF** → `speechSynthesis` exatamente como antes (sem rede, sem DSP).
3. **Efeitos ON** → `/api/tts` devolve MP3 (cache de 12 h por texto) → o navegador injeta
   o áudio na cadeia Web Audio → o resultado é reproduzido. O TTS nativo **não** é chamado
   (sem duplicação).
4. Se provedor/decodificação/`AudioContext` falharem → **um único** fallback para o TTS
   nativo e o status fica visível como `FALHA — VOZ NATIVA`; a próxima fala tenta de novo.

**Cadência:** o áudio do provedor pode vir lento; o processador usa `HTMLAudioElement`
com `preservesPitch` para acelerar até 2,4× mantendo o tom (17 s → ~7 s no exemplo testado).

### Desempenho e recursos

- Um único `AudioContext` por sessão de voo; buffers de ruído reaproveitados.
- Nós desconectados, `ObjectURL`s revogados e timers limpos ao fim de cada transmissão.
- Fila com limite (8) descartando a mensagem mais antiga; nunca duas vozes simultâneas.
- Desligar os efeitos interrompe imediatamente a fala em curso.

### Testes

```bash
node scripts/test-radio.mjs   # 22 testes: perfis, cache/config, fila, fallback, cadência
```

Também há verificação em navegador real cobrindo: OFF preserva o TTS (contador de
`speechSynthesis.speak`), ON não duplica a fala, alternância imediata, persistência após
recarregar, sons de PTT/encerramento configuráveis, um único `AudioContext` após várias
transmissões, ausência de estática residual, interrupção ao desligar e recuperação após
falha do provedor.

### Limitações honestas

- `speechSynthesis` do navegador **não** expõe o áudio para a Web Audio API; por isso o
  caminho processado usa um provedor TTS em MP3 via proxy. Sem rede/provedor, o sistema
  cai no TTS nativo (comportamento antigo) em vez de ficar mudo.
- O proxy usa um endpoint público de TTS; se ele bloquear/limitar, o fallback é automático.
- Acelerar acima de ~2× deixa a fala mais "apressada" (típico de rádio), mas ainda inteligível.


21 testes (`node:test`, sem dependências novas) cobrindo: aeroporto mais próximo
(e prioridade destino/origem), fases de voo, recomendação por fase, parser do
catálogo, cache TTL e tratamento de falha da API (sem chave, HTTP 500, timeout,
catálogo vazio) — incluindo a não-exposição da chave em mensagens.

### Limitações conhecidas

- O catálogo Broadcastify exige assinatura; sem chave, apenas o TTS do jogo.
- A ação/params exatos da busca geográfica podem variar por licença — por isso
  `BROADCASTIFY_GEO_ACTION` e as bases são configuráveis; o parser aceita os
  formatos comuns de resposta e há fallback por busca textual (ICAO/cidade).
- Origem/destino explícitos raramente vêm no ADS-B; quando ausentes, são
  inferidos pela fase (subindo perto de um campo → origem; descendo → destino).
- A tabela local cobre os aeroportos jogáveis + ~90 hubs mundiais; voos oceânicos
  remotos podem ficar fora de qualquer raio → painel informa e mantém o TTS.
- Ducking do TTS vale a partir da próxima fala (limitação da speechSynthesis).

---

## Sistema Unificado de Aeronaves (Aircraft Registry)

Um único catálogo atende **a aeronave pilotada e o tráfego ADS-B**. Não há dois sistemas.

### Arquitetura

| Arquivo | Papel |
|---|---|
| `src/lib/aircraft/registry.ts` | Catálogo único: 6 procedurais originais + GLB cadastradas, com origem, licença, liveries e flags `flyable`/`usableForTraffic` |
| `src/lib/aircraft/visual.ts` | Instancia a geometria (procedural **ou** GLB) devolvendo sempre a mesma interface `AircraftVisualInstance`, com fallback controlado |
| `src/lib/aircraft/identity.ts` | `AircraftIdentityResolver`: tipo ICAO → geometria; callsign/matricula → operador e livery; cache por hex |
| `src/lib/aircraft/loader.ts` | `AircraftAssetLoader`: GLB via GLTFLoader, cache por URL, descarte de geometrias/materiais |
| `src/lib/aircraft/controller.ts` | `AircraftController`: traduz estados da simulação em articulações visuais (não faz dinâmica de voo) |
| `src/lib/aircraft/discovery.ts` | `Feature Discovery`: aliases de nós, níveis de confiança (confirmed/probable/ambiguous) e manifest de capacidades |
| `src/lib/aircraft/liveries.ts` | `Livery System`: troca texturas/materiais/decals sem recarregar a geometria |
| `src/lib/aircraft/manifest.ts` | Manifestos GLB importados (adicionar aeronave = 1 linha aqui) |
| `src/components/AircraftInspector.tsx` | Inspetor de **ambas** as origens, com teste de articulação |

### O que está preservado

As 6 aeronaves procedurais originais (F-16C, A-10C, Su-35S, F/A-18E, C-172, B738) continuam
sendo a dinâmica de voo, os instrumentos, as câmeras e a animação (spoiler, trem, hélice, luzes).
O motor (`FlightEngine`) segue usando `buildAircraft()` — nada foi reescrito.

### Resolução ADS-B

```
ADS-B → normalização → tipo ICAO → geometria → operador (callsign) → livery → render
```

- **Tipo ICAO** é a referência principal da geometria (`ICAO_TYPE_MAP`, configurável).
- **Callsign** só identifica operador/livery — **nunca** a geometria.
- **Matrícula** identifica aeronave específica.
- Confiança: `high` / `medium` / `low`. Sem operador confiável → livery genérica, geometria correta.
- Cache por `hex`: a resolução **não** roda a cada atualização de posição.

Verificado ao vivo: `TAM4693 (A320)` → geometria b737 + LATAM; `PR-MBA (A320)` sem callsign de
companhia → geometria correta, confiança `medium`, **sem livery inventada**.

### Geometria híbrida

- **Procedural** (`origin: "procedural"`): sempre disponível, sem dependência externa.
- **GLB** (`origin: "glb"`): ids prefixados `glb-*`; `checkAvailability()` faz `HEAD` uma única
  vez por sessão para não repetir requisições a arquivo inexistente. GLB ausente → **fallback
  procedural identificado** (aviso visível no Inspector), nunca falha.

GLB são **visuais**: `flyable: false`. A dinâmica de voo continua nas aeronaves procedurais —
um modelo 3D não carrega dados aerodinâmicos.

### Inspector

Corrige o bug que deixava a tela em branco: o canvas do Three.js vive em um host de DOM criado
fora da árvore React (elimina `removeChild: not a child of this node`). Agora inspeciona as
**10** aeronaves do catálogo, incluindo todas as procedurais originais, com hierarquia,
componentes, confiança, teste de articulação e exportação da configuração.

### Como adicionar uma aeronave GLB (sem tocar no código central)

1. `public/aircraft/<pasta>/model.glb` + `aircraft.json` (id **com prefixo** `glb-`).
2. `public/aircraft/<pasta>/liveries/<livery>/livery.json` (opcional).
3. Acrescente o import em `src/lib/aircraft/manifest.ts`.
4. (Opcional) mapeie o tipo ICAO em `ICAO_TYPE_MAP` para o tráfego ADS-B.
5. Abra `/aircraft` → selecione → **ABRIR INSPECTOR** → valide componentes → **EXPORTAR**.

### Limitações reais

- As 4 GLB inclusas (CC BY 4.0, atribuição em `public/aircraft/LICENSE-modelos-CC-BY.md`) são
  **estáticas**: não têm nós nomeados de aileron/leme, então a descoberta por aliases não
  encontra superfícies. As articulações dos JSONs usam pivôs sintéticos por bounding box —
  **conjecturas para revisão manual no Inspector**, não articulações reais.
- Não há GLB específico por tipo ICAO para a maioria dos tipos: wide-bodies são representados
  pelo 737 procedural ampliado (aproximação visual).
- Liveries de companhia (Gol, LATAM, United…) estão **cadastradas no resolver**, mas os
  arquivos de textura ainda não existem. Hoje todas as GLB usam a pintura de fábrica embutida.
- Conversão FlightGear (AC3D/XML → GLB) não implementada; a arquitetura está preparada.
- Helicóptero procedural não existe: `H60`/`B06` usam o C-172 como proxy até houver GLB.

### Próximos passos

1. GLB com pivôs reais nomeados (Blender) para A320/B738 — habilita ailerons/flaps/trem reais.
2. Texturas de livery por companhia (UV map validado por variante).
3. Mapear mais tipos ICAO na tabela conforme os GLB forem adicionados.
4. Conversor FlightGear → GLB como etapa offline separada.
5. Aplicar livery ao tráfego ADS-B quando a textura existir.


---

## Local de início e vagas de nascimento (multiplayer)

No hangar há a opção **LOCAL DE INÍCIO**:

- **Pátio (padrão)** — malha de 24 vagas ao redor do pátio (78 m para fora, 52 m entre colunas,
  90–110 m entre linhas), fora da área das aeronaves estacionadas.
- **Pista** — fila de decolagem a partir da cabeceira ativa (140 m do limiar), com espaçamento
  `max(60, envergadura × 1,8)` e ocupando no máximo **40 % do comprimento**, para que todo
  piloto mantenha ≥ 60 % de pista disponível na corrida.

Regras de segurança:

1. Vagas da pista são validadas com `insideRunway(...)` — nenhuma fica fora do pavimento
   (evita nascer em colina/grama). Vagas sobre água são descartadas.
2. `pickSpawnSlot()` escolhe a primeira vaga cuja distância mínima para **outras aeronaves**
   (jogadores remotos, tráfego IA e aeronaves estacionadas no solo) seja ≥ `max(45, envergadura × 1,35)`.
   Se todas estiverem ocupadas, usa a que maximiza essa distância.
3. Ordem determinística: na pista, por proximidade da cabeceira (fila); no pátio, por hash do
   indicativo (cada piloto tende a ocupar sempre a mesma vaga).
4. **Proteção de nascimento (4 s):** durante esse período colisões com outras aeronaves são
   ignoradas, e o rebote elástico do trem é suprimido — nascer/renascer nunca causa explosão.

Verificado com dois clientes simultâneos: nascimento a 168 m de distância, quatro `respawn`
seguidos mantendo os mesmos 168 m, sem colisão nem dano.


---

## Flickering do cenário — diagnóstico e correção (v2, geométrica)

### Causa raiz (medida, não deduzida)
O deck pintado das pistas (plano a +0,12 m sobre o terreno) e as faixas de táxi/pátio
(+0,08/+0,09) tinham **folga física menor que a quantização do depth buffer**: com
`near=0,8 / far=95.000 m`, o passo de profundidade em 24 bits vale Δz ≈ d²/(near·2²⁴)
≈ 0,10 m aos 2 km e ≈ 0,6 m aos 5 km — a partir daí, terreno e deck caem no mesmo
bucket e o vencedor do depth test inverte a cada micro-movimento da câmera
(“moeda ao ar por pixel”) = flickering; a ~1 km, inversões de 1–3 px nas bordas.
Segundo contribuinte: a luz direcional seguia a aeronave sem quantização, e o filtro
PCF da shadow map alternava padrões sub-texel (“crawling” de sombra).

### Correção
1. **Geometria, não shader** — `DECK_LEVEL = 0,12` em `terrain.ts`: dentro das zonas
   planas (faixa de pista + pátio), a **mesma função** `height()` eleva terreno
   físico E renderizado a um platô de +0,12 m (feather contínuo pela borda via
   `flatWeight`, sem descontinuidade). Os planos pintados (pista 0,132; taxiway
   0,134; conexões 0,133; pátio 0,135) flutuam ~1,2 cm acima do platô. Onde a
   quantização do depth buffer empatar os dois (distâncias médias), o empate é
   resolvido pela ordem de desenho fixa (terreno `renderOrder 0` → deck `1`):
   o deck **sempre** vence — visibilidade determinística em qualquer distância,
   sem `gl_FragDepth`, sem `logarithmicDepthBuffer`, sem tocar em materiais.
   - Efeito colateral curado: o piso físico (aeronave pilotada, tráfego IA em solo,
     aeronaves estacionadas, luzes) usa `groundHeight` = platô — as rodas encostam
     no deck em vez de afundar 8–12 cm, corrigindo o aspecto “enterrado/emborcado”
     do tráfego dinâmico e dos pousos.
   - Cicatrizes/crateras assentam em `groundHeight + ε` (0,15) — acima do topo do
     deck (0,135) → continuam visíveis sobre a pista.
2. **Snap da shadow map à grade de texels** (`world.updateShadow`): o centro da
   projeção da luz é quantizado ao múltiplo de texel; o mapa de sombras só anda em
   saltos inteiros → padrões PCF idênticos entre quadros → sem crawling.
3. Câmera `far` 95.000→46.000 m (cobre o domo do céu; menos faixa de precisão
   desperdiçada). Mantido.

### O que foi TENTADO e REVERTIDO (registrado para não repetirmos o erro)
Uma primeira versão usou remapeamento logarítmico da profundidade no vertex shader
(como `logarithmicDepthBuffer`, mas sem `gl_FragDepth`, para evitar os drivers móveis
problemáticos). Eliminou o flicker medido, **mas enterrou a pista**: log aplicado por
vértice preserva a planaridade apenas em malha fina; nos tiles de terreno (células de
200–1000 m) a interpolação não-log do triângulo que cruza o plano do olho sangra
profundidade “mais próxima” sobre o deck. Uma variante intermediária (afundar o
terreno em bacia −0,35 m sob o deck) eliminou o flicker mas deixou aeronaves
flutuando na borda da zona — porque separou superfície física de superfície
renderizada. A bisseção empírica (pixel-probe: 97 % → 0,4 % de asfalto) revelou as
duas causas. Conclusão registrada: **a superfície onde os objetos pousam e a
superfície desenhada devem ser a MESMA função**; folga/ordem de desenho resolvem o
depth — não shader.

### Validação (headless, pixel-readback)
- Pista visível na câmera de solo a 120 m / 900 m / 2,4 km: **96,9 / 92,7 / 91,5 %**
  de pixels de asfalto (idêntica ao estado pré-regressão).
- Métrica de flicker (aproximação final a 15 m/quadro, banda de terreno a 6–20 km,
  assinatura = alternância temporal |Δ|≥30 com retorno ao valor anterior):
  **3,69 % antes → 0,00 % depois** no mesmo harness.
- Smoke nas 3 qualidades (sem AA, MSAA, bloom): sem erros GL, todos os modos de
  câmera renderizam, física avança, pouso sem dano.

### Limitações honestas
- Montanhas distantes (10–25 km) com emendas de LOD cujas superfícies geometricamente
  se cruzam ainda podem “cantilar” sub-pixel em slopes íngremes; a névoa (início
  denso ~15 km) e a granularidade da cena reduzem muito, mas não zeram, esse efeito
  em GPUs de baixa precisão. Eliminar por completo exigiria stitch de tesselação
  entre LODs, o que excederia o escopo de “preservar o cenário atual”.
- A folga de 0,47 m é invisível de cima (o deck cobre a bacia por completo dentro da
  zona); na borda da zona (blend de ~300–480 m) existe um pequeno degrau de grama,
  encoberto pelo próprio feather do `flatWeight`.

---

## PRD 01 — Importação e inspeção de aeronaves GLB/GLTF (Inspector)

O Inspector (`/aircraft` → **IMPORTAR AERONAVE**, ou o overlay do catálogo) virou um
visualizador/analisador completo de arquivos 3D, sem upload ao servidor.

### Importação local (navegador/dispositivo)
- Botões **IMPORTAR AERONAVE** / **ABRIR ARQUIVO**, **area de drag-and-drop** (com leitura
  recursiva de pastas via `webkitGetAsEntry`) e **seletor de pasta** de assets.
- **GLB** prioritário; **.gltf + .bin + texturas** via reescrita dos URIs de `buffers`/
  `images` para Object URLs montados a partir dos arquivos companheiros selecionados
  (casamento por basename, case/URL/unicode-insensitive). Loader: exclusivamente o
  `GLTFLoader` do Three.js (sem parser próprio).
- Indicador de progresso com fase textual; validação de extensão/tamanho
  (limites `MAX_FILE_MB=150`/`MAX_TOTAL_MB=200`), contagem de triângulos com aviso em
  2,5M e recusa acima de 9M; erros específicos: formato inválido, `.bin` faltante
  (com os nomes), texturas ausentes (aviso, material neutro), modelo sem geometria,
  falha de decodificação. Nenhuma falha do import afeta o simulador (código isolado
  em `src/lib/aircraft/glbImport.ts`).
- **DESCARREGAR MODELO** e **RESTAURAR MODELO PROCEDURAL**: troca/descarte com liberação
  explícita de geometrias, materiais, texturas e Object URLs (verificado por delta de
  `renderer.info.memory`); nada do import toca no cache do loader do simulador.
  Materiais/texturas marcados `userData.shared` nunca são descartados.

### Visualização
- Órbita + zoom + pan (mouse e toque), enquadramento automático ao importar e predefinições
  **FRENTE / TRÁS / ESQ. / DIR. / TOPO / PERSP**; alterna **perspectiva ⇄ ortográfica**.
- Fundo escuro/claro/grid; controles de **ambiente**, **luz direcional** (intensidade),
  **sombras** (chão receptor com `ShadowMaterial`), **HDRI**: preset estúdio (RoomEnvironment
  via PMREM) ou arquivo **.hdr** próprio; **calibração de escala de visualização**
  (apenas display — o arquivo não é modificado) com sugestão automática de unidade (cm→m).
- Modos de exibição: **material original / wireframe / normais / neutro / texturas**.

### Análise
- **Hierarquia completa** (Scene/Grupos/Meshes/SkinnedMesh/Bones/Câmeras/Luzes) com tipo,
  contagem de triângulos, **ocultar/exibir** nó individual, **seleção** ↔ destaque
  (BoxHelper) no 3D e transformações locais (posição/rotação/escala) do nó selecionado.
- **Stats geométricas**: malhas, vértices, triângulos, materiais, skinned/bones, bbox,
  centro, dimensões em metros pela calibração; orientação de eixos exibida.
- **Materiais PBR**: tipo, base color (swatch), metalness, roughness, opacidade/alpha, e
  chips por canal de textura (`Base Color/Normal/Roughness/Metalness/Emissive/AO/Alpha/Bump`)
  com resolução detectada — tudo derivado dos materiais reais criados pelo loader; os
  originais do arquivo são preservados (swap reversível por modo).
- **Laboratório de animações**: lista `AnimationClip`s (nome/duração), reprodução solo com
  velocidade ajustável via `AnimationMixer`.
- **RE-ANALISAR** reaplica a descoberta de aliases sobre o modelo importado; **EXPORTAR**
  gera um rascunho `aircraft-*.json` (stats, calibração, componentes, materiais, animações,
  avisos) para uso futuro como config de aeronave.

### Cobertura de testes
- **35 unitários** (`node scripts/test-aircraft.mjs`): canonização de URIs, escolha do
  arquivo principal, validação (sem main/acima do limite/aviso sem `.bin`), casamento de
  companheiros, coleta de URIs externos (ignora `data:`), stats/units, dispose seletivo
  (respeita `userData.shared`), canais de textura.
- **E2E em navegador** (Chromium headless + emulação iPhone 13): import GLB sintético
  (2 tri/4 verts/1 mat), fluxo real multi-arquivo (Khronos *Duck* `.gltf`+`.bin`+`.png`
  sidecar → textura 512×512 identificada na aba MATERIAIS), modos de exibição/ortográfica/
  luzes/HDRI sem erros, erro específico de `.bin` faltante, validação de extensão,
  restaurar procedural, **descarte com liberação de GPU comprovada** (geometrias 136→135),
  import por toque no mobile — zero erros de console.

### Limitações reais
- O import é volátil por design (memória do dispositivo): fechar o Inspector descarta o
  modelo; para o tráfego/IA de jogo, o arquivo precisa virar entrada do Registry
  (passo futuro: importar → salvar config → copiar asset para `public/aircraft/`).
- Arquivos `.gltf` que referenciam texturas por `uri` com extensões exóticas dependem do
  decodificador do navegador; formatos como DDS/KTX2 exigem setKTX2Loader (fora do escopo).
- A seleção de pasta usa `webkitdirectory` (Chromium/Safari/Android OK; Firefox desktop
  suporta; ambientes sem suporte usam o seletor múltiplo normal).

---

## PRD 02 — Laboratório de animações e articulações

Uma aeronave importada **não** está pronta para o simulador só por carregar. A aba
**LABORATÓRIO** do Inspector identifica, configura, testa e valida seus componentes
móveis — e usa **o mesmo** `ArticulationEngine` que a camada visual da simulação
(`src/lib/aircraft/articulation.ts`), sem criar física nova.

### A. Animações incorporadas
Lista de `AnimationClip`s do GLB com seleção, reprodução, **pausa**, **reinício**,
**loop** (LoopRepeat/LoopOnce), **velocidade** 0,1–2× e parada. `AnimationMixer`
é atualizado no loop do viewer; clipes ausentes não impedem as articulações.

### B. Articulações procedurais
Cada articulação: objeto (dropdown da hierarquia), pai exibido, **eixo** (X/Y/Z ou
vetor), **sentido** (inversão), **ângulo neutro**, mín/máx, **atuação** (slew),
**escala** (gain°), **pivô** automático (centro da bbox) ou manual XYZ, com
visualização do centro de rotação + eixo no 3D (esferas, AxesHelper, ArrowHelper).
O pivô é um **grupo intermediário** criado por `attach()` — geometria e hierarquia
originais são restauradas integralmente no `dispose()`. Suporta **translação linear**
(amortecedores/trem) além de rotação.
- Um comando → vários objetos; objetos independentes; `channel: custom` para livres.
- Catálogo com **27 grupos** (ailerons L/R, profundores L/R, leme, flaps L/R,
  spoilers, trem dianteiro/principal L/R, portas, rodas, amortecedores, hélice, fan,
  compressor, turbina, escapamento, pós-combustão, fumaça, canopy, freios, portas de
  armamentos, reversores) — todos opcionais.
- **Presets** (não impositivos): jato militar, jato civil, aeronave a hélice; todos os
  parâmetros editáveis. **AUTO-DETECTAR** casa nomes de nós (`Aileron_L`, `Rudder`,
  `Gear_Nose`…) com aliases e informa a confiança (95% exato / 55% frouxo).
- Controles interativos: slider −100…+100%, campos numéricos, botões de posição
  predefinida (−100/−50/neutro/+100%) e volta ao comando; sequência automática.

### C. Testes
Botões independentes **TESTAR AILERONS / PROFUNDOR / LEME / FLAPS / SPOILERS /
TREM DE POUSO / MOTOR / PÓS-COMBUSTÃO** + **SEQUÊNCIA COMBINADA** (todos os canais
em seno). Verificado no E2E: ao testar ailerons, o esquerdo sobe (+15,96°) e o
direito desce (−15,96°) conforme o mapeamento; nenhum eixo é presumido — o usuário
calibra.

### Mapeamento e integração com o motor de voo
`toArticulationState(s, dt)` é a **única** conversão dos estados físicos
(`rollIn/pitchIn/yawIn/flaps/spoilerPos/gearPos/eng/propAngle…`) para os canais
`aileron/elevator/rudder/flaps/spoiler/gear/throttle/afterburner/propeller/…`.
É usada pelo laboratório **e** por `visual.ts` (`buildGlbVisual`): quando há uma
config de sessão salva (`sbvs-lab:<id>`, session+localStorage), o mesmo
`ArticulationEngine` é instanciado na simulação e recebe os estados do motor a
cada quadro. A física/aerodinâmica continua 100% no `FlightEngine`.
- **SALVAR SESSÃO** persiste `LabConfig` (versão, preset, articulações, clipe);
  **USAR NA SIMULAÇÃO** grava também na chave lida pelo Registry (`config.id`) para
  aeronaves GLB cadastradas. **EXPORTAR** inclui `lab` no `aircraft-*.json`.

### Cobertura
- **49 unitários** (`node scripts/test-aircraft.mjs`): aliases/presets, comando→graus,
  limites/neutro/inversão, um comando para múltiplos objetos, slew, manual vs comando,
  sequência, pivô com restauração de pai/quaternion/geometria, rebind de objeto,
  translação linear, serialize/roundtrip de sessão, `toArticulationState`.
- **E2E** (Chromium + GLB de teste com 7 nós nomeados e 1 `AnimationClip`): import,
  clip tocando com loop/velocidade, slider manual → `manual=1`, eixo Y, inversão,
  teste pareado de ailerons em sentidos opostos, trem + combinado, 3 presets,
  auto-detecção, marcadores de pivô, sessão persistida (7 articulações), exportar,
  restaurar procedural (mecanismo reinstalado sem regressão), **zero erros**.

### Limitações reais
- Modelos importados localmente não entram automaticamente no tráfego/IA: para o
  motor de voo usar a config é preciso cadastrar o GLB no Registry (ver PRD 01) e
  abrir a aeronave pelo catálogo — o botão USAR NA SIMULAÇÃO explica isso na UI.
- Rotação de `SkinnedMesh`/bones é responsabilidade das animações incorporadas; as
  articulações procedurais atuam sobre `Object3D` (nós/grupos/meshes).
- Pivô automático usa o centro da bounding box — em superfícies complexas pode exigir
  ajuste manual do XYZ (a UI permite e mostra o centro no 3D).
