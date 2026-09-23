import { readFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const source = await readFile(path.join(root, "docs", "VISUAL_STYLE.md"), "utf8");

function section(start, end) {
  const from = source.indexOf(`## ${start}\n`);
  const to = source.indexOf(`## ${end}\n`, from + 1);
  if (from < 0 || to < 0) throw new Error(`Missing cover guidance section: ${start} or ${end}`);
  return source.slice(from, to).trim();
}

const brief = [
  "# Brief visual da capa do Tech Topics",
  "",
  "Extraído de docs/VISUAL_STYLE.md. A abertura final do artigo é a fonte da cena; consulte o documento integral somente para revisar casos duvidosos ou alterar a direção visual.",
  "A capa final deve ser salva em assets/<slug>/<slug>-cover.jpg. Não use SVG nem uma URL temporária.",
  "",
  section("Referências canônicas", "Regra permanente: a imagem precisa ser pintura em aquarela"),
  "",
  section("Processo obrigatório antes do prompt", "Template de prompt de capa"),
  "",
  section("Critérios de aceitação da capa", "Capas e arquivos"),
  ""
].join("\n");

if (Buffer.byteLength(brief) > 8192) throw new Error("Cover brief exceeds 8192 bytes; shorten the source sections");
process.stdout.write(brief);
