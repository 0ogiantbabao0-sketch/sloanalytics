import { createHash, randomUUID } from "node:crypto";
import { mkdir, open, unlink } from "node:fs/promises";
import { createReadStream } from "node:fs";
import { resolve } from "node:path";
import { Readable } from "node:stream";
import { parse } from "csv-parse";
import type { DatabaseSync } from "node:sqlite";
import { requireSource } from "./managed-sources";
import { kinds, type ImportKind, suggestMapping } from "./csv-dictionary";
export const limit = (name: string, fallback: number) => {
  const n = Number(process.env[name]);
  return Number.isSafeInteger(n) && n > 0 ? n : fallback;
};
export type CsvFile = {
  id: string;
  source_id: string;
  kind: ImportKind;
  filename: string;
  path: string;
  sha256: string;
  encoding: string;
  delimiter: string;
  headers_json: string;
  signature: string;
  status: string;
  row_count: number;
  config_json: string | null;
  summary_json: string | null;
  created_at: string;
  error: string | null;
};
export function getFile(db: DatabaseSync, id: string) {
  const f = db.prepare("SELECT * FROM import_files WHERE id=?").get(id) as
    CsvFile | undefined;
  if (!f) throw new Error("ファイルがありません");
  return f;
}
export function headerSignature(headers: string[]) {
  return createHash("sha256").update(JSON.stringify(headers)).digest("hex");
}
export async function stageCsv(
  db: DatabaseSync,
  body: ReadableStream<Uint8Array>,
  options: {
    source: string;
    kind: ImportKind;
    filename: string;
    mode: "demo" | "real";
    encoding?: string;
    delimiter?: string;
  },
) {
  requireSource(db, options.source);
  if (!kinds.includes(options.kind)) throw new Error("CSV種別が不正です");
  if (!/\.(csv|tsv)$/i.test(options.filename))
    throw new Error("CSVまたはTSVを指定してください（ExcelはCSVで保存）");
  const id = randomUUID(),
    dir = resolve(process.env.DATA_DIR || "data", "imports", options.mode);
  await mkdir(dir, { recursive: true });
  const path = resolve(dir, `${id}.csv`),
    handle = await open(path, "wx", 0o600),
    hash = createHash("sha256");
  const reader = body.getReader();
  let bytes = 0;
  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      bytes += value.length;
      if (bytes > limit("IMPORT_MAX_BYTES", 20_000_000)) {
        await reader.cancel();
        throw new Error("アップロード上限を超えました");
      }
      hash.update(value);
      await handle.write(value);
    }
  } catch (e) {
    await handle.close();
    await unlink(path);
    throw e;
  }
  await handle.close();
  let encoding = options.encoding || "auto",
    delimiter = options.delimiter || "auto",
    headers: string[] = [],
    count = 0;
  try {
    if (!["auto", "utf-8", "shift_jis"].includes(encoding))
      throw new Error("文字コードが不正です");
    if (encoding === "auto") {
      const decoder = new TextDecoder("utf-8", { fatal: true });
      try {
        for await (const chunk of createReadStream(path))
          decoder.decode(chunk, { stream: true });
        decoder.decode();
        encoding = "utf-8";
      } catch {
        encoding = "shift_jis";
      }
    }
    const file = await open(path, "r");
    const sample = Buffer.alloc(65536);
    const read = await file.read(sample, 0, sample.length, 0);
    await file.close();
    const sampleText = new TextDecoder(encoding).decode(
      sample.subarray(0, read.bytesRead),
    );
    if (delimiter === "auto") {
      const first = sampleText.split(/\r\n|\n|\r/)[0];
      let quoted = false;
      const counts = new Map([
        [",", 0],
        ["\t", 0],
        [";", 0],
      ]);
      for (let i = 0; i < first.length; i++) {
        const c = first[i];
        if (c === '"') {
          if (quoted && first[i + 1] === '"') {
            i++;
            continue;
          }
          quoted = !quoted;
        } else if (!quoted && counts.has(c)) counts.set(c, counts.get(c)! + 1);
      }
      delimiter = [...counts].sort((a, b) => b[1] - a[1])[0][0];
    }
    if (![",", "\t", ";"].includes(delimiter))
      throw new Error("区切り文字が不正です");
    const decoder = new TextDecoder(encoding, { fatal: true });
    async function* decoded() {
      for await (const chunk of createReadStream(path))
        yield decoder.decode(chunk, { stream: true });
      yield decoder.decode();
    }
    db.prepare(
      "INSERT INTO import_files(id,source_id,kind,filename,path,sha256,encoding,delimiter,headers_json,signature,status,created_at) VALUES(?,?,?,?,?,?,?,?,?,?,?,?)",
    ).run(
      id,
      options.source,
      options.kind,
      options.filename.slice(0, 255),
      path,
      hash.digest("hex"),
      encoding,
      delimiter,
      "[]",
      "",
      "uploading",
      new Date().toISOString(),
    );
    const stream = Readable.from(decoded());
    const parser = stream.pipe(
      parse({
        delimiter,
        bom: true,
        skip_empty_lines: true,
        max_record_size: limit("IMPORT_MAX_RECORD_BYTES", 100000),
        relax_column_count: true,
      }),
    );
    stream.on("error", (e) => parser.destroy(e));
    let batch: { line: number; raw: string }[] = [];
    const flush = () => {
      db.exec("BEGIN IMMEDIATE");
      try {
        const stmt = db.prepare(
          "INSERT INTO import_rows(file_id,line,raw_json) VALUES(?,?,?)",
        );
        for (const r of batch) stmt.run(id, r.line, r.raw);
        db.exec("COMMIT");
        batch = [];
      } catch (e) {
        if (db.isTransaction) db.exec("ROLLBACK");
        throw e;
      }
    };
    let first = true;
    for await (const record of parser) {
      if (first) {
        headers = record.map((v: string) => v.trim());
        first = false;
        if (
          !headers.length ||
          headers.length > 100 ||
          headers.some((h) => !h) ||
          new Set(headers).size !== headers.length
        )
          throw new Error("ヘッダーが空・重複、または100列を超えています");
        continue;
      }
      count++;
      if (count > limit("IMPORT_MAX_ROWS", 100000))
        throw new Error("処理件数の上限を超えました");
      batch.push({ line: count + 1, raw: JSON.stringify(record) });
      if (batch.length >= 500) flush();
    }
    if (!count) throw new Error("データ行がありません");
    flush();
    const signature = headerSignature(headers);
    db.prepare(
      "UPDATE import_files SET headers_json=?,signature=?,status='staged',row_count=? WHERE id=?",
    ).run(JSON.stringify(headers), signature, count, id);
    const saved = db
      .prepare("SELECT * FROM csv_mappings WHERE source_id=? AND kind=?")
      .get(options.source, options.kind) as
      { signature: string; mapping_json: string } | undefined;
    return {
      id,
      headers,
      encoding,
      delimiter,
      count,
      samples: db
        .prepare(
          "SELECT line,raw_json FROM import_rows WHERE file_id=? ORDER BY line LIMIT 5",
        )
        .all(id),
      mapping:
        saved?.signature === signature
          ? JSON.parse(saved.mapping_json)
          : suggestMapping(headers),
      formatChanged: !!saved && saved.signature !== signature,
    };
  } catch (e) {
    db.prepare(
      "UPDATE import_files SET status='failed',error=? WHERE id=?",
    ).run(e instanceof Error ? e.message : "解析失敗", id);
    throw e;
  }
}
