// Testes do alfabeto fonético ICAO. Executar: node scripts/test-atc.mjs
import { test } from "node:test";
import assert from "node:assert/strict";
import { ICAO_ALPHABET, ICAO_DIGITS, digitsToWords, icaoCallsign, icaoSpeech, lettersToPhonetic } from "../phonetic";

test("alfabeto ICAO completo (26 letras) e 10 dígitos", () => {
  assert.equal(Object.keys(ICAO_ALPHABET).length, 26);
  assert.equal(ICAO_DIGITS.length, 10);
  assert.equal(ICAO_ALPHABET.A, "Alfa");
  assert.equal(ICAO_ALPHABET.J, "Juliett");
  assert.equal(ICAO_ALPHABET.X, "X-ray");
  assert.equal(ICAO_ALPHABET.Z, "Zulu");
});

test("dígitos lidos por extenso", () => {
  assert.equal(digitsToWords("49"), "quatro nove");
  assert.equal(digitsToWords("27"), "dois sete");
  assert.equal(digitsToWords("0"), "zero");
});

test("letras em fonética", () => {
  assert.equal(lettersToPhonetic("TAM"), "Tango Alfa Mike");
  assert.equal(lettersToPhonetic("GOL"), "Golf Oscar Lima");
});

test("indicativo falado no dialeto aeronáutico", () => {
  assert.equal(icaoCallsign("FALCAO 49"), "Falcao quatro nove");
  assert.equal(icaoCallsign("FALCÃO 49"), "Falcão quatro nove");
  assert.equal(icaoCallsign("TAM3589"), "Tango Alfa Mike três cinco oito nove");
  assert.equal(icaoCallsign(""), "");
});

test("fala: QNH, frequência, altitude e nível de voo", () => {
  assert.ok(icaoSpeech("QNH 1013").includes("Q N H um zero um três"));
  assert.ok(icaoSpeech("vento 118.10").includes("um um oito ponto um zero"));
  assert.ok(icaoSpeech("suba 3000 pés").includes("três mil"));
  assert.ok(icaoSpeech("FL250").includes("F L dois cinco zero"));
});

test("fala: indicativo de companhia vira fonética", () => {
  const out = icaoSpeech("TANGO ALFA MIKE, decolagem autorizada");
  assert.ok(out.includes("Tango Alfa Mike"));
  assert.ok(out.includes("decolagem"));
});

test("fala preserva palavras comuns (não fonetiza tudo)", () => {
  const out = icaoSpeech("autorizado decolagem na pista 27");
  assert.ok(out.includes("autorizado"));
  assert.ok(out.includes("dois sete"));
  assert.ok(!out.includes("Alfa"));
});

test("fala nunca fica vazia nem duplica espaços", () => {
  const out = icaoSpeech("  FALCAO  49  ");
  assert.ok(out.length > 0);
  assert.ok(!/\s{2,}/.test(out));
});
