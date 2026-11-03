/**
 * Downloads the Brazilian municipalities from the IBGE API and writes the compact dataset
 * used by the seed: prisma/seed/data/cities.json -> [[ibgeCode, name, state], ...]
 *
 * Run only when the official list changes: npm run db:seed:fetch-cities
 */
import { mkdir, writeFile } from "node:fs/promises";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const IBGE_URL = "https://servicodados.ibge.gov.br/api/v1/localidades/municipios?orderBy=nome";

interface IbgeMunicipality {
  id: number;
  nome: string;
  microrregiao?: { mesorregiao?: { UF?: { sigla?: string } } } | null;
  "regiao-imediata"?: { "regiao-intermediaria"?: { UF?: { sigla?: string } } } | null;
}

function stateOf(m: IbgeMunicipality): string {
  const sigla =
    m.microrregiao?.mesorregiao?.UF?.sigla ??
    m["regiao-imediata"]?.["regiao-intermediaria"]?.UF?.sigla;
  if (!sigla) throw new Error(`Municipality without state: ${m.id} ${m.nome}`);
  return sigla;
}

async function main() {
  const response = await fetch(IBGE_URL);
  if (!response.ok) throw new Error(`IBGE request failed: ${response.status}`);
  const municipalities = (await response.json()) as IbgeMunicipality[];

  const rows = municipalities
    .map((m) => [m.id, m.nome, stateOf(m)] as const)
    .sort((a, b) => a[0] - b[0]);

  const keys = new Set(rows.map(([, name, state]) => `${state}|${name}`));
  if (keys.size !== rows.length) throw new Error("Duplicate (state, name) found: the unique key would fail");

  const output = resolve(dirname(fileURLToPath(import.meta.url)), "data", "cities.json");
  await mkdir(dirname(output), { recursive: true });
  await writeFile(output, `${JSON.stringify(rows)}\n`);
  console.log(`Wrote ${rows.length} municipalities to ${output}`);
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
